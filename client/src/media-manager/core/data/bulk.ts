// Client-side chunking of bulk operations, with progress (D24).
//
// The server never splits large selections: the client sends 100 ids per
// request for batch, delete and restore, 5000 for folder assign and 1000 for
// regenerate, one request after another. Each chunk's response is applied
// to the cache as it arrives (snapshots, rev), so the UI follows along and a
// stop or failure half-way leaves a consistent state: what was done is done,
// and Undo covers exactly that. A reload stops the rest.

import type { QueryClient } from '@tanstack/react-query'
import {
  type BatchEachRequest,
  type BatchItemChange,
  type BatchItemResult,
  type BatchItemSuccess,
  type BatchSameRequest,
  type DeleteItemResult,
  type DeleteMode,
  type FolderAssignResponse,
  type ItemFailure,
  type ItemPatch,
  LIMITS,
  type RestoreItemResult,
} from '../../../../../shared/library-api'
import { libraryApi } from './api'
import { isAbortError } from './errors'
import { applyFolderCounts } from './folderTree'
import { applyRev } from './invalidate'
import { beginItemWrite } from './itemWrites'
import { applyItemSnapshots } from './results'

export interface BulkProgress {
  /** ids (or items) processed so far */
  done: number
  total: number
  /** chunks finished so far, of `chunks` */
  chunk: number
  chunks: number
}

export interface BulkOptions {
  signal?: AbortSignal
  onProgress?: (progress: BulkProgress) => void
}

export interface BulkOutcome<R> {
  /** results of the chunks that finished, in request order */
  results: R[]
  done: number
  total: number
  /** the error that stopped the run, if any (not set for an abort) */
  error: unknown
  /** stopped by the signal */
  aborted: boolean
}

/**
 * Runs `run` over `items` in chunks of `size`, sequentially. Stops at the
 * first failing chunk (its error is in the outcome, nothing is thrown) or
 * when the signal aborts.
 */
export async function runChunked<T, R>(options: {
  items: readonly T[]
  size: number
  run: (chunk: T[], signal: AbortSignal | undefined) => Promise<R[]>
  signal?: AbortSignal
  onProgress?: (progress: BulkProgress) => void
}): Promise<BulkOutcome<R>> {
  const { items, size, run, signal, onProgress } = options
  const chunks: T[][] = []
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size))
  }
  const outcome: BulkOutcome<R> = {
    results: [],
    done: 0,
    total: items.length,
    error: null,
    aborted: false,
  }
  onProgress?.({
    done: 0,
    total: items.length,
    chunk: 0,
    chunks: chunks.length,
  })
  for (const [index, chunk] of chunks.entries()) {
    if (signal?.aborted) {
      outcome.aborted = true
      break
    }
    try {
      outcome.results.push(...(await run(chunk, signal)))
    } catch (error) {
      if (isAbortError(error)) {
        outcome.aborted = true
      } else {
        outcome.error = error
      }
      break
    }
    outcome.done += chunk.length
    onProgress?.({
      done: outcome.done,
      total: items.length,
      chunk: index + 1,
      chunks: chunks.length,
    })
  }
  return outcome
}

function changedFields(change: {
  set: ItemPatch
  appendDescription?: string
}): (keyof ItemPatch)[] {
  const fields = Object.keys(change.set) as (keyof ItemPatch)[]
  if (change.appendDescription !== undefined) {
    fields.push('description')
  }
  return fields
}

/**
 * `items/batch` for any number of items: the same change for every id, or a
 * change per item (Undo). 100 per request.
 */
export async function bulkBatch(
  queryClient: QueryClient,
  request: BatchSameRequest | BatchEachRequest,
  options: BulkOptions = {},
): Promise<BulkOutcome<BatchItemResult>> {
  const changes: BatchItemChange[] =
    'items' in request
      ? request.items
      : request.ids.map((id) => {
          const change: BatchItemChange = { id, set: request.set }
          if (request.appendDescription !== undefined) {
            change.appendDescription = request.appendDescription
          }
          return change
        })
  return runChunked({
    items: changes,
    size: LIMITS.batchItems,
    signal: options.signal,
    onProgress: options.onProgress,
    run: async (chunk, signal) => {
      // Keep the request's form: the same change stays one `set`.
      const body: BatchSameRequest | BatchEachRequest =
        'items' in request
          ? { items: chunk }
          : { ...request, ids: chunk.map((change) => change.id) }
      // Item reads overlapping this request keep the cache's values
      // (itemWrites.ts); it ends before the results are applied.
      const endWrite = beginItemWrite(
        queryClient,
        chunk.map((change) => change.id),
      )
      let response: Awaited<ReturnType<typeof libraryApi.batch>>
      try {
        response = await libraryApi.batch(body, { signal })
      } finally {
        endWrite()
      }
      const succeeded = response.results.filter(
        (result): result is BatchItemSuccess => result.ok,
      )
      applyItemSnapshots(queryClient, succeeded)
      applyRev(queryClient, response.rev, {
        kind: 'item-meta',
        ids: succeeded.map((result) => result.id),
        fields: [...new Set(chunk.flatMap(changedFields))],
      })
      return response.results
    },
  })
}

