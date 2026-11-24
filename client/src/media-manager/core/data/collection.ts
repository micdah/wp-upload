// The ordered collection (server-api.md §7.3): the single source of order for
// the grid, filmstrip, detail stepping, peek and Save & next.
//
// The response's flat `rows` (`[id, width, height, kindCode] × total`) is
// kept as a `Uint32Array` (spike C5: half the memory of a number[] and a
// cheap copy at 50k), with accessors by index and a lazily built id → index
// map. Snapshots are immutable: optimistic edits make new ones.

import {
  queryOptions,
  type UseQueryResult,
  useQuery,
} from '@tanstack/react-query'
import {
  type CollectionQuery,
  type CollectionResponse,
  MEDIA_KINDS,
  type MediaKind,
  ROW_STRIDE,
} from '../../../../../shared/library-api'
import { libraryApi } from './api'
import { libraryKeys } from './keys'
import { type CollectionParams, normaliseCollectionQuery } from './params'

export interface CollectionSnapshot {
  rev: string
  /** the server's normalised echo of the query */
  query: CollectionQuery
  total: number
  /** `[id, width, height, kindCode] × total`; width/height 0 = unknown */
  rows: Uint32Array
  indexComplete: boolean
}

export function parseCollection(
  response: CollectionResponse,
): CollectionSnapshot {
  return {
    rev: response.rev,
    query: response.query,
    total: response.total,
    rows: Uint32Array.from(response.rows),
    indexComplete: response.indexComplete,
  }
}

export function rowId(snapshot: CollectionSnapshot, index: number): number {
  return snapshot.rows[index * ROW_STRIDE] ?? 0
}

export function rowWidth(snapshot: CollectionSnapshot, index: number): number {
  return snapshot.rows[index * ROW_STRIDE + 1] ?? 0
}

export function rowHeight(snapshot: CollectionSnapshot, index: number): number {
  return snapshot.rows[index * ROW_STRIDE + 2] ?? 0
}

/** Unknown codes (from a newer plugin) read as `other` (server-api.md §5). */
export function rowKind(
  snapshot: CollectionSnapshot,
  index: number,
): MediaKind {
  const code = snapshot.rows[index * ROW_STRIDE + 3] ?? -1
  return MEDIA_KINDS[code] ?? 'other'
}

const positions = new WeakMap<CollectionSnapshot, Map<number, number>>()

/** Index of `id` in the collection, or -1. Builds the map on first use. */
export function positionOf(snapshot: CollectionSnapshot, id: number): number {
  let map = positions.get(snapshot)
  if (!map) {
    map = new Map()
    const { rows, total } = snapshot
    for (let index = 0; index < total; index++) {
      map.set(rows[index * ROW_STRIDE] ?? 0, index)
    }
    positions.set(snapshot, map)
  }
  return map.get(id) ?? -1
}

/** The ids of rows `[start, end)`, clamped to the collection. */
export function idsInRange(
  snapshot: CollectionSnapshot,
  start: number,
  end: number,
): number[] {
  const from = Math.max(0, start)
  const to = Math.min(snapshot.total, end)
  const ids: number[] = []
  for (let index = from; index < to; index++) {
    ids.push(rowId(snapshot, index))
  }
  return ids
}

/** Every id, in order. */
export function allIds(snapshot: CollectionSnapshot): number[] {
  return idsInRange(snapshot, 0, snapshot.total)
}

/** A copy without these ids (optimistic membership removal). */
export function withoutIds(
  snapshot: CollectionSnapshot,
  ids: ReadonlySet<number>,
): CollectionSnapshot {
  const { rows, total } = snapshot
  const kept = new Uint32Array(rows.length)
  let length = 0
  for (let index = 0; index < total; index++) {
    const offset = index * ROW_STRIDE
    if (ids.has(rows[offset] ?? 0)) {
      continue
    }
    kept.set(rows.subarray(offset, offset + ROW_STRIDE), length * ROW_STRIDE)
    length++
  }
  if (length === total) {
    return snapshot
  }
  return {
    ...snapshot,
    total: length,
    rows: kept.slice(0, length * ROW_STRIDE),
  }
}

/** A copy with one row's dimensions replaced (e.g. after an image edit). */
export function withDimensions(
  snapshot: CollectionSnapshot,
  id: number,
  width: number,
  height: number,
): CollectionSnapshot {
  const index = positionOf(snapshot, id)
  if (index < 0) {
    return snapshot
  }
  const rows = snapshot.rows.slice()
  rows[index * ROW_STRIDE + 1] = width
  rows[index * ROW_STRIDE + 2] = height
  return { ...snapshot, rows }
}

export function collectionQueryOptions(query: CollectionQuery) {
  return queryOptions({
    queryKey: libraryKeys.collection(query),
    queryFn: async ({ signal }) =>
      parseCollection(await libraryApi.collection(query, { signal })),
    // Fresh until the rev says otherwise (invalidate.ts).
    staleTime: Number.POSITIVE_INFINITY,
    // 200k numbers: never deep-compare them.
    structuralSharing: false,
  })
}

export interface UseCollectionRowsOptions {
  enabled?: boolean
  /**
   * Keep showing the previous collection while a new query loads (e.g. while
   * typing a search). Off by default: the grid shows skeletons instead.
   */
  keepPrevious?: boolean
}

/**
 * The ordered rows of the collection for these URL params (loose values are
 * normalised; see params.ts). F1's `useCollection()` builds on this.
 */
export function useCollectionRows(
  params: CollectionParams | CollectionQuery,
  options: UseCollectionRowsOptions = {},
): UseQueryResult<CollectionSnapshot> {
  const query = normaliseCollectionQuery(params)
  return useQuery({
    ...collectionQueryOptions(query),
    enabled: options.enabled ?? true,
    placeholderData: options.keepPrevious
      ? (previous: CollectionSnapshot | undefined) => previous
      : undefined,
  })
}
