import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectionAll,
  collectionTrash,
  facetsAll,
  facetsUncategorizedMissingAlt,
} from '../../../../shared/fixtures/index.ts'
import {
  CollectionResponseSchema,
  FacetsSchema,
} from '../../../../shared/library-api.schema.ts'
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

describe('GET collection', () => {
  it('answers the plugin’s collection with cache headers', async () => {
    const spy = fakeLibrary({
      [plugin('GET', '/collection')]: () => collectionAll,
    })
    const res = await request(libraryApp()).get('/collection')

    expect(res.status).toBe(200)
    expect(CollectionResponseSchema.parse(res.body)).toEqual(collectionAll)
    expect(res.headers['cache-control']).toBe('private, no-cache')
    expect(res.headers.etag).toMatch(/^W\/"1795867200000-/)
    expect(res.headers['x-library-rev']).toBe('1795867200000')
    expect(callsTo(spy, plugin('GET', '/collection'))[0]?.params).toEqual({})
  })

  it('sends the normalised query and leaves defaults out', async () => {
    const spy = fakeLibrary({
      [plugin('GET', '/collection')]: () => collectionAll,
    })
    await request(libraryApp()).get('/collection').query({
      folder: '0',
      q: '  summer   beach ',
      type: 'image',
      alt: 'missing',
      size: 'gt5',
      orient: 'portrait',
      month: '2025-01',
      sort: 'date-desc',
    })
    expect(callsTo(spy, plugin('GET', '/collection'))[0]?.params).toEqual({
      folder: '0',
      q: 'summer beach',
      type: 'image',
      alt: 'missing',
      size: 'gt5',
      orient: 'portrait',
      month: '2025-01',
    })
  })

  it('treats empty values as absent and drops folder=all', async () => {
    const spy = fakeLibrary({
      [plugin('GET', '/collection')]: () => collectionAll,
    })
    await request(libraryApp()).get('/collection?folder=all&q=&type=')
    expect(callsTo(spy, plugin('GET', '/collection'))[0]?.params).toEqual({})
  })

  it('ignores every other filter and the sort in the Trash', async () => {
    const spy = fakeLibrary({
      [plugin('GET', '/collection')]: () => collectionTrash,
    })
    await request(libraryApp()).get(
      '/collection?folder=trash&q=x&sort=title-asc&type=video',
    )
    expect(callsTo(spy, plugin('GET', '/collection'))[0]?.params).toEqual({
      folder: 'trash',
    })
  })

  it('serves repeated queries from the cache, whatever the parameter order', async () => {
    const spy = fakeLibrary({
      [plugin('GET', '/collection')]: () => collectionAll,
    })
    const app = libraryApp()
    await request(app).get('/collection?type=image&folder=3')
    await request(app).get('/collection?folder=3&type=image')
    expect(callsTo(spy, plugin('GET', '/collection'))).toHaveLength(1)
  })

  it('answers 304 to the current ETag without asking the plugin', async () => {
    const spy = fakeLibrary({
      [plugin('GET', '/collection')]: () => collectionAll,
    })
    const app = libraryApp()
    const first = await request(app).get('/collection')
    const second = await request(app)
      .get('/collection')
      .set('If-None-Match', first.headers.etag ?? '')
    expect(second.status).toBe(304)
    expect(second.text).toBe('')
    expect(second.headers['x-library-rev']).toBe('1795867200000')
    expect(callsTo(spy, plugin('GET', '/collection'))).toHaveLength(1)
  })

  it('misses the cache and the ETag once the rev changes', async () => {
    let rev = '1795867200000'
    const spy = fakeLibrary({
      [plugin('GET', '/collection')]: () => ({ ...collectionAll, rev }),
      [plugin('POST', '/media/trash')]: () => {
        rev = '1795867200009'
        return { rev, results: [], remaining: [] }
      },
    })
    const app = libraryApp()
    const first = await request(app).get('/collection')
    // A mutation response moves currentRev forward at once.
    const { pluginClient } = await import('../../lib/library/pluginClient.ts')
    await pluginClient.mediaTrash({ ids: [1] })
    const second = await request(app)
      .get('/collection')
      .set('If-None-Match', first.headers.etag ?? '')
    expect(second.status).toBe(200)
    expect(second.headers['x-library-rev']).toBe('1795867200009')
    expect(callsTo(spy, plugin('GET', '/collection'))).toHaveLength(2)
  })

  it('compresses large answers', async () => {
    const rows = Array.from({ length: 4000 }, (_, i) => i + 1)
    fakeLibrary({
      [plugin('GET', '/collection')]: () => ({
        ...collectionAll,
        total: 1000,
        rows,
      }),
    })
    const res = await request(libraryApp())
      .get('/collection')
      .set('Accept-Encoding', 'gzip')
    expect(res.headers['content-encoding']).toBe('gzip')
    expect(res.body.rows).toHaveLength(4000)
  })

  it.each([
    ['layout=grid', 'layout'],
    ['folder=-1', 'folder'],
    ['folder=01', 'folder'],
    ['type=pdf', 'type'],
    ['alt=present', 'alt'],
    ['size=gt10', 'size'],
    ['orient=round', 'orient'],
    ['month=2025-13', 'month'],
    ['sort=random', 'sort'],
    ['type=image&type=video', 'type'],
    [`q=${'a'.repeat(201)}`, 'q'],
    ['q=1 2 3 4 5 6 7 8 9 10 11', 'q'],
  ])('rejects %s', async (query, param) => {
    fakeLibrary()
    const res = await request(libraryApp()).get(`/collection?${query}`)
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('invalid_request')
    expect(res.body.details).toEqual({ param })
  })

  it('counts q in characters, not UTF-16 units (astral characters)', async () => {
    const spy = fakeLibrary({
      [plugin('GET', '/collection')]: () => collectionAll,
    })
    // 200 emoji are 400 UTF-16 units, but 200 characters: allowed.
    const q = '😀'.repeat(200)
    const ok = await request(libraryApp()).get('/collection').query({ q })
    expect(ok.status).toBe(200)
    expect(callsTo(spy, plugin('GET', '/collection'))[0]?.params).toEqual({
      q,
    })
    const tooLong = await request(libraryApp())
      .get('/collection')
      .query({ q: `${q}😀` })
    expect(tooLong.status).toBe(400)
    expect(tooLong.body.details).toEqual({ param: 'q' })
  })

  it.each([
    [404, 'wpu_folder_not_found'],
    [409, 'wpu_filebird_inactive'],
    [422, 'wpu_collection_too_large'],
  ])('passes the plugin’s %i %s through', async (status, code) => {
    fakeLibrary({
      [plugin('GET', '/collection')]: () => {
        throw wpErrorResponse(status, code, 'Nope.')
      },
    })
    const res = await request(libraryApp()).get('/collection?folder=99')
    expect(res.status).toBe(status)
    expect(res.body.code).toBe(code)
    expect(res.headers['cache-control']).toBe('no-store')
  })
})

describe('GET facets', () => {
  it('answers the plugin’s facets for the same query', async () => {
    const spy = fakeLibrary({
      [plugin('GET', '/facets')]: () => facetsUncategorizedMissingAlt,
    })
    const res = await request(libraryApp()).get('/facets?folder=0&alt=missing')
    expect(res.status).toBe(200)
    expect(FacetsSchema.parse(res.body)).toEqual(facetsUncategorizedMissingAlt)
    expect(res.headers['cache-control']).toBe('private, no-cache')
    expect(callsTo(spy, plugin('GET', '/facets'))[0]?.params).toEqual({
      folder: '0',
      alt: 'missing',
    })
  })

  it('caches separately from collection', async () => {
    const spy = fakeLibrary({
      [plugin('GET', '/collection')]: () => collectionAll,
      [plugin('GET', '/facets')]: () => facetsAll,
    })
    const app = libraryApp()
    const facets = await request(app).get('/facets')
    const collection = await request(app).get('/collection')
    expect(facets.body).toEqual(facetsAll)
    expect(collection.body).toEqual(collectionAll)
    expect(facets.headers.etag).not.toBe(collection.headers.etag)
    expect(callsTo(spy, plugin('GET', '/facets'))).toHaveLength(1)
  })

  it('validates like collection', async () => {
    fakeLibrary()
    const res = await request(libraryApp()).get('/facets?density=3')
    expect(res.status).toBe(400)
    expect(res.body.details).toEqual({ param: 'density' })
  })
})
