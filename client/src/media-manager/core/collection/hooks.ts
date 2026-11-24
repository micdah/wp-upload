// useCollection(), useItem(), useTargets(): the collection every view walks
// (interaction-spec §1: grid, filmstrip, ←/→ in detail, peek and Save & next
// all use the same ordered list).

import { useEffect, useMemo } from 'react'
import { useShallow } from 'zustand/shallow'
import type {
  CollectionQuery,
  ItemView,
  LibraryItemFull,
  LibraryItemTile,
} from '../../../../../shared/library-api'
import { notifyCommandsChanged } from '../commands/registry'
import { useCore } from '../state'
import { hiddenSelectedCount, targetIds } from '../state/selection'
import { collectionQueryOf } from '../url/codec'
import { useUrlState } from '../url/useUrlState'
import { type CollectionRows, decodeRows, EMPTY_ROWS } from './rows'
import { useCollectionResponse, useItemData } from './source'

export interface CollectionView {
  status: 'pending' | 'error' | 'success'
  /** True while showing the previous query's rows (a new query is loading). */
  isPlaceholder: boolean
  query: CollectionQuery
  rev: string | null
  total: number
  rows: CollectionRows
  /** Ids in collection order (same as rows.ids). */
  ids: readonly number[]
  indexComplete: boolean
  error: unknown
}

const decodedCache = new WeakMap<readonly number[], CollectionRows>()

function decodeOnce(rows: readonly number[]): CollectionRows {
  let decoded = decodedCache.get(rows)
  if (!decoded) {
    decoded = decodeRows(rows)
    decodedCache.set(rows, decoded)
  }
  return decoded
}

let current: CollectionView | null = null

/**
 * The latest collection the app shows, for code outside React (commands
 * such as select-all and detail stepping). The shell keeps it current.
 */
export function getCurrentCollection(): CollectionView | null {
  return current
}

/** The collection for the URL's current folder, filters and sort. */
export function useCollection(): CollectionView {
  const query = useUrlState(collectionQueryKey)
  const parsed = useMemo(() => JSON.parse(query) as CollectionQuery, [query])
  const result = useCollectionResponse(parsed)
  const data = result.data
  const rows = data ? decodeOnce(data.rows) : EMPTY_ROWS
  return useMemo(
    () => ({
      status: result.status,
      isPlaceholder: result.isPlaceholderData,
      query: parsed,
      rev: data?.rev ?? null,
      total: data?.total ?? 0,
      rows,
      ids: rows.ids,
      indexComplete: data?.indexComplete ?? true,
      error: result.error,
    }),
    [result.status, result.isPlaceholderData, result.error, parsed, data, rows],
  )
}

/** A stable string key for the URL's collection query (selector-safe). */
function collectionQueryKey(
  state: Parameters<typeof collectionQueryOf>[0],
): string {
  return JSON.stringify(collectionQueryOf(state))
}

/**
 * Publishes the collection for getCurrentCollection(). Mount once (the shell
 * does). Commands read it in `available()` (select all, ←/→ in detail), so
 * they are told to re-check: on a deep link into detail, the collection
 * arrives after the buttons first rendered.
 */
export function useTrackCurrentCollection(): CollectionView {
  const view = useCollection()
  useEffect(() => {
    current = view
    notifyCommandsChanged()
  }, [view])
  return view
}

export interface ItemResult<V extends ItemView> {
  item: (V extends 'full' ? LibraryItemFull : LibraryItemTile) | null
  status: 'pending' | 'error' | 'success'
  /** The item is gone (deleted, or not visible to this user). */
  missing: boolean
}

/** One item, hydrated on demand (batched with other ids asked for at once). */
export function useItem<V extends ItemView = 'tile'>(
  id: number | null,
  view?: V,
): ItemResult<V> {
  const result = useItemData(id, (view ?? 'tile') as V)
  return {
    item: (result.data ?? null) as ItemResult<V>['item'],
    status: id === null ? 'success' : result.status,
    missing: result.status === 'success' && result.data === null,
  }
}

export interface Targets {
  /** The selection in collection order (then hidden ones), or the focused item. */
  ids: number[]
  source: 'selection' | 'focus' | 'none'
  /** Selected ids the current filters hide. */
  hidden: number
}

/** What actions and the inspector apply to (interaction-spec §1 "Targets"). */
export function useTargets(): Targets {
  const { ids: order } = useCollection()
  const selection = useCore(
    useShallow((state) => ({
      selection: state.selection,
      anchor: state.anchor,
      focus: state.focus,
    })),
  )
  return useMemo(() => {
    const ids = targetIds(selection, order)
    const source =
      selection.selection.size > 0
        ? 'selection'
        : selection.focus === null
          ? 'none'
          : 'focus'
    return { ids, source, hidden: hiddenSelectedCount(selection, order) }
  }, [selection, order])
}
