// The fake job registry (server-api.md §7.13). A job's state is a function of
// time: queued → running → (processing, uploads only) → final, with phase
// lengths set when it starts. The outcome is computed once, when the job
// first reaches its end (`settle`), and that is when it changes the library.
// No timers: the library settles due jobs at the start of every request
// (`tick`), so a manual clock drives everything in tests.

import type {
  ApiError,
  ImageJobResult,
  Job,
  JobLookup,
  RegenerateJobResult,
  UploadJobResult,
} from '../../../../../shared/library-api.ts'
import { LIMITS } from '../../../../../shared/library-api.ts'
import { isoTime } from './dto.ts'

export type FakeJobKind = Job['kind']

export type JobOutcome<R> =
  | { state: 'succeeded'; result: R }
  | { state: 'failed'; error: ApiError }

interface Phases {
  queued: number
  running: number
  /** uploads only: WordPress generating sub-sizes */
  processing: number
}

interface JobBase<K extends FakeJobKind, R> {
  id: string
  kind: K
  createdAt: number
  phases: Phases
  /** progress total and unit while running */
  total: number
  unit: 'bytes' | 'items' | null
  settle: () => JobOutcome<R>
  outcome: JobOutcome<R> | null
  finishedAt: number | null
}

export type FakeJob =
  | (JobBase<'upload', UploadJobResult> & { filename: string })
  | (JobBase<'edit' | 'edit-undo' | 'restore' | 'replace', ImageJobResult> & {
      itemId: number
    })
  | (JobBase<'regenerate', RegenerateJobResult> & { itemIds: number[] })

export type NewJob = DistributiveOmit<
  FakeJob,
  'id' | 'createdAt' | 'outcome' | 'finishedAt'
>

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never

function endOf(job: FakeJob): number {
  const { queued, running, processing } = job.phases
  return job.createdAt + queued + running + processing
}

export class JobRegistry {
  private readonly jobs = new Map<string, FakeJob>()
  private counter = 0

  /** Ids look like UUIDs and are unique per registry. */
  private nextId(): string {
    this.counter++
    return `6f1c2a4e-0000-4000-8000-${this.counter.toString(16).padStart(12, '0')}`
  }

  start(job: NewJob, now: number): string {
    const id = this.nextId()
    this.jobs.set(id, {
      ...job,
      id,
      createdAt: now,
      outcome: null,
      finishedAt: null,
    } as FakeJob)
    return id
  }

  /** Settles every job whose time is up, oldest first. */
  tick(now: number): void {
    for (const job of this.jobs.values()) {
      if (job.outcome === null && now >= endOf(job)) {
        this.settle(job, now)
      }
    }
    for (const [id, job] of this.jobs) {
      if (
        job.finishedAt !== null &&
        now - job.finishedAt > LIMITS.finishedJobTtlMs
      ) {
        this.jobs.delete(id)
      }
    }
  }

  private settle(job: FakeJob, now: number): void {
    job.outcome = job.settle() as never
    job.finishedAt = Math.max(endOf(job), Math.min(now, endOf(job)))
  }

  get(id: string): FakeJob | undefined {
    return this.jobs.get(id)
  }

  /** Cancels an unfinished upload. False when unknown or finished. */
  cancelUpload(id: string): boolean {
    const job = this.jobs.get(id)
    if (job?.kind !== 'upload' || job.outcome !== null) {
      return false
    }
    this.jobs.delete(id)
    return true
  }

  lookup(id: string, now: number, uploadsOnly: boolean): JobLookup {
    const job = this.jobs.get(id)
    if (!job || (uploadsOnly && job.kind !== 'upload')) {
      return { id, state: 'not_found' }
    }
    return toDto(job, now)
  }
}

function progressOf(
  job: FakeJob,
  elapsedRunning: number,
): { done: number; total: number; unit: 'bytes' | 'items' } | null {
  if (job.unit === null) {
    return null
  }
  const share =
    job.phases.running === 0
      ? 1
      : Math.min(1, elapsedRunning / job.phases.running)
  return {
    done: Math.floor(job.total * share),
    total: job.total,
    unit: job.unit,
  }
}

function toDto(job: FakeJob, now: number): Job {
  const elapsed = now - job.createdAt
  const { queued, running } = job.phases
  let state: Job['state']
  let progress = null as ReturnType<typeof progressOf>
  let updatedAt = job.createdAt
  if (job.outcome !== null) {
    state = job.outcome.state
    progress = progressOf(job, running)
    updatedAt = job.finishedAt ?? now
  } else if (elapsed < queued) {
    state = 'queued'
  } else if (elapsed < queued + running) {
    state = 'running'
    progress = progressOf(job, elapsed - queued)
    updatedAt = now
  } else {
    state = 'processing'
    progress = progressOf(job, running)
    updatedAt = job.createdAt + queued + running
  }
  const common = {
    id: job.id,
    state,
    createdAt: isoTime(job.createdAt),
    updatedAt: isoTime(updatedAt),
    progress,
    error: job.outcome?.state === 'failed' ? job.outcome.error : null,
  }
  switch (job.kind) {
    case 'upload':
      return {
        ...common,
        kind: 'upload',
        filename: job.filename,
        result: job.outcome?.state === 'succeeded' ? job.outcome.result : null,
      }
    case 'regenerate':
      return {
        ...common,
        kind: 'regenerate',
        itemIds: job.itemIds,
        result: job.outcome?.state === 'succeeded' ? job.outcome.result : null,
      }
    default:
      return {
        ...common,
        kind: job.kind,
        itemId: job.itemId,
        result: job.outcome?.state === 'succeeded' ? job.outcome.result : null,
      }
  }
}
