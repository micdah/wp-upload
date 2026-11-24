// The transport for `api/library/*`: relative URLs only (the app runs under
// any sub-path), JSON in and out, `ApiError` envelopes turned into
// `LibraryError`, a pause while the session is lost (session.ts), and
// connectivity reporting (connectivity.ts).
//
// A 401 tells the app's session-lost listener (`notifyUnauthorized`, as
// `apiFetch` does), but only when it belongs to the current session epoch: a
// 401 for a request sent before a re-login must not re-open the dialog.

import type { ApiError } from '../../../../../shared/library-api'
import { LIBRARY_REV_HEADER } from '../../../../../shared/library-api'
import { notifyUnauthorized } from '../../../lib/api'
import {
  type ConnectivityStore,
  connectivityStore as defaultConnectivity,
} from './connectivity'
import { CLIENT_ERROR_CODES, isAbortError, LibraryError } from './errors'
import { sessionGate as defaultGate, type SessionGate } from './session'

/** Every library route is relative to this (no leading slash). */
export const LIBRARY_BASE = 'api/library/'

/** How many times one request is replayed after a re-login. */
const MAX_SESSION_REPLAYS = 3

export type QueryValue =
  | string
  | number
  | boolean
  | readonly (string | number)[]
  | null
  | undefined

export type Query = Record<string, QueryValue>

export interface RequestOptions {
  signal?: AbortSignal
  query?: Query
  /** A JSON body, or FormData for the multipart routes. */
  body?: unknown
  /**
   * The request proves whether WordPress is reachable (rev, bootstrap):
   * its success clears the offline state. Mutations count as probes too.
   */
  probe?: boolean
  /** `none` for 204 routes. Default `json`. */
  expect?: 'json' | 'none'
}

export interface LibraryResponse<T> {
  data: T
  status: number
  /** `X-Library-Rev`, when the route sent it */
  rev: string | null
  headers: Headers
}

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'

/** Swappable for tests; the app uses the defaults. */
export interface HttpDeps {
  gate: SessionGate
  connectivity: ConnectivityStore
  fetch: (input: string, init?: RequestInit) => Promise<Response>
  /** Tells the app the session is gone (shows the session-expired dialog). */
  notifyUnauthorized: () => void
}

const defaultDeps: HttpDeps = {
  gate: defaultGate,
  connectivity: defaultConnectivity,
  // Resolved per call, so test tools that patch `fetch` still see it.
  fetch: (input, init) => fetch(input, init),
  notifyUnauthorized,
}

let deps: HttpDeps = defaultDeps

/** Tests only: replace the transport's collaborators. Returns a restore function. */
export function setHttpDeps(next: Partial<HttpDeps>): () => void {
  const previous = deps
  deps = { ...deps, ...next }
  return () => {
    deps = previous
  }
}

/**
 * `api/library/<path>?<query>`. Arrays become comma lists (server-api.md §1);
 * null, undefined and empty strings are left out (they mean "default").
 */
export function libraryUrl(path: string, query?: Query): string {
  const url = LIBRARY_BASE + path.replace(/^\/+/, '')
  if (!query) {
    return url
  }
  const parts: string[] = []
  for (const [key, value] of Object.entries(query)) {
    const encoded = encodeQueryValue(value)
    if (encoded !== null) {
      parts.push(`${encodeURIComponent(key)}=${encoded}`)
    }
  }
  return parts.length > 0 ? `${url}?${parts.join('&')}` : url
}

function encodeQueryValue(value: QueryValue): string | null {
  if (value === null || value === undefined || value === '') {
    return null
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return null
    }
    return value.map((part) => encodeURIComponent(String(part))).join(',')
  }
  return encodeURIComponent(String(value))
}

function buildInit(method: HttpMethod, options: RequestOptions): RequestInit {
  const init: RequestInit = { method, signal: options.signal ?? null }
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (options.body instanceof FormData) {
    init.body = options.body
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(options.body)
  }
  init.headers = headers
  return init
}

