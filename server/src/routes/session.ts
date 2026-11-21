import express, { type Request, type Response, Router } from 'express'
import { env } from '../config/env.ts'
import {
  clearFailures,
  isLockedOut,
  recordFailure,
  retryAfterSeconds,
  sweepExpired,
} from '../lib/loginLockout.ts'
import {
  checkCredentials,
  createSessionToken,
  serializeClearedSessionCookie,
  serializeSessionCookie,
  sessionIssuedAt,
} from '../lib/session.ts'

// Re-issue the cookie at most once a day, so a device that keeps using the
// app stays logged in without a Set-Cookie on every request.
export const RENEW_AFTER_MS = 24 * 60 * 60 * 1000

// Mounted at the app root - `<mount>/session`, not `<mount>/api/session` -
// because the session cookie has no Path attribute and so is scoped to the
// directory of this URL, i.e. the app's mount path. See lib/session.ts.
export const sessionRouter = Router()

function setSessionCookie(req: Request, res: Response): void {
  // req.secure honours X-Forwarded-Proto when TRUST_PROXY trusts the proxy,
  // so the cookie is Secure behind an HTTPS proxy yet still works over plain
  // HTTP in local development.
  res.append(
    'Set-Cookie',
    serializeSessionCookie(createSessionToken(), { secure: req.secure }),
  )
}

function replyUnauthorized(res: Response): void {
  res.status(401).json({ code: 'unauthorized', message: 'Log in to continue.' })
}

// Who is logged in. The client calls this on every load, which is also when
// an aging cookie gets renewed.
sessionRouter.get('/session', (req, res) => {
  res.set('Cache-Control', 'no-store')

  const issuedAt = sessionIssuedAt(req.headers.cookie)
  if (issuedAt === null) {
    replyUnauthorized(res)
    return
  }

  if (Date.now() - issuedAt >= RENEW_AFTER_MS) setSessionCookie(req, res)
  res.json({ username: env.authUsername })
})

// Log in.
sessionRouter.post('/session', express.json({ limit: '10kb' }), (req, res) => {
  res.set('Cache-Control', 'no-store')
  sweepExpired()

  const ip = req.ip ?? 'unknown'

  // Deliberately checked before the credentials: a locked-out client must
  // not be able to keep guessing, and a correct guess must not slip
  // through (and reset its counter) while the lockout is in force.
  if (isLockedOut(ip)) {
    res.set('Retry-After', String(retryAfterSeconds(ip)))
    res.status(429).json({
      code: 'too_many_attempts',
      message: 'Too many failed login attempts. Try again later.',
    })
    return
  }

  const { username, password } = (req.body ?? {}) as Record<string, unknown>

  // A request that doesn't even carry credentials isn't a failed login,
  // so it doesn't count toward the lockout.
  if (typeof username !== 'string' || typeof password !== 'string') {
    res.status(400).json({
      code: 'invalid_request',
      message: 'Send a JSON body with "username" and "password".',
    })
    return
  }

  if (!checkCredentials(username, password)) {
    recordFailure(ip)
    res.status(401).json({
      code: 'invalid_credentials',
      message: 'Wrong username or password.',
    })
    return
  }

  clearFailures(ip)
  setSessionCookie(req, res)
  res.json({ username: env.authUsername })
})

// Log out. Sessions are stateless, so this only removes the cookie from this
// browser; rotate SESSION_SECRET to invalidate every session.
sessionRouter.delete('/session', (req, res) => {
  res.append(
    'Set-Cookie',
    serializeClearedSessionCookie({ secure: req.secure }),
  )
  res.status(204).end()
})
