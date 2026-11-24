import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  bootstrapOk,
  bootstrapPluginForbidden,
  bootstrapPluginMissing,
  bootstrapPluginTooNew,
  bootstrapPluginUpdateAvailable,
  bootstrapWpAuthFailed,
  bootstrapWpUnreachable,
  pluginInfo,
  pluginInfoForbidden,
} from '../../../../shared/fixtures/index.ts'
import { BootstrapSchema } from '../../../../shared/library-api.schema.ts'
import type { BundledPlugin } from '../../../../shared/library-api.ts'
import { env } from '../../config/env.ts'
import * as wpClient from '../../config/wpClient.ts'
import {
  callsTo,
  type FakeHandler,
  fakeLibrary,
  libraryApp,
  networkError,
  plugin,
  resetLibrary,
  timeoutError,
  wpErrorResponse,
} from '../../lib/library/specSupport.ts'
import {
  compareSemver,
  MAINTENANCE,
  maintenanceIdle,
  readBundledPlugin,
  resetBootstrapForTests,
} from './bootstrap.ts'

const bundledOk = bootstrapOk.plugin.bundled satisfies BundledPlugin

function fail(error: unknown): FakeHandler {
  return () => {
    throw error
  }
}

beforeEach(() => {
  resetBootstrapForTests(bundledOk)
  vi.spyOn(wpClient, 'invalidateConnection').mockImplementation(() => {})
})

afterEach(async () => {
  await resetLibrary()
})

async function getBootstrap() {
  const res = await request(libraryApp()).get('/bootstrap')
  expect(res.status).toBe(200)
  expect(res.headers['cache-control']).toBe('no-store')
  BootstrapSchema.parse(res.body)
  return res
}