async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('Content-Type') ?? ''
  if (!contentType.includes('json')) {
    return undefined
  }
  try {
    return await response.json()
  } catch {
    return undefined
  }
}

function isApiError(value: unknown): value is ApiError {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.code === 'string' && typeof candidate.message === 'string'
  )
}

async function toError(response: Response): Promise<LibraryError> {
  const body = await readJson(response)
  if (isApiError(body)) {
    return new LibraryError(response.status, body)
  }
  return new LibraryError(response.status, {
    code: CLIENT_ERROR_CODES.invalidResponse,
    message: `The server responded with HTTP ${response.status}.`,
  })
}

function networkError(cause: unknown): LibraryError {
  const error = new LibraryError(0, {
    code: CLIENT_ERROR_CODES.network,
    message: 'Could not reach the server. Check your connection.',
  })
  error.cause = cause
  return error
}

/** Tells the connectivity store how a request went (null: it succeeded). */
function report(error: LibraryError | null, probe: boolean): void {
  if (error === null) {
    deps.connectivity.reportSuccess(probe)
    return
  }
  const kind = error.kind
  if (kind === 'connectivity' || kind === 'wp-auth') {
    deps.connectivity.reportFailure(error, probe)
  }
}

/**
 * Reports a probe whose outcome is in its body rather than its status:
 * `bootstrap` is always 200 and says in `wp.state` whether WordPress
 * answered. `null` means WordPress was reached.
 */
export function reportProbe(error: LibraryError | null): void {
  report(error, true)
}

/**
 * One library request. Waits while the session is lost, replays after a
 * re-login, and throws `LibraryError` for every failure except an abort
 * (which rethrows the AbortError, as TanStack Query expects).
 */
export async function request<T>(
  method: HttpMethod,
  path: string,
  options: RequestOptions = {},
): Promise<LibraryResponse<T>> {
  const url = libraryUrl(path, options.query)
  const probe = options.probe ?? method !== 'GET'

  for (let attempt = 0; ; attempt++) {
    await deps.gate.waitUntilRestored(options.signal)
    const epoch = deps.gate.epoch

    let response: Response
    try {
      response = await deps.fetch(url, buildInit(method, options))
    } catch (cause) {
      if (isAbortError(cause)) {
        throw cause
      }
      const error = networkError(cause)
      report(error, probe)
      throw error
    }

    if (response.status === 401) {
      // Sent before the session was replaced (a re-login or logout since):
      // the answer says nothing about the current session, so just retry.
      const stale = epoch !== deps.gate.epoch
      if (!stale) {
        deps.notifyUnauthorized()
      }
      if (attempt < MAX_SESSION_REPLAYS) {
        if (!stale) {
          // Hold this request (and every new one) until the user logs in.
          deps.gate.markLost()
        }
        continue
      }
    }

    if (!response.ok) {
      const error = await toError(response)
      report(error, probe)
      throw error
    }

    let data: unknown
    if (options.expect === 'none' || response.status === 204) {
      data = undefined
    } else {
      data = await readJson(response)
      if (data === undefined) {
        const error = new LibraryError(response.status, {
          code: CLIENT_ERROR_CODES.invalidResponse,
          message: 'The server sent an unreadable response.',
        })
        report(error, probe)
        throw error
      }
    }
    report(null, probe)
    return {
      data: data as T,
      status: response.status,
      rev: response.headers.get(LIBRARY_REV_HEADER),
      headers: response.headers,
    }
  }
}

export const http = {
  get<T>(path: string, options?: RequestOptions) {
    return request<T>('GET', path, options)
  },
  post<T>(path: string, options?: RequestOptions) {
    return request<T>('POST', path, options)
  },
  patch<T>(path: string, options?: RequestOptions) {
    return request<T>('PATCH', path, options)
  },
  delete<T>(path: string, options?: RequestOptions) {
    return request<T>('DELETE', path, options)
  },
}
