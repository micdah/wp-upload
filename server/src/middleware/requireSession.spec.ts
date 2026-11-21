import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createSessionToken, SESSION_COOKIE_NAME } from '../lib/session.ts'
import { requireSession } from './requireSession.ts'

const app = express()
app.use(requireSession)
app.get('/protected', (_req, res) => {
  res.json({ issuedAt: res.locals.sessionIssuedAt })
})

describe('requireSession', () => {
  it('replies 401 JSON without a WWW-Authenticate challenge', async () => {
    const res = await request(app).get('/protected').expect(401)

    expect(res.body).toEqual({
      code: 'unauthorized',
      message: 'Log in to continue.',
    })
    // A challenge would make browsers show their native login prompt.
    expect(res.headers['www-authenticate']).toBeUndefined()
  })

  it('rejects an invalid session cookie', async () => {
    await request(app)
      .get('/protected')
      .set('Cookie', `${SESSION_COOKIE_NAME}=v1.123.forged`)
      .expect(401)
  })

  it('passes a request with a valid session cookie through', async () => {
    const now = Date.now()
    const res = await request(app)
      .get('/protected')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${createSessionToken({ now })}`)
      .expect(200)

    expect(res.body.issuedAt).toBe(Math.floor(now / 1000) * 1000)
  })

  it('never sets a cookie, not even for an old session', async () => {
    const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000
    const res = await request(app)
      .get('/protected')
      .set(
        'Cookie',
        `${SESSION_COOKIE_NAME}=${createSessionToken({ now: twoDaysAgo })}`,
      )
      .expect(200)

    expect(res.headers['set-cookie']).toBeUndefined()
  })
})
