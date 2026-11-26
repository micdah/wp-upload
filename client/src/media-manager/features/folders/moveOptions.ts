// The Move to… dialog's content (folders.md §7) as plain data: the title and
// subtitle, and the option list for a query. No React, no DOM, so every rule
// (Recent, Current, the blocked subtree, search paths, Create) is
// unit-tested in Node; MoveDialog.tsx only renders the result and keeps the
// active option.

import { plural } from '../../core/ui/announce'
import {
  cleanFolderName,
  descendantIds,
  displayParent,
  type FolderIndex,
  type FolderSort,
  flattenVisible,
  folderPath,
  hasFolderNamed,
  ROOT_ID,
  searchNeedle,
} from './model'

/** What the dialog moves, as the option builder needs it. */
export type MoveSubject =
  /** `current`: the one folder every item is in (0 = Uncategorized), else null */
  | { kind: 'items'; current: number | null }
  | { kind: 'folder'; folderId: number }

/** The first option: "remove from folder" for items, the top level for folders. */
export const ROOT_LABELS = {
  items: 'Uncategorized',
  folder: 'Top level',
} as const

/** How many recently used targets the dialog offers. */
export const MAX_RECENT = 3

export type MoveGroup = 'Recent' | 'All folders'

export interface MoveOption {
  /** Unique in the list; the option's DOM id is derived from it. */
  key: string
  kind: 'root' | 'folder' | 'create'
  /** The folder to move into (0 = Uncategorized / top level); null for Create. */
  target: number | null
  /** The folder name, the root label, or for Create the cleaned query. */
  label: string
  /** Indentation (0 = top level); always 0 in a flat list. */
  depth: number
  /** The parent path, top first ("2025 · Blog"); '' when not shown. */
  path: string
  /** Pro colour (`#rrggbb`), only with FileBird Pro. */
  color: string | null
  /** Where the subject already is: shown as "Current", can't be chosen. */
  current: boolean
  /** The heading the option sits under, if any. */
  group: MoveGroup | null
}

export interface MoveOptionsInput {
  index: FolderIndex
  subject: MoveSubject
  /** Recently used targets, newest first (folderUiStore's `recent`). */
  recent: readonly number[]
  /** The per-user folder sort; only applied with Pro (else manual order). */
  sort: FolderSort
  /** FileBird Pro detected: its name sort and colours apply. */
  pro: boolean
  query: string
}

/** The separator between the names of a path. */
export const PATH_SEPARATOR = ' · '

/** The target marked Current, if it still exists. */
export function currentTarget(
  index: FolderIndex,
  subject: MoveSubject,
): number | null {
  if (subject.kind === 'folder') {
    return index.byId.has(subject.folderId)
      ? displayParent(index, subject.folderId)
      : null
  }
  const { current } = subject
  if (current === ROOT_ID) {
    return ROOT_ID
  }
  return current !== null && index.byId.has(current) ? current : null
}

/** The folders a folder can't move into: itself and its whole subtree. */
function blockedFolders(index: FolderIndex, subject: MoveSubject): Set<number> {
  if (subject.kind !== 'folder') {
    return new Set()
  }
  return new Set([subject.folderId, ...descendantIds(index, subject.folderId)])
}

function pathOf(index: FolderIndex, id: number): string {
  return folderPath(index, id).join(PATH_SEPARATOR)
}

/**
 * The options for a query. Without one: the root option, Recent (when any
 * recent target is still offered) and every folder in tree order, indented.
 * With one: a flat list of matching folders with their paths, then "Create
 * folder “query”" when no folder has that exact name.
 */
export function buildMoveOptions(input: MoveOptionsInput): MoveOption[] {
  const { index, subject, pro, query } = input
  const sort: FolderSort = pro ? input.sort : 'manual'
  const needle = searchNeedle(query)
  const searching = needle !== ''
  const current = currentTarget(index, subject)
  const blocked = blockedFolders(index, subject)
  const colorOf = (id: number): string | null =>
    pro ? (index.byId.get(id)?.color ?? null) : null
  const options: MoveOption[] = []

  const rootLabel = ROOT_LABELS[subject.kind]
  if (!searching || rootLabel.toLowerCase().includes(needle)) {
    options.push({
      key: 'root',
      kind: 'root',
      target: ROOT_ID,
      label: rootLabel,
      depth: 0,
      path: '',
      color: null,
      current: current === ROOT_ID,
      group: null,
    })
  }

  const recent = searching
    ? []
    : input.recent
        .filter(
          (id, position, all) =>
            id !== ROOT_ID &&
            index.byId.has(id) &&
            !blocked.has(id) &&
            all.indexOf(id) === position,
        )
        .slice(0, MAX_RECENT)
  for (const id of recent) {
    options.push({
      key: `recent-${id}`,
      kind: 'folder',
      target: id,
      label: index.byId.get(id)?.name ?? '',
      depth: 0,
      path: pathOf(index, id),
      color: colorOf(id),
      current: current === id,
      group: 'Recent',
    })
  }

  // Every folder but the blocked ones, all expanded, in display order. A
  // blocked folder isn't emitted, so neither is anything below it.
  const allowed = new Set<number>()
  for (const id of index.byId.keys()) {
    if (!blocked.has(id)) {
      allowed.add(id)
    }
  }
  const rows = flattenVisible(index, new Set(), { sort, only: allowed })
  for (const row of rows) {
    if (searching && !row.folder.name.toLowerCase().includes(needle)) {
      continue
    }
    options.push({
      key: `folder-${row.id}`,
      kind: 'folder',
      target: row.id,
      label: row.folder.name,
      depth: searching ? 0 : row.level - 1,
      path: searching ? pathOf(index, row.id) : '',
      color: colorOf(row.id),
      current: current === row.id,
      group: recent.length > 0 ? 'All folders' : null,
    })
  }

  const name = cleanFolderName(query)
  if (name !== '' && !hasFolderNamed(index, name)) {
    options.push({
      key: 'create',
      kind: 'create',
      target: null,
      label: name,
      depth: 0,
      path: '',
      color: null,
      current: false,
      group: null,
    })
  }
  return options
}

