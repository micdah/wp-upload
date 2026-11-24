// The compact collection: `rows` is a flat [id, w, h, kind, id, w, h, kind, …]
// list in collection order (server-api.md §7.3). Decoded once into typed
// columns plus an id → index map, so the grid's layout and every "where is
// this item" lookup stay O(1) at 50k items.

import {
  MEDIA_KINDS,
  type MediaKind,
  ROW_STRIDE,
} from '../../../../../shared/library-api'

export interface CollectionRows {
  readonly length: number
  /** Ids in collection order. */
  readonly ids: readonly number[]
  readonly widths: Uint32Array
  readonly heights: Uint32Array
  /** Index into MEDIA_KINDS; unknown codes read as `other`. */
  readonly kinds: Uint8Array
  indexOf(id: number): number
  kindAt(index: number): MediaKind
  has(id: number): boolean
}

const OTHER_CODE = MEDIA_KINDS.indexOf('other')

export function decodeRows(rows: readonly number[]): CollectionRows {
  const length = Math.floor(rows.length / ROW_STRIDE)
  const ids = new Array<number>(length)
  const widths = new Uint32Array(length)
  const heights = new Uint32Array(length)
  const kinds = new Uint8Array(length)
  const index = new Map<number, number>()
  for (let i = 0; i < length; i += 1) {
    const base = i * ROW_STRIDE
    const id = rows[base] as number
    ids[i] = id
    widths[i] = rows[base + 1] ?? 0
    heights[i] = rows[base + 2] ?? 0
    const kind = rows[base + 3] ?? OTHER_CODE
    kinds[i] = kind >= 0 && kind < MEDIA_KINDS.length ? kind : OTHER_CODE
    index.set(id, i)
  }
  return {
    length,
    ids,
    widths,
    heights,
    kinds,
    indexOf: (id) => index.get(id) ?? -1,
    kindAt: (i) => MEDIA_KINDS[kinds[i] ?? OTHER_CODE] ?? 'other',
    has: (id) => index.has(id),
  }
}

export const EMPTY_ROWS: CollectionRows = decodeRows([])

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
  return rows.ids[index + direction] ?? null
}
