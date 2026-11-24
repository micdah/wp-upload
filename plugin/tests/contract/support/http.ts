// A tiny HTTP client for the plugin's `wp-upload/v1` routes and core's
// `/wp/v2` routes, authenticated with an Application Password (as the server
// does), or anonymous.
import type { Credentials } from './env.ts'
import { env } from './env.ts'

export interface Reply<T = unknown> {
  status: number
  headers: Headers
  // biome-ignore lint/suspicious/noExplicitAny: tests inspect arbitrary JSON
  body: T & any
}

export interface Client {
  get(path: string, query?: Record<string, string | number>): Promise<Reply>
  post(
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<Reply>
  patch(path: string, body?: unknown): Promise<Reply>
  del(path: string): Promise<Reply>
  /** sends `raw` as the body as is (malformed JSON tests) */
  raw(method: string, path: string, raw: string): Promise<Reply>
}

export const PLUGIN = '/wp-upload/v1'

function url(path: string, query?: Record<string, string | number>): string {
  const target = new URL(`${env.wpUrl}/wp-json${path}`)
  for (const [key, value] of Object.entries(query ?? {})) {
    target.searchParams.set(key, String(value))
  }
  return target.toString()
}

/**
 * Apache closes idle keep-alive connections (e.g. while a test switches a
 * variant through Docker); a request written to such a socket fails before
 * the server reads it, so it is sent again once on a fresh connection.
 */
export async function fetchOnce(
  target: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetch(target, init)
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause
    if (cause?.code !== 'UND_ERR_SOCKET') {
      throw error
    }
    return fetch(target, init)
  }
}

async function send(
  credentials: Credentials | null,
  method: string,
  target: string,
  body: string | undefined,
  extraHeaders: Record<string, string> = {},
): Promise<Reply> {
  const headers: Record<string, string> = { ...extraHeaders }
  if (credentials) {
    headers.Authorization = `Basic ${Buffer.from(`${credentials.user}:${credentials.password}`).toString('base64')}`
  }
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  const response = await fetchOnce(target, { method, headers, body })
  const text = await response.text()
  let parsed: unknown = text
  try {
    parsed = text === '' ? null : JSON.parse(text)
  } catch {
    // keep the text: a non-JSON answer is itself a failure the test reports
  }
  return { status: response.status, headers: response.headers, body: parsed }
}

export function client(credentials: Credentials | null): Client {
  return {
    get: (path, query) => send(credentials, 'GET', url(path, query), undefined),
    post: (path, body, headers) =>
      send(
        credentials,
        'POST',
        url(path),
        body === undefined ? undefined : JSON.stringify(body),
        headers,
      ),
    patch: (path, body) =>
      send(credentials, 'PATCH', url(path), JSON.stringify(body ?? {})),
    del: (path) => send(credentials, 'DELETE', url(path), undefined),
    raw: (method, path, raw) => send(credentials, method, url(path), raw),
  }
}

export const editor = client(env.editor)
export const anonymous = client(null)
