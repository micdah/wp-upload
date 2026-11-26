import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import { Readable } from 'node:stream'
import type { RequestHandler } from 'express'
import multer from 'multer'
import {
  type ApiError,
  type ImageJob,
  type ImageJobResult,
  type ItemView,
  type Job,
  type JobKind,
  type JobLookup,
  type JobProgress,
  LIMITS,
  type LibraryItemFull,
  type LibraryItemTile,
  type RegenerateJobResult,
  type UploadJobResult,
} from '../../../../shared/library-api.ts'
import { env } from '../../config/env.ts'
import { acquireSlot, releaseSlot } from '../uploadJobs.ts'
import { multipartFilename } from '../wpUpload.ts'
import { LibraryError, toLibraryError } from './errors.ts'
import { hydrateItems } from './normalise/items.ts'
import type { MultipartBody } from './pluginClient.ts'

// The job registry of /api/library/* (server-api.md §7.13): uploads and the
// long image operations run as in-memory background jobs that the client
// polls with `jobs` and `upload/jobs`. A job waits in `queued` for a slot of
// the server's WordPress concurrency budget, which it shares with the legacy
// upload page (acquireSlot/releaseSlot in uploadJobs.ts). Most jobs hold that
// slot until they finish; a long job of many small steps (regenerate) takes it
// per step instead, so uploads interleave (D48). Finished jobs stay readable
// for LIMITS.finishedJobTtlMs; a restart forgets every job.
//
// Also here: the streamed multipart bodies the upload and replace jobs send.

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

/** What a running job may do while it talks to WordPress. */
export interface JobContext {
  /** aborted when an upload job is cancelled */
  signal: AbortSignal
  /** reports progress (bytes for uploads, items for regenerate) */
  setProgress(progress: JobProgress): void
  /** an upload has sent every byte and WordPress is making sub-sizes */
  setProcessing(): void
  /**
   * Runs one unit of work (one WordPress call) while holding a slot of the
   * concurrency budget. In a `slots: 'per-step'` job, each step waits for a
   * slot and releases it when done, also when it throws, so whatever queued
   * for a slot meanwhile (acquireSlot is first come, first served) runs
   * before the job's next step. In any other job it just runs `work`: the job
   * already holds its slot.
   */
  step<T>(work: () => Promise<T>): Promise<T>
}

type ImageKind = ImageJob['kind']

/**
 * How a job uses the concurrency budget: one slot from start to finish
 * (`per-job`, the default), or one slot per `context.step` and none in
 * between (`per-step`). A `per-step` job is `queued` until its first step
 * gets a slot, then `running` until it finishes, also while it waits for the
 * next step's slot.
 */
export type SlotUse = 'per-job' | 'per-step'

/** What to run, by job kind. `run` resolves with the job's `result`. */
export type JobSpec = { slots?: SlotUse } & (
  | {
      kind: 'upload'
      filename: string
      run: (context: JobContext) => Promise<UploadJobResult>
    }
  | {
      kind: ImageKind
      itemId: number
      run: (context: JobContext) => Promise<ImageJobResult>
    }
  | {
      kind: 'regenerate'
      itemIds: number[]
      run: (context: JobContext) => Promise<RegenerateJobResult>
    }
)

interface JobRecord {
  /** the public view, updated in place */
  job: Job
  controller: AbortController
  /** releases what the job holds (a temp file); idempotent, may be null */
  cleanup: (() => void) | null
}

const jobs = new Map<string, JobRecord>()
const running = new Set<Promise<void>>()

/** ISO 8601 UTC with whole seconds (server-api.md §1). */
export function isoNow(): string {
  return `${new Date().toISOString().slice(0, 19)}Z`
}

function newJob(spec: JobSpec, id: string): Job {
  const now = isoNow()
  const base = {
    id,
    state: 'queued' as const,
    createdAt: now,
    updatedAt: now,
    progress: null,
    error: null,
    result: null,
  }
  switch (spec.kind) {
    case 'upload':
      return { ...base, kind: 'upload', filename: spec.filename }
    case 'regenerate':
      return { ...base, kind: 'regenerate', itemIds: spec.itemIds }
    default:
      return { ...base, kind: spec.kind, itemId: spec.itemId }
  }
}

/**
 * Registers a job and starts it in the background. Returns its id at once;
 * the job waits for a concurrency slot, then runs `spec.run` (a `per-step`
 * job calls `spec.run` at once and waits for a slot in each step). `cleanup`
 * runs once the job settles (or is cancelled while queued).
 */
