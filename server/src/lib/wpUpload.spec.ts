import type { ReadStream } from 'node:fs'
import fs from 'node:fs'
import type { AxiosResponse } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { connectionState, wpAxios } from '../config/wpClient.ts'
import {
  filenameToSlug,
  findExistingMediaBySlug,
  isWpError,
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

  beforeEach(() => {
    vi.spyOn(fs, 'createReadStream').mockReturnValue(
      {} as unknown as ReadStream,
    )
  })

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
