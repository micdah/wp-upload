import fs from 'node:fs'
import express from 'express'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { errorHandler } from '../middleware/errorHandler.ts'

vi.mock('../lib/wpUpload.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/wpUpload.ts')>()
  return { ...actual, uploadToWordPress: vi.fn() }
})

import { uploadToWordPress } from '../lib/wpUpload.ts'
import { acquireSlot, mediaRouter, releaseSlot } from './media.ts'

// Plain describe: both sections below mutate the module-scoped
// activeUploads/waiting counters that back the real upload concurrency
// gate, so running them concurrently (with each other, or with themselves)
// would race on that shared state - the queuing test intentionally leaves
// several acquires in flight within a single test.
describe('media', () => {
  describe('acquireSlot / releaseSlot', () => {
    const CAP = 8 // env.uploadConcurrency default when UPLOAD_CONCURRENCY is unset

    it('grants slots immediately while under the concurrency cap', async () => {
      await Promise.all([acquireSlot(), acquireSlot(), acquireSlot()])
      releaseSlot()
      releaseSlot()
      releaseSlot()
    })

    it('queues an acquire once the cap is reached, and releases it on the next free slot', async () => {
      for (let i = 0; i < CAP; i++) await acquireSlot()

      let queuedResolved = false
      const queued = acquireSlot().then(() => {
        queuedResolved = true
      })

      await Promise.resolve()
      expect(queuedResolved).toBe(false)

      releaseSlot()
      await queued
      expect(queuedResolved).toBe(true)

      // The release above closed one of the original 8 acquisitions and
      // handed it straight to the queued one, so `CAP` outstanding slots
      // (not `CAP - 1`) still need releasing to return to baseline.
      for (let i = 0; i < CAP; i++) releaseSlot()
    })
  })

  describe('POST /media', () => {
    function buildApp() {
      const app = express()
      app.use(mediaRouter)
      app.use(errorHandler)
      return app
    }

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

    it('responds 201 with the mapped result on success', async () => {
      vi.mocked(uploadToWordPress).mockResolvedValue({
        id: 1,
        title: 'Photo',
        sourceUrl: 'https://example.invalid/photo.png',
        mimeType: 'image/png',
      })
      const app = buildApp()

      const res = await request(app)
        .post('/media')
        .attach('file', Buffer.from('fake-image-bytes'), 'photo.png')

      expect(res.status).toBe(201)
      expect(res.body).toEqual({
        id: 1,
        title: 'Photo',
        sourceUrl: 'https://example.invalid/photo.png',
        mimeType: 'image/png',
      })
    })

    it('maps a WpError from uploadToWordPress to the matching HTTP response', async () => {
      vi.mocked(uploadToWordPress).mockRejectedValue({
        status: 502,
        code: 'wp_unreachable',
        message: 'Could not reach WordPress.',
      })
      const app = buildApp()

      const res = await request(app)
        .post('/media')
        .attach('file', Buffer.from('fake-image-bytes'), 'photo.png')

      expect(res.status).toBe(502)
      expect(res.body).toEqual({
        code: 'wp_unreachable',
        message: 'Could not reach WordPress.',
      })
    })

    it('aborts the upstream request and releases the slot when the client disconnects mid-upload', async () => {
      const CAP = 8 // env.uploadConcurrency default when UPLOAD_CONCURRENCY is unset
      let capturedSignal: AbortSignal | undefined
      let invoked = false

      vi.mocked(uploadToWordPress).mockImplementation((_file, options) => {
        capturedSignal = options?.signal
        invoked = true
        // Simulates a WP call that hangs until the client goes away, matching
        // the real timing of the bug: abort happens while the upstream
        // request is still in flight, not before or after it.
        return new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => {
            reject({ status: 502, code: 'wp_unreachable', message: 'canceled' })
          })
        })
      })
      const unlinkSpy = vi.spyOn(fs, 'unlink')
      const app = buildApp()

      // Saturate all but one slot so this request's own acquire lands on the
      // last free one.
      for (let i = 0; i < CAP - 1; i++) await acquireSlot()

      const req = request(app)
        .post('/media')
        .attach('file', Buffer.from('fake-image-bytes'), 'photo.png')
      const settled = req.then(
        (res) => ({ res }),
        (err) => ({ err }),
      )

      await vi.waitFor(() => expect(invoked).toBe(true))

      // Only queue this once the request holds the last slot - if this ran
      // any earlier it would grab that slot itself, starving the request's
      // own acquireSlot() and deadlocking the test.
      let queuedResolved = false
      const queued = acquireSlot().then(() => {
        queuedResolved = true
      })

      req.abort()
      await settled

      // The server only learns of the disconnect once the socket teardown
      // propagates to it, which can land a tick or two after the client-side
      // abort has already settled - so poll rather than assert immediately.
      await vi.waitFor(() => expect(capturedSignal?.aborted).toBe(true))
      await vi.waitFor(() => expect(unlinkSpy).toHaveBeenCalled())

      await queued
      expect(queuedResolved).toBe(true)

      // The release above closed one of the original CAP - 1 acquisitions and
      // handed it straight to the queued one, so CAP outstanding slots (not
      // CAP - 1) still need releasing to return to baseline.
      for (let i = 0; i < CAP; i++) releaseSlot()
    })
  })
})
