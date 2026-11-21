import express from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { errorHandler } from '../middleware/errorHandler.ts'

vi.mock('../lib/wpUpload.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/wpUpload.ts')>()
  return {
    ...actual,
    uploadToWordPress: vi.fn(),
    findExistingMediaBySlug: vi.fn(),
  }
})

vi.mock('../lib/filebird.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/filebird.ts')>()
  return { ...actual, assignToFolder: vi.fn() }
})

import { env } from '../config/env.ts'
import { assignToFolder } from '../lib/filebird.ts'
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

// Hangs until the job is cancelled, then rejects like an aborted request -
// so the job settles, frees its slot and removes its temp file.
function hangUntilAborted() {
  vi.mocked(uploadToWordPress).mockImplementation(
    (_file, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () =>
          reject({ status: 502, code: 'wp_unreachable', message: 'canceled' }),
        )
      }),
  )
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
      hangUntilAborted()
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
      hangUntilAborted()
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

  describe('FileBird folder assignment', () => {
    const originalKey = env.filebirdApiKey

    async function uploadAndSettle(folderId?: string) {
      const app = buildApp()
      const req = request(app).post('/media')
      if (folderId !== undefined) req.field('folderId', folderId)
      const res = await req.attach(
        'file',
        Buffer.from('fake-image-bytes'),
        'photo.png',
      )
      expect(res.status).toBe(202)
      const jobId: string = res.body.jobId

      let settled: { status: string } | undefined
      await vi.waitFor(async () => {
        ;[settled] = await fetchJobs(app, [jobId])
        expect(settled?.status).toMatch(/^(success|error)$/)
      })
      return settled
    }

    beforeEach(() => {
      env.filebirdApiKey = 'fb-key'
      vi.mocked(uploadToWordPress).mockResolvedValue(RESULT)
    })

    afterEach(() => {
      env.filebirdApiKey = originalKey
      vi.mocked(uploadToWordPress).mockReset()
      vi.mocked(assignToFolder).mockReset()
      vi.restoreAllMocks()
    })

    it('files the upload into the requested folder', async () => {
      vi.mocked(assignToFolder).mockResolvedValue()

      const job = await uploadAndSettle('40')

      expect(assignToFolder).toHaveBeenCalledWith(1, 40)
      expect(job).toMatchObject({
        status: 'success',
        result: { ...RESULT, folder: { id: 40, assigned: true } },
      })
    })

    it('still succeeds when filing fails, reporting why', async () => {
      vi.mocked(assignToFolder).mockRejectedValue({
        status: 502,
        code: 'filebird_error',
        message: 'Folder not found.',
      })
      vi.spyOn(console, 'error').mockImplementation(() => {})

      const job = await uploadAndSettle('40')

      expect(job).toMatchObject({
        status: 'success',
        result: {
          ...RESULT,
          folder: { id: 40, assigned: false, message: 'Folder not found.' },
        },
      })
    })

    it.each([[undefined], ['0'], ['-3'], ['abc']])(
      'does not file anything for folderId %j',
      async (folderId) => {
        const job = await uploadAndSettle(folderId)

        expect(job).toMatchObject({ status: 'success', result: RESULT })
        expect(job).not.toHaveProperty('result.folder')
        expect(assignToFolder).not.toHaveBeenCalled()
      },
    )

    it('ignores folderId when FileBird is disabled', async () => {
      env.filebirdApiKey = null

      const job = await uploadAndSettle('40')

      expect(job).toMatchObject({ status: 'success', result: RESULT })
      expect(job).not.toHaveProperty('result.folder')
      expect(assignToFolder).not.toHaveBeenCalled()
    })

    it('does not file anything when the upload itself fails', async () => {
      vi.mocked(uploadToWordPress).mockRejectedValue({
        status: 502,
        code: 'wp_unreachable',
        message: 'Could not reach WordPress.',
      })

      const job = await uploadAndSettle('40')

      expect(job).toMatchObject({ status: 'error' })
      expect(assignToFolder).not.toHaveBeenCalled()
    })
  })
})
