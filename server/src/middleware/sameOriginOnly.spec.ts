import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { sameOriginOnly } from './sameOriginOnly.ts'

const app = express()
app.use(sameOriginOnly)
app.all('/thing', (_req, res) => {
  res.status(200).json({ ok: true })
})

describe('sameOriginOnly', () => {
  it.each(['cross-site', 'same-site', 'Cross-Site'])(
    'rejects a POST with Sec-Fetch-Site: %s',
    async (fetchSite) => {
      const res = await request(app)
        .post('/thing')
        .set('Sec-Fetch-Site', fetchSite)
        .expect(403)

      expect(res.body.code).toBe('cross_site_request')
    },
  )

  it('rejects other state-changing methods from another site', async () => {
    await request(app)
      .delete('/thing')
      .set('Sec-Fetch-Site', 'cross-site')
      .expect(403)
    await request(app)
      .put('/thing')
      .set('Sec-Fetch-Site', 'same-site')
      .expect(403)
  })

  it.each(['same-origin', 'none'])(
    'allows a POST with Sec-Fetch-Site: %s',
    async (fetchSite) => {
      await request(app)
        .post('/thing')
        .set('Sec-Fetch-Site', fetchSite)
        .expect(200)
    },
  )

  it('allows a POST without Sec-Fetch-Site, as sent by scripts', async () => {
    await request(app).post('/thing').expect(200)
  })

  it('allows cross-site GETs, which must not change state', async () => {
    await request(app)
      .get('/thing')
      .set('Sec-Fetch-Site', 'cross-site')
      .expect(200)
  })
})
