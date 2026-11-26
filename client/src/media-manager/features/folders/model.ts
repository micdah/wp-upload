// The folder tree's pure model (folders.md §1–§8). No React, no DOM, no drag
// and drop library: the column, the drop targets and the Move dialog call
// into this module, so every rule is unit-tested in Node.
//
// Lifted from spike C3 (tracks/spikes/C3.md, its `folderTree.ts`)
// and extended with what the column needs beyond the spike:
//
// - indexFolders / flattenVisible: the API's flat list as the rows a
//   virtualiser renders, with the ARIA fields, a display sort (FileBird Pro's
//   name order) and a search filter that keeps ancestors visible;
// - folderDropAvailability / resolveFolderMove / applyFolderMove: drops as
//   the API's `{ parent, position }`, with the cycle rule;
// - searchFolders, nestedCounts, descendantIds, folderPath, cleanFolderName:
//   search, the two count modes, the delete confirm's numbers, the Move
//   dialog's paths, and FileBird's name normalisation.

import type {
  Folder,
  FolderUpdateRequest,
} from '../../../../../shared/library-api'

/** The top level's parent id, as in the API (`Folder.parent`). */
export const ROOT_ID = 0

/** FileBird's longest folder name (server-api.md §7.11). */
export const MAX_FOLDER_NAME_LENGTH = 200

/** Sibling order: FileBird's manual `ord`, or Pro's name sort (A–Z / Z–A). */
export const FOLDER_SORTS = ['manual', 'name-asc', 'name-desc'] as const
export type FolderSort = (typeof FOLDER_SORTS)[number]

/** Count files directly in a folder, or in its subfolders too. */
export const COUNT_MODES = ['direct', 'nested'] as const
export type CountMode = (typeof COUNT_MODES)[number]

/** The folder list as a tree. Children are in manual order (`ord`, then `id`). */
export interface FolderIndex {
  byId: ReadonlyMap<number, Folder>
  /** parent id → children in order; ROOT_ID holds the top level */
  children: ReadonlyMap<number, readonly Folder[]>
}

/** One visible row of the flattened tree (what the virtualiser renders). */
export interface FolderRow {
  id: number
  folder: Folder
  /** row index in the visible list */
  index: number
  /** aria-level: 1 = top level */
  level: number
  /** the parent the row is displayed under (ROOT_ID for the top level) */
  parent: number
  /** aria-posinset: 1-based position among its visible siblings */
  posInSet: number
  /** aria-setsize: number of visible siblings, itself included */
  setSize: number
  hasChildren: boolean
  /** expanded and has (visible) children; an empty folder is never "expanded" */
  expanded: boolean
}

function byOrder(a: Folder, b: Folder): number {
  return a.ord - b.ord || a.id - b.id
}

/** Natural, case-insensitive name order ("Event 2" before "Event 10"). */
export const compareNames: (a: string, b: string) => number = new Intl.Collator(
  undefined,
  { numeric: true, sensitivity: 'base' },
).compare

/**
 * Indexes the flat list. A folder whose parent is missing from the list (an
 * orphan, which FileBird can leave behind) is shown at the top level, so it
 * stays reachable instead of vanishing.
 */
export function indexFolders(folders: readonly Folder[]): FolderIndex {
  const byId = new Map<number, Folder>()
  for (const folder of folders) {
    byId.set(folder.id, folder)
  }
  const children = new Map<number, Folder[]>()
  for (const folder of folders) {
    const parent = byId.has(folder.parent) ? folder.parent : ROOT_ID
    const siblings = children.get(parent)
    if (siblings) {
      siblings.push(folder)
    } else {
      children.set(parent, [folder])
    }
  }
  for (const siblings of children.values()) {
    siblings.sort(byOrder)
  }
  return { byId, children }
}

