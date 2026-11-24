import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { batchCaption } from '../../../../shared/fixtures/index.ts'
import { BatchResponseSchema } from '../../../../shared/library-api.schema.ts'
import type {
  BatchItemChange,
  BatchItemResult,
} from '../../../../shared/library-api.ts'
import {
  callsTo,
  type FakeHandler,
  fakeLibrary,
  libraryApp,
  plugin,
  resetLibrary,
  wpErrorResponse,
} from '../../lib/library/specSupport.ts'

afterEach(async () => {
  await resetLibrary()
})

const MEDIA_BATCH = plugin('POST', '/media/batch')

/** The plugin's answer for the fixture's ids, `remaining` empty. */
function pluginBatch(remainingAfterFirst: number[] = []): FakeHandler {
  let round = 0
  return (call) => {
    round += 1
    const items = (call.data as { items: BatchItemChange[] }).items
    const remaining = round === 1 ? remainingAfterFirst : []
    const results = items
      .filter((change) => !remaining.includes(change.id))
      .map(
        (change) =>
          batchCaption.results.find((result) => result.id === change.id) as
            | BatchItemResult
            | undefined,
      )
      .filter(Boolean)
    return { rev: batchCaption.rev, results, remaining }
  }
}

describe('POST items/batch', () => {
  it('sends the same change for every id and answers per item', async () => {
    const spy = fakeLibrary({ [MEDIA_BATCH]: pluginBatch() })
    const res = await request(libraryApp())
      .post('/items/batch')
      .send({ ids: [1002, 1010, 1000], set: { caption: 'Summer party 2025' } })
    expect(res.status).toBe(200)
    expect(BatchResponseSchema.parse(res.body)).toEqual(batchCaption)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['x-library-rev']).toBe(batchCaption.rev)
    expect(callsTo(spy, MEDIA_BATCH)[0]?.data).toEqual({
      items: [
        { id: 1002, set: { caption: 'Summer party 2025' } },
        { id: 1010, set: { caption: 'Summer party 2025' } },
        { id: 1000, set: { caption: 'Summer party 2025' } },
      ],
    })
  })

  it('sends a different change per item (Undo)', async () => {
    const spy = fakeLibrary({ [MEDIA_BATCH]: pluginBatch() })
    const res = await request(libraryApp())
      .post('/items/batch')
      .send({
        items: [
          { id: 1002, set: { caption: '' } },
          { id: 1010, set: {}, appendDescription: 'More' },
        ],
      })
    expect(res.status).toBe(200)
    expect(callsTo(spy, MEDIA_BATCH)[0]?.data).toEqual({
      items: [
        { id: 1002, set: { caption: '' } },
        { id: 1010, set: {}, appendDescription: 'More' },
      ],
    })
  })

  it('re-sends remaining ids and keeps the request order', async () => {
    const spy = fakeLibrary({ [MEDIA_BATCH]: pluginBatch([1010, 1000]) })
    const res = await request(libraryApp())
      .post('/items/batch')
      .send({ ids: [1002, 1010, 1000], set: { caption: 'Summer party 2025' } })
    expect(res.status).toBe(200)
    const calls = callsTo(spy, MEDIA_BATCH)
    expect(calls).toHaveLength(2)
    expect(
      (calls[1]?.data as { items: BatchItemChange[] } | undefined)?.items.map(
        (i) => i.id,
      ),
    ).toEqual([1010, 1000])
    expect(res.body.results.map((result: { id: number }) => result.id)).toEqual(
      [1002, 1010, 1000],
    )
  })

  it('removes duplicate ids in the same-change form', async () => {
    const spy = fakeLibrary({ [MEDIA_BATCH]: pluginBatch() })
    await request(libraryApp())
      .post('/items/batch')
      .send({ ids: [1002, 1002], set: { alt: 'x' } })
    const sent = callsTo(spy, MEDIA_BATCH)[0]?.data as {
      items: BatchItemChange[]
    }
    expect(sent.items).toEqual([{ id: 1002, set: { alt: 'x' } }])
  })

  it.each([
    [{}, 'ids'],
    [{ ids: [], set: { alt: 'x' } }, 'ids'],
    [{ ids: [1], set: {} }, 'set'],
    [{ ids: [1] }, 'set'],
    [{ ids: [1], set: { nope: 1 } }, 'set.nope'],
    [{ ids: [1], set: { alt: 5 } }, 'set.alt'],
    [{ ids: [1], set: { post: 0 } }, 'set.post'],
    [{ ids: [1], set: { title: 'x'.repeat(1001) } }, 'set.title'],
    [{ ids: [1], set: {}, appendDescription: '' }, 'appendDescription'],
    [
      { ids: [1], set: { description: 'a' }, appendDescription: 'b' },
      'appendDescription',
    ],
    [{ ids: [1], set: { alt: 'x' }, extra: true }, 'extra'],
    [{ ids: Array.from({ length: 101 }, (_, i) => i + 1), set: {} }, 'ids'],
    [{ items: [] }, 'items'],
    [{ items: [{ id: 1, set: {} }] }, 'items[0].set'],
    [{ items: [{ id: 0, set: { alt: 'x' } }] }, 'items[0].id'],
    [{ items: [{ id: '1', set: { alt: 'x' } }] }, 'items[0].id'],
    [
      {
        items: [
          { id: 1, set: { alt: 'x' } },
          { id: 1, set: { alt: 'y' } },
        ],
      },
      'items[1].id',
    ],
    [{ items: [{ id: 1, set: { alt: 'x' }, more: 1 }] }, 'items[0].more'],
    [{ items: [{ id: 1, set: { alt: 'x' } }], ids: [1] }, 'ids'],
    [
      {
        items: Array.from({ length: 101 }, (_, i) => ({
          id: i + 1,
          set: { alt: '' },
        })),
      },
      'items',
    ],
  ])('rejects %j (param %s)', async (body, param) => {
    const spy = fakeLibrary()
    const res = await request(libraryApp()).post('/items/batch').send(body)
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({
      code: 'invalid_request',
      details: { param },
    })
    expect(callsTo(spy, MEDIA_BATCH)).toHaveLength(0)
  })

  it('maps request-level plugin errors (§2.3)', async () => {
    fakeLibrary({
      [MEDIA_BATCH]: () => {
        throw wpErrorResponse(400, 'wpu_too_many_items', 'Too many.', {
          param: 'items',
          max: 100,
        })
      },
    })
    const res = await request(libraryApp())
      .post('/items/batch')
      .send({ ids: [1], set: { alt: 'x' } })
    expect(res.status).toBe(400)
    expect(res.body).toEqual({
      code: 'wpu_too_many_items',
      message: 'Too many.',
      details: { param: 'items', max: 100 },
    })
  })

  it('answers 409 feature_unavailable without the media-batch feature', async () => {
    const { pluginInfo } = await import('../../../../shared/fixtures/index.ts')
    fakeLibrary({
      [plugin('GET', '/info')]: () => ({
        ...pluginInfo,
        features: pluginInfo.features.filter((f) => f !== 'media-batch'),
      }),
    })
    const res = await request(libraryApp())
      .post('/items/batch')
      .send({ ids: [1], set: { alt: 'x' } })
    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({
      code: 'feature_unavailable',
      details: { feature: 'media-batch' },
    })
  })
})