describe('GET bootstrap', () => {
  it('reports a compatible plugin and the site', async () => {
    fakeLibrary()
    const res = await getBootstrap()
    expect(res.body).toEqual(bootstrapOk)
    expect(res.headers['x-library-rev']).toBe(pluginInfo.rev)
  })

  it('caps the upload size at MAX_FILE_SIZE_MB', async () => {
    const original = env.maxFileSizeMb
    env.maxFileSizeMb = 10
    try {
      fakeLibrary()
      const res = await getBootstrap()
      expect(res.body.site.upload.maxBytes).toBe(10 * 1_048_576)
    } finally {
      env.maxFileSizeMb = original
    }
  })

  it('caches /info per rev', async () => {
    const spy = fakeLibrary()
    await getBootstrap()
    await getBootstrap()
    expect(callsTo(spy, plugin('GET', '/info'))).toHaveLength(1)
    expect(callsTo(spy, plugin('GET', '/rev'))).toHaveLength(1)
  })

  it('gives bootstrap’s calls the 10 s timeout', async () => {
    const spy = fakeLibrary()
    await getBootstrap()
    for (const call of callsTo(spy, plugin('GET', '/info'))) {
      expect(call.timeout).toBe(10_000)
    }
  })

  it('reports a missing plugin (rest_no_route)', async () => {
    fakeLibrary({
      [plugin('GET', '/rev')]: fail(wpErrorResponse(404, 'rest_no_route')),
      [plugin('GET', '/info')]: fail(wpErrorResponse(404, 'rest_no_route')),
    })
    expect((await getBootstrap()).body).toEqual(bootstrapPluginMissing)
  })

  it('reports a WordPress user without upload_files, with the plugin version', async () => {
    const forbidden = wpErrorResponse(
      403,
      pluginInfoForbidden.code,
      pluginInfoForbidden.message,
      pluginInfoForbidden.data,
    )
    const spy = fakeLibrary({
      [plugin('GET', '/rev')]: fail(
        wpErrorResponse(403, 'wpu_forbidden', 'No upload_files.'),
      ),
      [plugin('GET', '/info')]: fail(forbidden),
    })
    expect((await getBootstrap()).body).toEqual(bootstrapPluginForbidden)
    expect(callsTo(spy, plugin('GET', '/info'))).toHaveLength(1)
  })

  it('reports a plugin newer than this app understands', async () => {
    fakeLibrary({
      [plugin('GET', '/info')]: () => ({
        ...pluginInfo,
        version: '2.0.0',
        api: '2.0',
      }),
    })
    expect((await getBootstrap()).body).toEqual(bootstrapPluginTooNew)
  })

  it('reports an outdated plugin, with the whole changelog it lacks', async () => {
    const bundled: BundledPlugin = {
      version: '1.0.0',
      api: '1.0',
      features: [],
      changelog: [
        { version: '1.0.0', date: '2026-12-01', changes: ['First release.'] },
        { version: '0.9.0', date: '2026-11-01', changes: ['Beta.'] },
      ],
    }
    resetBootstrapForTests(bundled)
    fakeLibrary({
      [plugin('GET', '/info')]: () => ({
        ...pluginInfo,
        version: '0.9.0',
        api: '0.9',
      }),
    })
    const { body } = await getBootstrap()
    expect(body.wp).toEqual({ state: 'ok', message: null })
    expect(body.site).toBeNull()
    expect(body.rev).toBeNull()
    expect(body.plugin).toMatchObject({
      state: 'outdated',
      version: '0.9.0',
      api: '0.9',
      message:
        'The companion plugin is version 0.9.0; this app needs API 1.0 or newer.',
    })
    expect(body.plugin.bundled.changelog).toEqual([bundled.changelog[0]])
  })

  it('offers a newer bundled plugin', async () => {
    resetBootstrapForTests(bootstrapPluginUpdateAvailable.plugin.bundled)
    fakeLibrary()
    expect((await getBootstrap()).body).toEqual(bootstrapPluginUpdateAvailable)
  })

  it('reports no bundled plugin without its sidecars', async () => {
    resetBootstrapForTests(null)
    fakeLibrary()
    const { body } = await getBootstrap()
    expect(body.plugin.state).toBe('ok')
    expect(body.plugin.bundled).toBeNull()
  })

  it('reports WordPress unreachable, answering 200', async () => {
    fakeLibrary({
      [plugin('GET', '/rev')]: fail(networkError('ECONNREFUSED')),
      [plugin('GET', '/info')]: fail(networkError('ECONNREFUSED')),
    })
    expect((await getBootstrap()).body).toEqual(bootstrapWpUnreachable)
  })

  it('spends only one timeout when WordPress hangs', async () => {
    const spy = fakeLibrary({
      [plugin('GET', '/rev')]: fail(timeoutError()),
    })
    const { body } = await getBootstrap()
    expect(body.wp).toEqual({
      state: 'unreachable',
      message: 'WordPress did not respond in time.',
    })
    expect(callsTo(spy, plugin('GET', '/info'))).toHaveLength(0)
  })

  it('reports a rejected Application Password', async () => {
    fakeLibrary({
      [plugin('GET', '/rev')]: fail(wpErrorResponse(401, 'incorrect_password')),
    })
    expect((await getBootstrap()).body).toEqual(bootstrapWpAuthFailed)
    expect(wpClient.invalidateConnection).toHaveBeenCalled()
  })

  it('reports another 403 as WordPress refusing the request', async () => {
    fakeLibrary({
      [plugin('GET', '/rev')]: fail(wpErrorResponse(403, 'waf_blocked')),
      [plugin('GET', '/info')]: fail(wpErrorResponse(403, 'waf_blocked')),
    })
    expect((await getBootstrap()).body.wp).toEqual({
      state: 'unreachable',
      message: 'WordPress refused the request (HTTP 403).',
    })
  })

  it('reports a 5xx as unreachable', async () => {
    fakeLibrary({
      [plugin('GET', '/rev')]: fail(
        wpErrorResponse(500, 'internal_server_error'),
      ),
    })
    expect((await getBootstrap()).body.wp).toEqual({
      state: 'unreachable',
      message: 'WordPress failed with HTTP 500.',
    })
  })

  it('reports a malformed /info of a compatible plugin as unreachable', async () => {
    fakeLibrary({
      [plugin('GET', '/info')]: () => ({ ...pluginInfo, upload: null }),
    })
    expect((await getBootstrap()).body.wp.state).toBe('unreachable')
  })
})