/** The parent a folder is displayed under (orphans: the top level). */
export function displayParent(index: FolderIndex, id: number): number {
  const folder = index.byId.get(id)
  if (!folder) {
    return ROOT_ID
  }
  return index.byId.has(folder.parent) ? folder.parent : ROOT_ID
}

/** Siblings in display order: manual, or by name with Pro's sort. */
export function sortSiblings(
  siblings: readonly Folder[],
  sort: FolderSort,
): readonly Folder[] {
  if (sort === 'manual') {
    return siblings
  }
  const sorted = [...siblings].sort(
    (a, b) => compareNames(a.name, b.name) || a.id - b.id,
  )
  return sort === 'name-desc' ? sorted.reverse() : sorted
}

export interface FlattenOptions {
  /** Display order of siblings. Default `manual`. */
  sort?: FolderSort
  /**
   * Only these folders are shown (a search: the matches and their
   * ancestors), and every shown folder with shown children is expanded,
   * whatever `expanded` says, so the saved expansion stays untouched.
   */
  only?: ReadonlySet<number> | null
}

/**
 * The visible rows, depth first, given which folders are expanded. Iterative,
 * so a deep chain can't overflow the stack, and guarded against a corrupt
 * list with a parent cycle (each folder is emitted at most once).
 */
export function flattenVisible(
  index: FolderIndex,
  expanded: ReadonlySet<number>,
  options: FlattenOptions = {},
): FolderRow[] {
  const { sort = 'manual', only = null } = options
  const childrenOf = (id: number): readonly Folder[] => {
    const all = index.children.get(id) ?? []
    const shown = only ? all.filter((folder) => only.has(folder.id)) : all
    return sortSiblings(shown, sort)
  }
  const rows: FolderRow[] = []
  const seen = new Set<number>()
  // A stack of sibling lists with a cursor, instead of recursion.
  const stack: Array<{
    siblings: readonly Folder[]
    next: number
    level: number
    parent: number
  }> = []
  const top = childrenOf(ROOT_ID)
  if (top.length > 0) {
    stack.push({ siblings: top, next: 0, level: 1, parent: ROOT_ID })
  }
  while (stack.length > 0) {
    const frame = stack[stack.length - 1] as (typeof stack)[number]
    const folder = frame.siblings[frame.next]
    if (!folder) {
      stack.pop()
      continue
    }
    frame.next += 1
    if (seen.has(folder.id)) {
      continue
    }
    seen.add(folder.id)
    const children = childrenOf(folder.id)
    const hasChildren = children.length > 0
    const isExpanded = hasChildren && (only !== null || expanded.has(folder.id))
    rows.push({
      id: folder.id,
      folder,
      index: rows.length,
      level: frame.level,
      parent: frame.parent,
      posInSet: frame.next,
      setSize: frame.siblings.length,
      hasChildren,
      expanded: isExpanded,
    })
    if (isExpanded) {
      stack.push({
        siblings: children,
        next: 0,
        level: frame.level + 1,
        parent: folder.id,
      })
    }
  }
  return rows
}

/** Ancestor ids, nearest first (not including `id`). */
export function ancestorsOf(index: FolderIndex, id: number): number[] {
  const ancestors: number[] = []
  let current = displayParent(index, id)
  // Stops at the top, or when a corrupt parent cycle comes back around.
  while (
    current !== ROOT_ID &&
    current !== id &&
    !ancestors.includes(current)
  ) {
    ancestors.push(current)
    current = displayParent(index, current)
  }
  return ancestors
}

/** True if `id` is `rootId` or lies anywhere inside `rootId`'s subtree. */
export function isSelfOrDescendant(
  index: FolderIndex,
  rootId: number,
  id: number,
): boolean {
  return id === rootId || ancestorsOf(index, id).includes(rootId)
}

