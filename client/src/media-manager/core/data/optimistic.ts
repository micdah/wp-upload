// Optimistic updates with rollback.
//
// Pattern (what `optimistic()` does for you):
//   1. cancel in-flight fetches of the queries you'll touch, so a late
//      response can't overwrite the optimistic state;
//   2. snapshot them, then apply the change to the cache;
//   3. run the mutation; on failure restore the snapshot, invalidate what
//      it touched (so the server's state wins over a stale snapshot), and
//      rethrow;
//   4. on success the caller applies the response (snapshots, rev) and
//      `applyRev` invalidates what the map says.
//
// The building blocks each return a `Rollback`, so a feature can combine
// them: patch item fields, remove ids from collections (membership), and
// adjust folder counts.

import type { QueryClient, QueryFilters, QueryKey } from '@tanstack/react-query'
import type {
  CollectionQuery,
  FolderTree,
  LibraryItemFull,
  LibraryItemTile,
} from '../../../../../shared/library-api'
import { type CollectionSnapshot, withoutIds } from './collection'
import { cachedItem, updateCachedItems } from './items'
import { LIBRARY_ROOT, libraryKeys } from './keys'

export type Rollback = () => void

/** Fields shared by tiles and full items. */
type SharedFields = Omit<LibraryItemTile, 'id' | 'view'>
/** Fields only full items have. */
type FullOnlyFields = Omit<LibraryItemFull, keyof LibraryItemTile>

export type ItemFieldsPatch = Partial<SharedFields> & Partial<FullOnlyFields>

const FULL_ONLY_FIELDS: ReadonlySet<string> = new Set<keyof FullOnlyFields>([
  'caption',
  'description',
  'author',
  'attachedTo',
  'original',
  'sizes',
  'exif',
  'media',
  'edited',
  'editedAt',
  'undoable',
  'restorable',
  'usageCount',
  'links',
])

/**
 * Restores, in order, the data the filters matched when this was called,
 * then invalidates those filters. The snapshot may be older than other
 * changes that reached the cache since (a refetch, another mutation's
 * response), and restoring it overwrites them; refetching lets the server's
 * state win.
 */
export function snapshotQueries(
  queryClient: QueryClient,
  filtersList: readonly QueryFilters[],
): Rollback {
  const saved: [QueryKey, unknown][] = filtersList.flatMap((filters) =>
    queryClient.getQueriesData(filters),
  )
  return () => {
    for (const [key, data] of saved) {
      queryClient.setQueryData(key, data)
    }
    for (const filters of filtersList) {
      void queryClient.invalidateQueries(filters)
    }
  }
}

/** Runs rollbacks last-in, first-out. */
export function combineRollbacks(rollbacks: readonly Rollback[]): Rollback {
  return () => {
    for (const rollback of [...rollbacks].reverse()) {
      rollback()
    }
  }
}

function itemFilters(ids: readonly number[]): QueryFilters[] {
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

function collectionFilters(
  where: (query: CollectionQuery) => boolean,
): QueryFilters {
  return {
    queryKey: libraryKeys.collections(),
    predicate: (query) => where(query.queryKey[2] as CollectionQuery),
  }
}

/** The filters every building block below touches (for `cancelQueries`). */
export const optimisticTargets = {
  items: itemFilters,
  collections: collectionFilters,
  folders: (): QueryFilters => ({ queryKey: libraryKeys.folders() }),
}

/**
 * Sets fields on every cached copy of these items (both views, every chunk).
 * Full-only fields (caption, description, …) are applied to full items only.
 */
export function patchItems(
  queryClient: QueryClient,
  ids: readonly number[],
  patch: ItemFieldsPatch,
): Rollback {
  const rollback = snapshotQueries(queryClient, itemFilters(ids))
  const shared: Record<string, unknown> = {}
  const fullOnly: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(patch)) {
    if (FULL_ONLY_FIELDS.has(field)) {
      fullOnly[field] = value
    } else {
      shared[field] = value
    }
  }
  updateCachedItems(queryClient, ids, (item) =>
    item.view === 'full'
      ? { ...item, ...shared, ...fullOnly }
      : { ...item, ...shared },
  )
  return rollback
}

/**
 * Removes ids from every cached collection `where` accepts: items moved out
 * of the folder on screen, trashed, deleted or restored out of the Trash.
 */
export function removeFromCollections(
  queryClient: QueryClient,
  ids: readonly number[],
  where: (query: CollectionQuery) => boolean,
): Rollback {
  const filters = collectionFilters(where)
  const rollback = snapshotQueries(queryClient, [filters])
  const wanted = new Set(ids)
  queryClient.setQueriesData<CollectionSnapshot>(filters, (snapshot) =>
    snapshot ? withoutIds(snapshot, wanted) : snapshot,
  )
  return rollback
}

