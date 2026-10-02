import fs from 'node:fs'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from 'vitest'

vi.mock('./wpUpload.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./wpUpload.ts')>()
  return { ...actual, uploadToWordPress: vi.fn() }
})

import {
  acquireSlot,
  cancelJob,
  createJob,
  FINISHED_JOB_TTL_MS,
  getActiveUploadCount,
  getJob,
  releaseSlot,
} from './uploadJobs.ts'
import { uploadToWordPress } from './wpUpload.ts'

const CAP = 8 // env.uploadConcurrency default when UPLOAD_CONCURRENCY is unset

const RESULT = {
  id: 1,
  title: 'Photo',
  sourceUrl: 'https://example.invalid/photo.png',
  mimeType: 'image/png',
}

function fakeFile(path = '/tmp/fake-upload'): Express.Multer.File {
  return {
    path,
    originalname: 'photo.png',
    mimetype: 'image/png',
    size: 16,
  } as Express.Multer.File
}

// Resolves once uploadToWordPress has been called for the next job, handing
// back its abort signal; the upload itself hangs until that signal fires.
function hangUntilAborted(): Promise<AbortSignal | undefined> {
  return new Promise((resolveSignal) => {
    vi.mocked(uploadToWordPress).mockImplementationOnce((_file, options) => {
      resolveSignal(options?.signal)
      return new Promise((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () =>
          reject({ status: 502, code: 'wp_unreachable', message: 'canceled' }),
        )
      })
    })
  })
}

// Plain describe: every test here shares the module-scoped concurrency gate,
// so running them concurrently would race on its counters.
describe('uploadJobs', () => {
  let unlinkSpy: MockInstance<typeof fs.unlink>

  beforeEach(() => {
    unlinkSpy = vi
      .spyOn(fs, 'unlink')
      .mockImplementation((_path, callback) => callback(null))
  })

  afterEach(() => {
    vi.mocked(uploadToWordPress).mockReset()
    vi.useRealTimers()
  })

  describe('acquireSlot / releaseSlot', () => {
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

  describe('jobs', () => {
    it('reports processing while the upload is in flight, then success with the result', async () => {
      let finish: (result: typeof RESULT) => void = () => {}
      vi.mocked(uploadToWordPress).mockImplementationOnce(
        () => new Promise((resolve) => (finish = resolve)),
      )

      const id = createJob(fakeFile('/tmp/success-upload'))

      await vi.waitFor(() => expect(getJob(id)?.status).toBe('processing'))
      expect(getActiveUploadCount()).toBe(1)

      finish(RESULT)

      await vi.waitFor(() =>
        expect(getJob(id)).toEqual({
          id,
          status: 'success',
          result: RESULT,
          error: null,
        }),
      )
      expect(getActiveUploadCount()).toBe(0)
      expect(unlinkSpy).toHaveBeenCalledWith(
        '/tmp/success-upload',
        expect.any(Function),
      )
    })

    it('records a WpError from uploadToWordPress as the job error', async () => {
      const wpError = {
        status: 413,
        code: 'rest_upload_file_too_big',
        message: 'Too big.',
      }
      vi.mocked(uploadToWordPress).mockRejectedValueOnce(wpError)

      const id = createJob(fakeFile('/tmp/failed-upload'))

      await vi.waitFor(() => expect(getJob(id)?.status).toBe('error'))
      expect(getJob(id)?.error).toEqual(wpError)
      expect(getActiveUploadCount()).toBe(0)
      expect(unlinkSpy).toHaveBeenCalledWith(
        '/tmp/failed-upload',
        expect.any(Function),
      )
    })

    it('normalises an unexpected error rather than leaving the job stuck', async () => {
      vi.mocked(uploadToWordPress).mockRejectedValueOnce(new Error('boom'))

      const id = createJob(fakeFile())

      await vi.waitFor(() => expect(getJob(id)?.status).toBe('error'))
      expect(getJob(id)?.error).toMatchObject({ code: 'wp_unreachable' })
    })

    it('logs but does not fail the job when removing the temp file errors', async () => {
      vi.mocked(uploadToWordPress).mockResolvedValueOnce(RESULT)
      const unlinkError = new Error('EACCES: permission denied')
      unlinkSpy.mockImplementation((_path, callback) => callback(unlinkError))
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {})

      const id = createJob(fakeFile())

      await vi.waitFor(() => expect(getJob(id)?.status).toBe('success'))
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining('Failed to remove temp upload file'),
        unlinkError,
      )
    })

    it('aborts the upstream request, frees the slot and forgets the job when cancelled', async () => {
      const signalPromise = hangUntilAborted()

      const id = createJob(fakeFile('/tmp/cancelled-upload'))
      const signal = await signalPromise

      expect(cancelJob(id)).toBe(true)
      expect(signal?.aborted).toBe(true)
      expect(getJob(id)).toBeUndefined()

      await vi.waitFor(() =>
        expect(unlinkSpy).toHaveBeenCalledWith(
          '/tmp/cancelled-upload',
          expect.any(Function),
        ),
      )
      expect(getActiveUploadCount()).toBe(0)
    })

    it('never starts the upload for a job cancelled while waiting for a slot', async () => {
      for (let i = 0; i < CAP; i++) await acquireSlot()

      const id = createJob(fakeFile('/tmp/queued-upload'))
      expect(getJob(id)?.status).toBe('queued')
      expect(cancelJob(id)).toBe(true)

      // Hands the freed slot to the cancelled job, which should give it
      // straight back without uploading.
      releaseSlot()

      await vi.waitFor(() =>
        expect(unlinkSpy).toHaveBeenCalledWith(
          '/tmp/queued-upload',
          expect.any(Function),
        ),
      )
      expect(uploadToWordPress).not.toHaveBeenCalled()
      expect(getActiveUploadCount()).toBe(CAP - 1)

      for (let i = 0; i < CAP - 1; i++) releaseSlot()
    })

    it('returns false when cancelling an unknown job', () => {
      expect(cancelJob('no-such-job')).toBe(false)
    })

    it('purges a finished job once its TTL has passed', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      vi.mocked(uploadToWordPress).mockResolvedValueOnce(RESULT)

      const id = createJob(fakeFile())
      await vi.waitFor(() => expect(getJob(id)?.status).toBe('success'))

      vi.advanceTimersByTime(FINISHED_JOB_TTL_MS - 1_000)
      expect(getJob(id)).toBeDefined()

      vi.advanceTimersByTime(1_000)
      expect(getJob(id)).toBeUndefined()
    })
  })
})