/** Every folder inside `id`'s subtree (not `id` itself), depth first. */
export function descendantIds(index: FolderIndex, id: number): number[] {
  const ids: number[] = []
  const seen = new Set<number>([id])
  const stack = [...(index.children.get(id) ?? [])].reverse()
  while (stack.length > 0) {
    const folder = stack.pop() as Folder
    if (seen.has(folder.id)) {
      continue
    }
    seen.add(folder.id)
    ids.push(folder.id)
    const children = index.children.get(folder.id) ?? []
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push(children[i] as Folder)
    }
  }
  return ids
}

/** Files directly in the folder and in every subfolder. */
export function subtreeFileCount(index: FolderIndex, id: number): number {
  let total = index.byId.get(id)?.count ?? 0
  for (const descendant of descendantIds(index, id)) {
    total += index.byId.get(descendant)?.count ?? 0
  }
  return total
}

/**
 * Every folder's count including its subfolders ("Count files in subfolders
 * too"). One pass bottom-up, so 5k folders cost one walk.
 */
export function nestedCounts(index: FolderIndex): Map<number, number> {
  const totals = new Map<number, number>()
  // Children before parents: a post-order walk from the top level.
  const order: number[] = []
  const seen = new Set<number>()
  const stack: Array<{ id: number; done: boolean }> = (
    index.children.get(ROOT_ID) ?? []
  ).map((folder) => ({ id: folder.id, done: false }))
  while (stack.length > 0) {
    const frame = stack.pop() as { id: number; done: boolean }
    if (frame.done) {
      order.push(frame.id)
      continue
    }
    if (seen.has(frame.id)) {
      continue
    }
    seen.add(frame.id)
    stack.push({ id: frame.id, done: true })
    for (const child of index.children.get(frame.id) ?? []) {
      stack.push({ id: child.id, done: false })
    }
  }
  for (const id of order) {
    let total = index.byId.get(id)?.count ?? 0
    for (const child of index.children.get(id) ?? []) {
      total += totals.get(child.id) ?? 0
    }
    totals.set(id, total)
  }
  return totals
}

/** The names of a folder's ancestors, top first ("2025 · Blog"). */
export function folderPath(index: FolderIndex, id: number): string[] {
  return ancestorsOf(index, id)
    .reverse()
    .map((ancestor) => index.byId.get(ancestor)?.name ?? '')
}

// ---- Search ---------------------------------------------------------------------

export interface FolderSearch {
  /** folders whose name contains the query */
  matches: ReadonlySet<number>
  /** the matches plus all their ancestors: what the tree shows */
  visible: ReadonlySet<number>
}

/** The trimmed, lowercased search text, or '' for none. */
export function searchNeedle(query: string): string {
  return query.replace(/\s+/g, ' ').trim().toLowerCase()
}

/**
 * Client-side, case-insensitive substring search (folders.md §8). Matching
 * folders and all their ancestors stay visible.
 */
export function searchFolders(
  index: FolderIndex,
  query: string,
): FolderSearch | null {
  const needle = searchNeedle(query)
  if (needle === '') {
    return null
  }
  const matches = new Set<number>()
  const visible = new Set<number>()
  for (const folder of index.byId.values()) {
    if (!folder.name.toLowerCase().includes(needle)) {
      continue
    }
    matches.add(folder.id)
    visible.add(folder.id)
    for (const ancestor of ancestorsOf(index, folder.id)) {
      visible.add(ancestor)
    }
  }
  return { matches, visible }
}

/** Splits a name around the first match, for `<mark>`. */
export function highlightParts(
  name: string,
  query: string,
): { before: string; match: string; after: string } | null {
  const needle = searchNeedle(query)
  if (needle === '') {
    return null
  }
  const start = name.toLowerCase().indexOf(needle)
  if (start === -1) {
    return null
  }
  const end = start + needle.length
  return {
    before: name.slice(0, start),
    match: name.slice(start, end),
    after: name.slice(end),
  }
}

// ---- Names ------------------------------------------------------------------------

/**
 * A name as FileBird stores it: inner whitespace collapsed, trimmed, at most
 * 200 characters. Empty means "no name" (cancel).
 */
