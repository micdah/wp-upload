import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import {
  deletePermanently,
  deleteToTrash,
  pluginDeletePartial,
} from '../../../../shared/fixtures/index.ts'
import { DeleteResponseSchema } from '../../../../shared/library-api.schema.ts'
import {
  callsTo,
  fakeLibrary,
  libraryApp,
  plugin,
  resetLibrary,
  wpErrorResponse,
} from '../../lib/library/specSupport.ts'

afterEach(async () => {
  await resetLibrary()
})

const TRASH = plugin('POST', '/media/trash')
const DELETE = plugin('POST', '/media/delete')

describe('POST items/delete', () => {
  it('moves items to the Trash', async () => {
    const spy = fakeLibrary({
      [TRASH]: () => ({ ...deleteToTrash, remaining: [] }),
    })
    const res = await request(libraryApp())
      .post('/items/delete')
      .send({ ids: [1017, 1026], mode: 'trash' })
    expect(res.status).toBe(200)
    expect(DeleteResponseSchema.parse(res.body)).toEqual(deleteToTrash)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(callsTo(spy, TRASH)[0]?.data).toEqual({ ids: [1017, 1026] })
    expect(callsTo(spy, DELETE)).toHaveLength(0)
  })

  it('deletes permanently, with per-item failures', async () => {
    fakeLibrary({ [DELETE]: () => ({ ...deletePermanently, remaining: [] }) })
    const res = await request(libraryApp())
      .post('/items/delete')
      .send({ ids: [1092, 999999], mode: 'delete' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual(deletePermanently)
  })

  it('re-sends the ids the plugin had no time for', async () => {
    const spy = fakeLibrary({
      [DELETE]: (call) => {
        const ids = (call.data as { ids: number[] }).ids
        return ids.includes(1004)
          ? pluginDeletePartial
          : {
              rev: '1795867200009',
              results: [{ id: 1005, ok: true, trash: null }],
              remaining: [],
            }
      },
    })
    const res = await request(libraryApp())
      .post('/items/delete')
      .send({ ids: [1004, 1005], mode: 'delete' })
    expect(res.status).toBe(200)
    expect(callsTo(spy, DELETE).map((call) => call.data)).toEqual([
      { ids: [1004, 1005] },
      { ids: [1005] },
    ])
    expect(res.body).toEqual({
      rev: '1795867200009',
      results: [
        { id: 1004, ok: true, trash: null },
        { id: 1005, ok: true, trash: null },
      ],
    })
  })

  it('passes 409 wpu_trash_disabled through', async () => {
    fakeLibrary({
      [TRASH]: () => {
        throw wpErrorResponse(409, 'wpu_trash_disabled', 'Trash is off.')
      },
    })
    const res = await request(libraryApp())
      .post('/items/delete')
      .send({ ids: [1017], mode: 'trash' })
    expect(res.status).toBe(409)
    expect(res.body).toEqual({
      code: 'wpu_trash_disabled',
      message: 'Trash is off.',
    })
  })

  it.each([
    [{ ids: [1] }, 'mode'],
    [{ ids: [1], mode: 'purge' }, 'mode'],
    [{ mode: 'trash' }, 'ids'],
    [{ ids: [-1], mode: 'trash' }, 'ids'],
    [
      { ids: Array.from({ length: 101 }, (_, i) => i + 1), mode: 'trash' },
      'ids',
    ],
    [{ ids: [1], mode: 'trash', force: true }, 'force'],
  ])('rejects %j (param %s)', async (body, param) => {
    fakeLibrary()
    const res = await request(libraryApp()).post('/items/delete').send(body)
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({
      code: 'invalid_request',
      details: { param },
    })
  })
})
