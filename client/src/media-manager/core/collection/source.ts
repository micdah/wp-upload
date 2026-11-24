// The data seam of core/collection: the only file here that fetches.
//
// TEMPORARY (M1): track F2 builds the real data layer (core/data: http over
// apiFetch, query keys, rev-keyed invalidation, item chunk hydration with
// setQueryData seeding) in parallel. Until it merges, this file talks to
// `api/library/*` with a minimal TanStack Query setup of its own, under its
// own query-key prefix so it can't collide with F2's cache. At integration
// these two hooks delegate to F2's hooks and the rest of core/collection
// stays as it is (see tracks/F1-handoff.md).

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type {
  ApiError,
  CollectionQuery,
  CollectionResponse,
  ItemsFullResponse,
  ItemsTileResponse,
  ItemView,
  LibraryItemFull,
  LibraryItemTile,
} from '../../../../../shared/library-api'
import { LIMITS } from '../../../../../shared/library-api'
import { apiFetch } from '../../../lib/api'
import { collectionSearch } from '../url/codec'

const KEY_PREFIX = 'mm-core-temp'

export class LibraryRequestError extends Error {
  readonly status: number
  readonly code: string
  constructor(status: number, body: ApiError | null) {
    super(body?.message ?? `Server responded with HTTP ${status}.`)
    this.status = status
    this.code = body?.code ?? 'http_error'
  }
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await apiFetch(url, {
    signal,
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) {
    let body: ApiError | null = null
    try {
      body = (await response.json()) as ApiError
    } catch {
      // Non-JSON error page.
    }
    throw new LibraryRequestError(response.status, body)
  }
  return (await response.json()) as T
}

export function useCollectionResponse(query: CollectionQuery) {
  return useQuery({
    queryKey: [KEY_PREFIX, 'collection', query],
    queryFn: ({ signal }) => {
      const search = collectionSearch(query)
      return getJson<CollectionResponse>(
        `api/library/collection${search ? `?${search}` : ''}`,
        signal,
      )
    },
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  })
}

// Item hydration: ids asked for in the same tick are fetched together, in
// chunks of at most LIMITS.itemIds.

type ItemOf<V extends ItemView> = V extends 'full'
  ? LibraryItemFull
  : LibraryItemTile

interface Waiter {
  resolve(item: LibraryItemTile | LibraryItemFull | null): void
  reject(error: unknown): void
}

const waiting: Record<ItemView, Map<number, Waiter[]>> = {
  tile: new Map(),
  full: new Map(),
}
const scheduled: Record<ItemView, boolean> = { tile: false, full: false }

async function fetchChunk(view: ItemView, ids: number[]): Promise<void> {
  const waiters = ids.map((id) => {
    const list = waiting[view].get(id) ?? []
    waiting[view].delete(id)
    return [id, list] as const
  })
  try {
    const response = await getJson<ItemsTileResponse | ItemsFullResponse>(
      `api/library/items?ids=${ids.join(',')}&view=${view}`,
    )
    const byId = new Map<number, LibraryItemTile | LibraryItemFull>()
    for (const item of response.items) {
      byId.set(item.id, item)
    }
    for (const [id, list] of waiters) {
      for (const waiter of list) {
        waiter.resolve(byId.get(id) ?? null)
      }
    }
  } catch (error) {
    for (const [, list] of waiters) {
      for (const waiter of list) {
        waiter.reject(error)
      }
    }
  }
}

function flush(view: ItemView): void {
  scheduled[view] = false
  const ids = [...waiting[view].keys()]
  for (let start = 0; start < ids.length; start += LIMITS.itemIds) {
    void fetchChunk(view, ids.slice(start, start + LIMITS.itemIds))
  }
}

function loadItem<V extends ItemView>(
  view: V,
  id: number,
): Promise<ItemOf<V> | null> {
  return new Promise((resolve, reject) => {
    const list = waiting[view].get(id) ?? []
    list.push({ resolve: resolve as Waiter['resolve'], reject })
    waiting[view].set(id, list)
    if (!scheduled[view]) {
      scheduled[view] = true
      setTimeout(() => flush(view), 0)
    }
  })
}

export function useItemData<V extends ItemView>(id: number | null, view: V) {
  return useQuery({
    queryKey: [KEY_PREFIX, 'item', view, id],
    queryFn: () => loadItem(view, id as number),
    enabled: id !== null,
    staleTime: 15_000,
  })
}
