import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { env } from '../config/env.ts'
import { failures, MAX_FAILURES } from '../lib/loginLockout.ts'
import {
  createSessionToken,
  SESSION_COOKIE_NAME,
  verifySessionToken,
} from '../lib/session.ts'
import { errorHandler } from '../middleware/errorHandler.ts'
import { sameOriginOnly } from '../middleware/sameOriginOnly.ts'
import { RENEW_AFTER_MS, sessionRouter } from './session.ts'

// Trusts one proxy hop, so tests can pick req.ip via X-Forwarded-For and
// HTTPS via X-Forwarded-Proto, like a deployment behind a reverse proxy.
const app = express()
app.set('trust proxy', 1)
app.use(sameOriginOnly)
app.use(sessionRouter)
app.use(errorHandler)

const CORRECT = { username: env.authUsername, password: env.authPassword }
const WRONG = { username: env.authUsername, password: 'wrong' }

function login(ip: string, body: object | string = CORRECT) {
  return request(app)
    .post('/session')
    .set('X-Forwarded-For', ip)
    .set('Content-Type', 'application/json')
    .send(typeof body === 'string' ? body : JSON.stringify(body))
}

function sessionCookie(res: request.Response): string | undefined {
  const cookies = res.headers['set-cookie'] as unknown as string[] | undefined
  return cookies?.find((cookie) => cookie.startsWith(`${SESSION_COOKIE_NAME}=`))
}

function cookieValue(cookie: string): string {
  return cookie.split(';')[0]?.split('=')[1] ?? ''
}

describe('POST /session (log in)', () => {
  it('sets a session cookie on the right credentials', async () => {
    const res = await login('10.2.0.1').expect(200)

    expect(res.body).toEqual({ username: env.authUsername })
    const cookie = sessionCookie(res)
    expect(cookie).toBeDefined()
    expect(verifySessionToken(cookieValue(cookie as string))).not.toBeNull()
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).not.toMatch(/path=/i)
    expect(cookie).not.toContain('Secure')
  })

  it('marks the cookie Secure when the request came in over HTTPS', async () => {
    const res = await login('10.2.0.2')
      .set('X-Forwarded-Proto', 'https')
      .expect(200)

    expect(sessionCookie(res)).toContain('Secure')
  })

  it('rejects wrong credentials with a JSON 401 and no challenge', async () => {
    const res = await login('10.2.0.3', WRONG).expect(401)

    expect(res.body.code).toBe('invalid_credentials')
    expect(res.headers['www-authenticate']).toBeUndefined()
    expect(sessionCookie(res)).toBeUndefined()
    expect(failures.get('10.2.0.3')?.count).toBe(1)
  })

  it('locks the IP out after MAX_FAILURES wrong attempts, even for the right password', async () => {
    const ip = '10.2.0.4'
    for (let i = 0; i < MAX_FAILURES; i++) await login(ip, WRONG).expect(401)

    const res = await login(ip).expect(429)

    expect(res.body.code).toBe('too_many_attempts')
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0)
    expect(sessionCookie(res)).toBeUndefined()
    // Other IPs are unaffected.
    await login('10.2.0.5').expect(200)
  })

  it('clears earlier failures on a successful login', async () => {
    const ip = '10.2.0.6'
    await login(ip, WRONG).expect(401)
    await login(ip).expect(200)

    expect(failures.has(ip)).toBe(false)
  })

  it('replies 400 to a body without credentials, without counting it', async () => {
    const ip = '10.2.0.7'
    await login(ip, {}).expect(400)
    await login(ip, { username: 1, password: 2 }).expect(400)
    await request(app)
      .post('/session')
      .set('X-Forwarded-For', ip)
      .type('form')
      .send('username=a&password=b')
      .expect(400)
    await login(ip, '{not json').expect(400)

    expect(failures.has(ip)).toBe(false)
  })

  it('replies 413 to an oversized body, without counting it', async () => {
    const ip = '10.2.0.9'
    const res = await login(ip, {
      username: 'x'.repeat(20_000),
      password: 'y',
    }).expect(413)

    expect(res.body.code).toBe('invalid_request_body')
    expect(failures.has(ip)).toBe(false)
  })

  it('rejects a login posted from another site', async () => {
    await login('10.2.0.8').set('Sec-Fetch-Site', 'cross-site').expect(403)
  })
})

describe('GET /session', () => {
  it('replies 401 without a session, without counting it as a failure', async () => {
    const res = await request(app)
      .get('/session')
      .set('X-Forwarded-For', '10.2.1.1')
      .expect(401)

    expect(res.body.code).toBe('unauthorized')
    expect(res.headers['www-authenticate']).toBeUndefined()
    expect(failures.has('10.2.1.1')).toBe(false)
  })

  it('returns the user and leaves a fresh cookie alone', async () => {
    const res = await request(app)
      .get('/session')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${createSessionToken()}`)
      .expect(200)

    expect(res.body).toEqual({ username: env.authUsername })
    expect(sessionCookie(res)).toBeUndefined()
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it('renews a cookie older than a day', async () => {
    const issuedAt = Date.now() - RENEW_AFTER_MS - 1000
    const res = await request(app)
      .get('/session')
      .set(
        'Cookie',
        `${SESSION_COOKIE_NAME}=${createSessionToken({ now: issuedAt })}`,
      )
      .expect(200)

    const renewed = sessionCookie(res)
    expect(renewed).toBeDefined()
    expect(renewed).not.toMatch(/path=/i)
    expect(verifySessionToken(cookieValue(renewed as string))).toBeGreaterThan(
      issuedAt,
    )
  })

  it('rejects an expired cookie', async () => {
    const longAgo = Date.now() - (env.sessionMaxAgeDays + 1) * RENEW_AFTER_MS
    await request(app)
      .get('/session')
      .set(
        'Cookie',
        `${SESSION_COOKIE_NAME}=${createSessionToken({ now: longAgo })}`,
      )
      .expect(401)
  })
})

describe('DELETE /session (log out)', () => {
  it('clears the cookie', async () => {
    const res = await request(app)
      .delete('/session')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${createSessionToken()}`)
      .expect(204)

    expect(sessionCookie(res)).toBe(
      `${SESSION_COOKIE_NAME}=; Max-Age=0; HttpOnly; SameSite=Lax`,
    )
  })

  it('clears a Secure cookie with a Secure cookie over HTTPS', async () => {
    const res = await request(app)
      .delete('/session')
      .set('X-Forwarded-Proto', 'https')
      .expect(204)

    expect(sessionCookie(res)).toContain('Secure')
  })
})
