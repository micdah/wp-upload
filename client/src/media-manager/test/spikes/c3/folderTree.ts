import type {
  Folder,
  FolderUpdateRequest,
} from '../../../../../../shared/library-api'

// Spike C3: the folder tree's pure model (plan §3 "Folder tree: custom
// flattened, virtualised ARIA tree"). No React, no DOM, no drag-and-drop
// library: the component and the drop targets only call into this module, so
// A3 can lift it unchanged and unit-test every rule in Node.
//
// - indexFolders: the flat `Folder[]` from the API as a parent → children map.
// - flattenVisible: the rows a virtualiser renders, given the expanded set,
//   with everything the ARIA tree needs (level, position in set, set size).
// - folderDropAvailability: which drop operations a row offers for a dragged
//   folder (feeds the hitbox), including the cycle rule.
// - resolveFolderMove: a drop (operation on a row, or the empty tree area) as
//   the API's `{ parent, position }`.
// - applyFolderMove: the same move applied to the flat list (optimistic
//   update, Undo snapshot comparisons, tests).

/** The top level's parent id, as in the API (`Folder.parent`). */
export const ROOT_ID = 0

/** The folder list as a tree. Children are in display order (`ord`, then `id`). */
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
  /** aria-posinset: 1-based position among its siblings */
  posInSet: number
  /** aria-setsize: number of siblings, itself included */
  setSize: number
  hasChildren: boolean
  /** expanded and has children (an empty folder is never "expanded") */
  expanded: boolean
}

function byOrder(a: Folder, b: Folder): number {
  return a.ord - b.ord || a.id - b.id
}

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

/**
 * The visible rows, depth first, given which folders are expanded. Iterative,
 * so a deep chain can't overflow the stack, and guarded against a corrupt
 * list with a parent cycle (each folder is emitted at most once).
 */
export function flattenVisible(
  index: FolderIndex,
  expanded: ReadonlySet<number>,
): FolderRow[] {
  const rows: FolderRow[] = []
  const seen = new Set<number>()
  // A stack of sibling lists with a cursor, instead of recursion.
  const stack: Array<{
    siblings: readonly Folder[]
    next: number
    level: number
    parent: number
  }> = []
  const top = index.children.get(ROOT_ID)
  if (top) {
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
    const children = index.children.get(folder.id) ?? []
    const hasChildren = children.length > 0
    const isExpanded = hasChildren && expanded.has(folder.id)
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

// ---- Drop rules ---------------------------------------------------------------

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
  const currentParent = displayParent(index, draggedId)
  const currentPosition = (index.children.get(currentParent) ?? []).findIndex(
    (folder) => folder.id === draggedId,
  )
  const noop =
    move.parent === currentParent && move.position === currentPosition
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
