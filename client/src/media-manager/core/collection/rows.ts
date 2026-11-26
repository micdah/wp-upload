// The compact collection, as views read it. The data layer (core/data, spike
// C5) holds the rows once, as a `Uint32Array` with stride 4
// (`[id, width, height, kindCode] × total`); this is a thin view over that
// snapshot, not a second decode. Index lookups use the snapshot's lazily
// built id → index map, and the `ids` array (what the selection rules take)
// is built once per snapshot, on first read.

import type { MediaKind } from '../../../../../shared/library-api'
import {
  type CollectionSnapshot,
  positionOf,
  rowHeight,
  rowId,
  rowKind,
  rowWidth,
} from '../data/collection'

export interface CollectionRows {
  /** The data layer's snapshot (the grid lays out `snapshot.rows` directly). */
  readonly snapshot: CollectionSnapshot
  readonly length: number
  /** Ids in collection order; built on first read, once per snapshot. */
  readonly ids: readonly number[]
  idAt(index: number): number
  widthAt(index: number): number
  heightAt(index: number): number
  /** Unknown codes (from a newer plugin) read as `other`. */
  kindAt(index: number): MediaKind
  /** Index of `id`, or -1. */
  indexOf(id: number): number
  has(id: number): boolean
}

const views = new WeakMap<CollectionSnapshot, CollectionRows>()

function allIdsOf(snapshot: CollectionSnapshot): number[] {
  const ids = new Array<number>(snapshot.total)
  for (let index = 0; index < snapshot.total; index += 1) {
    ids[index] = rowId(snapshot, index)
  }
  return ids
}

/** The view of a snapshot; the same object for the same snapshot. */
export function rowsOf(snapshot: CollectionSnapshot): CollectionRows {
  let view = views.get(snapshot)
  if (view) {
    return view
  }
  let ids: number[] | null = null
  view = {
    snapshot,
    length: snapshot.total,
    get ids() {
      ids ??= allIdsOf(snapshot)
      return ids
    },
    idAt: (index) => rowId(snapshot, index),
    widthAt: (index) => rowWidth(snapshot, index),
    heightAt: (index) => rowHeight(snapshot, index),
    kindAt: (index) => rowKind(snapshot, index),
    indexOf: (id) => positionOf(snapshot, id),
    has: (id) => positionOf(snapshot, id) !== -1,
  }
  views.set(snapshot, view)
  return view
}

const EMPTY_SNAPSHOT: CollectionSnapshot = {
  rev: '',
  query: {
    folder: 'all',
    q: null,
    type: null,
    alt: null,
    size: null,
    orient: null,
    month: null,
    sort: 'date-desc',
  },
  total: 0,
  rows: new Uint32Array(0),
  indexComplete: true,
}

export const EMPTY_ROWS: CollectionRows = rowsOf(EMPTY_SNAPSHOT)

/** The neighbour of `id` in collection order (detail stepping), or null at the ends. */
export function neighbourOf(
  rows: CollectionRows,
  id: number,
  direction: 1 | -1,
): number | null {
  const index = rows.indexOf(id)
  if (index === -1) {
    return null
  }
  const next = index + direction
  if (next < 0 || next >= rows.length) {
    return null
  }
  return rows.idAt(next)
}

/** Where detail last saw its item in a collection (for stepStart). */
export interface DetailPosition {
  id: number
  index: number
  /** The collection query it was seen in (queryKeyOf). */
  query: string
}

/** A stable key for a collection query (the one the client asked for). */
export function queryKeyOf(query: unknown): string {
  return JSON.stringify(query)
}

/**
 * Where detail stepping goes from `id` (D34: no wrap-around):
 * - `{ next }`: the neighbour's id;
 * - `{ edge: true }`: at an end of the collection;
 * - `null`: nowhere, the item isn't in this collection and wasn't seen in it.
 *
 * An item that just left the view (e.g. `?alt=missing` and its alt text
 * was saved) steps from where it was: the item now in its slot is next,
 * the one before it previous. `last` is that remembered position; it
 * counts only in the same query (`queryKey`, from queryKeyOf).
 */
export function stepFrom(
  rows: CollectionRows,
  id: number,
  direction: 1 | -1,
  last: DetailPosition | null,
  queryKey: string,
): { next: number } | { edge: true } | null {
  const index = rows.indexOf(id)
  let target: number
  if (index >= 0) {
    target = index + direction
  } else if (last && last.id === id && last.query === queryKey) {
    target = direction === 1 ? last.index : last.index - 1
  } else {
    return null
  }
  if (target < 0 || target >= rows.length) {
    return { edge: true }
  }
  return { next: rows.idAt(target) }
}
