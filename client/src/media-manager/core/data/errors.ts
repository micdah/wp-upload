// The one error type every `api/library/*` call throws, and how the client
// classifies it. server-api.md §2: the client decides by `code`, never by
// HTTP status alone.

import type { ApiError } from '../../../../../shared/library-api'

/**
 * Codes the client itself produces when there is no usable `ApiError` body.
 * They never collide with the server's codes (server-api.md §2.2).
 */
export const CLIENT_ERROR_CODES = {
  /** fetch() itself failed: the app server is down or the browser is offline */
  network: 'network_error',
  /** a non-JSON body, e.g. a reverse proxy's error page */
  invalidResponse: 'invalid_response',
  /** the session was lost and the user logged out instead of logging in again */
  sessionLost: 'session_lost',
} as const

/**
 * - `session`: the session cookie is gone (401). The session-expired dialog
 *   handles it; requests wait for it (see session.ts).
 * - `connectivity`: WordPress (or the app server) can't be reached. Drives
 *   the offline banner.
 * - `wp-auth`: WordPress rejected the app's Application Password.
 * - `plugin`: the companion plugin vanished or became incompatible. The
 *   client re-runs `bootstrap`.
 * - `action`: everything else: an error of that one action.
 */
export type ErrorKind =
  | 'session'
  | 'connectivity'
  | 'wp-auth'
  | 'plugin'
  | 'action'

const CONNECTIVITY_CODES: ReadonlySet<string> = new Set([
  'wp_unreachable',
  'wp_timeout',
  CLIENT_ERROR_CODES.network,
])
const PLUGIN_CODES: ReadonlySet<string> = new Set([
  'plugin_missing',
  'plugin_incompatible',
])
/** Gateway statuses a reverse proxy answers with when the app server is down. */
const GATEWAY_STATUSES: ReadonlySet<number> = new Set([502, 503, 504])

export class LibraryError extends Error implements ApiError {
  override readonly name = 'LibraryError'
  /** HTTP status; 0 when no response arrived */
  readonly status: number
  readonly code: string
  readonly details?: Record<string, unknown>

  constructor(status: number, body: ApiError) {
    super(body.message)
    this.status = status
    this.code = body.code
    if (body.details !== undefined) {
      this.details = body.details
    }
  }

  get kind(): ErrorKind {
    return classifyError(this.status, this.code)
  }

  /** The plain `ApiError` envelope, e.g. for a job's `error` or a toast. */
  toApiError(): ApiError {
    const envelope: ApiError = { code: this.code, message: this.message }
    if (this.details !== undefined) {
      envelope.details = this.details
    }
    return envelope
  }
}

export function isLibraryError(value: unknown): value is LibraryError {
  return value instanceof LibraryError
}

/** True for the DOMException fetch() throws when its signal aborts. */
export function isAbortError(value: unknown): boolean {
  return value instanceof Error && value.name === 'AbortError'
}

function classifyError(status: number, code: string): ErrorKind {
  if (status === 401 || code === 'unauthorized') {
    return 'session'
  }
  if (code === CLIENT_ERROR_CODES.sessionLost) {
    return 'session'
  }
  if (CONNECTIVITY_CODES.has(code)) {
    return 'connectivity'
  }
  if (
    code === CLIENT_ERROR_CODES.invalidResponse &&
    GATEWAY_STATUSES.has(status)
  ) {
    return 'connectivity'
  }
  if (code === 'wp_auth_failed') {
    return 'wp-auth'
  }
  if (PLUGIN_CODES.has(code)) {
    return 'plugin'
  }
  return 'action'
}

/** The kind of any thrown value; unknown errors count as `action`. */
export function errorKind(error: unknown): ErrorKind {
  if (isLibraryError(error)) {
    return error.kind
  }
  return 'action'
}

// Every query and mutation of the media manager fails with a LibraryError
// (http.ts converts everything else), so that is TanStack Query's default
// error type in this app.
declare module '@tanstack/react-query' {
  interface Register {
    defaultError: LibraryError
  }
}
