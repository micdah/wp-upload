import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { env } from '../config/env.ts'
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

export interface UploadJob {
  id: string
  status: JobStatus
  result: UploadResult | null
  error: WpError | null
}

interface JobEntry extends UploadJob {
  controller: AbortController
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
// the temp file from here on and removes it once it settles.
export function createJob(file: Express.Multer.File): string {
  const job: JobEntry = {
    id: randomUUID(),
    status: 'queued',
    result: null,
    error: null,
    controller: new AbortController(),
  }
  jobs.set(job.id, job)
  void runJob(job, file)
  return job.id
}

async function runJob(job: JobEntry, file: Express.Multer.File): Promise<void> {
  await acquireSlot()
  try {
    // Cancelled while still waiting for a slot - never start the upload.
    if (job.controller.signal.aborted) return

    job.status = 'processing'
    job.result = await uploadToWordPress(file, {
      signal: job.controller.signal,
    })
    job.status = 'success'
  } catch (err) {
    job.status = 'error'
    job.error = isWpError(err) ? err : normaliseWpError(err)
  } finally {
    releaseSlot()
    fs.unlink(file.path, (unlinkErr) => {
      if (unlinkErr)
        console.error(
          `Failed to remove temp upload file ${file.path}:`,
          unlinkErr,
        )
    })
    setTimeout(() => {
      if (jobs.get(job.id) === job) jobs.delete(job.id)
    }, FINISHED_JOB_TTL_MS).unref()
  }
}

export function getJob(id: string): UploadJob | undefined {
  const job = jobs.get(id)
  if (!job) return undefined
  const { controller: _controller, ...publicJob } = job
  return publicJob
}

// Aborts the upstream WordPress request (or stops a still-queued job from
// ever starting) and forgets the job. Returns false if it's unknown, e.g.
// already purged after finishing.
export function cancelJob(id: string): boolean {
  const job = jobs.get(id)
  if (!job) return false
  jobs.delete(id)
  job.controller.abort()
  return true
}