// ---- The active option ------------------------------------------------------------

/** Whether an option can be moved into (Current can't). */
export function isChoosable(option: MoveOption | undefined): boolean {
  return option !== undefined && !option.current
}

/** The first choosable option at or after `from` in `step`'s direction, else -1. */
export function findChoosable(
  options: readonly MoveOption[],
  from: number,
  step: 1 | -1,
): number {
  for (let at = from; at >= 0 && at < options.length; at += step) {
    if (isChoosable(options[at])) {
      return at
    }
  }
  return -1
}

/**
 * ↑/↓ from the active option, skipping Current. At either end it stays
 * where it is (no wrap-around), as in the prototype.
 */
export function stepActive(
  options: readonly MoveOption[],
  activeKey: string | null,
  step: 1 | -1,
): string | null {
  const at = options.findIndex((option) => option.key === activeKey)
  if (at === -1) {
    const first =
      step === 1
        ? findChoosable(options, 0, 1)
        : findChoosable(options, options.length - 1, -1)
    return options[first]?.key ?? null
  }
  const next = findChoosable(options, at + step, step)
  return next === -1 ? activeKey : (options[next]?.key ?? activeKey)
}

/**
 * The active option after the list changed: the same one while it is still
 * there and choosable, else the first choosable one.
 */
export function keepActive(
  options: readonly MoveOption[],
  activeKey: string | null,
): string | null {
  const same = options.find((option) => option.key === activeKey)
  if (same && isChoosable(same)) {
    return same.key
  }
  return options[findChoosable(options, 0, 1)]?.key ?? null
}

// ---- Title and subtitle -----------------------------------------------------------

/** What the dialog knows about an item from the cache. */
export interface MoveItemInfo {
  title: string
  filename: string
  /** null or undefined: unknown (not cached, or no FileBird) */
  folder: number | null | undefined
}

export interface MoveDescription {
  title: string
  subtitle: string
  confirmLabel: string
  subject: MoveSubject
}

export const ONE_FOLDER_RULE =
  'A file lives in one folder, so this replaces its current folder.'

export const FOLDER_MOVE_TEXT =
  'Choose its new parent folder. Its subfolders and files move with it.'

/** “Name” in curly quotes (as actions.tsx `quoted`, kept here to stay pure). */
function quote(name: string): string {
  return `“${name}”`
}

/**
 * Where the items are now: one known folder (0 = Uncategorized), several,
 * or unknown when any item's folder isn't known or names a missing folder.
 */
function itemFolders(
  index: FolderIndex,
  items: readonly (MoveItemInfo | null)[],
): { kind: 'unknown' } | { kind: 'known'; folders: Set<number> } {
  const folders = new Set<number>()
  for (const item of items) {
    const folder = item?.folder
    if (folder === null || folder === undefined) {
      return { kind: 'unknown' }
    }
    if (folder !== ROOT_ID && !index.byId.has(folder)) {
      return { kind: 'unknown' }
    }
    folders.add(folder)
  }
  return folders.size === 0 ? { kind: 'unknown' } : { kind: 'known', folders }
}

/**
 * Items mode: "Move 3 items" or "Move “title”", and "From “X”." (or
 * "From Uncategorized.", "From 2 folders.") plus the one-folder rule. The
 * "From" sentence is left out when an item's folder is unknown, and nothing
 * is marked Current then.
 */
export function describeItemsMove(
  index: FolderIndex,
  ids: readonly number[],
  items: readonly (MoveItemInfo | null)[],
): MoveDescription {
  const only = ids.length === 1 ? items[0] : null
  const name = only ? only.title.trim() || only.filename : ''
  const title =
    name !== '' ? `Move ${quote(name)}` : `Move ${plural(ids.length, 'item')}`
  const where = itemFolders(index, items)
  let from = ''
  let current: number | null = null
  if (where.kind === 'known') {
    if (where.folders.size === 1) {
      const folder = [...where.folders][0] as number
      current = folder
      from =
        folder === ROOT_ID
          ? 'From Uncategorized. '
          : `From ${quote(index.byId.get(folder)?.name ?? '')}. `
    } else {
      from = `From ${where.folders.size} folders. `
    }
  }
  return {
    title,
    subtitle: `${from}${ONE_FOLDER_RULE}`,
    confirmLabel: 'Move here',
    subject: { kind: 'items', current },
  }
}

/** Folder mode: "Move “Blog”" and what moves with it. */
export function describeFolderMove(
  index: FolderIndex,
  folderId: number,
): MoveDescription {
  const name = index.byId.get(folderId)?.name ?? 'folder'
  return {
    title: `Move ${quote(name)}`,
    subtitle: FOLDER_MOVE_TEXT,
    confirmLabel: 'Move folder',
    subject: { kind: 'folder', folderId },
  }
}
