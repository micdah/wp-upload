import axios from 'axios'
import type {
  ErrorRequestHandler,
  NextFunction,
  Request,
  RequestHandler,
  Response,
} from 'express'
import multer from 'multer'
import type { ApiError, ItemError } from '../../../../shared/library-api.ts'
import { invalidateConnection } from '../../config/wpClient.ts'
import { isWpError, normaliseWpError } from '../wpUpload.ts'

// Error handling for /api/library/* (server-api.md §2). Every non-2xx JSON
// answer has the `ApiError` envelope, and every upstream (WordPress or
// companion plugin) failure goes through toLibraryError(), which applies the
// mapping table of server-api.md §2.3 top-down.

/** An error the library routes answer with as-is. */
export class LibraryError extends Error {
  readonly status: number
  readonly code: string
  readonly details: Record<string, unknown> | undefined

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'LibraryError'
    this.status = status
    this.code = code
    this.details = details
  }

  get body(): ApiError {
    return this.details === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, details: this.details }
  }
}

/** 400 `invalid_request` naming the offending parameter or body field. */
export function invalidRequest(param: string, message: string): LibraryError {
  return new LibraryError(400, 'invalid_request', message, { param })
}

/** 404 `not_found`, e.g. for a non-numeric id in a path. */
export function notFound(message = 'The requested item does not exist.') {
  return new LibraryError(404, 'not_found', message)
}

export interface MappedError {
  status: number
  body: ApiError
}

export const MESSAGES = {
  authFailed: 'WordPress rejected the configured credentials.',
  timeout: 'WordPress did not respond in time.',
  pluginMissing: 'The companion plugin is not installed on the WordPress site.',
  forbidden: 'WordPress refused the request for lack of permission.',
  internal: 'Something went wrong on the server.',
} as const

// What came back from upstream, reduced to what the mapping table looks at.
type Upstream =
  | { kind: 'timeout' }
  | { kind: 'no-response'; message: string }
  | { kind: 'redirect'; message: string }
  | {
      kind: 'response'
      status: number
      /** null when the body isn't a WordPress JSON error */
      json: UpstreamJson | null
      unexpectedMessage: string
    }

interface UpstreamJson {
  code: string
  message: string
  data: Record<string, unknown> | null
}

const TIMEOUT_CODES = new Set(['ECONNABORTED', 'ETIMEDOUT', 'ERR_CANCELED'])

/**
 * Maps any error from a library route or a WordPress/plugin call to the
 * status and `ApiError` body the browser gets (server-api.md §2.3). Also
 * marks the WordPress connection down when WordPress answered 401.
 *
 * Accepts `LibraryError`s (answered as they are), axios errors from
 * `wpAxios`, and the `WpError` objects the legacy upload code throws.
 * Anything else is a bug: 500 `internal_error`.
 */
export function toLibraryError(err: unknown): MappedError {
  if (err instanceof LibraryError) {
    return { status: err.status, body: err.body }
  }

  const upstream = describeUpstream(err)
  if (!upstream) {
    return {
      status: 500,
      body: { code: 'internal_error', message: MESSAGES.internal },
    }
  }
  return mapUpstream(upstream)
}

function describeUpstream(err: unknown): Upstream | null {
  if (axios.isAxiosError(err)) {
    if (err.code && TIMEOUT_CODES.has(err.code)) return { kind: 'timeout' }
    if (!err.response) {
      return { kind: 'no-response', message: normaliseWpError(err).message }
    }
    const { status, data } = err.response
    if (status >= 300 && status < 400) {
      return { kind: 'redirect', message: normaliseWpError(err).message }
    }
    return {
      kind: 'response',
      status,
      json: readWpErrorBody(data),
      unexpectedMessage: normaliseWpError(err).message,
    }
  }

  // Already normalised by normaliseWpError() (the legacy upload code).
  if (isWpError(err) && typeof err.status === 'number') {
    switch (err.code) {
      case 'wp_timeout':
        return { kind: 'timeout' }
      case 'wp_unreachable':
        return { kind: 'no-response', message: err.message }
      case 'wp_redirect':
        return { kind: 'redirect', message: err.message }
      case 'wp_unexpected_response':
        return {
          kind: 'response',
          status: err.status,
          json: null,
          unexpectedMessage: err.message,
        }
      default:
        return {
          kind: 'response',
          status: err.status,
          json: { code: err.code, message: err.message, data: null },
          unexpectedMessage: err.message,
        }
    }
  }
  return null
}

// A WordPress REST error is `{code, message, data: {status, …}}`. Anything
// else (a WAF page, a PHP fatal, a maintenance page) is "not JSON".
function readWpErrorBody(data: unknown): UpstreamJson | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const body = data as Record<string, unknown>
  if (typeof body.code !== 'string' || typeof body.message !== 'string') {
    return null
  }
  const extra =
    body.data && typeof body.data === 'object' && !Array.isArray(body.data)
      ? (body.data as Record<string, unknown>)
      : null
  return { code: body.code, message: body.message, data: extra }
}