describe('maintenance loop', () => {
  const building = {
    media: { state: 'building', done: 1, total: 20 },
    usage: { state: 'ready', done: 8, total: 8 },
  }

  it('runs once after the first bootstrap, even when every index is ready', async () => {
    const spy = fakeLibrary()
    await getBootstrap()
    await maintenanceIdle()
    await getBootstrap()
    await maintenanceIdle()
    const steps = callsTo(spy, plugin('POST', '/maintenance/step'))
    expect(steps).toHaveLength(1)
    expect(steps[0]?.data).toEqual({ budgetMs: MAINTENANCE.budgetMs })
  })

  it('steps while there is more to do', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    try {
      let left = 3
      const spy = fakeLibrary({
        [plugin('GET', '/info')]: () => ({ ...pluginInfo, index: building }),
        [plugin('POST', '/maintenance/step')]: () => {
          left -= 1
          return {
            rev: '1',
            locked: false,
            did: { media: 1, usage: 0, folders: 0 },
            more: left > 0,
            index: building,
          }
        },
      })
      await getBootstrap()
      await vi.runAllTimersAsync()
      await maintenanceIdle()
      expect(callsTo(spy, plugin('POST', '/maintenance/step'))).toHaveLength(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops after three errors in a row', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const spy = fakeLibrary({
        [plugin('POST', '/maintenance/step')]: fail(
          wpErrorResponse(500, 'wpu_internal'),
        ),
      })
      await getBootstrap()
      await vi.runAllTimersAsync()
      await maintenanceIdle()
      expect(callsTo(spy, plugin('POST', '/maintenance/step'))).toHaveLength(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops when another server holds the lock five times in a row', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    try {
      const spy = fakeLibrary({
        [plugin('POST', '/maintenance/step')]: () => ({
          rev: '1',
          locked: true,
          did: { media: 0, usage: 0, folders: 0 },
          more: true,
          index: building,
        }),
      })
      await getBootstrap()
      await vi.runAllTimersAsync()
      await maintenanceIdle()
      expect(callsTo(spy, plugin('POST', '/maintenance/step'))).toHaveLength(5)
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops after five steps in a row that did nothing but say more, and stays stopped', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const spy = fakeLibrary({
        [plugin('GET', '/info')]: () => ({ ...pluginInfo, index: building }),
        [plugin('GET', '/rev')]: () => ({
          rev: pluginInfo.rev,
          index: building,
        }),
        // e.g. a plugin whose usage index is a stub: `more` forever.
        [plugin('POST', '/maintenance/step')]: () => ({
          rev: '1',
          locked: false,
          did: { media: 0, usage: 0, folders: 0 },
          more: true,
          index: building,
        }),
      })
      const steps = () => callsTo(spy, plugin('POST', '/maintenance/step'))
      await getBootstrap()
      await vi.runAllTimersAsync()
      await maintenanceIdle()
      expect(steps()).toHaveLength(MAINTENANCE.maxConsecutiveIdle)

      // A rev poll during the cool-down doesn't restart it...
      await request(libraryApp()).get('/rev').expect(200)
      await maintenanceIdle()
      expect(steps()).toHaveLength(MAINTENANCE.maxConsecutiveIdle)

      // ...one after it does.
      vi.advanceTimersByTime(MAINTENANCE.idleCooldownMs)
      await request(libraryApp()).get('/rev').expect(200)
      await vi.runAllTimersAsync()
      await maintenanceIdle()
      expect(steps()).toHaveLength(2 * MAINTENANCE.maxConsecutiveIdle)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps stepping while steps make progress, however long', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    try {
      let left = MAINTENANCE.maxConsecutiveIdle * 2
      const spy = fakeLibrary({
        [plugin('GET', '/info')]: () => ({ ...pluginInfo, index: building }),
        // Idle steps in between progress never add up to a stop.
        [plugin('POST', '/maintenance/step')]: () => {
          left -= 1
          return {
            rev: '1',
            locked: false,
            did: { media: left % 2, usage: 0, folders: 0 },
            more: left > 0,
            index: building,
          }
        },
      })
      await getBootstrap()
      await vi.runAllTimersAsync()
      await maintenanceIdle()
      expect(callsTo(spy, plugin('POST', '/maintenance/step'))).toHaveLength(
        MAINTENANCE.maxConsecutiveIdle * 2,
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not run without the maintenance feature', async () => {
    const spy = fakeLibrary({
      [plugin('GET', '/info')]: () => ({
        ...pluginInfo,
        features: pluginInfo.features.filter((f) => f !== 'maintenance'),
      }),
    })
    await getBootstrap()
    await maintenanceIdle()
    expect(callsTo(spy, plugin('POST', '/maintenance/step'))).toHaveLength(0)
  })
})

