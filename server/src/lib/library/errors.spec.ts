import { AxiosError, AxiosHeaders } from 'axios'
import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import * as wpClient from '../../config/wpClient.ts'
import { errorHandler } from '../../middleware/errorHandler.ts'
import {
  asyncRoute,
  characters,
  invalidRequest,
  itemErrorToLibraryError,
  LibraryError,
  libraryErrorHandler,
  toLibraryError,
} from './errors.ts'
import {
  httpError,
  networkError,
  timeoutError,
  wpErrorResponse,
} from './specSupport.ts'

describe('characters', () => {
  it('counts code points, as WordPress does', () => {
    expect(characters('')).toBe(0)
    expect(characters('æøå')).toBe(3)
    // Astral characters are two UTF-16 units each, but one character.
    expect('😀𝄞'.length).toBe(4)
    expect(characters('😀𝄞')).toBe(2)
  })
})

describe('toLibraryError', () => {
  it('answers a LibraryError as it is', () => {
    expect(toLibraryError(invalidRequest('ids', 'ids: too many.'))).toEqual({
      status: 400,
      body: {
        code: 'invalid_request',
        message: 'ids: too many.',
        details: { param: 'ids' },
      },
    })
  })

  it('row 1: no response → 502 wp_unreachable', () => {
    expect(toLibraryError(networkError('ECONNREFUSED'))).toEqual({
      status: 502,
      body: {
        code: 'wp_unreachable',
        message: 'Could not reach WordPress (ECONNREFUSED).',
      },
    })
  })

  it.each([['ECONNABORTED'], ['ETIMEDOUT'], ['ERR_CANCELED']])(
    'row 2: %s → 504 wp_timeout',
    (code) => {
      const err = new AxiosError('timeout', code, {
        headers: new AxiosHeaders(),
      })
      expect(toLibraryError(err)).toEqual({
        status: 504,
        body: {
          code: 'wp_timeout',
          message: 'WordPress did not respond in time.',
        },
      })
      expect(toLibraryError(timeoutError()).body.code).toBe('wp_timeout')
    },
  )

  it('row 3: 3xx → 502 wp_redirect', () => {
    const mapped = toLibraryError(
      httpError(301, '', { location: 'https://example.com/' }),
    )
    expect(mapped.status).toBe(502)
    expect(mapped.body.code).toBe('wp_redirect')
    expect(mapped.body.message).toContain('https://example.com/')
  })

  it('row 4: 401 → 502 wp_auth_failed and marks the connection down', () => {
    const invalidate = vi
      .spyOn(wpClient, 'invalidateConnection')
      .mockImplementation(() => {})
    expect(toLibraryError(wpErrorResponse(401, 'incorrect_password'))).toEqual({
      status: 502,
      body: {
        code: 'wp_auth_failed',
        message: 'WordPress rejected the configured credentials.',
        details: { upstreamStatus: 401, upstreamCode: 'incorrect_password' },
      },
    })
    expect(invalidate).toHaveBeenCalledOnce()
  })

  it('row 4 wins over pass-through: a 401 wpu_* code is never a 401', () => {
    vi.spyOn(wpClient, 'invalidateConnection').mockImplementation(() => {})
    const mapped = toLibraryError(wpErrorResponse(401, 'wpu_forbidden'))
    expect(mapped.status).toBe(502)
    expect(mapped.body.code).toBe('wp_auth_failed')
  })

  it('row 4 also applies to a non-JSON 401', () => {
    vi.spyOn(wpClient, 'invalidateConnection').mockImplementation(() => {})
    const mapped = toLibraryError(httpError(401, '<html>Unauthorized</html>'))
    expect(mapped).toEqual({
      status: 502,
      body: {
        code: 'wp_auth_failed',
        message: 'WordPress rejected the configured credentials.',
        details: { upstreamStatus: 401 },
      },
    })
  })

  it('row 5: 403 → 403 forbidden with the upstream message and code', () => {
    expect(
      toLibraryError(
        wpErrorResponse(
          403,
          'wpu_forbidden',
          'Sorry, you are not allowed to edit this item.',
        ),
      ),
    ).toEqual({
      status: 403,
      body: {
        code: 'forbidden',
        message: 'Sorry, you are not allowed to edit this item.',
        details: { upstreamStatus: 403, upstreamCode: 'wpu_forbidden' },
      },
    })
  })

  it('a non-JSON 403 (a WAF page) → 502 wp_unexpected_response', () => {
    const mapped = toLibraryError(httpError(403, '<html>Blocked</html>'))
    expect(mapped.status).toBe(502)
    expect(mapped.body.code).toBe('wp_unexpected_response')
  })

  it('row 6: 404 rest_no_route → 409 plugin_missing', () => {
    expect(toLibraryError(wpErrorResponse(404, 'rest_no_route'))).toEqual({
      status: 409,
      body: {
        code: 'plugin_missing',
        message: 'The companion plugin is not installed on the WordPress site.',
        details: { upstreamStatus: 404, upstreamCode: 'rest_no_route' },
      },
    })
  })

  it('row 7: wpu_* codes pass through with data minus status as details', () => {
    expect(
      toLibraryError(
        wpErrorResponse(409, 'wpu_stale', 'The image changed.', {
          modifiedAt: '2026-10-02T08:41:19Z',
        }),
      ),
    ).toEqual({
      status: 409,
      body: {
        code: 'wpu_stale',
        message: 'The image changed.',
        details: { modifiedAt: '2026-10-02T08:41:19Z' },
      },
    })
  })

  it('row 7: a 5xx wpu_* code keeps its status', () => {
    expect(
      toLibraryError(wpErrorResponse(501, 'wpu_not_implemented', 'Not yet.')),
    ).toEqual({
      status: 501,
      body: { code: 'wpu_not_implemented', message: 'Not yet.' },
    })
  })

  it.each([
    [409, 'rest_upload_sideload_error'],
    [413, 'rest_upload_file_too_big'],
    [415, 'rest_upload_invalid_type'],
  ])('row 8: %i %s passes through', (status, code) => {
    expect(toLibraryError(wpErrorResponse(status, code, 'Nope.'))).toEqual({
      status,
      body: { code, message: 'Nope.' },
    })
  })

  it('row 9: other 400 → invalid_request with upstream code and params', () => {
    expect(
      toLibraryError(
        wpErrorResponse(400, 'rest_invalid_param', 'Invalid parameter(s): x', {
          params: { x: 'x is not an integer.' },
        }),
      ),
    ).toEqual({
      status: 400,
      body: {
        code: 'invalid_request',
        message: 'Invalid parameter(s): x',
        details: {
          upstreamStatus: 400,
          upstreamCode: 'rest_invalid_param',
          params: { x: 'x is not an integer.' },
        },
      },
    })
  })

  it('row 10: other 404 → not_found', () => {
    expect(
      toLibraryError(
        wpErrorResponse(404, 'rest_post_invalid_id', 'Invalid post ID.'),
      ),
    ).toEqual({
      status: 404,
      body: {
        code: 'not_found',
        message: 'Invalid post ID.',
        details: { upstreamStatus: 404, upstreamCode: 'rest_post_invalid_id' },
      },
    })
  })

  it('row 11: 5xx with a JSON body → 502 wp_error', () => {
    expect(
      toLibraryError(wpErrorResponse(500, 'internal_server_error')),
    ).toEqual({
      status: 502,
      body: {
        code: 'wp_error',
        message: 'WordPress failed with HTTP 500.',
        details: { upstreamStatus: 500, upstreamCode: 'internal_server_error' },
      },
    })
  })

  it('row 12: a non-JSON body → 502 wp_unexpected_response', () => {
    const mapped = toLibraryError(httpError(500, '<html>Fatal error</html>'))
    expect(mapped.status).toBe(502)
    expect(mapped.body.code).toBe('wp_unexpected_response')
    expect(mapped.body.details).toEqual({ upstreamStatus: 500 })
  })

  it('maps the WpError objects of the legacy upload code', () => {
    vi.spyOn(wpClient, 'invalidateConnection').mockImplementation(() => {})
    expect(
      toLibraryError({ status: 504, code: 'wp_timeout', message: 'x' }).body
        .code,
    ).toBe('wp_timeout')
    expect(
      toLibraryError({ status: 401, code: 'incorrect_password', message: 'x' })
        .body.code,
    ).toBe('wp_auth_failed')
    expect(
      toLibraryError({
        status: 413,
        code: 'rest_upload_file_too_big',
        message: 'Too big.',
      }),
    ).toEqual({
      status: 413,
      body: { code: 'rest_upload_file_too_big', message: 'Too big.' },
    })
  })

  it('anything else is a bug: 500 internal_error', () => {
    expect(toLibraryError(new TypeError('oops'))).toEqual({
      status: 500,
      body: {
        code: 'internal_error',
        message: 'Something went wrong on the server.',
      },
    })
  })
})

