import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { env } from '../config/env.ts'
import {
  checkCredentials,
  createSessionToken,
  SESSION_COOKIE_NAME,
  serializeClearedSessionCookie,
  serializeSessionCookie,
  sessionIssuedAt,
  sessionMaxAgeMs,
  sessionTokensFromCookieHeader,
  verifySessionToken,
} from './session.ts'

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0)

function cookieAttributes(cookie: string): string[] {
  return cookie.split('; ').slice(1)
}

describe('session tokens', () => {
  it('verifies a freshly created token and returns its issue time', () => {
    const token = createSessionToken({ now: NOW })

    expect(verifySessionToken(token, { now: NOW })).toBe(NOW)
  })

  it('accepts a token until the max age has passed', () => {
    const token = createSessionToken({ now: NOW })
    const maxAgeMs = sessionMaxAgeMs()

    expect(verifySessionToken(token, { now: NOW + maxAgeMs - 1000 })).toBe(NOW)
    expect(verifySessionToken(token, { now: NOW + maxAgeMs })).toBeNull()
  })

  it('applies the max age to the issue time, not to a stored expiry', () => {
    const token = createSessionToken({ now: NOW })
    const oneDay = 24 * 60 * 60 * 1000

    expect(
      verifySessionToken(token, { now: NOW + 2 * oneDay, maxAgeMs: oneDay }),
    ).toBeNull()
  })

  it('rejects a token issued too far in the future', () => {
    const token = createSessionToken({ now: NOW + 5 * 60 * 1000 })

    expect(verifySessionToken(token, { now: NOW })).toBeNull()
  })

  it('rejects a token signed with another key', () => {
    const token = createSessionToken({
      now: NOW,
      secret: crypto.randomBytes(32),
    })

    expect(verifySessionToken(token, { now: NOW })).toBeNull()
  })

  it('rejects a token whose issue time was tampered with', () => {
    const [version, issuedAt, signature] = createSessionToken({
      now: NOW,
    }).split('.')
    const tampered = `${version}.${Number(issuedAt) + 3600}.${signature}`

    expect(verifySessionToken(tampered, { now: NOW + 7200_000 })).toBeNull()
  })

  it('rejects malformed tokens', () => {
    const valid = createSessionToken({ now: NOW })
    const [, issuedAt, signature] = valid.split('.')

    for (const token of [
      '',
      'garbage',
      `${valid}.extra`,
      `v2.${issuedAt}.${signature}`,
      `v1.-1.${signature}`,
      `v1.1e9.${signature}`,
      `v1.${issuedAt}.`,
      `v1.${issuedAt}.${signature?.slice(0, -2)}`,
    ]) {
      expect(verifySessionToken(token, { now: NOW }), token).toBeNull()
    }
  })
})

describe('session cookies', () => {
  it('finds every value of the session cookie in a Cookie header', () => {
    const header = `other=1; ${SESSION_COOKIE_NAME}=a; x=${SESSION_COOKIE_NAME}; ${SESSION_COOKIE_NAME}=b;${SESSION_COOKIE_NAME}=`

    expect(sessionTokensFromCookieHeader(header)).toEqual(['a', 'b'])
    expect(sessionTokensFromCookieHeader(undefined)).toEqual([])
  })

  it('accepts a request if any of its session cookies is valid', () => {
    const valid = createSessionToken()
    const header = `${SESSION_COOKIE_NAME}=forged; ${SESSION_COOKIE_NAME}=${valid}`

    expect(sessionIssuedAt(header)).not.toBeNull()
    expect(sessionIssuedAt(`${SESSION_COOKIE_NAME}=forged`)).toBeNull()
    expect(sessionIssuedAt(undefined)).toBeNull()
  })

  it('serializes a long-lived HttpOnly, SameSite=Lax cookie without a Path', () => {
    const cookie = serializeSessionCookie('token', { secure: false })

    expect(cookie.startsWith(`${SESSION_COOKIE_NAME}=token; `)).toBe(true)
    expect(cookieAttributes(cookie)).toEqual([
      `Max-Age=${env.sessionMaxAgeDays * 24 * 60 * 60}`,
      'HttpOnly',
      'SameSite=Lax',
    ])
    // The browser must derive the path from the URL that set the cookie, so
    // it ends up scoped to the app's (unknown) mount path.
    expect(cookie).not.toMatch(/path=/i)
  })

  it('adds Secure only when asked to', () => {
    expect(
      cookieAttributes(serializeSessionCookie('token', { secure: true })),
    ).toContain('Secure')
    expect(
      cookieAttributes(serializeClearedSessionCookie({ secure: true })),
    ).toContain('Secure')
  })

  it('clears the cookie with an empty value, Max-Age=0 and no Path', () => {
    const cookie = serializeClearedSessionCookie({ secure: false })

    expect(cookie).toBe(
      `${SESSION_COOKIE_NAME}=; Max-Age=0; HttpOnly; SameSite=Lax`,
    )
  })
})

describe('checkCredentials', () => {
  it('accepts only the configured username and password together', () => {
    expect(checkCredentials(env.authUsername, env.authPassword)).toBe(true)
    expect(checkCredentials('wrong', env.authPassword)).toBe(false)
    expect(checkCredentials(env.authUsername, 'wrong')).toBe(false)
    expect(checkCredentials('', '')).toBe(false)
  })
})