function mapUpstream(upstream: Upstream): MappedError {
  // Rows 1–3: no usable answer at all.
  if (upstream.kind === 'timeout') {
    return error(504, 'wp_timeout', MESSAGES.timeout)
  }
  if (upstream.kind === 'no-response') {
    return error(502, 'wp_unreachable', upstream.message)
  }
  if (upstream.kind === 'redirect') {
    return error(502, 'wp_redirect', upstream.message)
  }

  const { status, json } = upstream
  const upstreamDetails = {
    upstreamStatus: status,
    ...(json ? { upstreamCode: json.code } : {}),
  }

  // Row 4: nothing under /api may answer 401 except the session check.
  if (status === 401) {
    invalidateConnection(MESSAGES.authFailed)
    return error(502, 'wp_auth_failed', MESSAGES.authFailed, upstreamDetails)
  }

  // Everything below needs a WordPress JSON error body (row 12 otherwise).
  // A 403 without one is a WAF or host block, not a capability answer.
  if (!json) {
    return error(502, 'wp_unexpected_response', upstream.unexpectedMessage, {
      upstreamStatus: status,
    })
  }

  // Row 5.
  if (status === 403) {
    return error(
      403,
      'forbidden',
      json.message || MESSAGES.forbidden,
      upstreamDetails,
    )
  }
  // Row 6.
  if (status === 404 && json.code === 'rest_no_route') {
    return error(409, 'plugin_missing', MESSAGES.pluginMissing, upstreamDetails)
  }
  // Row 7: the plugin's own codes pass through unchanged.
  if (json.code.startsWith('wpu_') && status >= 400 && status <= 599) {
    return error(status, json.code, json.message, dataWithoutStatus(json.data))
  }
  // Row 8.
  if (status === 409 || status === 413 || status === 415) {
    return error(status, json.code, json.message, dataWithoutStatus(json.data))
  }
  // Row 9.
  if (status === 400) {
    const params = json.data?.params
    return error(400, 'invalid_request', json.message, {
      ...upstreamDetails,
      ...(params !== undefined ? { params } : {}),
    })
  }
  // Row 10.
  if (status === 404) {
    return error(404, 'not_found', json.message, upstreamDetails)
  }
  // Row 11.
  if (status >= 500) {
    return error(
      502,
      'wp_error',
      `WordPress failed with HTTP ${status}.`,
      upstreamDetails,
    )
  }
  // Not in the table (e.g. 405, 410, 429): an error of WordPress we can't
  // act on, reported like a 5xx.
  return error(
    502,
    'wp_error',
    `WordPress answered HTTP ${status}: ${json.message}`,
    upstreamDetails,
  )
}

function dataWithoutStatus(
  data: Record<string, unknown> | null,
): Record<string, unknown> | undefined {
  if (!data) return undefined
  const { status: _status, ...rest } = data
  return Object.keys(rest).length > 0 ? rest : undefined
}

function error(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): MappedError {
  return {
    status,
    body:
      details === undefined ? { code, message } : { code, message, details },
  }
}

// HTTP status of each plugin error code (plugin-api.md §4), for per-item
// failures that become the error of a whole request (PATCH items/:id).
const PLUGIN_ERROR_STATUS: Record<string, number> = {
  wpu_forbidden: 403,
  wpu_invalid_param: 400,
  wpu_too_many_items: 400,
  wpu_not_found: 404,
  wpu_folder_not_found: 404,
  wpu_post_not_found: 404,
  wpu_invalid_parent: 400,
  wpu_collection_too_large: 422,
  wpu_stale: 409,
  wpu_locked: 409,
  wpu_filebird_inactive: 409,
  wpu_filebird_per_user: 409,
  wpu_folder_cycle: 409,
  wpu_invalid_folder_name: 400,
  wpu_folder_name_exhausted: 409,
  wpu_pro_required: 409,
  wpu_trash_disabled: 409,
  wpu_not_trashed: 409,
  wpu_unsupported_type: 415,
  wpu_mime_mismatch: 415,
  wpu_file_too_large: 413,
  wpu_invalid_edit: 400,
  wpu_nothing_to_undo: 409,
  wpu_not_edited: 409,
  wpu_image_error: 500,
  wpu_io_error: 500,
  wpu_time_budget: 503,
  wpu_not_implemented: 501,
  wpu_internal: 500,
}

/**
 * Turns a per-item failure from a plugin batch route into the error of a
 * whole request, as if the plugin had answered with that error: e.g.
 * `wpu_forbidden` → 403 `forbidden`, `wpu_not_found` → 404 `wpu_not_found`.
 */
export function itemErrorToLibraryError(itemError: ItemError): LibraryError {
  const status = PLUGIN_ERROR_STATUS[itemError.code] ?? 500
  const mapped = mapUpstream({
    kind: 'response',
    status,
    json: { code: itemError.code, message: itemError.message, data: null },
    unexpectedMessage: itemError.message,
  })
  return new LibraryError(
    mapped.status,
    mapped.body.code,
    mapped.body.message,
    mapped.body.details,
  )
}

type AsyncHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<unknown>

/** Express 4 doesn't catch rejected promises: hand them to the error handler. */
export function asyncRoute(handler: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next)
  }
}

/** Sends an error from a library route with the `ApiError` envelope. */
export function sendLibraryError(res: Response, err: unknown): void {
  const mapped = toLibraryError(err)
  if (mapped.body.code === 'internal_error') console.error(err)
  // res.end() rather than res.json(): no Express ETag on a no-store answer.
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.status(mapped.status).end(JSON.stringify(mapped.body))
}

/**
 * The error handler of `libraryRouter`. Body-parser and multer errors are
 * left to the app's own `errorHandler`, which already answers them with the
 * codes server-api.md §2.2 lists (`invalid_json`, `file_too_large`, …).
 */
export const libraryErrorHandler: ErrorRequestHandler = (
  err,
  _req,
  res,
  next,
) => {
  if (res.headersSent) {
    next(err)
    return
  }
  const isBodyParserError = typeof err?.type === 'string' && 'expose' in err
  if (isBodyParserError || err instanceof multer.MulterError) {
    next(err)
    return
  }
  sendLibraryError(res, err)
}

// ---------------------------------------------------------------------------
// Request validation helpers (server-api.md §1, §4.1)
// ---------------------------------------------------------------------------

/**
 * The query parameters of a request, as plain strings. Rejects parameters
 * the route doesn't know (so typos surface) and repeated ones; an empty
 * value counts as absent (server-api.md §1, §6).
 */
export function queryParams(
  req: Request,
  allowed: readonly string[],
): Record<string, string> {
  const params: Record<string, string> = {}
  for (const [name, value] of Object.entries(req.query)) {
    if (!allowed.includes(name)) {
      throw invalidRequest(name, `Unknown parameter "${name}".`)
    }
    if (typeof value !== 'string') {
      throw invalidRequest(name, `${name}: give the parameter once.`)
    }
    if (value !== '') params[name] = value
  }
  return params
}

/**
 * Characters as WordPress counts them: code points, not UTF-16 units, so an
 * emoji counts once (the length limits of server-api.md §4.1).
 */
export function characters(text: string): number {
  let count = 0
  for (const _ of text) count++
  return count
}

const ID_PATTERN = /^[1-9][0-9]{0,15}$/

/** A positive integer id, or null when `raw` isn't one. */
export function parseId(raw: unknown): number | null {
  if (typeof raw === 'number') {
    return Number.isSafeInteger(raw) && raw > 0 ? raw : null
  }
  if (typeof raw !== 'string' || !ID_PATTERN.test(raw)) return null
  const id = Number(raw)
  return Number.isSafeInteger(id) ? id : null
}

/** The `:id` of a path; 404 `not_found` when it isn't a positive integer. */
export function pathId(req: Request, name = 'id'): number {
  const id = parseId(req.params[name])
  if (id === null) throw notFound()
  return id
}

/**
 * A comma-separated id list (`ids=12,15,99`): 1–`max` distinct positive
 * integers after removing duplicates, in the order given.
 */
export function parseIdList(
  raw: string | undefined,
  param: string,
  max: number,
): number[] {
  if (raw === undefined) throw invalidRequest(param, `${param} is required.`)
  return uniqueIds(raw.split(','), param, max)
}

/** Like parseIdList, for an array in a JSON body. */
export function parseIdArray(
  raw: unknown,
  param: string,
  max: number,
): number[] {
  if (!Array.isArray(raw)) {
    throw invalidRequest(param, `${param} must be an array of ids.`)
  }
  return uniqueIds(raw, param, max)
}

function uniqueIds(values: unknown[], param: string, max: number): number[] {
  const ids: number[] = []
  const seen = new Set<number>()
  for (const value of values) {
    const id = parseId(typeof value === 'string' ? value.trim() : value)
    if (id === null) {
      throw invalidRequest(param, `${param}: ids must be positive integers.`)
    }
    if (!seen.has(id)) {
      seen.add(id)
      ids.push(id)
    }
  }
  if (ids.length === 0) {
    throw invalidRequest(param, `${param}: give at least one id.`)
  }
  if (ids.length > max) {
    throw invalidRequest(param, `${param}: at most ${max} ids per request.`)
  }
  return ids
}

/** The JSON body as an object; 400 for anything else (arrays, scalars). */
export function objectBody(req: Request): Record<string, unknown> {
  const body: unknown = req.body
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw invalidRequest('body', 'The request body must be a JSON object.')
  }
  return body as Record<string, unknown>
}

/** Rejects body fields the route doesn't know. */
export function rejectUnknownFields(
  body: Record<string, unknown>,
  allowed: readonly string[],
): void {
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key)) {
      throw invalidRequest(key, `Unknown field "${key}".`)
    }
  }
}