export function startJob(
  spec: JobSpec,
  cleanup: (() => void) | null = null,
): string {
  const id = randomUUID()
  const record: JobRecord = {
    job: newJob(spec, id),
    controller: new AbortController(),
    cleanup,
  }
  jobs.set(id, record)
  const run = runJob(
    record,
    spec.run as (c: JobContext) => Promise<unknown>,
    spec.slots ?? 'per-job',
  )
  running.add(run)
  void run.finally(() => running.delete(run))
  return id
}

function touch(record: JobRecord): void {
  record.job.updatedAt = isoNow()
}

function markRunning(record: JobRecord): void {
  record.job.state = 'running'
  touch(record)
}

async function runJob(
  record: JobRecord,
  run: (context: JobContext) => Promise<unknown>,
  slots: SlotUse,
): Promise<void> {
  const { signal } = record.controller
  const holdsSlot = slots === 'per-job'
  if (holdsSlot) await acquireSlot()
  try {
    if (holdsSlot) {
      // Cancelled while it waited for a slot: never start.
      if (signal.aborted) return
      markRunning(record)
    }
    const result = await run({
      signal,
      setProgress(progress) {
        record.job.progress = progress
        touch(record)
      },
      setProcessing() {
        record.job.state = 'processing'
        touch(record)
      },
      step: holdsSlot ? (work) => work() : (work) => runStep(record, work),
    })
    ;(record.job as { result: unknown }).result = result
    record.job.state = 'succeeded'
  } catch (err) {
    record.job.state = 'failed'
    // A cancelled upload is already forgotten: nothing to report or log.
    record.job.error = signal.aborted ? toLibraryError(err).body : jobError(err)
  } finally {
    touch(record)
    if (holdsSlot) releaseSlot()
    runCleanup(record)
    forgetLater(record)
  }
}

/**
 * One step of a `per-step` job: waits for a slot (behind everything already
 * waiting), runs `work` and releases the slot again, whatever happens. The
 * first step moves the job from `queued` to `running`, where it stays.
 */
async function runStep<T>(
  record: JobRecord,
  work: () => Promise<T>,
): Promise<T> {
  await acquireSlot()
  try {
    // Cancelled while it waited for this slot: don't start the step.
    record.controller.signal.throwIfAborted()
    if (record.job.state === 'queued') markRunning(record)
    return await work()
  } finally {
    releaseSlot()
  }
}

/** A failed job's `error`: the request error the browser would have got. */
function jobError(err: unknown): ApiError {
  const mapped = toLibraryError(err)
  if (mapped.body.code === 'internal_error') console.error(err)
  return mapped.body
}

function runCleanup(record: JobRecord): void {
  const cleanup = record.cleanup
  record.cleanup = null
  cleanup?.()
}

function forgetLater(record: JobRecord): void {
  setTimeout(() => {
    if (jobs.get(record.job.id) === record) jobs.delete(record.job.id)
  }, LIMITS.finishedJobTtlMs).unref()
}

/**
 * A job by id as `jobs` and `upload/jobs` return it: `not_found` for an
 * unknown or expired id, or a job whose kind isn't in `kinds`.
 */
export function lookupJob(id: string, kinds?: readonly JobKind[]): JobLookup {
  const record = jobs.get(id)
  if (!record || (kinds && !kinds.includes(record.job.kind))) {
    return { id, state: 'not_found' }
  }
  // A copy, so later updates never change an answer being serialised.
  return structuredClone(record.job)
}

/**
 * Cancels an upload job that hasn't finished: a queued one never starts, a
 * running one is aborted (WordPress may already have created the item). The
 * job is forgotten at once. False for an unknown, finished or non-upload job.
 */
export function cancelUploadJob(id: string): boolean {
  const record = jobs.get(id)
  if (record?.job.kind !== 'upload') return false
  if (record.job.state === 'succeeded' || record.job.state === 'failed') {
    return false
  }
  jobs.delete(id)
  const wasQueued = record.job.state === 'queued'
  record.controller.abort()
  // A queued job may wait minutes for a slot: free its temp file now.
  if (wasQueued) runCleanup(record)
  return true
}

/** Resolves once every job started so far has settled (tests). */
export async function jobsSettled(): Promise<void> {
  while (running.size > 0) await Promise.allSettled([...running])
}

/** Forgets every job (tests). */
export function resetJobsForTests(): void {
  jobs.clear()
}

// ---------------------------------------------------------------------------
// Reading the item back
// ---------------------------------------------------------------------------

/**
 * Hydrates an item a job has just changed (or created), bypassing the
 * cache. When that read fails, WordPress has nevertheless done the work, so
 * the error says so with `details.applied: true` and `details.itemId`: the
 * client then refetches the item instead of retrying the operation (which,
 * for an upload, would create a duplicate).
 */
