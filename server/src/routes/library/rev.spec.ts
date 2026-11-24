import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { pluginInfo } from '../../../../shared/fixtures/index.ts'
import { RevResponseSchema } from '../../../../shared/library-api.schema.ts'
import {
  callsTo,
  fakeLibrary,
  libraryApp,
  networkError,
  plugin,
  resetLibrary,
  timeoutError,
} from '../../lib/library/specSupport.ts'
import { maintenanceIdle } from './bootstrap.ts'

afterEach(async () => {
  await resetLibrary()
})

describe('GET rev', () => {
  it('answers the plugin’s rev and index state, never cached', async () => {
    fakeLibrary()
    const res = await request(libraryApp()).get('/rev')
    expect(res.status).toBe(200)
    expect(RevResponseSchema.parse(res.body)).toEqual({
      rev: pluginInfo.rev,
      index: pluginInfo.index,
    })
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['x-library-rev']).toBe(pluginInfo.rev)
    expect(res.headers.etag).toBeUndefined()
  })

  it('shares one /rev poll between clients polling within 2 s', async () => {
    const spy = fakeLibrary()
    const app = libraryApp()
    await Promise.all([
      request(app).get('/rev'),
      request(app).get('/rev'),
      request(app).get('/rev'),
    ])
    expect(callsTo(spy, plugin('GET', '/rev'))).toHaveLength(1)
  })

  it('starts the maintenance loop while an index is not ready', async () => {
    const index = {
      media: { state: 'ready', done: 20, total: 20 },
      usage: { state: 'stale', done: 3, total: 8 },
    }
    const spy = fakeLibrary({
      [plugin('GET', '/rev')]: () => ({ rev: pluginInfo.rev, index }),
    })
    await request(libraryApp()).get('/rev')
    await maintenanceIdle()
    expect(callsTo(spy, plugin('POST', '/maintenance/step'))).toHaveLength(1)
  })

  it('does not start it when every index is ready', async () => {
    const spy = fakeLibrary()
    await request(libraryApp()).get('/rev')
    await maintenanceIdle()
    expect(callsTo(spy, plugin('POST', '/maintenance/step'))).toHaveLength(0)
  })

  it('reports connectivity failures for the offline banner', async () => {
    fakeLibrary({
      [plugin('GET', '/rev')]: () => {
        throw timeoutError()
      },
      [plugin('GET', '/info')]: () => {
        throw networkError()
      },
    })
    const res = await request(libraryApp()).get('/rev')
    expect(res.status).toBe(504)
    expect(res.body.code).toBe('wp_timeout')
  })

  it('rejects parameters', async () => {
    fakeLibrary()
    const res = await request(libraryApp()).get('/rev?since=1')
    expect(res.status).toBe(400)
    expect(res.body.details).toEqual({ param: 'since' })
  })
})