/**
 * Adds `delta` to direct folder counts; key 0 is Uncategorized. `all` is
 * adjusted by `allDelta` (deletes and restores change it, moves don't).
 */
export function adjustFolderCounts(
  queryClient: QueryClient,
  deltas: ReadonlyMap<number, number>,
  allDelta = 0,
): Rollback {
  const rollback = snapshotQueries(queryClient, [
    { queryKey: libraryKeys.folders() },
  ])
  queryClient.setQueryData<FolderTree>(libraryKeys.folders(), (tree) => {
    if (!tree) {
      return tree
    }
    const clamp = (value: number) => Math.max(0, value)
    return {
      ...tree,
      counts: {
        all: clamp(tree.counts.all + allDelta),
        uncategorized: clamp(tree.counts.uncategorized + (deltas.get(0) ?? 0)),
      },
      folders: tree.folders.map((folder) => {
        const delta = deltas.get(folder.id)
        return delta
          ? { ...folder, count: clamp(folder.count + delta) }
          : folder
      }),
    }
  })
  return rollback
}

/** The cached folder of each id, where known (for count deltas and Undo). */
export function cachedFolders(
  queryClient: QueryClient,
  ids: readonly number[],
): Map<number, number> {
  const folders = new Map<number, number>()
  for (const id of ids) {
    const folder = cachedItem(queryClient, id)?.folder
    if (folder !== null && folder !== undefined) {
      folders.set(id, folder)
    }
  }
  return folders
}

function countDeltas(
  from: ReadonlyMap<number, number>,
  to: number | null,
): Map<number, number> {
  const deltas = new Map<number, number>()
  for (const folder of from.values()) {
    if (folder === to) {
      continue
    }
    deltas.set(folder, (deltas.get(folder) ?? 0) - 1)
    if (to !== null) {
      deltas.set(to, (deltas.get(to) ?? 0) + 1)
    }
  }
  return deltas
}

/**
 * Moving items to a folder (0 = Uncategorized): they leave every other
 * folder's collection, their `folder` changes, and counts follow (for the
 * items whose current folder is cached).
 */
export function optimisticMove(
  queryClient: QueryClient,
  ids: readonly number[],
  toFolder: number,
): Rollback {
  const before = cachedFolders(queryClient, ids)
  return combineRollbacks([
    removeFromCollections(
      queryClient,
      ids,
      (query) => typeof query.folder === 'number' && query.folder !== toFolder,
    ),
    patchItems(queryClient, ids, { folder: toFolder }),
    adjustFolderCounts(queryClient, countDeltas(before, toFolder)),
  ])
}

/**
 * Trash or delete: the items leave every collection but the Trash. With
 * `fromTrash` (deleting for good from the Trash view) they leave only the
 * Trash, and folder counts don't change (they exclude trashed items).
 */
export function optimisticRemove(
  queryClient: QueryClient,
  ids: readonly number[],
  options: { fromTrash?: boolean } = {},
): Rollback {
  if (options.fromTrash) {
    return removeFromCollections(
      queryClient,
      ids,
      (query) => query.folder === 'trash',
    )
  }
  const before = cachedFolders(queryClient, ids)
  return combineRollbacks([
    removeFromCollections(
      queryClient,
      ids,
      (query) => query.folder !== 'trash',
    ),
    adjustFolderCounts(queryClient, countDeltas(before, null), -ids.length),
  ])
}

/** Restore from the Trash: the items leave the Trash view. */
export function optimisticRestore(
  queryClient: QueryClient,
  ids: readonly number[],
): Rollback {
  return removeFromCollections(
    queryClient,
    ids,
    (query) => query.folder === 'trash',
  )
}

export interface OptimisticOptions<T> {
  /** what to cancel before applying (see `optimisticTargets`) */
  cancel: readonly QueryFilters[]
  /** apply the optimistic state; return its rollback */
  apply: () => Rollback
  /** the mutation itself */
  run: () => Promise<T>
}

/**
 * Cancel, apply, run; roll back and rethrow on failure. Returns the
 * mutation's result for the caller to apply (and `applyRev`).
 */
export async function optimistic<T>(
  queryClient: QueryClient,
  options: OptimisticOptions<T>,
): Promise<T> {
  await Promise.all(
    options.cancel.map((filters) => queryClient.cancelQueries(filters)),
  )
  const rollback = options.apply()
  try {
    return await options.run()
  } catch (error) {
    rollback()
    throw error
  }
}
