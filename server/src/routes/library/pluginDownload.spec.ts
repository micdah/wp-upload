import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pluginInfo } from '../../../../shared/fixtures/index.ts'
import { env } from '../../config/env.ts'
import {
  fakeWordPress,
  libraryApp,
  plugin,
  resetLibrary,
  wpErrorResponse,
} from '../../lib/library/specSupport.ts'
import { resetBootstrapForTests } from './bootstrap.ts'

const bundled = {
  version: '1.0.0',
  api: '1.0',
  features: [...pluginInfo.features],
  changelog: [],
}

let dir: string
const originalDir = env.pluginBundleDir

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpu-bundle-spec-'))
  env.pluginBundleDir = dir
  // Even with WordPress down or no plugin: the route needs neither.
  fakeWordPress({
    [plugin('GET', '/info')]: () => {
      throw wpErrorResponse(404, 'rest_no_route')
    },
  })
})

afterEach(async () => {
  env.pluginBundleDir = originalDir
  fs.rmSync(dir, { recursive: true, force: true })
  await resetLibrary()
})

describe('GET plugin/download', () => {
  it('serves the bundled zip with its version as ETag', async () => {
    resetBootstrapForTests(bundled)
    fs.writeFileSync(path.join(dir, 'wp-upload-companion.zip'), 'PK zip bytes')
    const res = await request(libraryApp())
      .get('/plugin/download')
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => done(null, Buffer.concat(chunks)))
      })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('application/zip')
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="wp-upload-companion-1.0.0.zip"',
    )
    expect(res.headers.etag).toBe('"1.0.0"')
    expect(res.headers['cache-control']).toBe(
      'private, max-age=0, must-revalidate',
    )
    expect(res.headers['content-length']).toBe('12')
    expect(res.headers['content-encoding']).toBeUndefined()
    expect((res.body as Buffer).toString()).toBe('PK zip bytes')
  })

  it('answers 304 to its ETag', async () => {
    resetBootstrapForTests(bundled)
    fs.writeFileSync(path.join(dir, 'wp-upload-companion.zip'), 'PK')
    const res = await request(libraryApp())
      .get('/plugin/download')
      .set('If-None-Match', '"1.0.0"')
    expect(res.status).toBe(304)
  })

  it('answers 404 plugin_not_bundled without a zip', async () => {
    resetBootstrapForTests(bundled)
    const res = await request(libraryApp()).get('/plugin/download')
    expect(res.status).toBe(404)
    expect(res.body.code).toBe('plugin_not_bundled')
  })

  it('answers 404 plugin_not_bundled without plugin.json', async () => {
    resetBootstrapForTests(null)
    fs.writeFileSync(path.join(dir, 'wp-upload-companion.zip'), 'PK')
    const res = await request(libraryApp()).get('/plugin/download')
    expect(res.status).toBe(404)
    expect(res.body.code).toBe('plugin_not_bundled')
  })
})
