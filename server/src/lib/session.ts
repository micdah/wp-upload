import crypto from 'node:crypto'
import { env } from '../config/env.ts'

// Session cookies are stateless: the cookie holds the time it was issued plus
// an HMAC of it, so sessions survive restarts and the server keeps no store.
// Rotating the signing key (SESSION_SECRET, or the credentials it is derived
// from - see config/env.ts) invalidates every session at once.

// Distinctive, because other apps may share the host.
export const SESSION_COOKIE_NAME = 'wp_upload_session'

const TOKEN_VERSION = 'v1'
const DAY_MS = 24 * 60 * 60 * 1000
// Tolerates a token "issued" slightly in the future, e.g. after a small
// clock adjustment between issuing and checking it.
const MAX_CLOCK_SKEW_MS = 60 * 1000

export function sessionMaxAgeMs(): number {
  return env.sessionMaxAgeDays * DAY_MS
}

interface TokenOptions {
  now?: number
  secret?: Buffer
  maxAgeMs?: number
}

function sign(payload: string, secret: Buffer): Buffer {
  return crypto.createHmac('sha256', secret).update(payload).digest()
}

export function createSessionToken({
  now = Date.now(),
  secret = env.sessionSecret,
}: TokenOptions = {}): string {
  const payload = `${TOKEN_VERSION}.${Math.floor(now / 1000)}`
  return `${payload}.${sign(payload, secret).toString('base64url')}`
}

// Returns when the token was issued (ms since the epoch), or null if it is
// malformed, forged or expired.
export function verifySessionToken(
  token: string,
  {
    now = Date.now(),
    secret = env.sessionSecret,
    maxAgeMs = sessionMaxAgeMs(),
  }: TokenOptions = {},
): number | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null

  const [version, issuedAtText, signatureText] = parts as [
    string,
    string,
    string,
  ]
  if (version !== TOKEN_VERSION || !/^\d{1,12}$/.test(issuedAtText)) {
    return null
  }

  const expected = sign(`${version}.${issuedAtText}`, secret)
  const actual = Buffer.from(signatureText, 'base64url')
  if (
    actual.length !== expected.length ||
    !crypto.timingSafeEqual(actual, expected)
  ) {
    return null
  }

  const issuedAt = Number(issuedAtText) * 1000
  if (issuedAt > now + MAX_CLOCK_SKEW_MS) return null
  if (now - issuedAt >= maxAgeMs) return null
  return issuedAt
}

// Every value of our cookie in a Cookie header. A request can carry more
// than one - one per cookie path, e.g. from instances of this app mounted at
// both `/` and `/wp-upload/` on one host - so callers try them all.
export function sessionTokensFromCookieHeader(
  header: string | undefined,
): string[] {
  if (!header) return []
  return header.split(';').flatMap((pair) => {
    const separatorIndex = pair.indexOf('=')
    if (separatorIndex === -1) return []
    const name = pair.slice(0, separatorIndex).trim()
    const value = pair.slice(separatorIndex + 1).trim()
    return name === SESSION_COOKIE_NAME && value ? [value] : []
  })
}

// When the newest valid session in the Cookie header was issued, or null if
// the request carries no valid session.
export function sessionIssuedAt(
  cookieHeader: string | undefined,
): number | null {
  let newest: number | null = null
  for (const token of sessionTokensFromCookieHeader(cookieHeader)) {
    const issuedAt = verifySessionToken(token)
    if (issuedAt !== null && (newest === null || issuedAt > newest)) {
      newest = issuedAt
    }
  }
  return newest
}

interface CookieOptions {
  secure: boolean
}

// Deliberately no Path attribute (and so not Express's res.cookie(), which
// always adds Path=/): the browser then scopes the cookie to the directory of
// the URL that set it. The cookie is only ever set by `<mount>/session`, so
// that directory is the app's mount path - `/` at the root, `/wp-upload`
// behind a proxy that strips that prefix - even though the app never knows
// its external prefix. Setting it from a deeper URL such as `api/...` would
// scope it to `<mount>/api` instead, so don't.
function serializeCookie(
  value: string,
  maxAgeSeconds: number,
  { secure }: CookieOptions,
): string {
  const attributes = [
    `${SESSION_COOKIE_NAME}=${value}`,
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
    'SameSite=Lax',
  ]
  if (secure) attributes.push('Secure')
  return attributes.join('; ')
}

export function serializeSessionCookie(
  token: string,
  options: CookieOptions,
): string {
  return serializeCookie(token, Math.floor(sessionMaxAgeMs() / 1000), options)
}

export function serializeClearedSessionCookie(options: CookieOptions): string {
  return serializeCookie('', 0, options)
}

function hash(value: string): Buffer {
  return crypto.createHash('sha256').update(value).digest()
}

// Hashing both sides to a fixed length first lets us use timingSafeEqual
// (which throws on mismatched lengths) without leaking the real
// username/password length through an early length-check branch.
function safeEqual(a: string, b: string): boolean {
  return crypto.timingSafeEqual(hash(a), hash(b))
}

export function checkCredentials(username: string, password: string): boolean {
  // Both comparisons always run, so the timing doesn't reveal whether the
  // username alone was right.
  const usernameMatches = safeEqual(username, env.authUsername)
  const passwordMatches = safeEqual(password, env.authPassword)
  return usernameMatches && passwordMatches
}
