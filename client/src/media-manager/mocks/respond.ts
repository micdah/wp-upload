// How the mock answers: JSON validated against the contract's zod schemas
// (a mismatch is a bug in the mock, answered as 500 with the zod issues), the
// `ApiError` envelope, the caching headers of server-api.md §3.3, and request
// body validation that names the offending field like the server does.

import { HttpResponse } from 'msw'
import type { z } from 'zod'
import { LIBRARY_REV_HEADER } from '../../../../shared/library-api'
import { FakeError, fakeError, invalidRequest } from './fake/errors'
import { hashString } from './fake/random'

/** `no-store` routes, or `etag` routes (`private, no-cache` + weak ETag). */
export type CacheMode = 'no-store' | 'etag'

export interface JsonOptions {
  status?: number
  /** sends `X-Library-Rev` */
  rev?: string
  cache?: CacheMode
  /** needed for `etag`: the request's URL and If-None-Match */
  request?: Request
}

/** Called with every response that failed its schema (tests fail on it). */
let onSchemaViolation: (message: string) => void = (message) => {
  console.error(message)
}

export function setSchemaViolationHandler(
  handler: (message: string) => void,
): void {
  onSchemaViolation = handler
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ')
}

/** The weak ETag of server-api.md §3.3: rev plus a hash of the query. */
export function etagFor(rev: string, request: Request): string {
  const url = new URL(request.url)
  const params = [...url.searchParams.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )
  const key = `${url.pathname.replace(/^.*\/api\/library\//, '')}?${new URLSearchParams(params)}`
  return `W/"${rev}-${hashString(key).toString(16)}"`
}

export function apiError(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): Response {
  return HttpResponse.json(
    details === undefined ? { code, message } : { code, message, details },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )
}

export function fromFakeError(error: FakeError): Response {
  return HttpResponse.json(error.body, {
    status: error.status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

/** A JSON response whose body must satisfy `schema`. */
export function json<T>(
  schema: z.ZodType<T>,
  body: T,
  options: JsonOptions = {},
): Response {
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    const message = `Mock response violates the contract: ${formatIssues(parsed.error)}`
    onSchemaViolation(message)
    return apiError(500, 'internal_error', message)
  }
  const headers: Record<string, string> = {}
  if (options.rev !== undefined) {
    headers[LIBRARY_REV_HEADER] = options.rev
  }
  if (
    options.cache === 'etag' &&
    options.request &&
    options.rev !== undefined
  ) {
    const etag = etagFor(options.rev, options.request)
    headers['Cache-Control'] = 'private, no-cache'
    headers.ETag = etag
    if (options.request.headers.get('If-None-Match') === etag) {
      return new HttpResponse(null, { status: 304, headers })
    }
  } else {
    headers['Cache-Control'] = 'no-store'
  }
  return HttpResponse.json(body as never, {
    status: options.status ?? 200,
    headers,
  })
}

/** Parses and validates a JSON body: 400 `invalid_json` / `invalid_request`. */
export async function readBody<T>(
  request: Request,
  schema: z.ZodType<T>,
): Promise<T> {
  let body: unknown
  try {
    const text = await request.text()
    body = text === '' ? {} : JSON.parse(text)
  } catch {
    throw fakeError(400, 'invalid_json', 'The request body is not valid JSON.')
  }
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const param = issue && issue.path.length > 0 ? issue.path.join('.') : 'body'
    throw invalidRequest(param, issue?.message)
  }
  return parsed.data
}

/** A positive integer path segment, or 404 `not_found` (server-api.md §7.12). */
export function idParam(value: string | readonly string[] | undefined): number {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw !== 'string' || !/^[1-9][0-9]*$/.test(raw)) {
    throw fakeError(404, 'not_found', 'Not found.')
  }
  return Number(raw)
}

/** `ids=1,2,3`: 1..max distinct positive integers, order kept. */
export function idsParam(
  search: URLSearchParams,
  max: number,
  name = 'ids',
): number[] {
  const raw = search.get(name)
  if (raw === null || raw === '') {
    throw invalidRequest(name, `"${name}" is required.`)
  }
  const ids: number[] = []
  for (const part of raw.split(',')) {
    if (!/^[1-9][0-9]*$/.test(part)) {
      throw invalidRequest(name)
    }
    const id = Number(part)
    if (!ids.includes(id)) {
      ids.push(id)
    }
  }
  if (ids.length > max) {
    throw invalidRequest(name, `At most ${max} ids.`)
  }
  return ids
}

/** `ids=` of job ids (opaque strings). */
export function jobIdsParam(search: URLSearchParams, max: number): string[] {
  const raw = search.get('ids')
  if (raw === null || raw === '') {
    throw invalidRequest('ids', '"ids" is required.')
  }
  const ids = [...new Set(raw.split(',').filter((id) => id !== ''))]
  if (ids.length === 0 || ids.length > max) {
    throw invalidRequest('ids', `Between 1 and ${max} ids.`)
  }
  return ids
}

export { FakeError }
