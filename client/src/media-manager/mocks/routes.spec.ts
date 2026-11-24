// Every mock route, in every scenario: responses satisfy the contract's zod
// schemas (respond.ts reports a violation as a 500 and through the handler
// set here), and the scenario-wide behaviour (guards, states) holds.

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  type Bootstrap,
  type JobsResponse,
  ROW_STRIDE,
} from '../../../../shared/library-api'
import * as S from '../../../../shared/library-api.schema'
import { mockFetch, startFakeBackend, stopFakeBackend } from './node'
import { setSchemaViolationHandler } from './respond'
import { SCENARIO_IDS } from './scenarios'

const violations: string[] = []
const fetchMock = mockFetch()

beforeAll(() => {
  setSchemaViolationHandler((message) => violations.push(message))
})

afterAll(() => {
  setSchemaViolationHandler((message) => console.error(message))
})

afterEach(() => {
  stopFakeBackend()
  expect(violations).toEqual([])
})

function api(path: string, init?: RequestInit): Promise<Response> {
  return fetchMock(`api/library/${path}`, init)
}

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }
}

async function body<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

/** Calls every route once; returns the statuses by route. */
async function exerciseEveryRoute(): Promise<Record<string, number>> {
  const statuses: Record<string, number> = {}
  const record = async (name: string, response: Promise<Response>) => {
    const reply = await response
    statuses[name] = reply.status
    if (reply.status >= 400) {
      S.ApiErrorSchema.parse(await reply.json())
    }
    return reply
  }
  const bootstrap = await body<Bootstrap>(
    await record('bootstrap', api('bootstrap')),
  )
  S.BootstrapSchema.parse(bootstrap)
  await record('rev', api('rev'))
  const collection = await record('collection', api('collection'))
  let ids: number[] = []
  if (collection.ok) {
    const parsed = S.CollectionResponseSchema.parse(await collection.json())
    ids = Array.from(
      { length: Math.min(parsed.total, 5) },
      (_, index) => parsed.rows[index * ROW_STRIDE] ?? 0,
    )
  }
  const first = ids[0] ?? 1000
  const list = ids.length > 0 ? ids.join(',') : '1000'
  await record('facets', api('facets?type=image'))
  await record('items', api(`items?ids=${list}`))
  await record('items-full', api(`items?ids=${list}&view=full`))
  await record('usage', api(`usage?ids=${list}`))
  await record('posts', api('posts?search=a'))
  await record('folders', api('folders'))
  await record('trash', api('trash'))
  await record(
    'patch',
    api(`items/${first}`, json('PATCH', { alt: 'route check' })),
  )
  await record(
    'batch',
    api('items/batch', json('POST', { ids: [first], set: { caption: 'c' } })),
  )
  const folder = await record(
    'folder-create',
    api('folders', json('POST', { name: 'Route check', parent: 0 })),
  )
  const folderId = folder.ok
    ? (await body<{ folder: { id: number } }>(folder)).folder.id
    : 1
  await record(
    'folder-update',
    api(`folders/${folderId}`, json('PATCH', { name: 'Renamed' })),
  )
  await record(
    'folder-assign',
    api('folders/assign', json('POST', { folder: folderId, ids: [first] })),
  )
  await record(
    'folder-delete',
    api(`folders/${folderId}`, { method: 'DELETE' }),
  )
  const item = await (await api(`items?ids=${first}&view=full`))
    .json()
    .catch(() => null)
  const modifiedAt: string =
    item?.items?.[0]?.modifiedAt ?? '2026-01-01T00:00:00Z'
  const jobs: string[] = []
  const job = async (name: string, response: Promise<Response>) => {
    const reply = await record(name, response)
    if (reply.status === 202) {
      jobs.push((await body<{ jobId: string }>(reply)).jobId)
    }
  }
  await job(
    'edit',
    api(
      `items/${first}/edit`,
      json('POST', {
        ops: [{ op: 'flipH' }],
        applyTo: 'all',
        expectedModified: modifiedAt,
      }),
    ),
  )
  await job(
    'undo',
    api(
      `items/${first}/edit/undo`,
      json('POST', { expectedModified: modifiedAt }),
    ),
  )
  await job(
    'restore',
    api(
      `items/${first}/restore`,
      json('POST', { expectedModified: modifiedAt }),
    ),
  )
  const replace = new FormData()
  replace.append(
    'file',
    new File([new Uint8Array([0xff, 0xd8, 0xff])], 'new.jpg', {
      type: 'image/jpeg',
    }),
  )
  replace.append('expectedModified', modifiedAt)
  await job(
    'replace',
    api(`items/${first}/replace`, { method: 'POST', body: replace }),
  )
  await job(
    'regenerate',
    api('items/regenerate', json('POST', { ids: ids.length ? ids : [1000] })),
  )
  const upload = new FormData()
  upload.append(
    'file',
    new File(['hello'], 'notes.txt', { type: 'text/plain' }),
  )
  upload.append('folder', '0')
  await job('upload', api('upload', { method: 'POST', body: upload }))
  const jobList = jobs.length > 0 ? jobs.join(',') : 'unknown-job'
  const polled = await record('jobs', api(`jobs?ids=${jobList}`))
  if (polled.ok) {
    S.JobsResponseSchema.parse(await body<JobsResponse>(polled))
  }
  await record('upload-jobs', api(`upload/jobs?ids=${jobList}`))
  await record(
    'upload-cancel',
    api('upload/jobs/unknown-job', { method: 'DELETE' }),
  )
  await record('upload-check', api('upload/check?filename=notes.txt'))
  await record(
    'delete',
    api('items/delete', json('POST', { ids: [first], mode: 'trash' })),
  )
  await record(
    'trash-restore',
    api('trash/restore', json('POST', { ids: [first] })),
  )
  await record('trash-empty', api('trash/empty', { method: 'POST' }))
  await record('download', api(`items/${first}/download?variant=original`))
  await record('plugin-download', api('plugin/download'))
  return statuses
}

