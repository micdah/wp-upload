// The inspector's mutation: saving one item's metadata (inspector.md §3).
//
// Optimistic: the value reaches every cached copy of the item at once (tile,
// full, every chunk), so the grid and the panel show it while the request
// runs. A failed PATCH puts the cached values back and rethrows; the caller
// keeps the typed text for Retry. On success the response's snapshot and rev
// go into the cache, and `applyRev` refetches only what the change can
// affect (title sort, search, the missing-alt filter and facets).

import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import type {
  BatchItemResult,
  BatchSameRequest,
  ItemPatch,
  ItemPatchResponse,
} from '../../../../../shared/library-api'
import { libraryApi } from './api'
import { type BulkOptions, type BulkOutcome, bulkBatch } from './bulk'
import { applyRev } from './invalidate'
import { optimistic, optimisticTargets, patchItems } from './optimistic'
import { applyItemSnapshots } from './results'

/** The text fields the inspector edits on one item. */
export type ItemMetaField = 'title' | 'alt' | 'caption' | 'description'

/** At least one of the text fields; `post` (attach) is the usage feature's. */
export type ItemMetaPatch = Partial<Record<ItemMetaField, string>>

/**
 * PATCHes one item's text fields with an optimistic cache update. Resolves
 * with the response once the cache holds the server's snapshot; rejects
 * with the `LibraryError` after rolling the cache back.
 */
export async function saveItemMeta(
  queryClient: QueryClient,
  id: number,
  patch: ItemMetaPatch,
): Promise<ItemPatchResponse> {
  const fields = Object.keys(patch) as (keyof ItemPatch)[]
  if (fields.length === 0) {
    throw new Error('saveItemMeta needs at least one field')
  }
  const response = await optimistic(queryClient, {
    cancel: optimisticTargets.items([id]),
    apply: () => patchItems(queryClient, [id], patch),
    run: () => libraryApi.patchItem(id, patch),
    writes: [id],
  })
  applyItemSnapshots(queryClient, [{ id, item: response.item }])
  applyRev(queryClient, response.rev, { kind: 'item-meta', ids: [id], fields })
  return response
}

/** saveItemMeta bound to the provider's query client. */
export function useSaveItemMeta(): (
  id: number,
  patch: ItemMetaPatch,
) => Promise<ItemPatchResponse> {
  const queryClient = useQueryClient()
  return useCallback(
    (id, patch) => saveItemMeta(queryClient, id, patch),
    [queryClient],
  )
}

// ---------------------------------------------------------------------------
// Batch metadata (inspector.md §2 "Several items", D24)
// ---------------------------------------------------------------------------

/** How a batch commit changes the description. */
export type DescriptionMode = 'replace' | 'append'

export interface BatchMetaChange {
  field: ItemMetaField
  value: string
  /** Description only: append the text as a new paragraph. */
  mode?: DescriptionMode
}

/** The per-item `previous` values a batch returned, for its Undo. */
export type BatchUndo = { id: number; set: ItemPatch }[]

export interface BatchMetaOutcome {
  /** Ids the server changed. */
  changed: number[]
  /** Ids it refused (per-item errors). */
  failed: number[]
  /** The first per-item error's message. */
  failure: string | null
  /** What stopped the run (a failing chunk); the rest wasn't sent. */
  error: unknown
  aborted: boolean
  undo: BatchUndo
}

/**
 * Writes the same change to every id, client-chunked (100 per request) with
 * progress. Each chunk's snapshots and rev reach the cache as it arrives.
 * Never rejects: a failing chunk stops the run and is in `error`.
 */
export async function saveBatchMeta(
  queryClient: QueryClient,
  ids: readonly number[],
  change: BatchMetaChange,
  options: BulkOptions = {},
): Promise<BatchMetaOutcome> {
  const request: BatchSameRequest =
    change.field === 'description' && change.mode === 'append'
      ? { ids: [...ids], set: {}, appendDescription: change.value }
      : { ids: [...ids], set: { [change.field]: change.value } }
  return outcomeOf(await bulkBatch(queryClient, request, options))
}

/** Puts back every item's `previous` values (the batch toast's Undo). */
export async function undoBatchMeta(
  queryClient: QueryClient,
  undo: BatchUndo,
  options: BulkOptions = {},
): Promise<BatchMetaOutcome> {
  return outcomeOf(await bulkBatch(queryClient, { items: undo }, options))
}

function outcomeOf(outcome: BulkOutcome<BatchItemResult>): BatchMetaOutcome {
  const changed: number[] = []
  const failed: number[] = []
  const undo: BatchUndo = []
  let failure: string | null = null
  for (const result of outcome.results) {
    if (result.ok) {
      changed.push(result.id)
      undo.push({ id: result.id, set: result.previous })
    } else {
      failed.push(result.id)
      failure ??= result.error.message
    }
  }
  return {
    changed,
    failed,
    failure,
    error: outcome.error,
    aborted: outcome.aborted,
    undo,
  }
}

