import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fullItems, tileItems } from '../../../../shared/fixtures/index.ts'
import { JobSchema } from '../../../../shared/library-api.schema.ts'
import {
  type ImageJobResult,
  LIMITS,
  type LibraryItemFull,
  type LibraryItemTile,
} from '../../../../shared/library-api.ts'
import { env } from '../../config/env.ts'
import {
  acquireSlot,
  getActiveUploadCount,
  releaseSlot,
} from '../uploadJobs.ts'
import { LibraryError } from './errors.ts'
import {
  cancelUploadJob,
  isoNow,
  jobsSettled,
  lookupJob,
  multipartFileBody,
  readBack,
  resetJobsForTests,
  startJob,
} from './jobs.ts'
import {
  fakeLibrary,
  libraryApp,
  resetLibrary,
  wpErrorResponse,
  wpMediaFor,
} from './specSupport.ts'

const originalConcurrency = env.uploadConcurrency

beforeEach(() => {
  fakeLibrary()
})

afterEach(async () => {
  await jobsSettled()
  resetJobsForTests()
  await resetLibrary()
  env.uploadConcurrency = originalConcurrency
  vi.useRealTimers()
})

const item = fullItems.find((entry) => entry.id === 1000) as LibraryItemFull

const tile = tileItems[0] as LibraryItemTile

function imageResult(): ImageJobResult {
  return { item, sizesRegenerated: 6, urlChanged: false }
}

/** A promise with its resolve function, to hold a job in `running`. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('the job registry', () => {
  it('runs a job to succeeded with its result', async () => {
    const id = startJob({
      kind: 'edit',
      itemId: 1000,
      run: async () => imageResult(),
    })
    await jobsSettled()
    const job = JobSchema.parse(lookupJob(id))
    expect(job).toMatchObject({
      id,
      kind: 'edit',
      itemId: 1000,
      state: 'succeeded',
      error: null,
      progress: null,
    })
    expect(job.result).toEqual(imageResult())
  })

  it('maps a failure with the server’s error mapping', async () => {
    const id = startJob({
      kind: 'edit',
      itemId: 1000,
      run: async () => {
        throw wpErrorResponse(409, 'wpu_stale', 'The image changed.', {
          modifiedAt: '2026-10-02T08:41:19Z',
        })
      },
    })
    await jobsSettled()
    const job = JobSchema.parse(lookupJob(id))
    expect(job.state).toBe('failed')
    expect(job.result).toBeNull()
    expect(job.error).toEqual({
      code: 'wpu_stale',
      message: 'The image changed.',
      details: { modifiedAt: '2026-10-02T08:41:19Z' },
    })
  })

  it('never lets a job answer 401: WordPress’s 401 is wp_auth_failed', async () => {
    const id = startJob({
      kind: 'restore',
      itemId: 1000,
      run: async () => {
        throw wpErrorResponse(401, 'incorrect_password')
      },
    })
    await jobsSettled()
    expect(lookupJob(id)).toMatchObject({
      state: 'failed',
      error: { code: 'wp_auth_failed' },
    })
  })

  it('waits in queued for a slot of the shared upload budget', async () => {
    env.uploadConcurrency = 1
    await acquireSlot() // e.g. a legacy upload holds the only slot
    const run = vi.fn(async () => imageResult())
    const id = startJob({ kind: 'edit', itemId: 1000, run })
    await new Promise((resolve) => setImmediate(resolve))
    expect(lookupJob(id)).toMatchObject({ state: 'queued' })
    expect(run).not.toHaveBeenCalled()

    releaseSlot()
    await jobsSettled()
    expect(lookupJob(id)).toMatchObject({ state: 'succeeded' })
  })

  it('reports running, progress and processing while it works', async () => {
    const sending = deferred<void>()
    const processing = deferred<void>()
    const id = startJob({
      kind: 'upload',
      filename: 'a.jpg',
      run: async (context) => {
        context.setProgress({ done: 5, total: 10, unit: 'bytes' })
        await sending.promise
        context.setProcessing()
        await processing.promise
        throw new LibraryError(504, 'wp_timeout', 'stop here')
      },
    })
    await vi.waitFor(() =>
      expect(lookupJob(id)).toMatchObject({
        state: 'running',
        progress: { done: 5, total: 10, unit: 'bytes' },
      }),
    )
    sending.resolve()
    await vi.waitFor(() =>
      expect(lookupJob(id)).toMatchObject({ state: 'processing' }),
    )
    processing.resolve()
    await jobsSettled()
    expect(lookupJob(id)).toMatchObject({
      state: 'failed',
      error: { code: 'wp_timeout' },
    })
  })

  it('runs cleanup once the job settles', async () => {
    const cleanup = vi.fn()
    startJob(
      { kind: 'edit', itemId: 1000, run: async () => imageResult() },
      cleanup,
    )
    await jobsSettled()
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('forgets finished jobs after LIMITS.finishedJobTtlMs', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    const id = startJob({
      kind: 'edit',
      itemId: 1000,
      run: async () => imageResult(),
    })
    await jobsSettled()
    vi.advanceTimersByTime(LIMITS.finishedJobTtlMs - 1)
    expect(lookupJob(id).state).toBe('succeeded')
    vi.advanceTimersByTime(1)
    expect(lookupJob(id)).toEqual({ id, state: 'not_found' })
  })

  it('finds only the kinds asked for', async () => {
    const id = startJob({
      kind: 'edit',
      itemId: 1000,
      run: async () => imageResult(),
    })
    await jobsSettled()
    expect(lookupJob(id, ['upload'])).toEqual({ id, state: 'not_found' })
    expect(lookupJob('nope')).toEqual({ id: 'nope', state: 'not_found' })
  })

  it('answers copies, so later changes don’t alter an earlier answer', async () => {
    const gate = deferred<void>()
    const id = startJob({
      kind: 'edit',
      itemId: 1000,
      run: async () => {
        await gate.promise
        return imageResult()
      },
    })
    await vi.waitFor(() => expect(lookupJob(id).state).toBe('running'))
    const before = lookupJob(id)
    gate.resolve()
    await jobsSettled()
    expect(before.state).toBe('running')
  })

  it('stamps times as ISO 8601 with whole seconds', () => {
    expect(isoNow()).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/)
  })
})

/** Lets every pending promise callback and I/O callback run. */
function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

