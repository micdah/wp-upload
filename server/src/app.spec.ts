import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { app, clientDist } from './app.ts'

vi.mock('./lib/wpUpload.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/wpUpload.ts')>()
  return { ...actual, uploadToWordPress: vi.fn() }
})

function authHeader(): string {
  return `Basic ${Buffer.from('test-auth-user:test-auth-password').toString('base64')}`
}

describe('app', () => {
  it('returns a JSON 404 for an unmatched /api route', async () => {
    const res = await request(app)
      .get('/api/does-not-exist')
      .set('Authorization', authHeader())
      .expect(404)

    expect(res.body).toEqual({
      code: 'not_found',
      message: 'The requested API endpoint does not exist.',
    })
  })

  it('serves existing client file', () => {
    const expectedFile = readFileSync(path.join(clientDist, 'favicon.png'))
    return request(app)
      .get('/favicon.png')
      .set('Authorization', authHeader())
      .expect('Content-Type', 'image/png')
      .expect('Content-Length', expectedFile.length.toString())
      .expect(200)
  })

  it('serves index.html on unmatched client file', () => {
    const expectedFile = readFileSync(path.join(clientDist, 'index.html'))
    return request(app)
      .get('/index.html')
      .set('Authorization', authHeader())
      .expect('Content-Type', 'text/html; charset=UTF-8')
      .expect('Content-Length', expectedFile.length.toString())
      .expect(200)
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
      return [...source.matchAll(/["'`](\/api\/[^"'`]*)/g)].map(
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
