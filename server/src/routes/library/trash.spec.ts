import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import {
  emptyTrashStep,
  restoreFromTrash,
  trashSummary,
} from '../../../../shared/fixtures/index.ts'
import {
  EmptyTrashResponseSchema,
  RestoreResponseSchema,
  TrashSummarySchema,
} from '../../../../shared/library-api.schema.ts'
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

describe('GET trash', () => {
  it('answers the summary, cached per rev with an ETag', async () => {
    const spy = fakeLibrary({ [plugin('GET', '/trash')]: () => trashSummary })
    const app = libraryApp()
    const res = await request(app).get('/trash')
    expect(res.status).toBe(200)
    expect(TrashSummarySchema.parse(res.body)).toEqual(trashSummary)
    expect(res.headers['cache-control']).toBe('private, no-cache')
    expect(res.headers.etag).toMatch(/^W\/"1795867200000-/)

    const again = await request(app)
      .get('/trash')
      .set('If-None-Match', res.headers.etag ?? '')
    expect(again.status).toBe(304)
    const third = await request(app).get('/trash')
    expect(third.status).toBe(200)
    expect(callsTo(spy, plugin('GET', '/trash'))).toHaveLength(1)
  })

  it('rejects unknown parameters', async () => {
    fakeLibrary()
    const res = await request(libraryApp()).get('/trash?all=1')
    expect(res.status).toBe(400)
    expect(res.body.details).toEqual({ param: 'all' })
  })
})

describe('POST trash/restore', () => {
  it('restores items and reports their folders', async () => {
    const spy = fakeLibrary({
      [plugin('POST', '/trash/restore')]: () => ({
        ...restoreFromTrash,
        remaining: [],
      }),
    })
    const res = await request(libraryApp())
      .post('/trash/restore')
      .send({ ids: [1017, 1026] })
    expect(res.status).toBe(200)
    expect(RestoreResponseSchema.parse(res.body)).toEqual(restoreFromTrash)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(callsTo(spy, plugin('POST', '/trash/restore'))[0]?.data).toEqual({
      ids: [1017, 1026],
    })
  })

  it('re-sends remaining ids', async () => {
    const spy = fakeLibrary({
      [plugin('POST', '/trash/restore')]: (call) => {
        const ids = (call.data as { ids: number[] }).ids
        return ids.length === 2
          ? {
              rev: '1795867200006',
              results: [restoreFromTrash.results[0]],
              remaining: [1026],
            }
          : {
              rev: '1795867200007',
              results: [restoreFromTrash.results[1]],
              remaining: [],
            }
      },
    })
    const res = await request(libraryApp())
      .post('/trash/restore')
      .send({ ids: [1017, 1026] })
    expect(callsTo(spy, plugin('POST', '/trash/restore'))).toHaveLength(2)
    expect(res.body).toEqual({ ...restoreFromTrash, rev: '1795867200007' })
  })

  it.each([
    [{}, 'ids'],
    [{ ids: [] }, 'ids'],
    [{ ids: [1], folder: 3 }, 'folder'],
  ])('rejects %j (param %s)', async (body, param) => {
    fakeLibrary()
    const res = await request(libraryApp()).post('/trash/restore').send(body)
    expect(res.status).toBe(400)
    expect(res.body.details).toEqual({ param })
  })
})

describe('POST trash/empty', () => {
  it('runs one time-budgeted step', async () => {
    const spy = fakeLibrary({
      [plugin('POST', '/trash/empty')]: () => emptyTrashStep,
    })
    const res = await request(libraryApp()).post('/trash/empty')
    expect(res.status).toBe(200)
    expect(EmptyTrashResponseSchema.parse(res.body)).toEqual(emptyTrashStep)
    expect(res.headers['x-library-rev']).toBe(emptyTrashStep.rev)
    expect(callsTo(spy, plugin('POST', '/trash/empty'))[0]?.data).toEqual({})
  })

  it('accepts an empty JSON object and rejects anything in it', async () => {
    fakeLibrary({ [plugin('POST', '/trash/empty')]: () => emptyTrashStep })
    const ok = await request(libraryApp()).post('/trash/empty').send({})
    expect(ok.status).toBe(200)
    const bad = await request(libraryApp())
      .post('/trash/empty')
      .send({ budgetMs: 100 })
    expect(bad.status).toBe(400)
    expect(bad.body.details).toEqual({ param: 'budgetMs' })
  })
})
