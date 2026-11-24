// The central invalidation map, keyed by the library revision.
//
// Every change to the library bumps `rev` (server-api.md §3.1). The client
// holds the last rev it knows (per QueryClient). When it learns a new one it
// invalidates exactly what that change made stale:
//
// - from the rev poll or bootstrap (`external`: someone else changed
//   something): every rev-dependent query (keys.ts `REV_DEPENDENT`);
// - from one of our own mutation responses: only what `INVALIDATION_MAP`
//   lists for that change. The response itself has usually patched the rest
//   already (item snapshots, folder trees, counts).
//
// Because our own mutations set the known rev first, the next poll sees the
// same rev and does nothing. A rev that didn't change means nothing changed,
// so nothing is invalidated.
//
// The gap behind our own rev: revs are opaque (shared/library-api.ts says
// compare for equality only) and mutation responses carry no `revBefore`, so
// the client can't tell whether someone else changed the library between the
// rev it knew and the one our mutation returned. Moving `known` forward would
// hide that change from the poll for good. So every own mutation also marks
// every rev-dependent query stale without refetching it
// (`refetchType: 'none'`): the map still decides what refetches now, and
// everything else refetches the next time it is used (a view mounts, a chunk
// scrolls in). That is the simplest option that is always correct; the cost
// is one refetch per query on its next use after each own mutation.
//
// Feature tracks don't add invalidation calls of their own: they describe the
// change with a `LibraryChange` and call `applyRev`. A new kind of change gets
// a row here (a change request after the M2 gate).

import type {
  InvalidateQueryFilters,
  Query,
  QueryClient,
} from '@tanstack/react-query'
import type {
  CollectionQuery,
  DeleteMode,
  ItemPatch,
  LibraryItem,
} from '../../../../../shared/library-api'
import { keyResource, LIBRARY_ROOT, REV_DEPENDENT } from './keys'

export type LibraryChange =
  /** someone else changed the library (rev poll, bootstrap refetch) */
  | { kind: 'external' }
  /** metadata of these items (PATCH items/:id, items/batch) */
  | {
      kind: 'item-meta'
      ids: readonly number[]
      fields: readonly (keyof ItemPatch)[]
    }
  /** items moved to a folder (0 = Uncategorized) */
  | { kind: 'folder-assign'; ids: readonly number[]; folder: number }
  /** a folder was created, renamed, moved or recoloured (the response holds the tree) */
  | { kind: 'folder-tree' }
  /** folders were deleted; their files moved to Uncategorized */
  | { kind: 'folder-delete'; folderIds: readonly number[] }
  /** items trashed or deleted for good */
  | { kind: 'delete'; ids: readonly number[]; mode: DeleteMode }
  /** items restored from the Trash */
  | { kind: 'restore'; ids: readonly number[] }
  /** one step of emptying the Trash */
  | { kind: 'empty-trash' }
  /** an image operation finished (edit, undo, restore, replace, regenerate) */
  | { kind: 'image'; ids: readonly number[] }
  /** uploads finished and created these items */
  | { kind: 'upload'; ids: readonly number[] }

export type LibraryChangeKind = LibraryChange['kind']

type FiltersFor<K extends LibraryChangeKind> = (
  change: Extract<LibraryChange, { kind: K }>,
) => InvalidateQueryFilters[]

// ---------------------------------------------------------------------------
// Filter builders
// ---------------------------------------------------------------------------

function resource(name: string): InvalidateQueryFilters {
  return { queryKey: [LIBRARY_ROOT, name] }
}

function queryOf(query: Query): CollectionQuery {
  return query.queryKey[2] as CollectionQuery
}

/** Collection (or facets) queries whose query matches `test`. */
function collectionsWhere(
  name: 'collection' | 'facets',
  test: (query: CollectionQuery) => boolean,
): InvalidateQueryFilters {
  return {
    queryKey: [LIBRARY_ROOT, name],
    predicate: (query) => test(queryOf(query)),
  }
}

/** Per-id item queries and item chunks that hold any of these ids. */
function itemsWith(ids: readonly number[]): InvalidateQueryFilters[] {
  const wanted = new Set(ids)
  return [
    {
      queryKey: [LIBRARY_ROOT, 'item'],
      predicate: (query) => wanted.has(query.queryKey[3] as number),
    },
    {
      queryKey: [LIBRARY_ROOT, 'items'],
      predicate: (query) =>
        (query.queryKey[3] as readonly number[]).some((id) => wanted.has(id)),
    },
  ]
}

