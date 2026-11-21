import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { app, clientDist } from './app.ts'
import { env } from './config/env.ts'
import { failures } from './lib/loginLockout.ts'
import { SESSION_COOKIE_NAME } from './lib/session.ts'

vi.mock('./lib/wpUpload.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/wpUpload.ts')>()
  return { ...actual, uploadToWordPress: vi.fn() }
})

// Logs in through the real endpoint and returns the Cookie header to send.
async function sessionCookieHeader(): Promise<string> {
  const res = await request(app)
    .post('/session')
    .send({ username: env.authUsername, password: env.authPassword })
    .expect(200)
  const cookies = res.headers['set-cookie'] as unknown as string[]
  const cookie = cookies.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`))
  return (cookie as string).split(';')[0] as string
}

describe('app', () => {
  it('returns a JSON 404 for an unmatched /api route', async () => {
    const res = await request(app)
      .get('/api/does-not-exist')
      .set('Cookie', await sessionCookieHeader())
      .expect(404)

    expect(res.body).toEqual({
      code: 'not_found',
      message: 'The requested API endpoint does not exist.',
    })
  })

  it('serves existing client files without requiring a session', () => {
    const expectedFile = readFileSync(path.join(clientDist, 'favicon.png'))
    return request(app)
      .get('/favicon.png')
      .expect('Content-Type', 'image/png')
      .expect('Content-Length', expectedFile.length.toString())
      .expect(200)
  })

  it('serves index.html without requiring a session', () => {
    const expectedFile = readFileSync(path.join(clientDist, 'index.html'))
    return request(app)
      .get('/index.html')
      .expect('Content-Type', 'text/html; charset=UTF-8')
      .expect('Content-Length', expectedFile.length.toString())
      .expect(200)
  })

  it('serves the page and its bundled assets without requiring a session', async () => {
    const res = await request(app).get('/').expect(200)
    const assetUrls = [
      ...res.text.matchAll(/(?:src|href)="\.\/(assets\/[^"]+)"/g),
    ].map((match) => match[1])

    expect(assetUrls).not.toHaveLength(0)
    for (const assetUrl of assetUrls) {
      await request(app).get(`/${assetUrl}`).expect(200)
    }
  })

  it('serves the SPA fallback for nested paths without requiring a session', async () => {
    await request(app)
      .get('/some/nested/path')
      .expect('Content-Type', 'text/html; charset=UTF-8')
      .expect(200)
  })

  it('rejects API requests without a session with a JSON 401 and no challenge', async () => {
    const res = await request(app)
      .get('/api/status')
      .set('X-Forwarded-For', '10.3.0.1')
      .expect(401)

    expect(res.body).toEqual({
      code: 'unauthorized',
      message: 'Log in to continue.',
    })
    // A WWW-Authenticate challenge would make browsers show their own prompt.
    expect(res.headers['www-authenticate']).toBeUndefined()
    // ...and an anonymous request isn't a failed login.
    expect(failures.size).toBe(0)
  })

  it('serves the API to a client that logged in via /session', async () => {
    const res = await request(app)
      .get('/api/status')
      .set('Cookie', await sessionCookieHeader())
      .expect(200)

    expect(res.body).toHaveProperty('maxFileSizeMb')
  })

  it('no longer accepts HTTP Basic Auth', async () => {
    const basic = Buffer.from(
      `${env.authUsername}:${env.authPassword}`,
    ).toString('base64')
    await request(app)
      .get('/api/status')
      .set('Authorization', `Basic ${basic}`)
      .expect(401)
  })

  it('logs out via DELETE /session', async () => {
    const res = await request(app).delete('/session').expect(204)

    expect(res.headers['set-cookie']).toEqual([
      `${SESSION_COOKIE_NAME}=; Max-Age=0; HttpOnly; SameSite=Lax`,
    ])
  })

  // The app must work under any sub-path behind a prefix-stripping reverse
  // proxy, so the built page may only reference its assets relatively.
  it('builds index.html with relative asset URLs only', () => {
    const html = readFileSync(path.join(clientDist, 'index.html'), 'utf8')

    expect(html).toContain('./assets/')
    expect(html).not.toMatch(/(?:src|href)="\/(?!\/)/)
  })

  it('builds client scripts that call the API with relative URLs only', () => {
    const assetsDir = path.join(clientDist, 'assets')
    const scripts = readdirSync(assetsDir).filter((name) =>
      name.endsWith('.js'),
    )

    expect(scripts).not.toHaveLength(0)
    // Collect just the offending URLs: matching against the whole minified
    // bundle would make a failure print hundreds of KB of JavaScript.
    const rootRelativeApiUrls = scripts.flatMap((script) => {
      const source = readFileSync(path.join(assetsDir, script), 'utf8')
      return [...source.matchAll(/["'`](\/(?:api\/|session\b)[^"'`]*)/g)].map(
        (match) => `${script}: ${match[1]}`,
      )
    })
    expect(rootRelativeApiUrls).toEqual([])
  })

  it('serves /healthz without requiring authentication', async () => {
    const res = await request(app)
      .get('/healthz')
      .expect('Content-Type', 'text/html; charset=utf-8')
      .expect(200)

    expect(res.text).toBe('ok')
  })
})