export function cleanFolderName(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_FOLDER_NAME_LENGTH)
    .trim()
}

/** Whether any folder already has this name (case-insensitive). */
export function hasFolderNamed(index: FolderIndex, name: string): boolean {
  const wanted = cleanFolderName(name).toLowerCase()
  if (wanted === '') {
    return false
  }
  for (const folder of index.byId.values()) {
    if (folder.name.toLowerCase() === wanted) {
      return true
    }
  }
  return false
}

// ---- Drop rules -------------------------------------------------------------------

/**
 * The three things a drop on a row can mean. Same names as the hitbox
 * package's list-item instruction (`reorder-before` / `reorder-after` /
 * `combine`), so the component passes them through without a mapping table.
 * `combine` = nest inside the row.
 */
export type DropOperation = 'reorder-before' | 'reorder-after' | 'combine'

/** Same values as the hitbox package's `Availability`. */
export type Availability = 'available' | 'not-available' | 'blocked'

export type BlockReason =
  /** onto itself */
  | 'self'
  /** into its own subtree */
  | 'cycle'

export interface DropAvailability {
  operations: Record<DropOperation, Availability>
  /** set when the operations are blocked */
  reason: BlockReason | null
}

export interface DropRuleOptions {
  /**
   * false when siblings are sorted by name (FileBird Pro's A–Z / Z–A), so
   * there is no manual order and only "inside" is offered. Default true.
   */
  manualOrder?: boolean
}

/**
 * What a row offers while a folder is dragged over it. The hitbox uses this:
 * a `not-available` zone is absorbed by its neighbours, a `blocked` one
 * still resolves (so the preview can say why) but must refuse the drop.
 *
 * - Onto itself or into its own subtree: everything blocked (the cycle rule;
 *   reordering next to a descendant would also land inside the subtree).
 * - An expanded row with children has no "after": its bottom edge sits
 *   right above its first child, so "after" would be ambiguous. The bottom
 *   quarter means "inside" there (folders spec §6).
 * - Without a manual order only "inside" exists.
 */
export function folderDropAvailability(
  index: FolderIndex,
  draggedId: number,
  target: Pick<FolderRow, 'id' | 'expanded'>,
  { manualOrder = true }: DropRuleOptions = {},
): DropAvailability {
  if (isSelfOrDescendant(index, draggedId, target.id)) {
    const reason: BlockReason = target.id === draggedId ? 'self' : 'cycle'
    return {
      operations: {
        'reorder-before': manualOrder ? 'blocked' : 'not-available',
        'reorder-after':
          manualOrder && !target.expanded ? 'blocked' : 'not-available',
        combine: 'blocked',
      },
      reason,
    }
  }
  return {
    operations: {
      'reorder-before': manualOrder ? 'available' : 'not-available',
      'reorder-after':
        manualOrder && !target.expanded ? 'available' : 'not-available',
      combine: 'available',
    },
    reason: null,
  }
}

/** Media dropped on a row can only mean "assign to this folder". */
export const MEDIA_DROP_AVAILABILITY: DropAvailability = {
  operations: {
    'reorder-before': 'not-available',
    'reorder-after': 'not-available',
    combine: 'available',
  },
  reason: null,
}

/** Where a folder was dropped. */
export type FolderDropTarget =
  | { kind: 'row'; targetId: number; operation: DropOperation }
  /** the empty tree area below the rows: the end of the top level */
  | { kind: 'root' }

/** The API's move fields (`FolderUpdateRequest`), both required. */
export type FolderMove = Required<
  Pick<FolderUpdateRequest, 'parent' | 'position'>
>

export type MoveResolution =
  | {
      ok: true
      move: FolderMove
      /** the folder would end up exactly where it is */
      noop: boolean
    }
  | { ok: false; reason: BlockReason | 'missing' }

function siblingsWithout(
  index: FolderIndex,
  parent: number,
  id: number,
): Folder[] {
  return (index.children.get(parent) ?? []).filter((folder) => folder.id !== id)
}