/** Per-id full items only (e.g. `attachedTo` after an attach). */
function fullItemsWith(ids: readonly number[]): InvalidateQueryFilters {
  const wanted = new Set(ids)
  return {
    queryKey: [LIBRARY_ROOT, 'item', 'full'],
    predicate: (query) => wanted.has(query.queryKey[3] as number),
  }
}

/** Cached items (either view) whose `folder` is one of these. */
function itemsInFolders(
  folderIds: readonly number[],
): InvalidateQueryFilters[] {
  const wanted = new Set(folderIds)
  const holds = (item: LibraryItem | null | undefined) =>
    item?.folder !== null &&
    item?.folder !== undefined &&
    wanted.has(item.folder)
  return [
    {
      queryKey: [LIBRARY_ROOT, 'item'],
      predicate: (query) => holds(query.state.data as LibraryItem | null),
    },
    {
      queryKey: [LIBRARY_ROOT, 'items'],
      predicate: (query) => {
        const data = query.state.data as { items?: LibraryItem[] } | undefined
        return data?.items?.some(holds) ?? false
      },
    },
  ]
}

const everyCollection = () => true
const notTrash = (query: CollectionQuery) => query.folder !== 'trash'
const isTrash = (query: CollectionQuery) => query.folder === 'trash'

// ---------------------------------------------------------------------------
// The map
// ---------------------------------------------------------------------------

/** Which fields can change a collection's membership or order, and how. */
function metaAffects(
  fields: readonly (keyof ItemPatch)[],
): (query: CollectionQuery) => boolean {
  const searchable = fields.some((field) => field !== 'post')
  return (query) => {
    if (query.folder === 'trash') {
      return false
    }
    if (searchable && query.q !== null) {
      return true
    }
    if (fields.includes('title') && query.sort === 'title-asc') {
      return true
    }
    return fields.includes('alt') && query.alt !== null
  }
}

export const INVALIDATION_MAP: { [K in LibraryChangeKind]: FiltersFor<K> } = {
  external: () => [...REV_DEPENDENT].map((name) => resource(name)),

  'item-meta': ({ ids, fields }) => {
    const affects = metaAffects(fields)
    const filters: InvalidateQueryFilters[] = [
      collectionsWhere('collection', affects),
      // Facets count missing alt, and searches match any text field.
      collectionsWhere(
        'facets',
        (query) => fields.includes('alt') || affects(query),
      ),
    ]
    // The snapshots in the response patched title, alt, caption and
    // description already; `post` changes `attachedTo`, which only a refetch
    // of the full view brings.
    if (fields.includes('post')) {
      filters.push(fullItemsWith(ids))
    }
    return filters
  },

  'folder-assign': ({ ids }) => [
    // All files doesn't change; every folder view may have gained or lost.
    collectionsWhere('collection', (query) => typeof query.folder === 'number'),
    collectionsWhere('facets', (query) => typeof query.folder === 'number'),
    resource('folders'),
    ...itemsWith(ids),
  ],

  'folder-tree': () => [resource('folders')],

  'folder-delete': ({ folderIds }) => [
    resource('folders'),
    collectionsWhere('collection', (query) => typeof query.folder === 'number'),
    collectionsWhere('facets', (query) => typeof query.folder === 'number'),
    ...itemsInFolders(folderIds),
  ],

  delete: ({ ids }) => [
    collectionsWhere('collection', everyCollection),
    collectionsWhere('facets', everyCollection),
    resource('folders'),
    resource('trash'),
    ...itemsWith(ids),
  ],

  restore: ({ ids }) => [
    collectionsWhere('collection', everyCollection),
    collectionsWhere('facets', everyCollection),
    resource('folders'),
    resource('trash'),
    ...itemsWith(ids),
  ],

  'empty-trash': () => [
    collectionsWhere('collection', isTrash),
    collectionsWhere('facets', isTrash),
    resource('trash'),
  ],

  image: ({ ids }) => [
    // New dimensions are in the collection rows (the justified layout), and
    // change `orient`, the dimensions/size sorts and the byte totals.
    collectionsWhere('collection', notTrash),
    collectionsWhere('facets', notTrash),
    ...itemsWith(ids),
  ],

  upload: () => [
    collectionsWhere('collection', notTrash),
    collectionsWhere('facets', notTrash),
    resource('folders'),
  ],
}

