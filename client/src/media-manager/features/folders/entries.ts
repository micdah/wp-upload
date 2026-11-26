// The folder column's rows, top to bottom (folders.md §2): All files,
// Uncategorized and the Trash stub, a separator, then the folder tree with
// the inline "new folder" input (or the pending row while a create runs).
// Pure, so the ARIA numbers and the placement of the input row are
// unit-tested; the tree component virtualises this list.

import type { FolderRef } from '../../../../../shared/library-api'
import {
  type FolderIndex,
  type FolderRow,
  type FolderSort,
  flattenVisible,
  ROOT_ID,
  searchFolders,
} from './model'
import type { Editing } from './store'

interface EntryBase {
  /** stable key for React and the virtualiser */
  key: string
}

interface TreeItemFields {
  level: number
  posInSet: number
  setSize: number
}

export type PseudoKind = 'all' | 'uncategorized' | 'trash'

export type TreeEntry =
  | (EntryBase &
      TreeItemFields & {
        kind: PseudoKind
        ref: FolderRef
      })
  | (EntryBase & { kind: 'separator' })
  | (EntryBase &
      TreeItemFields & {
        kind: 'folder'
        ref: number
        row: FolderRow
        /** a search match (its name is marked) */
        match: boolean
      })
  | (EntryBase &
      TreeItemFields & {
        /** the inline name input of a new folder */
        kind: 'new'
        parent: number
      })
  | (EntryBase &
      TreeItemFields & {
        /** a create that was sent and not answered yet */
        kind: 'pending'
        parent: number
        name: string
      })

export type TreeItemEntry = Exclude<TreeEntry, { kind: 'separator' }>

export interface EntryInput {
  index: FolderIndex
  expanded: ReadonlySet<number>
  sort: FolderSort
  search: string
  editing: Editing | null
  pendingCreate: { parent: number; name: string } | null
  /** show the Trash row (bootstrap: trash on) */
  trash: boolean
}

export interface EntryList {
  entries: TreeEntry[]
  /** a search is active */
  searching: boolean
  /** folders whose names match the search */
  matchCount: number
  /** there are no folders at all */
  noFolders: boolean
}

/** The row a treeitem stands for, as a key for lookups. */
export function rowKey(ref: FolderRef): string {
  return String(ref)
}

/**
 * Where an extra child row (the name input, or the pending create) goes:
 * right after the last visible row of `parent`'s subtree, one level deeper.
 * Returns the insertion index into `rows` and the level, or null when the
 * parent isn't visible.
 */
function childSlot(
  rows: readonly FolderRow[],
  parent: number,
): { at: number; level: number } | null {
  if (parent === ROOT_ID) {
    return { at: rows.length, level: 1 }
  }
  const start = rows.findIndex((row) => row.id === parent)
  if (start === -1) {
    return null
  }
  const parentLevel = (rows[start] as FolderRow).level
  let end = start + 1
  while (end < rows.length && (rows[end] as FolderRow).level > parentLevel) {
    end += 1
  }
  return { at: end, level: parentLevel + 1 }
}

export function buildEntries(input: EntryInput): EntryList {
  const search = searchFolders(input.index, input.search)
  const rows = flattenVisible(input.index, input.expanded, {
    sort: input.sort,
    only: search?.visible ?? null,
  })
  // The extra row under a parent: the name input, else a pending create.
  const extra =
    input.editing?.mode === 'new' && !search
      ? { kind: 'new' as const, parent: input.editing.parent, name: '' }
      : input.pendingCreate && !search
        ? {
            kind: 'pending' as const,
            parent: input.pendingCreate.parent,
            name: input.pendingCreate.name,
          }
        : null
  const slot = extra ? childSlot(rows, extra.parent) : null

  const pseudo: PseudoKind[] = search
    ? []
    : input.trash
      ? ['all', 'uncategorized', 'trash']
      : ['all', 'uncategorized']
  const topLevel =
    rows.filter((row) => row.level === 1).length + (slot?.level === 1 ? 1 : 0)
  const levelOneSize = pseudo.length + topLevel

  const entries: TreeEntry[] = pseudo.map((kind, position) => ({
    key: kind,
    kind,
    ref: kind === 'all' ? 'all' : kind === 'trash' ? 'trash' : ROOT_ID,
    level: 1,
    posInSet: position + 1,
    setSize: levelOneSize,
  }))
  if (pseudo.length > 0 && (rows.length > 0 || slot)) {
    entries.push({ key: 'separator', kind: 'separator' })
  }

  // The extra row's siblings get one more in their set.
  const extraParent = slot ? (extra?.parent ?? null) : null
  const extraSetSize =
    slot && extraParent !== null
      ? rows.filter((row) => row.parent === extraParent).length + 1
      : 0

  const pushExtra = () => {
    if (!slot || !extra) {
      return
    }
    const fields = {
      level: slot.level,
      posInSet: extraSetSize + (slot.level === 1 ? pseudo.length : 0),
      setSize: slot.level === 1 ? levelOneSize : extraSetSize,
    }
    if (extra.kind === 'new') {
      entries.push({ key: 'new', kind: 'new', parent: extra.parent, ...fields })
    } else {
      entries.push({
        key: 'pending',
        kind: 'pending',
        parent: extra.parent,
        name: extra.name,
        ...fields,
      })
    }
  }

  rows.forEach((row, position) => {
    if (slot && slot.at === position) {
      pushExtra()
    }
    const isExtraParent = extraParent !== null && row.id === extraParent
    const siblingsGrow = extraParent !== null && row.parent === extraParent
    entries.push({
      key: `f${row.id}`,
      kind: 'folder',
      ref: row.id,
      // The parent of the name input shows open, with a child.
      row: isExtraParent ? { ...row, hasChildren: true, expanded: true } : row,
      match: search?.matches.has(row.id) ?? false,
      level: row.level,
      posInSet: row.level === 1 ? row.posInSet + pseudo.length : row.posInSet,
      setSize:
        row.level === 1
          ? levelOneSize
          : siblingsGrow
            ? row.setSize + 1
            : row.setSize,
    })
  })
  if (slot && slot.at === rows.length) {
    pushExtra()
  }

  return {
    entries,
    searching: search !== null,
    matchCount: search?.matches.size ?? 0,
    noFolders: input.index.byId.size === 0,
  }
}

/** The treeitems only (keyboard navigation skips the separator). */
export function treeItems(entries: readonly TreeEntry[]): TreeItemEntry[] {
  return entries.filter(
    (entry): entry is TreeItemEntry => entry.kind !== 'separator',
  )
}

/** The row an entry stands for, or null for the input and pending rows. */
export function entryRef(entry: TreeEntry): FolderRef | null {
  if (
    entry.kind === 'folder' ||
    entry.kind === 'all' ||
    entry.kind === 'uncategorized' ||
    entry.kind === 'trash'
  ) {
    return entry.ref
  }
  return null
}