describe('per-step jobs (slots: per-step)', () => {
  /**
   * A regenerate-like job of `count` steps, each held open until the test
   * resolves `steps[i]`. `log` records each step as it starts.
   */
  function steppedJob(count: number, log: string[]) {
    const steps = Array.from({ length: count }, () => deferred<void>())
    const id = startJob({
      kind: 'regenerate',
      itemIds: steps.map((_, index) => index + 1),
      slots: 'per-step',
      run: async (context) => {
        for (const [index, gate] of steps.entries()) {
          await context.step(async () => {
            log.push(`step ${index + 1}`)
            await gate.promise
          })
        }
        return { results: [] }
      },
    })
    return { id, steps }
  }

  it('is queued until its first step has a slot, then running throughout', async () => {
    env.uploadConcurrency = 1
    await acquireSlot() // e.g. a legacy upload holds the only slot
    const log: string[] = []
    const { id, steps } = steppedJob(2, log)
    await tick()
    expect(lookupJob(id).state).toBe('queued')
    expect(log).toEqual([])

    releaseSlot()
    await vi.waitFor(() => expect(log).toEqual(['step 1']))
    expect(lookupJob(id).state).toBe('running')

    // Someone else queues for the slot; step 1 finishing hands it over.
    let otherHasSlot = false
    const other = acquireSlot().then(() => {
      otherHasSlot = true
    })
    steps[0]?.resolve()
    await other
    expect(otherHasSlot).toBe(true)
    await tick()
    // Waiting for its next slot, the job stays running.
    expect(log).toEqual(['step 1'])
    expect(lookupJob(id).state).toBe('running')

    releaseSlot()
    await vi.waitFor(() => expect(log).toEqual(['step 1', 'step 2']))
    steps[1]?.resolve()
    await jobsSettled()
    expect(lookupJob(id).state).toBe('succeeded')
    expect(getActiveUploadCount()).toBe(0)
  })

  it('lets an upload queued meanwhile in before its next step', async () => {
    env.uploadConcurrency = 1
    const log: string[] = []
    const { steps } = steppedJob(3, log)
    await vi.waitFor(() => expect(log).toEqual(['step 1']))

    const upload = startJob({
      kind: 'upload',
      filename: 'a.jpg',
      run: async () => {
        log.push('upload')
        return { item: tile, folder: null }
      },
    })
    await tick()
    expect(lookupJob(upload).state).toBe('queued')

    for (const step of steps) step.resolve()
    await jobsSettled()
    expect(log).toEqual(['step 1', 'upload', 'step 2', 'step 3'])
    expect(getActiveUploadCount()).toBe(0)
  })

  it('releases the slot when a step throws, and when the job fails', async () => {
    env.uploadConcurrency = 1
    const caught: string[] = []
    const id = startJob({
      kind: 'regenerate',
      itemIds: [1, 2],
      slots: 'per-step',
      run: async (context) => {
        try {
          await context.step(async () => {
            throw new Error('one item failed')
          })
        } catch (err) {
          caught.push((err as Error).message)
        }
        // The slot came back: the next step gets it at once.
        expect(getActiveUploadCount()).toBe(0)
        await context.step(async () => {
          throw new LibraryError(502, 'wp_unreachable', 'gone')
        })
        return { results: [] }
      },
    })
    await jobsSettled()
    expect(caught).toEqual(['one item failed'])
    expect(lookupJob(id)).toMatchObject({
      state: 'failed',
      error: { code: 'wp_unreachable' },
    })
    expect(getActiveUploadCount()).toBe(0)
  })

  it('aborts a cancelled upload’s step and frees its slot', async () => {
    let signal: AbortSignal | undefined
    const id = startJob({
      kind: 'upload',
      filename: 'a.jpg',
      slots: 'per-step',
      run: (context) =>
        context.step(
          () =>
            new Promise((_resolve, reject) => {
              signal = context.signal
              context.signal.addEventListener('abort', () =>
                reject(new Error('aborted')),
              )
            }),
        ),
    })
    await vi.waitFor(() => expect(signal).toBeDefined())
    expect(getActiveUploadCount()).toBe(1)
    expect(cancelUploadJob(id)).toBe(true)
    await jobsSettled()
    expect(getActiveUploadCount()).toBe(0)
  })

  it('never starts a step cancelled while it waited for its slot', async () => {
    env.uploadConcurrency = 1
    await acquireSlot()
    const work = vi.fn(async () => {
      throw new Error('must not run')
    })
    const id = startJob({
      kind: 'upload',
      filename: 'a.jpg',
      slots: 'per-step',
      run: (context) => context.step(work),
    })
    await tick()
    expect(cancelUploadJob(id)).toBe(true)

    releaseSlot()
    await jobsSettled()
    expect(work).not.toHaveBeenCalled()
    expect(getActiveUploadCount()).toBe(0)
  })

  it('leaves other jobs on one slot for the whole run', async () => {
    env.uploadConcurrency = 1
    const log: string[] = []
    const gate = deferred<void>()
    startJob({
      kind: 'edit',
      itemId: 1000,
      run: async (context) => {
        await context.step(async () => {
          log.push('step 1')
          await gate.promise
        })
        await context.step(async () => {
          log.push('step 2')
        })
        return imageResult()
      },
    })
    await vi.waitFor(() => expect(log).toEqual(['step 1']))
    const other = acquireSlot().then(() => log.push('other'))
    gate.resolve()
    await other
    expect(log).toEqual(['step 1', 'step 2', 'other'])
    releaseSlot()
    await jobsSettled()
    expect(getActiveUploadCount()).toBe(0)
  })
})

