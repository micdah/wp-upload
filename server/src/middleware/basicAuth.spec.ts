import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { basicAuth, failures } from './basicAuth.ts'

function basicAuthHeader(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`
}

function createReqRes(ip: string, header?: string) {
  const req = { ip, headers: { authorization: header } } as unknown as Request
  const res = {
    set: vi.fn(),
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  } as unknown as Response
  const next: NextFunction = vi.fn()
  return { req, res, next }
}

// These tests are synchronous end-to-end (basicAuth never awaits), and each
// one uses its own IP so no two tests ever share a `failures` map entry -
// safe to run concurrently.
describe.concurrent('basicAuth', () => {
  it('rejects a request with no Authorization header', () => {
    const { req, res, next } = createReqRes('10.0.0.1')

    basicAuth(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.set).toHaveBeenCalledWith(
      'WWW-Authenticate',
      expect.stringContaining('Basic'),
    )
    expect(next).not.toHaveBeenCalled()
  })

  it('rejects a non-Basic scheme and counts it as a failed attempt', () => {
    const { req, res, next } = createReqRes('10.0.0.2', 'Bearer abc')

    basicAuth(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
    expect(failures.get('10.0.0.2')?.count).toBe(1)
  })

  it('does not count requests without credentials toward the lockout', () => {
    const ip = '10.0.0.11'
    for (const header of [undefined, '', '   ']) {
      for (let i = 0; i < 10; i++) {
        const attempt = createReqRes(ip, header)
        basicAuth(attempt.req, attempt.res, attempt.next)

        expect(attempt.res.status).toHaveBeenCalledWith(401)
        expect(attempt.res.set).toHaveBeenCalledWith(
          'WWW-Authenticate',
          expect.stringContaining('Basic'),
        )
      }
    }
    expect(failures.has(ip)).toBe(false)

    const { req, res, next } = createReqRes(
      ip,
      basicAuthHeader('test-auth-user', 'test-auth-password'),
    )
    basicAuth(req, res, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(res.status).not.toHaveBeenCalled()
  })

  it('rejects malformed credentials with no ":" separator', () => {
    const { req, res, next } = createReqRes(
      '10.0.0.3',
      `Basic ${Buffer.from('no-colon-here').toString('base64')}`,
    )

    basicAuth(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('rejects a wrong username or password', () => {
    const { req, res, next } = createReqRes(
      '10.0.0.4',
      basicAuthHeader('wrong', 'test-auth-password'),
    )

    basicAuth(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('calls next() and clears prior failures on correct credentials', () => {
    const ip = '10.0.0.5'
    const wrong = createReqRes(ip, basicAuthHeader('wrong', 'wrong'))
    basicAuth(wrong.req, wrong.res, wrong.next)

    const { req, res, next } = createReqRes(
      ip,
      basicAuthHeader('test-auth-user', 'test-auth-password'),
    )
    basicAuth(req, res, next)

    expect(next).toHaveBeenCalledTimes(1)
    expect(res.status).not.toHaveBeenCalled()
  })

  it('locks out an IP after MAX_FAILURES wrong attempts within the window', () => {
    const ip = '10.0.0.6'
    for (let i = 0; i < 10; i++) {
      const attempt = createReqRes(ip, basicAuthHeader('wrong', 'wrong'))
      basicAuth(attempt.req, attempt.res, attempt.next)
    }

    const { req, res, next } = createReqRes(
      ip,
      basicAuthHeader('test-auth-user', 'test-auth-password'),
    )
    basicAuth(req, res, next)

    expect(res.status).toHaveBeenCalledWith(429)
    expect(res.set).toHaveBeenCalledWith('Retry-After', expect.any(String))
    expect(next).not.toHaveBeenCalled()
  })

  it('unlocks the IP again once the lockout window has passed', () => {
    const ip = '10.0.0.7'
    vi.useFakeTimers()
    try {
      for (let i = 0; i < 10; i++) {
        const attempt = createReqRes(ip, basicAuthHeader('wrong', 'wrong'))
        basicAuth(attempt.req, attempt.res, attempt.next)
      }

      vi.advanceTimersByTime(5 * 60 * 1000 + 1)

      const { req, res, next } = createReqRes(
        ip,
        basicAuthHeader('test-auth-user', 'test-auth-password'),
      )
      basicAuth(req, res, next)

      expect(next).toHaveBeenCalledTimes(1)
      expect(res.status).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it("opportunistically sweeps other IPs' stale entries on every request", () => {
    const ipA = '10.0.0.8'
    const ipB = '10.0.0.9'
    const ipC = '10.0.0.10'
    vi.useFakeTimers()
    try {
      const failA = createReqRes(ipA, basicAuthHeader('wrong', 'wrong'))
      basicAuth(failA.req, failA.res, failA.next)
      const failB = createReqRes(ipB, basicAuthHeader('wrong', 'wrong'))
      basicAuth(failB.req, failB.res, failB.next)

      expect(failures.has(ipA)).toBe(true)
      expect(failures.has(ipB)).toBe(true)

      vi.advanceTimersByTime(5 * 60 * 1000 + 1)

      // A request from an unrelated IP should sweep A and B's now-expired
      // entries too, not just its own - an IP that never comes back must
      // not linger in the map forever (issue #3).
      const { req, res, next } = createReqRes(
        ipC,
        basicAuthHeader('test-auth-user', 'test-auth-password'),
      )
      basicAuth(req, res, next)

      expect(failures.has(ipA)).toBe(false)
      expect(failures.has(ipB)).toBe(false)
      expect(next).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

// Kept out of the concurrent block above: this test is async, and the
// fake-timer tests there advance Date.now() past the lockout window, which
// would let their sweepExpired() wipe this test's real-time entries between
// requests.
describe('basicAuth behind a reverse proxy', () => {
  it('keys the lockout on the proxy-appended address with a trust proxy hop count', async () => {
    // Mirrors a reverse proxy that appends the real client address to
    // whatever X-Forwarded-For the client sent: only the rightmost entry is
    // trustworthy, so spoofing the leftmost must not dodge the lockout.
    const app = express()
      .set('trust proxy', 1)
      .use(basicAuth)
      .get('/', (_req, res) => {
        res.send('ok')
      })
    const attacker = '203.0.113.5'
    const otherClient = '198.51.100.7'

    for (let i = 0; i < 10; i++) {
      await request(app)
        .get('/')
        .set('X-Forwarded-For', `192.0.2.${i}, ${attacker}`)
        .set('Authorization', basicAuthHeader('wrong', 'wrong'))
        .expect(401)
    }

    await request(app)
      .get('/')
      .set('X-Forwarded-For', `192.0.2.99, ${attacker}`)
      .set(
        'Authorization',
        basicAuthHeader('test-auth-user', 'test-auth-password'),
      )
      .expect(429)
    expect(failures.has('192.0.2.0')).toBe(false)

    await request(app)
      .get('/')
      .set('X-Forwarded-For', `192.0.2.1, ${otherClient}`)
      .set(
        'Authorization',
        basicAuthHeader('test-auth-user', 'test-auth-password'),
      )
      .expect(200)
  })
})
