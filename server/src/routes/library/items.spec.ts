import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fullItems,
  patchAlt,
  pluginInfo,
} from '../../../../shared/fixtures/index.ts'
import {
  ItemPatchResponseSchema,
  ItemsFullResponseSchema,
  ItemsTileResponseSchema,
} from '../../../../shared/library-api.schema.ts'
import { env } from '../../config/env.ts'
import {
  callsTo,
  type FakeHandler,
  fakeLibrary,
  libraryApp,
  plugin,
  resetLibrary,
  wpErrorResponse,
  wpMediaFor,
} from '../../lib/library/specSupport.ts'

const originalWpUrl = env.wpUrl
beforeEach(() => {
  env.wpUrl = 'https://example.com'
  vi.useFakeTimers({
    toFake: ['Date'],
    now: Date.parse('2026-11-22T12:00:00Z'),
  })
})
afterEach(async () => {
  vi.useRealTimers()
  env.wpUrl = originalWpUrl
  await resetLibrary()
})

const media: FakeHandler = (call) => {
  const ids = String(call.params.include).split(',').map(Number)
  return fullItems
    .filter((item) => ids.includes(item.id))
    .map((item) => wpMediaFor(item))
}

const types: FakeHandler = () => ({
  post: { slug: 'post', name: 'Posts', rest_base: 'posts' },
  page: { slug: 'page', name: 'Pages', rest_base: 'pages' },
})