describe('every route in every scenario', () => {
  for (const scenario of SCENARIO_IDS) {
    it(`${scenario}: schema-valid answers`, async () => {
      startFakeBackend(
        scenario,
        scenario === 'large' ? { settings: { largeCount: 3000 } } : {},
      )
      const statuses = await exerciseEveryRoute()
      expect(Object.values(statuses).every((status) => status !== 500)).toBe(
        true,
      )
    })
  }
})

describe('scenario behaviour', () => {
  it('normal: everything works', async () => {
    startFakeBackend('normal')
    const statuses = await exerciseEveryRoute()
    expect(statuses).toMatchObject({
      bootstrap: 200,
      collection: 200,
      patch: 200,
      'folder-create': 201,
      edit: 202,
      upload: 202,
      'upload-cancel': 404,
      'trash-restore': 200,
      download: 200,
      'plugin-download': 200,
    })
    // MEDIA_TRASH is off in `normal`.
    expect(statuses.delete).toBe(409)
  })

  it('plugin states: bootstrap reports them, library routes answer 409', async () => {
    for (const [scenario, state] of [
      ['no-plugin', 'missing'],
      ['plugin-forbidden', 'forbidden'],
      ['plugin-outdated', 'outdated'],
      ['plugin-too-new', 'too-new'],
    ] as const) {
      startFakeBackend(scenario)
      const bootstrap = await body<Bootstrap>(await api('bootstrap'))
      expect(bootstrap.plugin?.state).toBe(state)
      expect(bootstrap.site).toBeNull()
      const collection = await api('collection')
      expect(collection.status).toBe(409)
      expect(await collection.json()).toMatchObject({
        code: 'plugin_incompatible',
      })
      expect((await api('plugin/download')).status).not.toBe(409)
    }
  })

  it('update-available: the app runs', async () => {
    startFakeBackend('plugin-update-available')
    const bootstrap = await body<Bootstrap>(await api('bootstrap'))
    expect(bootstrap.plugin?.state).toBe('update-available')
    expect(bootstrap.site).not.toBeNull()
    expect((await api('collection')).status).toBe(200)
  })

  it('WordPress unreachable or rejecting the password: bootstrap 200, routes 502', async () => {
    for (const [scenario, state, code] of [
      ['wp-unreachable', 'unreachable', 'wp_unreachable'],
      ['wp-auth-failed', 'auth_failed', 'wp_auth_failed'],
    ] as const) {
      startFakeBackend(scenario)
      const bootstrap = await api('bootstrap')
      expect(bootstrap.status).toBe(200)
      expect((await body<Bootstrap>(bootstrap)).wp.state).toBe(state)
      const rev = await api('rev')
      expect(rev.status).toBe(502)
      expect(await rev.json()).toMatchObject({ code })
    }
  })

  it('offline: WordPress goes away after a while', async () => {
    let now = Date.parse('2026-11-22T12:00:00Z')
    startFakeBackend('offline', { clock: () => now })
    expect((await api('rev')).status).toBe(200)
    now += 5000
    expect((await api('rev')).status).toBe(502)
  })

  it('no-filebird: items have no folder, folder routes answer 409', async () => {
    startFakeBackend('no-filebird')
    const items = await body<{ items: { folder: number | null }[] }>(
      await api('items?ids=1000'),
    )
    expect(items.items[0]?.folder).toBeNull()
    expect(await (await api('folders')).json()).toMatchObject({
      code: 'wpu_filebird_inactive',
    })
  })

  it('pro: colours are shown and writable', async () => {
    startFakeBackend('pro')
    const tree = S.FolderTreeSchema.parse(await (await api('folders')).json())
    expect(tree.mode).toMatchObject({ pro: true, colorsWritable: true })
    expect(tree.folders.some((folder) => folder.color !== null)).toBe(true)
  })

  it('empty: no items, no folders', async () => {
    startFakeBackend('empty')
    const collection = S.CollectionResponseSchema.parse(
      await (await api('collection')).json(),
    )
    expect(collection.total).toBe(0)
  })

  it('indexing: incomplete index and usage', async () => {
    startFakeBackend('indexing')
    const collection = S.CollectionResponseSchema.parse(
      await (await api('collection')).json(),
    )
    expect(collection.indexComplete).toBe(false)
    const items = S.ItemsFullResponseSchema.parse(
      await (await api('items?ids=1000&view=full')).json(),
    )
    expect(items.items[0]?.usageCount).toBeNull()
  })

  it('an expired session answers 401 everywhere under api/library until login', async () => {
    const mock = startFakeBackend('normal')
    mock.session.loggedIn = false
    expect((await api('rev')).status).toBe(401)
    expect((await api('no-such-route')).status).toBe(401)
    expect((await fetchMock('session')).status).toBe(401)
    const login = await fetchMock(
      'session',
      json('POST', { username: 'dev', password: 'x' }),
    )
    expect(login.status).toBe(200)
    expect((await api('rev')).status).toBe(200)
    expect(
      (
        await fetchMock(
          'session',
          json('POST', { username: 'dev', password: 'wrong' }),
        )
      ).status,
    ).toBe(401)
  })

  it('serves placeholder renditions for the URLs it hands out', async () => {
    startFakeBackend('normal')
    const items = S.ItemsTileResponseSchema.parse(
      await (await api('items?ids=1000')).json(),
    )
    const thumb = items.items[0]?.thumb?.url ?? ''
    const response = await fetchMock(thumb)
    expect(response.headers.get('Content-Type')).toBe('image/svg+xml')
    expect(await response.text()).toContain('<svg')
  })
})
