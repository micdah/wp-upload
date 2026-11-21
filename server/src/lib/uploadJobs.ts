import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { env } from '../config/env.ts'
import { assignToFolder } from './filebird.ts'
import {
  isWpError,
  normaliseWpError,
  type UploadResult,
  uploadToWordPress,
  type WpError,
} from './wpUpload.ts'

// Caps how many uploads are proxying to WordPress at once, regardless of
// how many jobs the client(s) hand over - protects the WP site from a
// runaway client or multiple browser tabs each running their own limit.
let activeUploads = 0
const waiting: Array<() => void> = []

export function acquireSlot(): Promise<void> {
  if (activeUploads < env.uploadConcurrency) {
    activeUploads++
    return Promise.resolve()
  }
  return new Promise((resolve) => waiting.push(resolve))
}

export function releaseSlot(): void {
  const next = waiting.shift()
  if (next) next()
  else activeUploads--
}

// Read live (not cached) by /api/server-load, since it's cheap and more
// time-sensitive than the periodic OS-metric snapshot.
export function getActiveUploadCount(): number {
  return activeUploads
}

export type JobStatus = 'queued' | 'processing' | 'success' | 'error'

export type FolderAssignment =
  | { id: number; assigned: true }
  | { id: number; assigned: false; message: string }

// `folder` is only present when the upload asked to be filed into a
// FileBird folder (#38).
export interface JobResult extends UploadResult {
  folder?: FolderAssignment
}

export interface UploadJob {
  id: string
  status: JobStatus
  result: JobResult | null
  error: WpError | null
}

interface JobEntry extends UploadJob {
  controller: AbortController
  // Multer temp file; null once removed (see removeTempFile).
  tempFilePath: string | null
}

// How long a finished job's outcome stays readable. The client normally
// collects it within a poll interval or two; this just leaves room for a
// lost poll response (or a briefly offline client) before it's gone.
export const FINISHED_JOB_TTL_MS = 10 * 60_000

const jobs = new Map<string, JobEntry>()

// Hands a fully received temp file off to a background WordPress upload, so
// the browser connection that delivered it can be freed straight away. This
// is what lets more uploads process in WordPress at once than the browser's
// per-origin connection limit would otherwise allow (see #37). The job owns
// the temp file from here on and removes it once it settles. A non-null
// folderId files the new media item into that FileBird folder afterwards.
export function createJob(
  file: Express.Multer.File,
  folderId: number | null = null,
): string {
  const job: JobEntry = {
    id: randomUUID(),
    status: 'queued',
    result: null,
    error: null,
    controller: new AbortController(),
    tempFilePath: file.path,
  }
  jobs.set(job.id, job)
  void runJob(job, file, folderId)
  return job.id
}

async function runJob(
  job: JobEntry,
  file: Express.Multer.File,
  folderId: number | null,
): Promise<void> {
  await acquireSlot()
  try {
    // Cancelled while still waiting for a slot - never start the upload.
    if (job.controller.signal.aborted) return

    job.status = 'processing'
    const result = await uploadToWordPress(file, {
      signal: job.controller.signal,
    })
    // Filed before reporting success, so the client sees the folder outcome
    // together with the upload result rather than in a later poll.
    job.result =
      folderId === null ? result : await fileIntoFolder(result, folderId)
    job.status = 'success'
  } catch (err) {
    job.status = 'error'
    job.error = isWpError(err) ? err : normaliseWpError(err)
  } finally {
    releaseSlot()
    removeTempFile(job)
    setTimeout(() => {
      if (jobs.get(job.id) === job) jobs.delete(job.id)
    }, FINISHED_JOB_TTL_MS).unref()
  }
}

// Idempotent, so a job cancelled while queued can free its disk space right
// away and runJob's own cleanup later is a no-op.
function removeTempFile(job: JobEntry): void {
  const tempFilePath = job.tempFilePath
  if (tempFilePath === null) return
  job.tempFilePath = null
  fs.unlink(tempFilePath, (unlinkErr) => {
    if (unlinkErr)
      console.error(
        `Failed to remove temp upload file ${tempFilePath}:`,
        unlinkErr,
      )
  })
}

// The media item already exists at this point, so a filing failure must not
// turn into an upload error (retrying would just create a duplicate) - it's
// reported alongside the result instead.
async function fileIntoFolder(
  result: UploadResult,
  folderId: number,
): Promise<JobResult> {
  try {
    await assignToFolder(result.id, folderId)
    return { ...result, folder: { id: folderId, assigned: true } }
  } catch (folderError) {
    const message = isWpError(folderError)
      ? folderError.message
      : 'Could not file the upload into the FileBird folder.'
    console.error(
      `Uploaded media ${result.id} but could not file it into FileBird folder ${folderId}: ${message}`,
    )
    return { ...result, folder: { id: folderId, assigned: false, message } }
  }
}

export function getJob(id: string): UploadJob | undefined {
  const job = jobs.get(id)
  if (!job) return undefined
  const {
    controller: _controller,
    tempFilePath: _tempFilePath,
    ...publicJob
  } = job
  return publicJob
}

// Aborts the upstream WordPress request (or stops a still-queued job from
// ever starting) and forgets the job. Returns false if it's unknown, e.g.
// already purged after finishing. A cancel that lands while the item is
// being filed into a FileBird folder lets the filing finish: the media item
// already exists in WordPress by then.
export function cancelJob(id: string): boolean {
  const job = jobs.get(id)
  if (!job) return false
  jobs.delete(id)
  job.controller.abort()
  // A queued job may wait minutes for a slot - don't hold its file that long.
  if (job.status === 'queued') removeTempFile(job)
  return true
}