/**
 * Where a folder is now, in the API's terms: its parent and its index among
 * that parent's children in manual order, counted without itself. That is
 * exactly the `{ parent, position }` that moves it back (Undo,
 * server-api.md §7.11).
 */
export function currentPlacement(
  index: FolderIndex,
  id: number,
): FolderMove | null {
  if (!index.byId.has(id)) {
    return null
  }
  const parent = displayParent(index, id)
  const position = (index.children.get(parent) ?? []).findIndex(
    (folder) => folder.id === id,
  )
  return { parent, position: Math.max(0, position) }
}

/**
 * A drop as the API's `{ parent, position }`. `position` is the 0-based index
 * among the new parent's children counted without the moved folder (the
 * contract of `FolderUpdateRequest`). "Inside" appends as the last child.
 * Refuses a move onto itself or into its own subtree.
 */
export function resolveFolderMove(
  index: FolderIndex,
  draggedId: number,
  target: FolderDropTarget,
): MoveResolution {
  if (!index.byId.has(draggedId)) {
    return { ok: false, reason: 'missing' }
  }
  let move: FolderMove
  if (target.kind === 'root') {
    move = {
      parent: ROOT_ID,
      position: siblingsWithout(index, ROOT_ID, draggedId).length,
    }
  } else {
    if (!index.byId.has(target.targetId)) {
      return { ok: false, reason: 'missing' }
    }
    if (isSelfOrDescendant(index, draggedId, target.targetId)) {
      return {
        ok: false,
        reason: target.targetId === draggedId ? 'self' : 'cycle',
      }
    }
    if (target.operation === 'combine') {
      move = {
        parent: target.targetId,
        position: siblingsWithout(index, target.targetId, draggedId).length,
      }
    } else {
      const parent = displayParent(index, target.targetId)
      const siblings = siblingsWithout(index, parent, draggedId)
      const targetPosition = siblings.findIndex(
        (folder) => folder.id === target.targetId,
      )
      move = {
        parent,
        position:
          target.operation === 'reorder-before'
            ? targetPosition
            : targetPosition + 1,
      }
    }
  }
  const current = currentPlacement(index, draggedId)
  const noop =
    current !== null &&
    move.parent === current.parent &&
    move.position === current.position
  return { ok: true, move, noop }
}

/**
 * Applies a move to the flat list: the folder gets its new parent, and both
 * the old and the new sibling groups get `ord` renumbered 0…n-1 (FileBird's
 * sibling order). Returns a new list in API order (parent, ord, id); the
 * input is not mutated. Throws on a cycle, which resolveFolderMove refuses
 * first.
 */
export function applyFolderMove(
  folders: readonly Folder[],
  id: number,
  move: FolderMove,
): Folder[] {
  const index = indexFolders(folders)
  const moved = index.byId.get(id)
  if (!moved) {
    throw new Error(`Folder ${id} not found`)
  }
  if (move.parent !== ROOT_ID && isSelfOrDescendant(index, id, move.parent)) {
    throw new Error(`Moving folder ${id} into ${move.parent} makes a cycle`)
  }
  const oldParent = displayParent(index, id)
  const newSiblings = siblingsWithout(index, move.parent, id)
  const position = Math.max(0, Math.min(move.position, newSiblings.length))
  newSiblings.splice(position, 0, { ...moved, parent: move.parent })

  const updates = new Map<number, Folder>()
  newSiblings.forEach((folder, ord) => {
    updates.set(folder.id, { ...folder, ord })
  })
  if (oldParent !== move.parent) {
    siblingsWithout(index, oldParent, id).forEach((folder, ord) => {
      updates.set(folder.id, { ...folder, ord })
    })
  }
  return folders
    .map((folder) => updates.get(folder.id) ?? folder)
    .sort((a, b) => a.parent - b.parent || byOrder(a, b))
}