describe('route guards', () => {
  it('blocks library routes while the plugin is missing, but not bootstrap', async () => {
    fakeLibrary({
      [plugin('GET', '/rev')]: fail(wpErrorResponse(404, 'rest_no_route')),
      [plugin('GET', '/info')]: fail(wpErrorResponse(404, 'rest_no_route')),
    })
    const res = await request(libraryApp()).get('/collection')
    expect(res.status).toBe(409)
    expect(res.body).toEqual({
      code: 'plugin_incompatible',
      message: 'The companion plugin was not found on the WordPress site.',
      details: { state: 'missing' },
    })
    expect((await request(libraryApp()).get('/bootstrap')).status).toBe(200)
  })

  it('lets routes report WordPress being unreachable themselves', async () => {
    fakeLibrary({
      [plugin('GET', '/rev')]: fail(networkError()),
      [plugin('GET', '/info')]: fail(networkError()),
    })
    const res = await request(libraryApp()).get('/folders')
    expect(res.status).toBe(502)
    expect(res.body.code).toBe('wp_unreachable')
  })

  it('answers feature_unavailable when the plugin lacks a feature', async () => {
    fakeLibrary({
      [plugin('GET', '/info')]: () => ({
        ...pluginInfo,
        features: pluginInfo.features.filter((f) => f !== 'folders'),
      }),
    })
    const res = await request(libraryApp()).get('/folders')
    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({
      code: 'feature_unavailable',
      details: { feature: 'folders' },
    })
  })

  it('re-reads /info at most every 5 minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const spy = fakeLibrary({
        [plugin('GET', '/folders')]: () => ({
          rev: pluginInfo.rev,
          mode: {
            pro: false,
            perUser: false,
            readOnly: false,
            colorsWritable: false,
          },
          folders: [],
          counts: { all: 0, uncategorized: 0 },
        }),
      })
      await request(libraryApp()).get('/folders')
      vi.advanceTimersByTime(60_000)
      await request(libraryApp()).get('/folders')
      expect(callsTo(spy, plugin('GET', '/info'))).toHaveLength(1)
      vi.advanceTimersByTime(5 * 60_000)
      await request(libraryApp()).get('/folders')
      expect(callsTo(spy, plugin('GET', '/info'))).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('compareSemver', () => {
  it.each([
    ['1.0.1', '1.0.0', 1],
    ['1.0.0', '1.0.1', -1],
    ['1.10.0', '1.9.0', 1],
    ['1.0.0', '1.0.0', 0],
    ['1.0.0', '1.0.0-dev.3', 1],
    ['1.0.0-dev.3', '1.0.0-dev.10', -1],
    ['1.0.0-beta', '1.0.0-alpha', 1],
    ['1.0.0-dev.3', '1.0.0-dev', 1],
  ])('%s vs %s', (a, b, sign) => {
    expect(Math.sign(compareSemver(a, b))).toBe(sign)
  })
})

describe('readBundledPlugin', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpu-bundle-'))
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('reads plugin.json and changelog.json', () => {
    fs.writeFileSync(
      path.join(dir, 'plugin.json'),
      JSON.stringify({ version: '1.0.1', api: '1.0', features: ['trash'] }),
    )
    fs.writeFileSync(
      path.join(dir, 'changelog.json'),
      JSON.stringify([
        { version: '1.0.1', date: '2026-11-21', changes: ['Faster.'] },
        { broken: true },
      ]),
    )
    expect(readBundledPlugin(dir)).toEqual({
      version: '1.0.1',
      api: '1.0',
      features: ['trash'],
      changelog: [
        { version: '1.0.1', date: '2026-11-21', changes: ['Faster.'] },
      ],
    })
  })

  it('is null without plugin.json, and tolerates a missing changelog', () => {
    expect(readBundledPlugin(dir)).toBeNull()
    fs.writeFileSync(
      path.join(dir, 'plugin.json'),
      JSON.stringify({ version: '1.0.0', api: '1.0', features: [] }),
    )
    expect(readBundledPlugin(dir)?.changelog).toEqual([])
  })
})
