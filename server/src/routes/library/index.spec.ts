import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  fakeLibrary,
  libraryApp,
  plugin,
  resetLibrary,
} from '../../lib/library/specSupport.ts'

// Every route of the server API contract is registered from the start (the
// M0 scaffold), so tracks only ever replace handlers. A route that answers
// 404 has been dropped or renamed by mistake.
const contractRoutes: Array<['get' | 'post' | 'patch' | 'delete', string]> = [
  ['get', '/bootstrap'],
  ['get', '/rev'],
  ['get', '/collection'],
  ['get', '/facets'],
  ['get', '/items'],
  ['patch', '/items/1'],
  ['post', '/items/batch'],
  ['post', '/items/delete'],
  ['post', '/items/1/edit'],
  ['post', '/items/1/edit/undo'],
  ['post', '/items/1/restore'],
  ['post', '/items/1/replace'],
  ['get', '/items/1/download'],
  ['post', '/items/regenerate'],
  ['get', '/jobs'],
  ['get', '/folders'],
  ['post', '/folders'],
  ['post', '/folders/assign'],
  ['patch', '/folders/1'],
  ['delete', '/folders/1'],
  ['get', '/trash'],
  ['post', '/trash/restore'],
  ['post', '/trash/empty'],
  ['get', '/usage'],
  ['post', '/usage'],
  ['get', '/posts'],
  ['post', '/upload'],
  ['get', '/upload/jobs'],
  ['get', '/upload/check'],
  ['get', '/plugin/download'],
]

beforeEach(() => {
  fakeLibrary()
})

afterEach(async () => {
  await resetLibrary()
})

describe('libraryRouter', () => {
  it.each(contractRoutes)('registers %s %s', async (method, path) => {
    const res = await request(libraryApp())[method](path)
    // Only the catch-all's 404: a route may answer its own 404 code
    // (plugin/download without a bundled zip: plugin_not_bundled).
    expect(res.status === 404 && res.body.code === 'not_found').toBe(false)
  })

  it('parses JSON bodies up to 4 MiB', async () => {
    const big = { name: 'x'.repeat(5 * 1024 * 1024), parent: 0 }
    const res = await request(libraryApp()).post('/folders').send(big)
    expect(res.status).toBe(413)
    expect(res.body.code).toBe('invalid_request_body')
  })

  it('answers malformed JSON with invalid_json', async () => {
    const res = await request(libraryApp())
      .post('/folders')
      .set('Content-Type', 'application/json')
      .send('{nope')
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('invalid_json')
  })

  it('compresses JSON of 1 kB or more, with brotli when accepted', async () => {
    fakeLibrary({
      [plugin('GET', '/folders')]: () => ({
        rev: '1',
        mode: {
          pro: false,
          perUser: false,
          readOnly: false,
          colorsWritable: false,
        },
        folders: Array.from({ length: 50 }, (_, i) => ({
          id: i + 1,
          name: `Folder ${i + 1}`,
          parent: 0,
          ord: i,
          color: null,
          count: 0,
        })),
        counts: { all: 0, uncategorized: 0 },
      }),
    })
    const res = await request(libraryApp())
      .get('/folders')
      .set('Accept-Encoding', 'br')
    expect(res.headers['content-encoding']).toBe('br')
  })

  it('does not compress small answers', async () => {
    const res = await request(libraryApp())
      .get('/rev')
      .set('Accept-Encoding', 'gzip')
    expect(res.status).toBe(200)
    expect(res.headers['content-encoding']).toBeUndefined()
  })
})
