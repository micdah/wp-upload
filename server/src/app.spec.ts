import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'

vi.mock('./lib/wpUpload.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/wpUpload.ts')>()
  return { ...actual, uploadToWordPress: vi.fn() }
})

import { app } from './app.ts'

function authHeader(): string {
  return `Basic ${Buffer.from('test-auth-user:test-auth-password').toString('base64')}`
}

describe('app', () => {
  it('returns a JSON 404 for an unmatched /api route', async () => {
    const res = await request(app)
      .get('/api/does-not-exist')
      .set('Authorization', authHeader())

    expect(res.status).toBe(404)
    expect(res.body).toEqual({
      code: 'not_found',
      message: 'The requested API endpoint does not exist.',
    })
  })

  // client/dist isn't built in this environment, so the SPA/static block in
  // app.ts never registers - this asserts the /api 404 handler stays scoped
  // to /api and doesn't shadow non-API paths (Express's own default 404
  // applies here instead of our { code: 'not_found', ... } JSON body).
  it('does not shadow unmatched non-API routes with the /api 404 handler', async () => {
    const res = await request(app)
      .get('/some-other-page')
      .set('Authorization', authHeader())

    expect(res.status).toBe(404)
    expect(res.body).not.toEqual({
      code: 'not_found',
      message: 'The requested API endpoint does not exist.',
    })
  })

  it('serves /healthz without requiring authentication', async () => {
    const res = await request(app).get('/healthz')

    expect(res.status).toBe(200)
    expect(res.text).toBe('ok')
  })
})
