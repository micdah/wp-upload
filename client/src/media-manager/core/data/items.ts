// Item hydration by id (server-api.md §7.5).
//
// The grid asks for the rows it shows in **chunks of at most 100 ids**,
// aligned to the collection order (rows 0–99, 100–199, …), so scrolling back
// and forth reuses the same keys. Each chunk's queryFn seeds the per-id cache
// (`item` keys) with `setQueryData`, so the inspector, detail mode and peek
// read an item the grid already loaded without another request. A full item
// also seeds the tile cache (a tile is a subset of it).
//
// Ids the server reports `missing` (deleted in between) are dropped from the
// cached collections, which are then refetched (server-api.md §7.3).

import {
  type QueryClient,
  queryOptions,
  type UseQueryResult,
  useQueries,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  type ItemView,
  LIMITS,
  type LibraryItemFull,
  type LibraryItemTile,
} from '../../../../../shared/library-api'
import { libraryApi } from './api'
import { type CollectionSnapshot, idsInRange, withoutIds } from './collection'
import type { LibraryError } from './errors'
import { isStaleItemRead, itemReadClock } from './itemWrites'
import { LIBRARY_ROOT, libraryKeys } from './keys'

export const ITEM_CHUNK_SIZE = LIMITS.itemIds

export type ItemOf<V extends ItemView> = V extends 'full'
  ? LibraryItemFull
  : LibraryItemTile

/** What one chunk query holds. `items` follows `ids`, minus `missing`. */
export interface ItemChunk<V extends ItemView = ItemView> {
  rev: string
  ids: readonly number[]
  items: ItemOf<V>[]
  missing: number[]
}

/** Splits ids into request-sized chunks, keeping their order. */
export function chunkIds(
  ids: readonly number[],
  size: number = ITEM_CHUNK_SIZE,
): number[][] {
  const chunks: number[][] = []
  for (let start = 0; start < ids.length; start += size) {
    chunks.push(ids.slice(start, start + size))
  }
  return chunks
}

/**
 * The chunks covering collection rows `[start, end)`, aligned to multiples of
 * `size` so the same rows always make the same chunk keys.
 */
export function alignedChunks(
  snapshot: CollectionSnapshot,
  start: number,
  end: number,
  size: number = ITEM_CHUNK_SIZE,
): number[][] {
  const from = Math.max(0, start)
  const to = Math.min(snapshot.total, end)
  if (to <= from) {
    return []
  }
  const chunks: number[][] = []
  const firstBlock = Math.floor(from / size)
  const lastBlock = Math.floor((to - 1) / size)
  for (let block = firstBlock; block <= lastBlock; block++) {
    chunks.push(idsInRange(snapshot, block * size, (block + 1) * size))
  }
  return chunks
}

/** A tile view of a full item (what `items?view=tile` would have said). */
export function toTile(item: LibraryItemFull): LibraryItemTile {
  return {
    id: item.id,
    view: 'tile',
    kind: item.kind,
    mime: item.mime,
    title: item.title,
    filename: item.filename,
    width: item.width,
    height: item.height,
    filesize: item.filesize,
    alt: item.alt,
    uploadedAt: item.uploadedAt,
    modifiedAt: item.modifiedAt,
    authorId: item.authorId,
    folder: item.folder,
    url: item.url,
    thumb: item.thumb,
    srcset: item.srcset,
    poster: item.poster,
    duration: item.duration,
    pages: item.pages,
    sizesPending: item.sizesPending,
    perms: item.perms,
    trash: item.trash,
  }
}

/**
 * Writes hydrated items into the per-id cache (and the tile cache for full
 * items), records `missing` ids as null, and drops missing ids from the
 * cached collections.
 */
export function seedItems(
  queryClient: QueryClient,
  view: ItemView,
  items: readonly (LibraryItemTile | LibraryItemFull)[],
  missing: readonly number[] = [],
): void {
  for (const item of items) {
    queryClient.setQueryData(libraryKeys.item(view, item.id), item)
    if (item.view === 'full') {
      queryClient.setQueryData(libraryKeys.item('tile', item.id), toTile(item))
    }
  }
  for (const id of missing) {
    queryClient.setQueryData(libraryKeys.item(view, id), null)
  }
  if (missing.length > 0) {
    dropMissingFromCollections(queryClient, missing)
  }
}