describe('itemErrorToLibraryError', () => {
  it.each([
    ['wpu_forbidden', 403, 'forbidden'],
    ['wpu_not_found', 404, 'wpu_not_found'],
    ['wpu_post_not_found', 404, 'wpu_post_not_found'],
    ['wpu_invalid_parent', 400, 'wpu_invalid_parent'],
  ])('%s → %i %s', (code, status, mappedCode) => {
    const err = itemErrorToLibraryError({ code, message: 'Nope.' })
    expect(err.status).toBe(status)
    expect(err.code).toBe(mappedCode)
    expect(err.message).toBe('Nope.')
  })
})

describe('libraryErrorHandler', () => {
  function buildApp(handler: express.RequestHandler) {
    const app = express()
    app.use(express.json())
    app.post('/x', handler)
    app.use(libraryErrorHandler)
    app.use(errorHandler)
    return app
  }

  it('answers errors from async routes with the envelope and no-store', async () => {
    const app = buildApp(
      asyncRoute(async () => {
        throw new LibraryError(409, 'wpu_folder_cycle', 'Cycle.')
      }),
    )
    const res = await request(app).post('/x').send({})
    expect(res.status).toBe(409)
    expect(res.body).toEqual({ code: 'wpu_folder_cycle', message: 'Cycle.' })
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('leaves body-parser errors to the app errorHandler', async () => {
    const app = buildApp((_req, res) => {
      res.json({})
    })
    const res = await request(app)
      .post('/x')
      .set('Content-Type', 'application/json')
      .send('{not json')
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('invalid_json')
  })

  it('logs and answers 500 for bugs', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const app = buildApp(
      asyncRoute(async () => {
        throw new Error('bug')
      }),
    )
    const res = await request(app).post('/x').send({})
    expect(res.status).toBe(500)
    expect(res.body.code).toBe('internal_error')
    expect(log).toHaveBeenCalled()
  })
})
