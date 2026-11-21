// Shared plumbing for talking to the server: session (login) calls, and a
// fetch wrapper that reports a lost session so the app can show its login
// form. All URLs are relative, so the app works under any sub-path.

// The session endpoint sits at the app root - `session`, not `api/session` -
// because the server scopes the session cookie to the directory of this URL.
const SESSION_URL = 'session'

type UnauthorizedListener = () => void

let unauthorizedListener: UnauthorizedListener | null = null

export function setUnauthorizedListener(
  listener: UnauthorizedListener | null,
): void {
  unauthorizedListener = listener
}

// Called whenever the server answers 401, i.e. the session cookie is
// missing, expired or no longer valid.
export function notifyUnauthorized(): void {
  unauthorizedListener?.()
}

export async function apiFetch(
  input: string,
  init?: RequestInit,
): Promise<Response> {
  const res = await fetch(input, init)
  if (res.status === 401) notifyUnauthorized()
  return res
}

export interface Session {
  username: string
}

// The current session, or null if not logged in. Also renews an aging
// session cookie server-side. Throws on network or server errors.
export async function fetchSession(): Promise<Session | null> {
  const res = await fetch(SESSION_URL, { cache: 'no-store' })
  if (res.status === 401) return null
  if (!res.ok) throw new Error(`Server responded with HTTP ${res.status}.`)
  return (await res.json()) as Session
}

export type LoginResult =
  | { ok: true; session: Session }
  | { ok: false; reason: 'invalid_credentials' }
  | { ok: false; reason: 'too_many_attempts'; retryAfterSeconds: number | null }
  | { ok: false; reason: 'error'; message: string }

export async function login(
  username: string,
  password: string,
): Promise<LoginResult> {
  let res: Response
  try {
    res = await fetch(SESSION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })
  } catch {
    return {
      ok: false,
      reason: 'error',
      message: 'Could not reach the server. Check your connection.',
    }
  }

  if (res.ok) {
    try {
      return { ok: true, session: (await res.json()) as Session }
    } catch {
      // E.g. a proxy error page served with a 200.
      return {
        ok: false,
        reason: 'error',
        message: 'The server sent an unreadable response.',
      }
    }
  }
  if (res.status === 401) return { ok: false, reason: 'invalid_credentials' }
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('Retry-After'))
    return {
      ok: false,
      reason: 'too_many_attempts',
      retryAfterSeconds: retryAfter > 0 ? retryAfter : null,
    }
  }

  let message = `Server responded with HTTP ${res.status}.`
  try {
    const body = (await res.json()) as { message?: string }
    if (body.message) message = body.message
  } catch {
    // Keep the generic message.
  }
  return { ok: false, reason: 'error', message }
}

// Throws unless the server confirmed it cleared the session cookie -
// otherwise the cookie is still there and the next reload is logged in again.
export async function logout(): Promise<void> {
  const res = await fetch(SESSION_URL, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Server responded with HTTP ${res.status}.`)
}
