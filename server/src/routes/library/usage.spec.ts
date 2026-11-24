import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { usageSample } from '../../../../shared/fixtures/index.ts'
import { UsageResponseSchema } from '../../../../shared/library-api.schema.ts'
import {
  callsTo,
  fakeLibrary,
  libraryApp,
  plugin,
  resetLibrary,
} from '../../lib/library/specSupport.ts'

afterEach(async () => {
  await resetLibrary()
})

const USAGE = plugin('GET', '/usage')

describe('usage', () => {
  it('GET answers the plugin’s usage, cached per rev and id list', async () => {
    const spy = fakeLibrary({ [USAGE]: () => usageSample })
    const app = libraryApp()
    const ids = usageSample.items.map((item) => item.id).join(',')
    const res = await request(app).get(`/usage?ids=${ids}`)
    expect(res.status).toBe(200)
    expect(UsageResponseSchema.parse(res.body)).toEqual(usageSample)
    expect(res.headers['cache-control']).toBe('private, no-cache')
    expect(callsTo(spy, USAGE)[0]?.params).toEqual({ ids })

    await request(app).get(`/usage?ids=${ids}`)
    expect(callsTo(spy, USAGE)).toHaveLength(1)
  })

  it('POST takes the ids in the body and shares the cache', async () => {
    const spy = fakeLibrary({ [USAGE]: () => usageSample })
    const app = libraryApp()
    const ids = usageSample.items.map((item) => item.id)
    const res = await request(app).post('/usage').send({ ids })
    expect(res.status).toBe(200)
    expect(res.body).toEqual(usageSample)
    await request(app).get(`/usage?ids=${ids.join(',')}`)
    expect(callsTo(spy, USAGE)).toHaveLength(1)
  })

  it.each([
    ['/usage', 'ids'],
    ['/usage?ids=1,abc', 'ids'],
    [
      `/usage?ids=${Array.from({ length: 101 }, (_, i) => i + 1).join(',')}`,
      'ids',
    ],
    ['/usage?ids=1&view=full', 'view'],
  ])('GET %s → 400 (param %s)', async (path, param) => {
    fakeLibrary()
    const res = await request(libraryApp()).get(path)
    expect(res.status).toBe(400)
    expect(res.body.details).toEqual({ param })
  })

  it('POST rejects unknown fields', async () => {
    fakeLibrary()
    const res = await request(libraryApp())
      .post('/usage')
      .send({ ids: [1], refs: true })
    expect(res.status).toBe(400)
    expect(res.body.details).toEqual({ param: 'refs' })
  })
})