/** The filters one change invalidates. */
export function filtersFor(change: LibraryChange): InvalidateQueryFilters[] {
  const build = INVALIDATION_MAP[change.kind] as (
    change: LibraryChange,
  ) => InvalidateQueryFilters[]
  return build(change)
}

/** Invalidates (and refetches the active ones of) what `change` made stale. */
export async function invalidateFor(
  queryClient: QueryClient,
  change: LibraryChange,
): Promise<void> {
  await Promise.all(
    filtersFor(change).map((filters) => queryClient.invalidateQueries(filters)),
  )
}

// ---------------------------------------------------------------------------
// The known revision, per QueryClient
// ---------------------------------------------------------------------------

interface RevState {
  rev: string | null
  /** Bumped whenever `rev` changes; lets a poll tell it was overtaken. */
  sequence: number
  listeners: Set<() => void>
}

const revStates = new WeakMap<QueryClient, RevState>()

function revState(queryClient: QueryClient): RevState {
  let state = revStates.get(queryClient)
  if (!state) {
    state = { rev: null, sequence: 0, listeners: new Set() }
    revStates.set(queryClient, state)
  }
  return state
}

/** The last library revision this client has seen (null before bootstrap). */
export function knownRev(queryClient: QueryClient): string | null {
  return revState(queryClient).rev
}

/**
 * A counter that moves whenever the known rev changes. A rev poll reads it
 * before sending and passes it to `applyPolledRev`, so an answer that was
 * overtaken by a newer rev (e.g. our own mutation's) can't move it back.
 */
export function revSequence(queryClient: QueryClient): number {
  return revState(queryClient).sequence
}

/** For useSyncExternalStore: changes of the known rev. */
export function subscribeRev(
  queryClient: QueryClient,
  listener: () => void,
): () => void {
  const state = revState(queryClient)
  state.listeners.add(listener)
  return () => {
    state.listeners.delete(listener)
  }
}

/**
 * Records a revision the client just learned and invalidates what changed.
 * Returns true when the rev was new (and something was invalidated).
 *
 * - The first rev ever seen only sets the baseline.
 * - The same rev again does nothing.
 * - A new rev invalidates per `INVALIDATION_MAP[change.kind]`.
 *
 * Callers don't await the refetches; the returned promise is for tests.
 */
export function applyRev(
  queryClient: QueryClient,
  rev: string | null | undefined,
  change: LibraryChange = { kind: 'external' },
): { changed: boolean; settled: Promise<void> } {
  const state = revState(queryClient)
  if (rev === null || rev === undefined || rev === state.rev) {
    return { changed: false, settled: Promise.resolve() }
  }
  const first = state.rev === null
  state.rev = rev
  state.sequence += 1
  for (const listener of state.listeners) {
    listener()
  }
  if (first && change.kind === 'external') {
    return { changed: false, settled: Promise.resolve() }
  }
  if (change.kind !== 'external') {
    // Someone else's change may hide behind our rev (see the top of the
    // file): stale everything rev-dependent, refetch only what the map says.
    void queryClient.invalidateQueries({
      predicate: isRevDependent,
      refetchType: 'none',
    })
  }
  return { changed: true, settled: invalidateFor(queryClient, change) }
}

/**
 * `applyRev` for a rev poll's answer (an `external` change). The answer is
 * ignored when the known rev moved since the poll was sent
 * (`sentAt = revSequence()` then): it may predate that rev, and applying it
 * would move the known rev back and refetch everything for nothing.
 */
export function applyPolledRev(
  queryClient: QueryClient,
  rev: string | null | undefined,
  sentAt: number,
): { changed: boolean; settled: Promise<void> } {
  if (revState(queryClient).sequence !== sentAt) {
    return { changed: false, settled: Promise.resolve() }
  }
  return applyRev(queryClient, rev)
}

/** Forget the known rev (logout, tests). */
export function resetRev(queryClient: QueryClient): void {
  revState(queryClient).rev = null
}

/** True for queries whose data depends on the library revision. */
export function isRevDependent(query: Query): boolean {
  const name = keyResource(query.queryKey)
  return name !== null && REV_DEPENDENT.has(name)
}
