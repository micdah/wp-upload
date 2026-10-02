import express from 'express'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { errorHandler } from '../middleware/errorHandler.ts'

vi.mock('../lib/wpUpload.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/wpUpload.ts')>()
  return {
    ...actual,
    uploadToWordPress: vi.fn(),
    findExistingMediaBySlug: vi.fn(),
  }
})

import { findExistingMediaBySlug, uploadToWordPress } from '../lib/wpUpload.ts'
import { mediaRouter } from './media.ts'

function buildApp() {
  const app = express()
  app.use(mediaRouter)
  app.use(errorHandler)
  return app
}

const RESULT = {
  id: 1,
  title: 'Photo',
  sourceUrl: 'https://example.invalid/photo.png',
  mimeType: 'image/png',
}

async function startUpload(app: express.Express): Promise<string> {
  const res = await request(app)
    .post('/media')
    .attach('file', Buffer.from('fake-image-bytes'), 'photo.png')
  expect(res.status).toBe(202)
  return res.body.jobId
}

async function fetchJobs(app: express.Express, ids: string[]) {
  const res = await request(app)
    .get('/media/jobs')
    .query({ ids: ids.join(',') })
  expect(res.status).toBe(200)
  return res.body.jobs
}

// Plain describe: the upload sections below start real background jobs that
// share the module-scoped upload concurrency gate, so running them
// concurrently would race on that shared state.
describe('media', () => {
  describe('GET /media/check', () => {
    afterEach(() => {
      vi.mocked(findExistingMediaBySlug).mockReset()
    })

    it('responds 400 when no filename is provided', async () => {
      const app = buildApp()

      const res = await request(app).get('/media/check')

      expect(res.status).toBe(400)
      expect(res.body).toEqual({
        code: 'no_filename',
        message: 'No filename was provided.',
      })
    })

    it('responds with duplicate: false when no matches are found', async () => {
      vi.mocked(findExistingMediaBySlug).mockResolvedValue([])
      const app = buildApp()

      const res = await request(app)
        .get('/media/check')
        .query({ filename: 'photo.png' })

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ duplicate: false, matches: [] })
      expect(findExistingMediaBySlug).toHaveBeenCalledWith('photo.png')
    })

    it('responds with duplicate: true and the matches when found', async () => {
      vi.mocked(findExistingMediaBySlug).mockResolvedValue([
        {
          id: 7,
          title: 'Photo',
          sourceUrl: 'https://example.invalid/photo.png',
        },
      ])
      const app = buildApp()

      const res = await request(app)
        .get('/media/check')
        .query({ filename: 'photo.png' })

      expect(res.status).toBe(200)
      expect(res.body).toEqual({
        duplicate: true,
        matches: [
          {
            id: 7,
            title: 'Photo',
            sourceUrl: 'https://example.invalid/photo.png',
          },
        ],
      })
    })

    it('maps a WpError from findExistingMediaBySlug to the matching HTTP response', async () => {
      vi.mocked(findExistingMediaBySlug).mockRejectedValue({
        status: 502,
        code: 'wp_unreachable',
        message: 'Could not reach WordPress.',
      })
      const app = buildApp()

      const res = await request(app)
        .get('/media/check')
        .query({ filename: 'photo.png' })

      expect(res.status).toBe(502)
      expect(res.body).toEqual({
        code: 'wp_unreachable',
        message: 'Could not reach WordPress.',
      })
    })
  })

  describe('POST /media', () => {
    afterEach(() => {
      vi.mocked(uploadToWordPress).mockReset()
    })

    it('responds 400 when no file is attached', async () => {
      const app = buildApp()

      const res = await request(app).post('/media')

      expect(res.status).toBe(400)
      expect(res.body).toEqual({
        code: 'no_file',
        message: 'No file was provided.',
      })
    })

    it('responds 202 with a job id without waiting for WordPress', async () => {
      // Never settles - the response must not depend on WordPress at all.
      vi.mocked(uploadToWordPress).mockReturnValue(new Promise(() => {}))
      const app = buildApp()

      const res = await request(app)
        .post('/media')
        .attach('file', Buffer.from('fake-image-bytes'), 'photo.png')

      expect(res.status).toBe(202)
      expect(res.body).toEqual({ jobId: expect.any(String) })

      await request(app).delete(`/media/jobs/${res.body.jobId}`)
    })
  })

  describe('GET /media/jobs', () => {
    afterEach(() => {
      vi.mocked(uploadToWordPress).mockReset()
    })

    it('responds 400 when no ids are provided', async () => {
      const app = buildApp()

      const res = await request(app).get('/media/jobs')

      expect(res.status).toBe(400)
      expect(res.body).toEqual({
        code: 'no_ids',
        message: 'No job ids were provided.',
      })
    })

    it('reports the mapped result once the upload succeeds', async () => {
      vi.mocked(uploadToWordPress).mockResolvedValue(RESULT)
      const app = buildApp()

      const jobId = await startUpload(app)

      await vi.waitFor(async () =>
        expect(await fetchJobs(app, [jobId])).toEqual([
          { id: jobId, status: 'success', result: RESULT },
        ]),
      )
    })

    it('reports the code and message of a WpError from uploadToWordPress', async () => {
      vi.mocked(uploadToWordPress).mockRejectedValue({
        status: 502,
        code: 'wp_unreachable',
        message: 'Could not reach WordPress.',
      })
      const app = buildApp()

      const jobId = await startUpload(app)

      await vi.waitFor(async () =>
        expect(await fetchJobs(app, [jobId])).toEqual([
          {
            id: jobId,
            status: 'error',
            error: {
              code: 'wp_unreachable',
              message: 'Could not reach WordPress.',
            },
          },
        ]),
      )
    })

    it('answers for every requested id, marking unknown ones not_found', async () => {
      vi.mocked(uploadToWordPress).mockReturnValue(new Promise(() => {}))
      const app = buildApp()

      const jobId = await startUpload(app)

      expect(await fetchJobs(app, [jobId, 'no-such-job'])).toEqual([
        { id: jobId, status: 'processing' },
        { id: 'no-such-job', status: 'not_found' },
      ])

      await request(app).delete(`/media/jobs/${jobId}`)
    })
  })

  describe('DELETE /media/jobs/:id', () => {
    afterEach(() => {
      vi.mocked(uploadToWordPress).mockReset()
    })

    it('aborts the upstream request and forgets the job', async () => {
      let capturedSignal: AbortSignal | undefined
      vi.mocked(uploadToWordPress).mockImplementation((_file, options) => {
        capturedSignal = options?.signal
        return new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => {
            reject({ status: 502, code: 'wp_unreachable', message: 'canceled' })
          })
        })
      })
      const app = buildApp()

      const jobId = await startUpload(app)
      await vi.waitFor(() => expect(capturedSignal).toBeDefined())

      const res = await request(app).delete(`/media/jobs/${jobId}`)

      expect(res.status).toBe(204)
      expect(capturedSignal?.aborted).toBe(true)
      expect(await fetchJobs(app, [jobId])).toEqual([
        { id: jobId, status: 'not_found' },
      ])
    })

    it('responds 404 for an unknown job', async () => {
      const app = buildApp()

      const res = await request(app).delete('/media/jobs/no-such-job')

      expect(res.status).toBe(404)
      expect(res.body).toEqual({
        code: 'job_not_found',
        message: 'No such upload job.',
      })
    })
  })
})