describe('GET items', () => {
  it('hydrates tiles in the order asked, with missing ids', async () => {
    fakeLibrary({ 'GET /wp-json/wp/v2/media': media })
    const res = await request(libraryApp()).get(
      '/items?ids=1086,999999,1000,1086',
    )
    expect(res.status).toBe(200)
    const body = ItemsTileResponseSchema.parse(res.body)
    expect(body.rev).toBe(pluginInfo.rev)
    expect(body.items.map((item) => item.id)).toEqual([1086, 1000])
    expect(body.items.every((item) => item.view === 'tile')).toBe(true)
    expect(body.missing).toEqual([999999])
    expect(res.headers['cache-control']).toBe('private, no-cache')
    expect(res.headers.etag).toMatch(/^W\/"1795867200000-/)
  })

  it('hydrates the full view with the attached-to post', async () => {
    fakeLibrary({
      'GET /wp-json/wp/v2/media': media,
      'GET /wp-json/wp/v2/types': types,
      'GET /wp-json/wp/v2/pages/203': () => ({
        id: 203,
        type: 'page',
        status: 'publish',
        link: 'https://example.com/?p=203',
        title: { raw: 'About us' },
      }),
    })
    const res = await request(libraryApp()).get('/items?ids=1009&view=full')
    expect(res.status).toBe(200)
    const body = ItemsFullResponseSchema.parse(res.body)
    expect(body.items[0]?.attachedTo).toEqual({
      postId: 203,
      postType: 'page',
      postTypeLabel: 'Pages',
      title: 'About us',
      status: 'publish',
      editUrl: 'https://example.com/wp-admin/post.php?post=203&action=edit',
      viewUrl: 'https://example.com/?p=203',
    })
  })

  it('serves the same id set from the cache in any order', async () => {
    const spy = fakeLibrary({ 'GET /wp-json/wp/v2/media': media })
    const app = libraryApp()
    const first = await request(app).get('/items?ids=1000,1001')
    const second = await request(app).get('/items?ids=1001,1000')
    expect(callsTo(spy, 'GET /wp-json/wp/v2/media')).toHaveLength(1)
    expect(second.body.items.map((item: { id: number }) => item.id)).toEqual([
      1001, 1000,
    ])
    expect(first.headers.etag).not.toBe(second.headers.etag)
  })

  it('answers 304 to the current ETag', async () => {
    const spy = fakeLibrary({ 'GET /wp-json/wp/v2/media': media })
    const app = libraryApp()
    const first = await request(app).get('/items?ids=1000')
    const second = await request(app)
      .get('/items?ids=1000')
      .set('If-None-Match', first.headers.etag ?? '')
    expect(second.status).toBe(304)
    expect(callsTo(spy, 'GET /wp-json/wp/v2/media')).toHaveLength(1)
  })

  it.each([
    ['', 'ids'],
    ['ids=', 'ids'],
    ['ids=0', 'ids'],
    ['ids=1,x', 'ids'],
    ['ids=-3', 'ids'],
    [`ids=${Array.from({ length: 101 }, (_, i) => i + 1).join(',')}`, 'ids'],
    ['ids=1&view=grid', 'view'],
    ['ids=1&fields=all', 'fields'],
  ])('rejects ?%s', async (query, param) => {
    fakeLibrary()
    const res = await request(libraryApp()).get(`/items?${query}`)
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({
      code: 'invalid_request',
      details: { param },
    })
  })

  it('accepts 100 ids', async () => {
    fakeLibrary({ 'GET /wp-json/wp/v2/media': () => [] })
    const ids = Array.from({ length: 100 }, (_, i) => i + 1).join(',')
    const res = await request(libraryApp()).get(`/items?ids=${ids}`)
    expect(res.status).toBe(200)
    expect(res.body.missing).toHaveLength(100)
  })

  it('maps WordPress errors', async () => {
    fakeLibrary({
      'GET /wp-json/wp/v2/media': () => {
        throw wpErrorResponse(500, 'internal_server_error')
      },
    })
    const res = await request(libraryApp()).get('/items?ids=1')
    expect(res.status).toBe(502)
    expect(res.body.code).toBe('wp_error')
  })
})

describe('PATCH items/:id', () => {
  function batchRoute(handler: FakeHandler) {
    return { [plugin('POST', '/media/batch')]: handler }
  }

  it('sends a one-item batch and answers the previous values', async () => {
    const spy = fakeLibrary(
      batchRoute(() => ({
        rev: patchAlt.rev,
        results: [
          {
            id: 1001,
            ok: true,
            previous: patchAlt.previous,
            item: patchAlt.item,
          },
        ],
        remaining: [],
      })),
    )
    const res = await request(libraryApp())
      .patch('/items/1001')
      .send({ alt: 'Close-up of a woven textile' })

    expect(res.status).toBe(200)
    expect(ItemPatchResponseSchema.parse(res.body)).toEqual(patchAlt)
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['x-library-rev']).toBe(patchAlt.rev)
    expect(res.headers.etag).toBeUndefined()
    expect(callsTo(spy, plugin('POST', '/media/batch'))[0]?.data).toEqual({
      items: [{ id: 1001, set: { alt: 'Close-up of a woven textile' } }],
    })
  })

  it('attaches and detaches', async () => {
    const spy = fakeLibrary(
      batchRoute((call) => {
        const [change] = (call.data as { items: { set: object }[] }).items
        return {
          rev: '2',
          results: [
            {
              id: 1001,
              ok: true,
              previous: { post: 202 },
              item: { ...patchAlt.item, ...change?.set },
            },
          ],
          remaining: [],
        }
      }),
    )
    const app = libraryApp()
    await request(app).patch('/items/1001').send({ post: 205 })
    await request(app).patch('/items/1001').send({ post: null })
    const sets = callsTo(spy, plugin('POST', '/media/batch')).map(
      (call) => (call.data as { items: { set: object }[] }).items[0]?.set,
    )
    expect(sets).toEqual([{ post: 205 }, { post: null }])
  })

  it('re-sends the item while the plugin reports it remaining', async () => {
    let calls = 0
    const spy = fakeLibrary(
      batchRoute(() => {
        calls += 1
        if (calls === 1) return { rev: '2', results: [], remaining: [1001] }
        return {
          rev: '3',
          results: [
            {
              id: 1001,
              ok: true,
              previous: { title: 'a' },
              item: patchAlt.item,
            },
          ],
          remaining: [],
        }
      }),
    )
    const res = await request(libraryApp())
      .patch('/items/1001')
      .send({ title: 'b' })
    expect(res.status).toBe(200)
    expect(res.body.rev).toBe('3')
    expect(callsTo(spy, plugin('POST', '/media/batch'))).toHaveLength(2)
  })

  it.each([
    ['wpu_forbidden', 403, 'forbidden'],
    ['wpu_not_found', 404, 'wpu_not_found'],
    ['wpu_post_not_found', 404, 'wpu_post_not_found'],
    ['wpu_invalid_parent', 400, 'wpu_invalid_parent'],
  ])('turns a per-item %s into %i %s', async (code, status, mapped) => {
    fakeLibrary(
      batchRoute(() => ({
        rev: '2',
        results: [{ id: 1001, ok: false, error: { code, message: 'Nope.' } }],
        remaining: [],
      })),
    )
    const res = await request(libraryApp())
      .patch('/items/1001')
      .send({ post: 5 })
    expect(res.status).toBe(status)
    expect(res.body.code).toBe(mapped)
    expect(res.body.message).toBe('Nope.')
  })

  it.each([
    [{}, 'body'],
    [{ colour: 'red' }, 'colour'],
    [{ title: 5 }, 'title'],
    [{ alt: 'x'.repeat(1001) }, 'alt'],
    [{ caption: 'x'.repeat(5001) }, 'caption'],
    [{ post: 0 }, 'post'],
    [{ post: '5' }, 'post'],
    [{ post: 1.5 }, 'post'],
  ])('rejects %j', async (body, param) => {
    fakeLibrary()
    const res = await request(libraryApp()).patch('/items/1001').send(body)
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({
      code: 'invalid_request',
      details: { param },
    })
  })

  it('counts characters, not UTF-16 units', async () => {
    fakeLibrary(
      batchRoute(() => ({
        rev: '2',
        results: [
          { id: 1001, ok: true, previous: { alt: '' }, item: patchAlt.item },
        ],
        remaining: [],
      })),
    )
    const res = await request(libraryApp())
      .patch('/items/1001')
      .send({ alt: '😀'.repeat(1000) })
    expect(res.status).toBe(200)
  })

  it('answers 404 for a non-numeric id', async () => {
    fakeLibrary()
    const res = await request(libraryApp())
      .patch('/items/abc')
      .send({ alt: 'x' })
    expect(res.status).toBe(404)
    expect(res.body.code).toBe('not_found')
  })

  it('rejects a JSON body that is not an object', async () => {
    fakeLibrary()
    const res = await request(libraryApp())
      .patch('/items/1')
      .set('Content-Type', 'application/json')
      .send('[1]')
    expect(res.status).toBe(400)
    expect(res.body.details).toEqual({ param: 'body' })
  })
})