export async function readBack(
  id: number,
  view: 'tile',
): Promise<LibraryItemTile>
export async function readBack(
  id: number,
  view: 'full',
): Promise<LibraryItemFull>
export async function readBack(
  id: number,
  view: ItemView,
): Promise<LibraryItemTile | LibraryItemFull> {
  try {
    const { items } = await hydrateItems([id], view)
    const item = items[0]
    if (!item) {
      throw new LibraryError(
        404,
        'not_found',
        `Media item ${id} could not be read back from WordPress.`,
      )
    }
    return item
  } catch (err) {
    const { status, body } = toLibraryError(err)
    throw new LibraryError(status, body.code, body.message, {
      ...body.details,
      itemId: id,
      applied: true,
    })
  }
}

// ---------------------------------------------------------------------------
// Temp files
// ---------------------------------------------------------------------------

/**
 * Receives one multipart `file` part into a temp file (the upload and
 * replace routes), as the legacy upload does: UTF-8 file names kept, at
 * most MAX_FILE_SIZE_MB (413 `file_too_large` from the app's error
 * handler). Built per request, so the limit is read when it applies.
 *
 * A body the multipart parser can't read (busboy's "Malformed part header",
 * "Unexpected end of form", …) is the client's fault: 400 `upload_error`,
 * not a 500.
 */
export const receiveFile: RequestHandler = (req, res, next) => {
  // multer 2 supports defParamCharset; @types/multer doesn't declare it yet.
  const options: multer.Options & { defParamCharset: string } = {
    dest: os.tmpdir(),
    limits: { fileSize: env.maxFileSizeMb * 1024 * 1024, fields: 10 },
    // Browsers send file names as raw UTF-8; multer would decode them as
    // latin1 by default, mangling any non-ASCII name.
    defParamCharset: 'utf8',
  }
  multer(options).single('file')(req, res, (err?: unknown) => {
    if (!err || err instanceof multer.MulterError) {
      next(err)
      return
    }
    const reason = err instanceof Error ? err.message : String(err)
    next(
      new LibraryError(
        400,
        'upload_error',
        `The upload could not be read (${reason}).`,
      ),
    )
  })
}

/** Removes a multer temp file, logging (never throwing) on failure. */
export function removeTempFile(filePath: string): void {
  fs.unlink(filePath, (err) => {
    if (err && err.code !== 'ENOENT') {
      console.error(`Failed to remove temp upload file ${filePath}:`, err)
    }
  })
}

// ---------------------------------------------------------------------------
// Streamed multipart bodies
// ---------------------------------------------------------------------------

/** A file received by multer, as the multipart builder needs it. */
export interface TempFile {
  path: string
  size: number
  originalname: string
  mimetype: string
}

/**
 * A `multipart/form-data` body with some text fields and one file part
 * named `file`, streamed from the temp file (never buffered whole), with an
 * exact Content-Length (chunked bodies don't work on every PHP host).
 *
 * `onProgress` gets the file bytes read so far; `onSent` fires once the
 * whole body has been handed to the connection.
 *
 * The file name is quoted the way the legacy upload does it
 * (multipartFilename in wpUpload.ts), so UTF-8 names reach WordPress
 * intact. Field names and values must not contain CR, LF or `"`: callers
 * pass only validated values.
 */
export function multipartFileBody(
  file: TempFile,
  fields: Record<string, string> = {},
  hooks: {
    onProgress?: (sent: number, total: number) => void
    onSent?: () => void
  } = {},
): MultipartBody & { body: Readable } {
  const boundary = `----wp-upload-${randomUUID().replaceAll('-', '')}`
  const fieldParts = Object.entries(fields)
    .map(
      ([name, value]) =>
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${name}"\r\n` +
        '\r\n' +
        `${value}\r\n`,
    )
    .join('')
  const partType = (file.mimetype || 'application/octet-stream').replace(
    /[\r\n]/g,
    '',
  )
  const head = Buffer.from(
    fieldParts +
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${multipartFilename(file.originalname)}"\r\n` +
      `Content-Type: ${partType}\r\n` +
      '\r\n',
    'utf8',
  )
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8')

  async function* parts(): AsyncGenerator<Buffer> {
    yield head
    let sent = 0
    hooks.onProgress?.(0, file.size)
    for await (const chunk of fs.createReadStream(file.path)) {
      sent += (chunk as Buffer).length
      hooks.onProgress?.(sent, file.size)
      yield chunk as Buffer
    }
    yield tail
  }

  const body = Readable.from(parts())
  if (hooks.onSent) body.once('end', hooks.onSent)
  return {
    body,
    contentType: `multipart/form-data; boundary=${boundary}`,
    contentLength: head.length + file.size + tail.length,
  }
}
