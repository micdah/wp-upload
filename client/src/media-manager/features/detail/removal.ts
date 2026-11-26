// What detail does when the item on stage leaves the view (system.md §4
// "After any removal", folders.md §11). Pure, so it is tested in Node.

import type { CollectionQuery } from '../../../../../shared/library-api'
import type { CollectionRows } from '../../core/collection/rows'

/** The fields of an item the rule reads. */
export interface RemovalItem {
  folder: number | null
  trash: unknown | null
}

/**
 * Whether the item on stage was removed from the view: deleted or missing,
 * trashed, removed from (or moved out of) the folder on view, or restored
 * out of the Trash view. An item that only stopped matching a filter (alt
 * text saved under Missing alt) wasn't: it stays on stage and steps on from
 * its place (M2).
 */
export function wasRemoved(
  item: RemovalItem | null,
  missing: boolean,
  folder: CollectionQuery['folder'],
): boolean {
  if (missing) return true
  if (!item) return false
  if (folder === 'trash') return item.trash === null
  if (item.trash !== null) return true
  return (
    typeof folder === 'number' && item.folder !== null && item.folder !== folder
  )
}

/**
 * The item to show once the one on stage left the view: the first of the
 * items that followed it (in the rows it was last seen in) still in the
 * view, else the nearest one before it, so a batch removal lands on the
 * real successor. Null when the view is empty.
 */
export function successorIn(
  rows: CollectionRows,
  seen: { index: number; rows: CollectionRows },
): number | null {
  for (let index = seen.index + 1; index < seen.rows.length; index += 1) {
    const candidate = seen.rows.idAt(index)
    if (rows.has(candidate)) return candidate
  }
  for (let index = seen.index - 1; index >= 0; index -= 1) {
    const candidate = seen.rows.idAt(index)
    if (rows.has(candidate)) return candidate
  }
  if (rows.length === 0) return null
  return rows.idAt(Math.min(seen.index, rows.length - 1))
}
