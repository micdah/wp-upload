import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import type { AxiosResponse } from 'axios'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { connectionState, wpAxios } from '../config/wpClient.ts'
import {
  filenameToSlug,
  findExistingMediaBySlug,
  isWpError,
  multipartFilename,
  normaliseWpError,
  uploadToWordPress,
} from './wpUpload.ts'

describe.concurrent('normaliseWpError', () => {
  it('maps ECONNABORTED to a 504 timeout error', () => {
    const result = normaliseWpError({
      isAxiosError: true,
      code: 'ECONNABORTED',
    })

    expect(result).toEqual({
      status: 504,
      code: 'wp_timeout',
      message: expect.stringContaining('did not respond in time'),
    })
  })

  it('passes through a JSON error body from WordPress', () => {
    const result = normaliseWpError({
      isAxiosError: true,
      response: {
        status: 400,
        data: { code: 'rest_invalid_param', message: 'Bad request' },
      },
    })

    expect(result).toEqual({
      status: 400,
      code: 'rest_invalid_param',
      message: 'Bad request',
    })
  })

  it('falls back to "wp_error" when the JSON body has a message but no code', () => {
    const result = normaliseWpError({
      isAxiosError: true,
      response: { status: 400, data: { message: 'Bad request' } },
    })

    expect(result).toEqual({
      status: 400,
      code: 'wp_error',
      message: 'Bad request',
    })
  })

  it('classifies a non-JSON response body as an unexpected response', () => {
    const result = normaliseWpError({
      isAxiosError: true,
      response: { status: 503, data: '<html>Maintenance</html>' },
    })

    expect(result.status).toBe(503)
    expect(result.code).toBe('wp_unexpected_response')
  })

  it('maps a redirect to a 502 that names the redirect target', () => {
    const result = normaliseWpError({
      isAxiosError: true,
      response: {
        status: 301,
        data: '',
        headers: { location: 'https://example.com/wp-json/wp/v2/media' },
      },
    })

    expect(result).toEqual({
      status: 502,
      code: 'wp_redirect',
      message: expect.stringContaining(
        'https://example.com/wp-json/wp/v2/media',
      ),
    })
    expect(result.message).toContain('WP_URL')
  })

  it('classifies a response-less axios error as unreachable', () => {
    const result = normaliseWpError({
      isAxiosError: true,
      code: 'ECONNREFUSED',
      message: 'connect ECONNREFUSED',
    })

    expect(result).toEqual({
      status: 502,
      code: 'wp_unreachable',
      message: expect.stringContaining('ECONNREFUSED'),
    })
  })

  it('classifies a non-axios Error as unreachable using its message', () => {
    const result = normaliseWpError(new Error('boom'))

    expect(result).toEqual({
      status: 502,
      code: 'wp_unreachable',
      message: expect.stringContaining('boom'),
    })
  })

  it('stringifies a thrown non-Error value', () => {
    const result = normaliseWpError('oops')

    expect(result.message).toContain('oops')
  })
})

describe.concurrent('isWpError', () => {
  it('accepts a well-shaped WpError', () => {
    expect(isWpError({ status: 500, code: 'x', message: 'y' })).toBe(true)
  })

  it.each([
    null,
    undefined,
    'string',
    42,
    {},
    { status: 1 },
    { status: 1, code: 'x' },
  ])('rejects %j', (value) => {
    expect(isWpError(value)).toBe(false)
  })
})

