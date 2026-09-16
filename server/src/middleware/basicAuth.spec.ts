import type { NextFunction, Request, Response } from 'express'
import { describe, expect, it, vi } from 'vitest'
import { basicAuth } from './basicAuth.ts'

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

  it('rejects a non-Basic scheme', () => {
    const { req, res, next } = createReqRes('10.0.0.2', 'Bearer abc')

    basicAuth(req, res, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
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
})