describe('cancelUploadJob', () => {
  it('stops a queued upload before it starts and frees its file at once', async () => {
    env.uploadConcurrency = 1
    await acquireSlot()
    const run = vi.fn(async () => {
      throw new Error('must not run')
    })
    const cleanup = vi.fn()
    const id = startJob({ kind: 'upload', filename: 'a.jpg', run }, cleanup)

    expect(cancelUploadJob(id)).toBe(true)
    expect(cleanup).toHaveBeenCalledTimes(1)
    expect(lookupJob(id)).toEqual({ id, state: 'not_found' })

    releaseSlot()
    await jobsSettled()
    expect(run).not.toHaveBeenCalled()
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('aborts a running upload', async () => {
    let signal: AbortSignal | undefined
    const id = startJob({
      kind: 'upload',
      filename: 'a.jpg',
      run: (context) =>
        new Promise((_resolve, reject) => {
          signal = context.signal
          context.signal.addEventListener('abort', () =>
            reject(new Error('aborted')),
          )
        }),
    })
    await vi.waitFor(() => expect(signal).toBeDefined())
    expect(cancelUploadJob(id)).toBe(true)
    expect(signal?.aborted).toBe(true)
    await jobsSettled()
    expect(lookupJob(id).state).toBe('not_found')
  })

  it('refuses finished, unknown and non-upload jobs', async () => {
    const upload = startJob({
      kind: 'upload',
      filename: 'a.jpg',
      run: async () => {
        throw new Error('boom')
      },
    })
    const gate = deferred<void>()
    const edit = startJob({
      kind: 'edit',
      itemId: 1000,
      run: async () => {
        await gate.promise
        return imageResult()
      },
    })
    await vi.waitFor(() => expect(lookupJob(upload).state).toBe('failed'))
    expect(cancelUploadJob(upload)).toBe(false)
    expect(cancelUploadJob(edit)).toBe(false)
    expect(cancelUploadJob('unknown')).toBe(false)
    gate.resolve()
  })
})

describe('readBack', () => {
  it('hydrates the item in the view asked for', async () => {
    fakeLibrary({ 'GET /wp-json/wp/v2/media': () => [wpMediaFor(item)] })
    const tile = await readBack(1000, 'tile')
    expect(tile.view).toBe('tile')
    expect(tile.id).toBe(1000)
  })

  it('marks a failed read as applied, with the item id', async () => {
    fakeLibrary({ 'GET /wp-json/wp/v2/media': () => [] })
    await expect(readBack(1000, 'full')).rejects.toMatchObject({
      status: 404,
      code: 'not_found',
      details: { itemId: 1000, applied: true },
    })
  })

  it('keeps the mapped upstream error', async () => {
    fakeLibrary({
      'GET /wp-json/wp/v2/media': () => {
        throw wpErrorResponse(500, 'internal_server_error')
      },
    })
    await expect(readBack(1000, 'tile')).rejects.toMatchObject({
      status: 502,
      code: 'wp_error',
      details: { upstreamStatus: 500, itemId: 1000, applied: true },
    })
  })
})

describe('receiveFile', () => {
  it.each([
    ['a part header that never ends', '--xyz\r\nContent-Disposition: form-'],
    [
      'a form that ends early',
      '--xyz\r\nContent-Disposition: form-data; name="file"; filename="a.jpg"\r\n\r\nbytes',
    ],
  ])('answers 400 upload_error to %s, not 500', async (_name, body) => {
    const res = await request(libraryApp())
      .post('/upload')
      .set('Content-Type', 'multipart/form-data; boundary=xyz')
      .send(body)
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('upload_error')
  })
})

describe('multipartFileBody', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpu-jobs-spec-'))
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  async function collect(stream: NodeJS.ReadableStream): Promise<Buffer> {
    const chunks: Buffer[] = []
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer))
    return Buffer.concat(chunks)
  }

  it('streams fields, then the file, with an exact length and progress', async () => {
    const filePath = path.join(dir, 'upload')
    const content = Buffer.alloc(200_000, 7)
    fs.writeFileSync(filePath, content)
    const progress: number[] = []
    const sent = vi.fn()

    const body = multipartFileBody(
      {
        path: filePath,
        size: content.length,
        originalname: 'Strand ved Skagen.jpg',
        mimetype: 'image/jpeg',
      },
      { expectedModified: '2026-11-22T10:15:00Z' },
      { onProgress: (done) => progress.push(done), onSent: sent },
    )
    const bytes = await collect(body.body)
    expect(bytes.length).toBe(body.contentLength)

    const boundary = /boundary=(.+)$/.exec(body.contentType)?.[1]
    const text = bytes.toString('latin1')
    expect(
      text.startsWith(
        `--${boundary}\r\nContent-Disposition: form-data; name="expectedModified"\r\n\r\n2026-11-22T10:15:00Z\r\n`,
      ),
    ).toBe(true)
    expect(bytes.toString('utf8')).toContain(
      'Content-Disposition: form-data; name="file"; filename="Strand ved Skagen.jpg"\r\nContent-Type: image/jpeg\r\n\r\n',
    )
    expect(text.endsWith(`\r\n--${boundary}--\r\n`)).toBe(true)
    expect(progress[0]).toBe(0)
    expect(progress.at(-1)).toBe(content.length)
    await vi.waitFor(() => expect(sent).toHaveBeenCalledTimes(1))
  })
})