// Plain describe: every test here spies on the shared `wpAxios.post` instance
// and reads/mutates the shared `connectionState`, so concurrent execution
// could interleave mid-await and observe another test's half-applied change.
describe('uploadToWordPress', () => {
  const file = {
    path: '/tmp/upload',
    mimetype: 'image/png',
    originalname: 'photo.png',
    size: 42,
  } as Express.Multer.File

  it('returns a mapped UploadResult on success', async () => {
    vi.spyOn(wpAxios, 'post').mockResolvedValue({
      data: {
        id: 7,
        title: { rendered: 'Photo' },
        source_url: 'https://example.invalid/photo.png',
        mime_type: 'image/png',
      },
    } as unknown as AxiosResponse)

    const result = await uploadToWordPress(file)

    expect(result).toEqual({
      id: 7,
      title: 'Photo',
      sourceUrl: 'https://example.invalid/photo.png',
      mimeType: 'image/png',
    })
  })

  it('falls back to the original filename when WordPress omits a title', async () => {
    vi.spyOn(wpAxios, 'post').mockResolvedValue({
      data: {
        id: 7,
        source_url: 'https://example.invalid/photo.png',
        mime_type: 'image/png',
      },
    } as unknown as AxiosResponse)

    const result = await uploadToWordPress(file)

    expect(result.title).toBe('photo.png')
  })

  it('invalidates the connection and rethrows the normalised error on a 401/403', async () => {
    vi.spyOn(wpAxios, 'post').mockRejectedValue({
      isAxiosError: true,
      response: {
        status: 401,
        data: {
          code: 'rest_forbidden',
          message: 'Sorry, you are not allowed.',
        },
      },
    })

    await expect(uploadToWordPress(file)).rejects.toEqual({
      status: 401,
      code: 'rest_forbidden',
      message: 'Sorry, you are not allowed.',
    })
    expect(connectionState.connected).toBe(false)
    expect(connectionState.reason).toBe(
      'WordPress rejected the configured credentials.',
    )
  })

  it('does not invalidate the connection for non-auth errors', async () => {
    connectionState.connected = true
    connectionState.reason = null
    vi.spyOn(wpAxios, 'post').mockRejectedValue({
      isAxiosError: true,
      response: { status: 500, data: {} },
    })

    await expect(uploadToWordPress(file)).rejects.toMatchObject({ status: 500 })
    expect(connectionState.connected).toBe(true)
    expect(connectionState.reason).toBeNull()
  })

  it('forwards the abort signal through to wpAxios.post', async () => {
    const postSpy = vi.spyOn(wpAxios, 'post').mockResolvedValue({
      data: {
        id: 7,
        title: { rendered: 'Photo' },
        source_url: 'https://example.invalid/photo.png',
        mime_type: 'image/png',
      },
    } as unknown as AxiosResponse)
    const controller = new AbortController()

    await uploadToWordPress(file, { signal: controller.signal })

    expect(postSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.anything(),
      expect.objectContaining({ signal: controller.signal }),
    )
  })

  it('rejects with a normalised WpError when the request is cancelled', async () => {
    vi.spyOn(wpAxios, 'post').mockRejectedValue({
      isAxiosError: true,
      code: 'ERR_CANCELED',
      message: 'canceled',
    })
    const controller = new AbortController()

    await expect(
      uploadToWordPress(file, { signal: controller.signal }),
    ).rejects.toEqual({
      status: 502,
      code: 'wp_unreachable',
      message: expect.stringContaining('ERR_CANCELED'),
    })
  })
})