/**
 * Splits a read's items into those to seed and what the read should hold.
 * An item one of our writes overlapped (itemWrites.ts) isn't seeded, and the
 * read holds the cached copy instead, so an answer from before the write
 * can't put old values back over the saved ones.
 */
function keepNewerWrites<T extends LibraryItemTile | LibraryItemFull>(
  queryClient: QueryClient,
  view: ItemView,
  items: readonly T[],
  sentAt: number,
): { fresh: T[]; all: T[] } {
  const fresh: T[] = []
  const all: T[] = []
  for (const item of items) {
    if (!isStaleItemRead(queryClient, item.id, sentAt)) {
      fresh.push(item)
      all.push(item)
      continue
    }
    all.push(newerCopy(queryClient, view, item))
  }
  return { fresh, all }
}

/** The cached copy of `item` in its view, else the read with the cache's fields. */
function newerCopy<T extends LibraryItemTile | LibraryItemFull>(
  queryClient: QueryClient,
  view: ItemView,
  item: T,
): T {
  const same = queryClient.getQueryData<T | null>(
    libraryKeys.item(view, item.id),
  )
  if (same) {
    return same
  }
  const other = cachedItem(queryClient, item.id)
  if (!other) {
    return item
  }
  const shared = other.view === 'full' ? toTile(other) : other
  return { ...item, ...shared, view: item.view } as T
}

function dropMissingFromCollections(
  queryClient: QueryClient,
  missing: readonly number[],
): void {
  const ids = new Set(missing)
  queryClient.setQueriesData<CollectionSnapshot>(
    { queryKey: libraryKeys.collections() },
    (snapshot) => (snapshot ? withoutIds(snapshot, ids) : snapshot),
  )
  void queryClient.invalidateQueries({ queryKey: libraryKeys.collections() })
}

/**
 * A chunk made of cached per-id items, when every id is cached and none is
 * invalidated. Lets a re-sorted grid show known items without a request.
 */
function chunkFromCache<V extends ItemView>(
  queryClient: QueryClient,
  view: V,
  ids: readonly number[],
): { chunk: ItemChunk<V>; updatedAt: number } | undefined {
  const items: ItemOf<V>[] = []
  const missing: number[] = []
  let updatedAt = Number.POSITIVE_INFINITY
  for (const id of ids) {
    const state = queryClient.getQueryState<ItemOf<V> | null>(
      libraryKeys.item(view, id),
    )
    if (!state || state.data === undefined || state.isInvalidated) {
      return undefined
    }
    updatedAt = Math.min(updatedAt, state.dataUpdatedAt)
    if (state.data === null) {
      missing.push(id)
    } else {
      items.push(state.data)
    }
  }
  return { chunk: { rev: '', ids, items, missing }, updatedAt }
}

export function itemChunkQueryOptions<V extends ItemView>(
  queryClient: QueryClient,
  view: V,
  ids: readonly number[],
) {
  return queryOptions({
    queryKey: libraryKeys.itemChunk(view, ids),
    queryFn: async ({ signal }): Promise<ItemChunk<V>> => {
      const sentAt = itemReadClock(queryClient)
      const response = await libraryApi.items(ids, view, { signal })
      const { fresh, all } = keepNewerWrites(
        queryClient,
        view,
        response.items as ItemOf<V>[],
        sentAt,
      )
      seedItems(queryClient, view, fresh, response.missing)
      return { rev: response.rev, ids, items: all, missing: response.missing }
    },
    initialData: () => chunkFromCache(queryClient, view, ids)?.chunk,
    initialDataUpdatedAt: () =>
      chunkFromCache(queryClient, view, ids)?.updatedAt,
    staleTime: Number.POSITIVE_INFINITY,
  })
}

export interface HydratedItems<V extends ItemView> {
  /** every item the chunks hold, by id */
  items: ReadonlyMap<number, ItemOf<V>>
  /** ids the server no longer knows */
  missing: ReadonlySet<number>
  /** some chunk has no data yet */
  pending: boolean
  fetching: boolean
  errors: LibraryError[]
}

