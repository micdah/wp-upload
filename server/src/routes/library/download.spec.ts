import { Readable } from 'node:stream'
import { gzipSync } from 'node:zlib'
import { AxiosError, AxiosHeaders, type AxiosRequestConfig } from 'axios'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fullItems } from '../../../../shared/fixtures/index.ts'
import type { LibraryItemFull } from '../../../../shared/library-api.ts'
import {
  contentDisposition,
  downloadSource,
} from '../../lib/library/normalise/download.ts'
import {
  fakeLibrary,
  httpError,
  libraryApp,
  networkError,
  resetLibrary,
  timeoutError,
  wpMediaFor,
} from '../../lib/library/specSupport.ts'
import { fileAxios, MAX_FILE_REDIRECTS } from './download.ts'

afterEach(async () => {
  await resetLibrary()
})

function fixture(id: number): LibraryItemFull {
  const item = fullItems.find((entry) => entry.id === id)
  if (!item) throw new Error(`fixture item ${id} is missing`)
  return item as LibraryItemFull
}

const media = () => (call: { params: Record<string, unknown> }) => {
  const ids = String(call.params.include).split(',').map(Number)
  return fullItems
    .filter((entry) => ids.includes(entry.id))
    .map((entry) => wpMediaFor(entry as LibraryItemFull))
}

/** Fakes the file server: answers `files[url]` as a stream. */
function fakeFiles(
  files: Record<string, { body: string; headers?: Record<string, string> }>,
) {
  return vi
    .spyOn(fileAxios, 'get')
    .mockImplementation(async (url: string, config?: AxiosRequestConfig) => {
      const file = files[url]
      if (!file) throw httpError(404, '<html>Not found</html>')
      return {
        data: Readable.from([Buffer.from(file.body)]),
        status: 200,
        statusText: 'OK',
        headers: {
          'content-length': String(Buffer.byteLength(file.body)),
          ...file.headers,
        },
        config: { ...config, headers: new AxiosHeaders() },
      }
    })
}