// Plain describe: spies on the shared wpAxios.post instance. Uses a real
// temp file, so the request body can be read back and checked byte for byte.
describe('uploadToWordPress multipart body', () => {
  const FILE_BYTES = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x00, 0xff,
  ])
  let tempDir: string
  let tempPath: string

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-upload-spec-'))
    tempPath = path.join(tempDir, 'upload')
    fs.writeFileSync(tempPath, FILE_BYTES)
  })

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  function multerFile(originalname: string, mimetype = 'image/png') {
    return {
      path: tempPath,
      mimetype,
      originalname,
      size: FILE_BYTES.length,
    } as Express.Multer.File
  }

  // Runs an upload against a mocked wpAxios.post and reads back what would
  // have been sent to WordPress.
  async function captureRequest(file: Express.Multer.File) {
    let sent: { body: unknown; headers: Record<string, unknown> } | null = null
    vi.spyOn(wpAxios, 'post').mockImplementation(async (_url, body, config) => {
      const chunks: Buffer[] = []
      for await (const chunk of body as Readable) chunks.push(chunk)
      sent = {
        body: Buffer.concat(chunks),
        headers: (config?.headers ?? {}) as Record<string, unknown>,
      }
      expect(body).toBeInstanceOf(Readable)
      return {
        data: {
          id: 7,
          source_url: 'https://example.invalid/x',
          mime_type: 'image/png',
        },
      } as AxiosResponse
    })

    await uploadToWordPress(file)

    if (!sent) throw new Error('wpAxios.post was not called')
    const { body, headers } = sent as {
      body: Buffer
      headers: Record<string, unknown>
    }
    const boundary = /^multipart\/form-data; boundary=(\S+)$/.exec(
      String(headers['Content-Type']),
    )?.[1]
    return { body, headers, boundary }
  }

  it('sends the file as a single "file" part with an exact Content-Length', async () => {
    const { body, headers, boundary } = await captureRequest(
      multerFile('photo.png'),
    )

    expect(boundary).toBeTruthy()
    expect(headers['Content-Length']).toBe(body.length)
    const expected = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\n` +
          'Content-Disposition: form-data; name="file"; filename="photo.png"\r\n' +
          'Content-Type: image/png\r\n' +
          '\r\n',
      ),
      FILE_BYTES,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ])
    expect(body.equals(expected)).toBe(true)
  })

  // follow-redirects (axios's default transport) would otherwise keep a copy
  // of the whole request body in memory.
  it('disables redirects so the body is never buffered for replay', async () => {
    const postSpy = vi.spyOn(wpAxios, 'post').mockResolvedValue({
      data: { id: 7 },
    } as AxiosResponse)

    await uploadToWordPress(multerFile('photo.png'))

    expect(postSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.anything(),
      expect.objectContaining({ maxRedirects: 0 }),
    )
  })

  // axios pipes the body without destroying it when the request fails, so
  // uploadToWordPress must, or the temp file's descriptor would stay open.
  it('closes the file when the request fails part-way through the body', async () => {
    const realCreateReadStream = fs.createReadStream
    const fileStreams: fs.ReadStream[] = []
    vi.spyOn(fs, 'createReadStream').mockImplementation((...args) => {
      const stream = realCreateReadStream(...(args as [string]))
      fileStreams.push(stream)
      return stream
    })
    let sentBody: Readable | null = null
    vi.spyOn(wpAxios, 'post').mockImplementation(async (_url, body) => {
      sentBody = body as Readable
      // Read the part header and the first file chunk, then fail. A manual
      // iterator rather than `for await` + break, since breaking would
      // destroy the body itself.
      const chunks = sentBody[Symbol.asyncIterator]()
      await chunks.next()
      await chunks.next()
      throw { isAxiosError: true, response: { status: 500, data: {} } }
    })

    await expect(
      uploadToWordPress(multerFile('photo.png')),
    ).rejects.toMatchObject({ status: 500 })

    expect(sentBody).not.toBeNull()
    expect((sentBody as unknown as Readable).destroyed).toBe(true)
    expect(fileStreams).toHaveLength(1)
    await vi.waitFor(() => expect(fileStreams[0]?.closed).toBe(true))
  })

  it('uses a different boundary for each upload', async () => {
    const first = await captureRequest(multerFile('photo.png'))
    const second = await captureRequest(multerFile('photo.png'))

    expect(first.boundary).not.toBe(second.boundary)
  })

  it.each([
    ['a name with spaces', 'my photo.jpg', 'my photo.jpg'],
    ['a non-ASCII name', 'café 写真.jpg', 'café 写真.jpg'],
    ['a name with quotes', 'say "hi".jpg', 'say hi.jpg'],
  ])('sends %s unencoded, as UTF-8', async (_label, originalname, sentName) => {
    const { body, headers } = await captureRequest(multerFile(originalname))

    expect(
      body.includes(Buffer.from(`filename="${sentName}"\r\n`, 'utf8')),
    ).toBe(true)
    expect(headers['Content-Length']).toBe(body.length)
  })

  it('falls back to application/octet-stream without a MIME type', async () => {
    const { body } = await captureRequest(multerFile('photo.png', ''))

    expect(
      body.includes(Buffer.from('Content-Type: application/octet-stream\r\n')),
    ).toBe(true)
  })
})

describe.concurrent('multipartFilename', () => {
  it.each([
    ['my photo.jpg', 'my photo.jpg'],
    ['café.jpg', 'café.jpg'],
    ['写真.jpg', '写真.jpg'],
    ['say "hi".jpg', 'say hi.jpg'],
    ['back\\slash.jpg', 'backslash.jpg'],
    ['a/b.jpg', 'ab.jpg'],
    ['line\r\nbreak.jpg', 'linebreak.jpg'],
    ['tab\there.jpg', 'tabhere.jpg'],
    ['"".jpg', 'upload.jpg'],
    ['"/\\', 'upload'],
  ])('%j -> %j', (name, expected) => {
    expect(multipartFilename(name)).toBe(expected)
  })
})

describe.concurrent('filenameToSlug', () => {
  it('strips the extension and lowercases', () => {
    expect(filenameToSlug('Photo.PNG')).toBe('photo')
  })

  it('replaces whitespace with a single dash and deletes other punctuation', () => {
    expect(filenameToSlug('My Summer Trip (2024)!!.jpg')).toBe(
      'my-summer-trip-2024',
    )
  })

  it('deletes punctuation without inserting a dash in its place', () => {
    expect(filenameToSlug('photo(1).jpg')).toBe('photo1')
  })

  it('preserves underscores rather than folding them into a dash - camera default filenames rely on this', () => {
    expect(filenameToSlug('IMG_1234.JPG')).toBe('img_1234')
  })

  it('strips leading/trailing dashes left by punctuation at the edges', () => {
    expect(filenameToSlug('-- weird_name --.jpg')).toBe('weird_name')
  })

  it('strips accents', () => {
    expect(filenameToSlug('café.jpg')).toBe('cafe')
  })

  it('returns an empty string for a filename with no sluggable characters', () => {
    expect(filenameToSlug('.jpg')).toBe('')
  })
})

// Plain describe: spies on the shared wpAxios.get instance.
describe('findExistingMediaBySlug', () => {
  it('returns [] without calling WordPress when the slug is empty', async () => {
    const getSpy = vi.spyOn(wpAxios, 'get')

    const result = await findExistingMediaBySlug('.jpg')

    expect(result).toEqual([])
    expect(getSpy).not.toHaveBeenCalled()
  })

  it('maps matching media items from the slug lookup', async () => {
    vi.spyOn(wpAxios, 'get').mockResolvedValue({
      data: [
        {
          id: 7,
          title: { rendered: 'Photo' },
          source_url: 'https://example.invalid/photo.png',
        },
      ],
    } as unknown as AxiosResponse)

    const result = await findExistingMediaBySlug('Photo.png')

    expect(result).toEqual([
      { id: 7, title: 'Photo', sourceUrl: 'https://example.invalid/photo.png' },
    ])
  })

  it('queries by the slugified filename', async () => {
    const getSpy = vi
      .spyOn(wpAxios, 'get')
      .mockResolvedValue({ data: [] } as unknown as AxiosResponse)

    await findExistingMediaBySlug('My Photo.png')

    expect(getSpy).toHaveBeenCalledWith(
      '/wp-json/wp/v2/media',
      expect.objectContaining({
        params: expect.objectContaining({ slug: 'my-photo' }),
      }),
    )
  })

  it('returns [] when WordPress responds with something unexpected', async () => {
    vi.spyOn(wpAxios, 'get').mockResolvedValue({
      data: null,
    } as unknown as AxiosResponse)

    const result = await findExistingMediaBySlug('photo.png')

    expect(result).toEqual([])
  })

  it('throws a normalised WpError when the lookup fails', async () => {
    vi.spyOn(wpAxios, 'get').mockRejectedValue({
      isAxiosError: true,
      response: { status: 500, data: {} },
    })

    await expect(findExistingMediaBySlug('photo.png')).rejects.toMatchObject({
      status: 500,
    })
  })
})