function combineChunks<V extends ItemView>(
  results: UseQueryResult<ItemChunk<V>, LibraryError>[],
): HydratedItems<V> {
  const items = new Map<number, ItemOf<V>>()
  const missing = new Set<number>()
  const errors: LibraryError[] = []
  let pending = false
  let fetching = false
  for (const result of results) {
    if (result.data) {
      for (const item of result.data.items) {
        items.set(item.id, item)
      }
      for (const id of result.data.missing) {
        missing.add(id)
      }
    } else {
      pending = true
    }
    if (result.isFetching) {
      fetching = true
    }
    if (result.error) {
      errors.push(result.error)
    }
  }
  return { items, missing, pending, fetching, errors }
}

/**
 * Hydrates the given chunks (from `alignedChunks` or `chunkIds`). The grid
 * passes the chunks around its visible range; each tile then reads
 * `items.get(id)`.
 */
export function useItemChunks<V extends ItemView = 'tile'>(
  chunks: readonly (readonly number[])[],
  view: V = 'tile' as V,
): HydratedItems<V> {
  const queryClient = useQueryClient()
  return useQueries({
    queries: chunks.map((ids) => itemChunkQueryOptions(queryClient, view, ids)),
    combine: combineChunks<V>,
  })
}

export function itemQueryOptions<V extends ItemView>(
  queryClient: QueryClient,
  view: V,
  id: number,
) {
  return queryOptions({
    queryKey: libraryKeys.item(view, id),
    queryFn: async ({ signal }): Promise<ItemOf<V> | null> => {
      const sentAt = itemReadClock(queryClient)
      const response = await libraryApi.items([id], view, { signal })
      const { fresh, all } = keepNewerWrites(
        queryClient,
        view,
        response.items as ItemOf<V>[],
        sentAt,
      )
      seedItems(queryClient, view, fresh, response.missing)
      return all[0] ?? null
    },
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/**
 * One item; `null` once the server says it is missing. The inspector and
 * detail mode use `view: 'full'`; a tile the grid loaded comes from cache.
 */
export function useItem<V extends ItemView = 'tile'>(
  id: number | null,
  view: V = 'tile' as V,
): UseQueryResult<ItemOf<V> | null, LibraryError> {
  const queryClient = useQueryClient()
  return useQuery({
    ...itemQueryOptions(queryClient, view, id ?? 0),
    enabled: id !== null && id > 0,
  })
}

/** The cached item (either view's shared fields), without fetching. */
export function cachedItem(
  queryClient: QueryClient,
  id: number,
): LibraryItemFull | LibraryItemTile | null | undefined {
  return (
    queryClient.getQueryData<LibraryItemFull | null>(
      libraryKeys.item('full', id),
    ) ??
    queryClient.getQueryData<LibraryItemTile | null>(
      libraryKeys.item('tile', id),
    )
  )
}

type AnyItem = LibraryItemTile | LibraryItemFull

/**
 * Applies `update` to every cached copy of these items: per-id entries of
 * both views and every chunk that holds them. Returns nothing; for rollback
 * use optimistic.ts, which snapshots first.
 */
export function updateCachedItems(
  queryClient: QueryClient,
  ids: readonly number[],
  update: <T extends AnyItem>(item: T) => T,
): void {
  const wanted = new Set(ids)
  for (const id of wanted) {
    for (const view of ['tile', 'full'] as const) {
      queryClient.setQueryData<AnyItem | null>(
        libraryKeys.item(view, id),
        (item) => (item ? update(item) : item),
      )
    }
  }
  queryClient.setQueriesData<ItemChunk>(
    {
      queryKey: [LIBRARY_ROOT, 'items'],
      predicate: (query) =>
        (query.queryKey[3] as readonly number[]).some((id) => wanted.has(id)),
    },
    (chunk) => {
      if (!chunk) {
        return chunk
      }
      let changed = false
      const items = chunk.items.map((item) => {
        if (!wanted.has(item.id)) {
          return item
        }
        changed = true
        return update(item)
      })
      return changed ? { ...chunk, items } : chunk
    },
  )
}
