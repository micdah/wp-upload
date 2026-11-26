// The folder column's own UI state (feature-local, not the core store):
// tree expansion, the search, the inline name input, the roving tab stop,
// open menus and dialogs. Commands (in the initial chunk) write requests
// here; the lazily loaded column renders them.
//
// Per-user preferences (count mode, Pro's folder sort and the expansion) are
// kept in localStorage per WordPress user, as FileBird keeps them per user
// (folders.md §2); `loadFolderPrefs(userId)` switches to a user's set.

import { createStore } from 'zustand/vanilla'
import type { FolderRef } from '../../../../../shared/library-api'
import type { CountMode, FolderSort } from './model'

/** A row of the column: All files, Uncategorized (0), Trash or a folder id. */
export type RowRef = FolderRef

/** The inline name input: a new folder under `parent`, or a rename. */
export type Editing =
  | { mode: 'new'; parent: number }
  | { mode: 'rename'; id: number }

/** What the Move to… dialog moves (folders.md §7). */
export type MoveRequest =
  | { kind: 'items'; ids: number[] }
  | { kind: 'folder'; folderId: number }

/** Where a menu opens: at the pointer, or under its row. */
export type MenuAnchor = { x: number; y: number } | 'row'

export interface FolderPrefs {
  countMode: CountMode
  sort: FolderSort
  expanded: number[]
}

export interface FolderUiState extends Omit<FolderPrefs, 'expanded'> {
  expanded: ReadonlySet<number>
  /** The search box's text (folders.md §8). */
  search: string
  editing: Editing | null
  /** A create sent and not answered yet: shown as a muted row. */
  pendingCreate: { parent: number; name: string } | null
  /** The roving tab stop: the last focused row. */
  focusedRow: RowRef | null
  /**
   * Ask the tree to move DOM focus to a row. The tree clears it once
   * handled; `at` lets it drop a request whose row never appears.
   */
  focusRequest: { row: RowRef; seq: number; at: number } | null
  /** A row that just appeared or changed glows once. */
  flash: { id: number; seq: number } | null
  /** The open context menu. */
  menu: { row: RowRef; anchor: MenuAnchor } | null
  /** The open Move to… dialog. */
  move: MoveRequest | null
  /** The folder whose Pro colour picker is open. */
  colorPicker: number | null
  /** Folders used as move targets this session, newest first (≤ 3). */
  recent: number[]
}

export const DEFAULT_PREFS: FolderPrefs = Object.freeze({
  countMode: 'direct',
  sort: 'manual',
  expanded: [],
}) as FolderPrefs

const INITIAL: FolderUiState = {
  countMode: DEFAULT_PREFS.countMode,
  sort: DEFAULT_PREFS.sort,
  expanded: new Set(),
  search: '',
  editing: null,
  pendingCreate: null,
  focusedRow: null,
  focusRequest: null,
  flash: null,
  menu: null,
  move: null,
  colorPicker: null,
  recent: [],
}

export const folderUiStore = createStore<FolderUiState>(() => ({
  ...INITIAL,
}))

let sequence = 0

/** A fresh number for focus and flash requests. */
export function nextSeq(): number {
  sequence += 1
  return sequence
}

// ---- Preferences ---------------------------------------------------------------

export const PREFS_STORAGE_PREFIX = 'wpu-media-manager:folders:'

let prefsKey: string | null = null

function readPrefs(key: string): FolderPrefs {
  try {
    const raw = JSON.parse(window.localStorage.getItem(key) ?? '{}') as Record<
      string,
      unknown
    >
    return {
      countMode: raw.countMode === 'nested' ? 'nested' : 'direct',
      sort:
        raw.sort === 'name-asc' || raw.sort === 'name-desc'
          ? raw.sort
          : 'manual',
      expanded: Array.isArray(raw.expanded)
        ? raw.expanded.filter(
            (id): id is number => Number.isInteger(id) && (id as number) > 0,
          )
        : [],
    }
  } catch {
    // Unavailable or corrupt storage: the defaults.
    return { ...DEFAULT_PREFS, expanded: [] }
  }
}

function writePrefs(): void {
  if (prefsKey === null) {
    return
  }
  const { countMode, sort, expanded } = folderUiStore.getState()
  const prefs: FolderPrefs = { countMode, sort, expanded: [...expanded] }
  try {
    window.localStorage.setItem(prefsKey, JSON.stringify(prefs))
  } catch {
    // Storage can be unavailable (private mode); the choice just isn't kept.
  }
}

/** Switches to a WordPress user's preferences (the column calls it). */
export function loadFolderPrefs(userId: number): void {
  const key = `${PREFS_STORAGE_PREFIX}${userId}`
  if (key === prefsKey) {
    return
  }
  prefsKey = key
  const prefs = readPrefs(key)
  folderUiStore.setState({
    countMode: prefs.countMode,
    sort: prefs.sort,
    expanded: new Set(prefs.expanded),
  })
}

export function setCountMode(countMode: CountMode): void {
  folderUiStore.setState({ countMode })
  writePrefs()
}

export function setFolderSort(sort: FolderSort): void {
  folderUiStore.setState({ sort })
  writePrefs()
}

/** Replaces the expanded set (remembered). */
export function setExpanded(expanded: ReadonlySet<number>): void {
  folderUiStore.setState({ expanded })
  writePrefs()
}

/** Expands or collapses one folder. */
export function setFolderExpanded(id: number, open: boolean): void {
  const current = folderUiStore.getState().expanded
  if (current.has(id) === open) {
    return
  }
  const next = new Set(current)
  if (open) {
    next.add(id)
  } else {
    next.delete(id)
  }
  setExpanded(next)
}

/** Expands every folder in `ids` (ancestors of a row being revealed). */
export function expandFolders(ids: Iterable<number>): void {
  const current = folderUiStore.getState().expanded
  const next = new Set(current)
  for (const id of ids) {
    next.add(id)
  }
  if (next.size !== current.size) {
    setExpanded(next)
  }
}

// ---- Requests ----------------------------------------------------------------------

/** Moves the roving tab stop and DOM focus to a row. */
export function requestRowFocus(row: RowRef): void {
  folderUiStore.setState({
    focusedRow: row,
    focusRequest: { row, seq: nextSeq(), at: Date.now() },
  })
}

/** Clears a focus request once the tree handled (or dropped) it. */
export function clearFocusRequest(seq: number): void {
  if (folderUiStore.getState().focusRequest?.seq === seq) {
    folderUiStore.setState({ focusRequest: null })
  }
}

export function flashRow(id: number): void {
  folderUiStore.setState({ flash: { id, seq: nextSeq() } })
}

export function openMoveRequest(move: MoveRequest): void {
  folderUiStore.setState({ move, menu: null })
}

/** Records a move target for the Move dialog's Recent group. */
export function rememberRecent(id: number): void {
  if (id <= 0) {
    return
  }
  const recent = folderUiStore.getState().recent.filter((other) => other !== id)
  recent.unshift(id)
  folderUiStore.setState({ recent: recent.slice(0, 3) })
}

/** Tests and logout: back to the initial state (preferences reload). */
export function resetFolderUi(): void {
  prefsKey = null
  folderUiStore.setState({ ...INITIAL, expanded: new Set() })
}