/** `items/delete` for any number of ids, 100 per request. */
export async function bulkDelete(
  queryClient: QueryClient,
  ids: readonly number[],
  mode: DeleteMode,
  options: BulkOptions = {},
): Promise<BulkOutcome<DeleteItemResult>> {
  return runChunked({
    items: ids,
    size: LIMITS.deleteIds,
    signal: options.signal,
    onProgress: options.onProgress,
    run: async (chunk, signal) => {
      const response = await libraryApi.deleteItems(
        { ids: chunk, mode },
        { signal },
      )
      applyRev(queryClient, response.rev, { kind: 'delete', ids: chunk, mode })
      return response.results
    },
  })
}

/** `trash/restore` for any number of ids, 100 per request. */
export async function bulkRestore(
  queryClient: QueryClient,
  ids: readonly number[],
  options: BulkOptions = {},
): Promise<BulkOutcome<RestoreItemResult>> {
  return runChunked({
    items: ids,
    size: LIMITS.deleteIds,
    signal: options.signal,
    onProgress: options.onProgress,
    run: async (chunk, signal) => {
      const response = await libraryApi.restoreFromTrash(
        { ids: chunk },
        { signal },
      )
      applyRev(queryClient, response.rev, { kind: 'restore', ids: chunk })
      return response.results
    },
  })
}

export interface BulkAssignOutcome extends BulkOutcome<never> {
  previous: FolderAssignResponse['previous']
  skipped: ItemFailure[]
  moved: number
}

/** `folders/assign` for any number of ids, 5000 per request. */
export async function bulkAssign(
  queryClient: QueryClient,
  folder: number,
  ids: readonly number[],
  options: BulkOptions = {},
): Promise<BulkAssignOutcome> {
  const previous: FolderAssignResponse['previous'] = []
  const skipped: ItemFailure[] = []
  let moved = 0
  // Every id is being written from the start (the caller moved them
  // optimistically); each chunk's ids end when its response arrives, before
  // applyRev refetches them, and the rest end with the run (itemWrites.ts).
  const writes = new Map(
    [...new Set(ids)].map((id) => [id, beginItemWrite(queryClient, [id])]),
  )
  const endWrites = (done: readonly number[]) => {
    for (const id of done) {
      writes.get(id)?.()
      writes.delete(id)
    }
  }
  const outcome = await runChunked<number, never>({
    items: ids,
    size: LIMITS.assignIds,
    signal: options.signal,
    onProgress: options.onProgress,
    run: async (chunk, signal) => {
      let response: Awaited<ReturnType<typeof libraryApi.assignFolder>>
      try {
        response = await libraryApi.assignFolder(
          { folder, ids: chunk },
          { signal },
        )
      } finally {
        endWrites(chunk)
      }
      previous.push(...response.previous)
      skipped.push(...response.skipped)
      moved += response.moved
      applyFolderCounts(queryClient, response.counts, response.rev)
      applyRev(queryClient, response.rev, {
        kind: 'folder-assign',
        ids: chunk,
        folder,
      })
      return []
    },
  })
  endWrites([...writes.keys()])
  return { ...outcome, previous, skipped, moved }
}

/** Undo of an assign: one request per previous folder (server-api.md §7.11). */
export function groupByPreviousFolder(
  previous: FolderAssignResponse['previous'],
): Map<number, number[]> {
  const groups = new Map<number, number[]>()
  for (const { id, folder } of previous) {
    const group = groups.get(folder)
    if (group) {
      group.push(id)
    } else {
      groups.set(folder, [id])
    }
  }
  return groups
}

/** `items/regenerate` for any number of ids: one job per 1000. */
export async function bulkRegenerate(
  ids: readonly number[],
  options: BulkOptions = {},
): Promise<BulkOutcome<string>> {
  return runChunked({
    items: ids,
    size: LIMITS.regenerateIds,
    signal: options.signal,
    onProgress: options.onProgress,
    run: async (chunk, signal) => {
      const accepted = await libraryApi.regenerate({ ids: chunk }, { signal })
      return [accepted.jobId]
    },
  })
}

export interface EmptyTrashOutcome {
  deleted: number
  remaining: number
  skipped: number
  error: unknown
  aborted: boolean
}

/** Stop when this many steps in a row delete nothing (a stuck item). */
const MAX_IDLE_STEPS = 3

/**
 * Empties the Trash: repeats the time-budgeted step while `remaining > 0`,
 * reporting `deleted` of `deleted + remaining` as progress.
 */
export async function emptyTrash(
  queryClient: QueryClient,
  options: BulkOptions = {},
): Promise<EmptyTrashOutcome> {
  const outcome: EmptyTrashOutcome = {
    deleted: 0,
    remaining: 0,
    skipped: 0,
    error: null,
    aborted: false,
  }
  let idleSteps = 0
  let step = 0
  for (;;) {
    if (options.signal?.aborted) {
      outcome.aborted = true
      return outcome
    }
    try {
      const response = await libraryApi.emptyTrashStep({
        signal: options.signal,
      })
      step++
      outcome.deleted += response.deleted
      outcome.remaining = response.remaining
      outcome.skipped = response.skipped
      applyRev(queryClient, response.rev, { kind: 'empty-trash' })
      options.onProgress?.({
        done: outcome.deleted,
        total: outcome.deleted + response.remaining,
        chunk: step,
        chunks: step + (response.remaining > 0 ? 1 : 0),
      })
      idleSteps = response.deleted === 0 ? idleSteps + 1 : 0
      if (response.remaining === 0 || idleSteps >= MAX_IDLE_STEPS) {
        return outcome
      }
    } catch (error) {
      if (isAbortError(error)) {
        outcome.aborted = true
      } else {
        outcome.error = error
      }
      return outcome
    }
  }
}