describe('GET items/:id/download', () => {
  it('streams the file url points to, under its own name', async () => {
    const item = fixture(1000)
    fakeLibrary({ 'GET /wp-json/wp/v2/media': media() })
    const files = fakeFiles({ [item.url]: { body: 'scaled jpeg' } })
    const res = await request(libraryApp()).get('/items/1000/download')
    expect(res.status).toBe(200)
    expect(res.body.toString()).toBe('scaled jpeg')
    expect(res.headers['content-type']).toBe('image/jpeg')
    expect(res.headers['content-length']).toBe('11')
    expect(res.headers['content-disposition']).toBe(
      `attachment; filename="still-life-joshua-earle-548-scaled.jpg"; filename*=UTF-8''still-life-joshua-earle-548-scaled.jpg`,
    )
    expect(res.headers['cache-control']).toBe('private, no-store')
    expect(res.headers['content-encoding']).toBeUndefined()
    const config = files.mock.calls[0]?.[1]
    expect(config).toMatchObject({
      responseType: 'stream',
      maxRedirects: MAX_FILE_REDIRECTS,
      decompress: false,
    })
    // The Application Password never goes to the file host.
    expect(JSON.stringify(config?.headers ?? {})).not.toMatch(/Authorization/i)
  })

  it('streams the untouched original for variant=original', async () => {
    const item = fixture(1000)
    fakeLibrary({ 'GET /wp-json/wp/v2/media': media() })
    const original = item.original?.url ?? ''
    fakeFiles({ [original]: { body: 'original jpeg' } })
    const res = await request(libraryApp()).get(
      '/items/1000/download?variant=original',
    )
    expect(res.status).toBe(200)
    expect(res.body.toString()).toBe('original jpeg')
    expect(res.headers['content-disposition']).toContain(
      'filename="still-life-joshua-earle-548.jpg"',
    )
  })

  it('falls back to the file when there is no original', async () => {
    const item = fixture(1091)
    fakeLibrary({ 'GET /wp-json/wp/v2/media': media() })
    fakeFiles({ [item.url]: { body: '<svg/>' } })
    const res = await request(libraryApp()).get(
      '/items/1091/download?variant=original',
    )
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('image/svg+xml')
    expect(res.headers['content-disposition']).toContain(
      'filename="logo-mark.svg"',
    )
  })

  it('passes a Content-Encoding the file server insisted on', async () => {
    const item = fixture(1091)
    fakeLibrary({ 'GET /wp-json/wp/v2/media': media() })
    const gzipped = gzipSync('<svg/>')
    vi.spyOn(fileAxios, 'get').mockResolvedValue({
      data: Readable.from([gzipped]),
      status: 200,
      statusText: 'OK',
      headers: {
        'content-length': String(gzipped.length),
        'content-encoding': 'gzip',
      },
      config: { headers: new AxiosHeaders() },
    })
    const res = await request(libraryApp())
      .get(`/items/${item.id}/download`)
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => done(null, Buffer.concat(chunks)))
      })
    expect(res.status).toBe(200)
    expect(res.headers['content-encoding']).toBe('gzip')
    expect(res.headers['content-length']).toBe(String(gzipped.length))
    // supertest decompresses, as a browser would.
    expect((res.body as Buffer).toString()).toBe('<svg/>')
  })

  it('answers 404 for an unknown or invisible item', async () => {
    fakeLibrary({ 'GET /wp-json/wp/v2/media': () => [] })
    const res = await request(libraryApp()).get('/items/999999/download')
    expect(res.status).toBe(404)
    expect(res.body.code).toBe('not_found')
  })

  it.each([
    [networkError(), 502, 'wp_unreachable'],
    [timeoutError(), 504, 'wp_timeout'],
    [httpError(404, 'gone'), 502, 'wp_unreachable'],
    [
      new AxiosError('redirect loop', 'ERR_FR_TOO_MANY_REDIRECTS', {
        headers: new AxiosHeaders(),
      }),
      502,
      'wp_unreachable',
    ],
  ])('maps a failed file fetch (%s) to %i %s', async (error, status, code) => {
    fakeLibrary({ 'GET /wp-json/wp/v2/media': media() })
    vi.spyOn(fileAxios, 'get').mockRejectedValue(error)
    const res = await request(libraryApp()).get('/items/1000/download')
    expect(res.status).toBe(status)
    expect(res.body.code).toBe(code)
  })

  it('closes the body stream of a failed file fetch', async () => {
    fakeLibrary({ 'GET /wp-json/wp/v2/media': media() })
    const body = Readable.from([Buffer.from('<html>Not found</html>')])
    vi.spyOn(fileAxios, 'get').mockRejectedValue(httpError(404, body))
    const res = await request(libraryApp()).get('/items/1000/download')
    expect(res.status).toBe(502)
    expect(body.destroyed).toBe(true)
  })

  it('closes the file stream and answers 502 when a header can’t be sent', async () => {
    fakeLibrary({ 'GET /wp-json/wp/v2/media': media() })
    const body = Readable.from([Buffer.from('bytes')])
    vi.spyOn(fileAxios, 'get').mockResolvedValue({
      data: body,
      status: 200,
      statusText: 'OK',
      // Node refuses a header value with a control character.
      headers: { 'content-length': '5', 'content-encoding': 'gzip\u0001' },
      config: { headers: new AxiosHeaders() },
    })
    const res = await request(libraryApp()).get('/items/1000/download')
    expect(res.status).toBe(502)
    expect(res.body.code).toBe('wp_unexpected_response')
    // None of the file's headers leak into the error answer.
    expect(res.headers['content-encoding']).toBeUndefined()
    expect(res.headers['content-disposition']).toBeUndefined()
    expect(body.destroyed).toBe(true)
  })

  it.each([
    ['/items/1000/download?variant=thumb', 400, 'invalid_request'],
    ['/items/1000/download?size=full', 400, 'invalid_request'],
    ['/items/abc/download', 404, 'not_found'],
  ])('%s → %i', async (path, status, code) => {
    fakeLibrary()
    const res = await request(libraryApp()).get(path)
    expect(res.status).toBe(status)
    expect(res.body.code).toBe(code)
  })
})

describe('download names', () => {
  it('encodes non-ASCII names for filename*', () => {
    expect(contentDisposition('Strand ved Skagen (1).jpg')).toBe(
      `attachment; filename="Strand ved Skagen (1).jpg"; filename*=UTF-8''Strand%20ved%20Skagen%20%281%29.jpg`,
    )
    expect(contentDisposition('blåbær.jpg')).toBe(
      `attachment; filename="bl_b_r.jpg"; filename*=UTF-8''bl%C3%A5b%C3%A6r.jpg`,
    )
    expect(contentDisposition('a"b\\c\r\n.jpg')).toBe(
      `attachment; filename="abc.jpg"; filename*=UTF-8''abc.jpg`,
    )
  })

  it('decodes percent-encoded basenames', () => {
    const item = wpMediaFor(fixture(1004))
    item.source_url = 'https://example.com/wp-content/uploads/bl%C3%A5.jpg'
    expect(downloadSource(item, 'file').filename).toBe('blå.jpg')
  })
})