// ---------------------------------------------------------------------------
// Usage and attach (inspector.md §5). Written by the usage helper; keep
// additions below this line.
// ---------------------------------------------------------------------------
//
// - Usage (`GET usage`, ≤ 100 ids a request): one query per chunk of ids,
//   whose queryFn seeds the per-id `libraryKeys.usage(id)` entries, so a
//   single item the batch view loaded opens without a request. `usage` is
//   rev-dependent (keys.ts), so a new rev makes it stale.
// - The post picker (`GET posts`, no-store): a short staleTime, so typing
//   back and forth reuses answers for a moment and then asks again.
// - Attach / detach: one item through `PATCH items/:id {post}` with the
//   picked post shown at once (optimistic), several through `bulkBatch`
//   (100 per request). `applyRev` with fields ['post'] refetches the full
//   items for `attachedTo`; the picked post also goes straight into every
//   cached copy, so chunked views (the batch panel) follow without one.

import {
  keepPreviousData,
  queryOptions,
  type UseQueryResult,
  useQueries,
  useQuery,
} from '@tanstack/react-query'
import {
  type ItemUsage,
  LIMITS,
  type LibraryItemFull,
  type PostRef,
  type PostsResponse,
} from '../../../../../shared/library-api'
import type { LibraryError } from './errors'
import { cachedItem, chunkIds } from './items'
import { libraryKeys } from './keys'

/** One item's usage, with whether the index was complete when it answered. */
export interface UsageEntry extends ItemUsage {
  complete: boolean
}

/** The key of one `usage?ids=` request (under `usage`: rev-dependent). */
function usageChunkKey(ids: readonly number[]) {
  return [...libraryKeys.usages(), 'chunk', ids] as const
}

/** A chunk made of cached per-id entries, when all are there and fresh. */
function usageChunkFromCache(
  queryClient: QueryClient,
  ids: readonly number[],
): { entries: UsageEntry[]; updatedAt: number } | undefined {
  const entries: UsageEntry[] = []
  let updatedAt = Number.POSITIVE_INFINITY
  for (const id of ids) {
    const state = queryClient.getQueryState<UsageEntry>(libraryKeys.usage(id))
    if (!state || state.data === undefined || state.isInvalidated) {
      return undefined
    }
    updatedAt = Math.min(updatedAt, state.dataUpdatedAt)
    entries.push(state.data)
  }
  return { entries, updatedAt }
}

/** Usage of 1–100 ids (LIMITS.usageIds), in request order. */
export function usageQueryOptions(
  queryClient: QueryClient,
  ids: readonly number[],
) {
  return queryOptions({
    queryKey: usageChunkKey(ids),
    queryFn: async ({ signal }): Promise<UsageEntry[]> => {
      const response = await libraryApi.usage(ids, { signal })
      const entries = response.items.map((item) => ({
        ...item,
        complete: response.complete,
      }))
      for (const entry of entries) {
        queryClient.setQueryData(libraryKeys.usage(entry.id), entry)
      }
      return entries
    },
    initialData: () => usageChunkFromCache(queryClient, ids)?.entries,
    initialDataUpdatedAt: () =>
      usageChunkFromCache(queryClient, ids)?.updatedAt,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

export interface UsageResult {
  /** every entry the chunks hold, by id */
  items: ReadonlyMap<number, UsageEntry>
  /** false when any chunk said the usage index is still building */
  complete: boolean
  /** some chunk has no data yet */
  pending: boolean
  fetching: boolean
  /** the first chunk's error, if any */
  error: LibraryError | null
  /** refetches every chunk (the panel's Retry) */
  refetch: () => void
}

function combineUsage(
  results: UseQueryResult<UsageEntry[], LibraryError>[],
): UsageResult {
  const items = new Map<number, UsageEntry>()
  let complete = true
  let pending = false
  let fetching = false
  let error: LibraryError | null = null
  for (const result of results) {
    if (result.data) {
      for (const entry of result.data) {
        items.set(entry.id, entry)
        complete &&= entry.complete
      }
    } else {
      pending = true
    }
    fetching ||= result.isFetching
    error ??= result.error ?? null
  }
  return {
    items,
    complete,
    pending,
    fetching,
    error,
    refetch: () => {
      for (const result of results) {
        void result.refetch()
      }
    },
  }
}

/**
 * Usage of any number of ids, 100 per request. Cap large selections first
 * (the Usage panel shows the first 500).
 */
export function useUsage(
  ids: readonly number[],
  options: { enabled?: boolean } = {},
): UsageResult {
  const queryClient = useQueryClient()
  const enabled = options.enabled ?? true
  return useQueries({
    queries: chunkIds(ids, LIMITS.usageIds).map((chunk) => ({
      ...usageQueryOptions(queryClient, chunk),
      enabled,
    })),
    combine: combineUsage,
  })
}

/** How many posts the picker lists. */
export const POST_PICKER_LIMIT = 10

/** `GET posts` for the picker: published posts only (core search, D21). */
export function postSearchQueryOptions(search: string) {
  const text = search.trim().slice(0, LIMITS.queryLength)
  return queryOptions({
    queryKey: libraryKeys.posts(text, POST_PICKER_LIMIT),
    queryFn: ({ signal }): Promise<PostsResponse> =>
      libraryApi.posts(text, POST_PICKER_LIMIT, { signal }),
    // `no-store` on the server: reuse an answer briefly, then ask again.
    staleTime: 30_000,
  })
}

/** The picker's results; keeps the previous list while a search loads. */
export function usePostSearch(
  search: string,
): UseQueryResult<PostsResponse, LibraryError> {
  return useQuery({
    ...postSearchQueryOptions(search),
    placeholderData: keepPreviousData,
  })
}

/**
 * Attaches one item to `post` (null detaches) through `PATCH items/:id`.
 * `shown` is the post to show as `attachedTo` while the request runs (and
 * after); leave it out to wait for the full item's refetch. Rejects with the
 * `LibraryError` after rolling the cache back.
 */
export async function attachItem(
  queryClient: QueryClient,
  id: number,
  post: number | null,
  shown?: PostRef | null,
): Promise<ItemPatchResponse> {
  const response = await optimistic(queryClient, {
    cancel: optimisticTargets.items([id]),
    apply: () =>
      shown === undefined
        ? () => {}
        : patchItems(queryClient, [id], { attachedTo: shown }),
    run: () => libraryApi.patchItem(id, { post }),
    writes: [id],
  })
  applyItemSnapshots(queryClient, [{ id, item: response.item }])
  applyRev(queryClient, response.rev, {
    kind: 'item-meta',
    ids: [id],
    fields: ['post'],
  })
  return response
}

/** What to send back for a batch attach's Undo, per item. */
export type AttachUndo = {
  id: number
  /** the post it was attached to before (null: none) */
  post: number | null
  /** that post as the cache knew it; undefined when unknown */
  shown: PostRef | null | undefined
}[]

export interface AttachOutcome {
  /** Ids the server changed. */
  changed: number[]
  /** Ids it refused (per-item errors). */
  failed: number[]
  /** The first per-item error's message. */
  failure: string | null
  /** What stopped the run (a failing chunk); the rest wasn't sent. */
  error: unknown
  aborted: boolean
  undo: AttachUndo
}

/** The `attachedTo` a cached full item has; undefined when not cached. */
function cachedAttachment(
  queryClient: QueryClient,
  id: number,
): PostRef | null | undefined {
  const item = cachedItem(queryClient, id)
  return item?.view === 'full'
    ? (item as LibraryItemFull).attachedTo
    : undefined
}

function attachOutcomeOf(
  outcome: BulkOutcome<BatchItemResult>,
  before: ReadonlyMap<number, PostRef | null | undefined>,
): AttachOutcome {
  const changed: number[] = []
  const failed: number[] = []
  const undo: AttachUndo = []
  let failure: string | null = null
  for (const result of outcome.results) {
    if (result.ok) {
      changed.push(result.id)
      const post = result.previous.post ?? null
      const known = before.get(result.id)
      // Show the cached post only when it is the one the server reports.
      const matches = known !== undefined && (known?.postId ?? null) === post
      undo.push({ id: result.id, post, shown: matches ? known : undefined })
    } else {
      failed.push(result.id)
      failure ??= result.error.message
    }
  }
  return {
    changed,
    failed,
    failure,
    error: outcome.error,
    aborted: outcome.aborted,
    undo,
  }
}

/**
 * Attaches every id to `post` (null detaches), client-chunked. Never
 * rejects: a failing chunk stops the run and is in `error`.
 */
export async function attachItems(
  queryClient: QueryClient,
  ids: readonly number[],
  post: PostRef | null,
  options: BulkOptions = {},
): Promise<AttachOutcome> {
  const before = new Map(
    ids.map((id) => [id, cachedAttachment(queryClient, id)] as const),
  )
  const outcome = attachOutcomeOf(
    await bulkBatch(
      queryClient,
      { ids: [...ids], set: { post: post?.postId ?? null } },
      options,
    ),
    before,
  )
  if (outcome.changed.length > 0) {
    patchItems(queryClient, outcome.changed, { attachedTo: post })
  }
  return outcome
}

/** Puts every item back on its previous post (the batch toast's Undo). */
export async function undoAttachItems(
  queryClient: QueryClient,
  undo: AttachUndo,
  options: BulkOptions = {},
): Promise<AttachOutcome> {
  const before = new Map(
    undo.map(({ id }) => [id, cachedAttachment(queryClient, id)] as const),
  )
  const outcome = attachOutcomeOf(
    await bulkBatch(
      queryClient,
      { items: undo.map(({ id, post }) => ({ id, set: { post } })) },
      options,
    ),
    before,
  )
  const changed = new Set(outcome.changed)
  for (const { id, shown } of undo) {
    if (changed.has(id) && shown !== undefined) {
      patchItems(queryClient, [id], { attachedTo: shown })
    }
  }
  return outcome
}
