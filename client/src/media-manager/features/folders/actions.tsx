// Folder operations as the user sees them (folders.md §4–§7, §9): each one
// checks permission first and says why when it can't run, calls the data
// layer (core/data/folders.ts), and ends in the toast, Undo, focus and
// announcement the spec describes. Commands, the column, its menus, drag and
// drop and the Move dialog all go through here, so every path behaves alike.
//
// This module is loaded lazily (with the column), so the initial chunk only
// carries the commands' thin wrappers (index.tsx).

import type { QueryClient } from '@tanstack/react-query'
import type { FolderRef, ItemFailure } from '../../../../../shared/library-api'
import { centerApi } from '../../core/collection/centerApi'
import { getCurrentCollection } from '../../core/collection/hooks'
import { runCommand } from '../../core/commands/registry'
import { errorKind, isLibraryError } from '../../core/data/errors'
import {
  assignItemsToFolder,
  cachedFolderTree,
  createFolder,
  deleteFolder,
  restoreItemFolders,
  updateFolder,
  withFolderFields,
} from '../../core/data/folders'
import { cachedItem } from '../../core/data/items'
import { can, type PermAction } from '../../core/perms'
import { coreStore, isCompactViewport } from '../../core/state'
import { targetIds } from '../../core/state/selection'
import { announce, plural } from '../../core/ui/announce'
import { confirm } from '../../core/ui/confirm'
import { toast } from '../../core/ui/toast'
import { urlStore } from '../../core/url/useUrlState'
import {
  ancestorsOf,
  applyFolderMove,
  cleanFolderName,
  currentPlacement,
  descendantIds,
  type FolderIndex,
  type FolderMove,
  indexFolders,
  ROOT_ID,
  resolveFolderMove,
  subtreeFileCount,
} from './model'
import { folderQueryClient } from './runtime'
import {
  expandFolders,
  flashRow,
  folderUiStore,
  type MenuAnchor,
  openMoveRequest,
  type RowRef,
  rememberRecent,
  requestRowFocus,
  setExpanded,
} from './store'
import { focusRowNow } from './treeApi'

// ---- Messages -------------------------------------------------------------------

export const MESSAGES = {
  offline:
    'WordPress can’t be reached, so folder changes can’t be saved right now.',
  noFileBird: 'Folders need the FileBird plugin on your WordPress site.',
  perUser:
    'Folder changes are off: FileBird’s per-user folders aren’t supported.',
  renameWhat: 'Open or focus a folder to rename it.',
  selectFirst: 'Select media first, then move it to a folder.',
  deleteWhat: 'Select media to delete first',
  cycle: 'A folder can’t move into itself or one of its subfolders.',
  gone: 'That folder no longer exists.',
} as const

/** “Name” in curly quotes, as every folder message writes it. */
export function quoted(name: string): string {
  return `“${name}”`
}

/** A folder target as toasts name it: `“Press kit”` or `Uncategorized`. */
export function targetLabel(index: FolderIndex | null, folder: number): string {
  if (folder === ROOT_ID) {
    return 'Uncategorized'
  }
  return quoted(index?.byId.get(folder)?.name ?? 'folder')
}

// ---- Context -----------------------------------------------------------------------

function client(): QueryClient | null {
  return folderQueryClient()
}

/** The cached tree as an index, or null before it loaded. */
export function currentIndex(): FolderIndex | null {
  const queryClient = client()
  const tree = queryClient ? cachedFolderTree(queryClient) : undefined
  return tree ? indexFolders(tree.folders) : null
}

export function isRealFolder(ref: RowRef | null | undefined): ref is number {
  return (
    typeof ref === 'number' &&
    ref !== ROOT_ID &&
    (currentIndex()?.byId.has(ref) ?? false)
  )
}

/** The folder name for announcements (All files, Uncategorized, Trash, …). */
export function rowName(ref: RowRef): string {
  if (ref === 'all') return 'All files'
  if (ref === 'trash') return 'Trash'
  if (ref === ROOT_ID) return 'Uncategorized'
  return currentIndex()?.byId.get(ref)?.name ?? 'folder'
}

// ---- Permission guard ---------------------------------------------------------------

/**
 * Whether a folder change may run now. When it can't, a toast says why
 * (folders.md §9: per-user mode and offline refuse with a sentence, never
 * silently). The plugin refuses the same requests anyway.
 */
export function guardFolderChange(action: PermAction): boolean {
  const refusal = folderRefusal(action)
  if (refusal === null) {
    return true
  }
  toast({ message: refusal, tone: 'info' })
  return false
}

/** Why a folder change can't run now, in the feature's words; null if it can. */
export function folderRefusal(action: PermAction): string | null {
  const result = can(action)
  if (result.ok) {
    return null
  }
  if (result.code === 'offline' && result.reason.includes('unreachable')) {
    return MESSAGES.offline
  }
  if (result.code === 'no-filebird') {
    return MESSAGES.noFileBird
  }
  if (result.code === 'filebird-per-user') {
    return MESSAGES.perUser
  }
  return result.reason
}

/**
 * An error whose message is already a sentence for the user (an Undo that
 * can't run). The toast's Undo shows it as "Couldn't undo: <message>".
 */
export class FolderActionError extends Error {
  override readonly name = 'FolderActionError'
}

/** Throws the refusal as a FolderActionError, without a toast (Undo). */
function assertFolderChange(action: PermAction): void {
  const refusal = folderRefusal(action)
  if (refusal !== null) {
    throw new FolderActionError(refusal)
  }
}

/**
 * Runs an Undo's request; a failure becomes a sentence for the user
 * instead of the raw error.
 */
async function undoRequest(run: () => Promise<unknown>): Promise<void> {
  try {
    await run()
  } catch (error) {
    throw new FolderActionError(folderErrorMessage(error, null).message)
  }
}

/** Applies a folder move to a list; a cycle (the tree changed) is a sentence. */
function movedFolders(id: number, move: FolderMove) {
  return (folders: Parameters<typeof applyFolderMove>[0]) => {
    try {
      return applyFolderMove(folders, id, move)
    } catch {
      throw new FolderActionError(MESSAGES.cycle)
    }
  }
}

/**
 * A failed request in the folder feature's words. `what` ("rename the
 * folder") prefixes messages that aren't sentences of their own.
 */
export function folderErrorMessage(
  error: unknown,
  what: string | null,
): { message: string; tone: 'info' | 'warning' | 'error' } {
  if (error instanceof FolderActionError) {
    return { message: error.message, tone: 'error' }
  }
  if (errorKind(error) === 'connectivity') {
    return { message: MESSAGES.offline, tone: 'warning' }
  }
  if (isLibraryError(error)) {
    switch (error.code) {
      case 'wpu_folder_cycle':
        return { message: MESSAGES.cycle, tone: 'error' }
      case 'wpu_filebird_per_user':
        return { message: MESSAGES.perUser, tone: 'info' }
      case 'wpu_filebird_inactive':
        return { message: MESSAGES.noFileBird, tone: 'info' }
      case 'wpu_folder_not_found':
        return { message: MESSAGES.gone, tone: 'error' }
    }
    return {
      message: what ? `Couldn’t ${what}: ${error.message}` : error.message,
      tone: 'error',
    }
  }
  return {
    message: what ? `Couldn’t ${what}.` : 'Something went wrong.',
    tone: 'error',
  }
}

/** Toasts a failed request in the folder feature's words. */
export function toastFolderError(error: unknown, what: string): void {
  toast(folderErrorMessage(error, what))
}

// ---- Column -------------------------------------------------------------------------

/** Opens the column (or the drawer below 900 px) if it is hidden. */
export function openColumn(): void {
  const state = coreStore.getState()
  const open = isCompactViewport(state.viewport)
    ? state.compactFoldersOpen
    : state.panels.foldersOpen
  if (!open) {
    state.setFoldersOpen(true)
  }
}

/**
 * Makes a row visible: clears the folder search and expands its ancestors
 * (and itself with `includeSelf`), so an edited or revealed row is on screen
 * (folders.md §11 "Hidden folders").
 */
export function revealRow(id: number, includeSelf = false): void {
  const index = currentIndex()
  if (folderUiStore.getState().search !== '') {
    folderUiStore.setState({ search: '' })
  }
  if (!index || id === ROOT_ID) {
    return
  }
  const ids = ancestorsOf(index, id)
  if (includeSelf) {
    ids.push(id)
  }
  expandFolders(ids)
}

/**
 * Opens a folder (Enter, Space or a click): filters the grid, clears the
 * selection (core sync) and replaces `?folder=` (D16). Leaves detail mode.
 */
export function openFolder(ref: FolderRef): void {
  folderUiStore.setState({ focusedRow: ref })
  const url = urlStore()
  const current = url.get()
  if (current.folder === ref && current.item === null) {
    return
  }
  url.navigate({ folder: ref, item: null })
  announce(
    `Showing ${ref === 'all' || ref === 'trash' || ref === ROOT_ID ? rowName(ref) : quoted(rowName(ref))}`,
  )
  // Below 900 px the column is a drawer over the grid: get out of the way.
  const state = coreStore.getState()
  if (isCompactViewport(state.viewport) && state.compactFoldersOpen) {
    state.setFoldersOpen(false)
  }
}

/** Expands every folder that has children (the options menu, the palette). */
export function expandAll(): void {
  const index = currentIndex()
  if (!index) {
    return
  }
  const ids = [...index.children.keys()].filter((id) => id !== ROOT_ID)
  setExpanded(new Set(ids))
  announce('All folders expanded')
}

export function collapseAll(): void {
  setExpanded(new Set())
  announce('All folders collapsed')
}

// ---- Create and rename (folders.md §4) --------------------------------------------------

/** Starts a new folder under `parent` (0 = the top level). */
export function startCreate(parent: number): void {
  if (!guardFolderChange('folder-create')) {
    return
  }
  const index = currentIndex()
  const under = parent !== ROOT_ID && index?.byId.has(parent) ? parent : ROOT_ID
  // Only one name input at a time: starting another saves the first.
  const editing = folderUiStore.getState().editing
  if (editing) {
    void commitEditFrom(editing, currentDraft(), { refocus: false })
  }
  openColumn()
  revealRow(under, true)
  folderUiStore.setState({
    editing: { mode: 'new', parent: under },
    menu: null,
  })
  announce('New folder. Type a name, Enter to create, Escape to cancel.')
}

/** Renames a folder in place: its name becomes an input. */
export function startRename(ref: RowRef | null): void {
  if (!guardFolderChange('folder-rename')) {
    return
  }
  if (!isRealFolder(ref)) {
    toast({ message: MESSAGES.renameWhat, tone: 'info' })
    return
  }
  const editing = folderUiStore.getState().editing
  if (editing && !(editing.mode === 'rename' && editing.id === ref)) {
    void commitEditFrom(editing, currentDraft(), { refocus: false })
  }
  openColumn()
  revealRow(ref)
  folderUiStore.setState({ editing: { mode: 'rename', id: ref }, menu: null })
}

/** The live name input's text, read when another edit takes over. */
let draftReader: (() => string) | null = null

export function registerDraftReader(reader: (() => string) | null): void {
  draftReader = reader
}

function currentDraft(): string {
  return draftReader?.() ?? ''
}

/** Esc, or an empty name: the input goes, focus returns to its row. */
export function cancelEdit(): void {
  const editing = folderUiStore.getState().editing
  if (!editing) {
    return
  }
  folderUiStore.setState({ editing: null })
  requestRowFocus(
    editing.mode === 'rename'
      ? editing.id
      : editing.parent === ROOT_ID
        ? 'all'
        : editing.parent,
  )
}

/**
 * Enter or leaving the field: creates or renames. With `refocus` (Enter),
 * keyboard focus goes to the new or renamed row; a blur leaves focus where
 * the user put it.
 */
export function commitEdit(
  value: string,
  options: { refocus: boolean },
): Promise<void> {
  const editing = folderUiStore.getState().editing
  if (!editing) {
    return Promise.resolve()
  }
  return commitEditFrom(editing, value, options)
}

async function commitEditFrom(
  editing: NonNullable<ReturnType<typeof folderUiStore.getState>['editing']>,
  value: string,
  { refocus }: { refocus: boolean },
): Promise<void> {
  const name = cleanFolderName(value)
  const state = folderUiStore.getState()
  if (state.editing === editing) {
    folderUiStore.setState({ editing: null })
  }
  if (name === '') {
    if (refocus) {
      cancelEditFocus(editing)
    }
    return
  }
  const queryClient = client()
  if (!queryClient) {
    return
  }
  if (editing.mode === 'new') {
    await commitCreate(queryClient, editing.parent, name, refocus)
  } else {
    await commitRename(queryClient, editing.id, name, refocus)
  }
}

function cancelEditFocus(
  editing: NonNullable<ReturnType<typeof folderUiStore.getState>['editing']>,
): void {
  requestRowFocus(
    editing.mode === 'rename'
      ? editing.id
      : editing.parent === ROOT_ID
        ? 'all'
        : editing.parent,
  )
}

async function commitCreate(
  queryClient: QueryClient,
  parent: number,
  name: string,
  refocus: boolean,
): Promise<void> {
  folderUiStore.setState({ pendingCreate: { parent, name } })
  try {
    const response = await createFolder(queryClient, name, parent)
    folderUiStore.setState({ pendingCreate: null })
    const created = response.folder
    if (parent !== ROOT_ID) {
      expandFolders([parent])
    }
    if (refocus) {
      requestRowFocus(created.id)
    }
    flashRow(created.id)
    if (response.renamed) {
      toast({
        message: `A folder named ${quoted(response.requestedName ?? name)} is already there, so this one is ${quoted(created.name)}.`,
        tone: 'info',
      })
    } else {
      announce(`Folder ${quoted(created.name)} created`)
    }
  } catch (error) {
    folderUiStore.setState({ pendingCreate: null })
    toastFolderError(error, 'create the folder')
    if (refocus) {
      requestRowFocus(parent === ROOT_ID ? 'all' : parent)
    }
  }
}

async function commitRename(
  queryClient: QueryClient,
  id: number,
  name: string,
  refocus: boolean,
): Promise<void> {
  const previous = currentIndex()?.byId.get(id)?.name
  if (previous === undefined) {
    return
  }
  if (name === previous) {
    if (refocus) {
      requestRowFocus(id)
    }
    return
  }
  try {
    const response = await updateFolder(
      queryClient,
      id,
      { name },
      withFolderFields(id, { name }),
    )
    const final = response.folder.name
    if (refocus) {
      requestRowFocus(id)
    }
    flashRow(id)
    toast({
      message: response.renamed
        ? `${quoted(name)} is taken here, so it’s now ${quoted(final)}`
        : `Renamed to ${quoted(final)}`,
      undo: {
        run: () => undoRename(id, previous),
        done: `Renamed back to ${quoted(previous)}`,
      },
    })
  } catch (error) {
    toastFolderError(error, 'rename the folder')
    if (refocus) {
      requestRowFocus(id)
    }
  }
}

async function undoRename(id: number, previous: string): Promise<void> {
  assertFolderChange('folder-rename')
  const queryClient = client()
  if (!queryClient) {
    return
  }
  await undoRequest(() =>
    updateFolder(
      queryClient,
      id,
      { name: previous },
      withFolderFields(id, { name: previous }),
    ),
  )
  flashRow(id)
}

// ---- Delete (folders.md §5) -------------------------------------------------------------

/** The confirm's wording, from the real numbers. */
export function deleteWording(
  name: string,
  subfolders: number,
  files: number,
): { title: string; text: string; confirmLabel: string } {
  const scope =
    subfolders > 0
      ? `${quoted(name)} and its ${plural(subfolders, 'subfolder')} will be deleted.`
      : `${quoted(name)} will be deleted.`
  const fileText =
    files > 0
      ? `The ${plural(files, 'file')} in ${subfolders > 0 ? 'them' : 'it'} ${files === 1 ? 'moves' : 'move'} to Uncategorized.`
      : `There are no files in ${subfolders > 0 ? 'them' : 'it'}.`
  return {
    title:
      subfolders > 0
        ? `Delete ${quoted(name)} and ${plural(subfolders, 'subfolder')}?`
        : `Delete ${quoted(name)}?`,
    text: `${scope} ${fileText} No media is deleted.`,
    confirmLabel:
      subfolders > 0 ? `Delete ${subfolders + 1} folders` : 'Delete folder',
  }
}

/** Delete with a confirm that explains the subtree. No Undo (FileBird can't). */
export async function confirmDeleteFolder(ref: RowRef | null): Promise<void> {
  if (!guardFolderChange('folder-delete') || !isRealFolder(ref)) {
    return
  }
  const queryClient = client()
  const index = currentIndex()
  const folder = index?.byId.get(ref)
  if (!queryClient || !index || !folder) {
    return
  }
  const subfolders = descendantIds(index, ref).length
  const files = subtreeFileCount(index, ref)
  const wording = deleteWording(folder.name, subfolders, files)
  // The confirm returns focus to what had it when it opened: the row.
  focusRowNow(ref)
  const confirmed = await confirm({
    title: wording.title,
    body: (
      <>
        <p style={{ margin: 0 }}>{wording.text}</p>
        <p style={{ margin: '8px 0 0', color: 'var(--text-3)' }}>
          Deleted folders can’t be restored.
        </p>
      </>
    ),
    confirmLabel: wording.confirmLabel,
    tone: 'danger',
  })
  if (!confirmed) {
    return
  }
  const parent = folder.parent
  try {
    const response = await deleteFolder(queryClient, ref)
    const viewed = urlStore().get().folder
    if (typeof viewed === 'number' && response.deletedIds.includes(viewed)) {
      // You were inside the deleted subtree: land in Uncategorized, as
      // FileBird does (folders.md §11).
      urlStore().navigate({ folder: ROOT_ID, item: null })
    }
    requestRowFocus(parent !== ROOT_ID && isRealFolder(parent) ? parent : 'all')
    toast({
      message:
        response.movedFiles > 0
          ? `Deleted ${quoted(folder.name)} · ${plural(response.movedFiles, 'file')} moved to Uncategorized`
          : `Deleted ${quoted(folder.name)}`,
    })
  } catch (error) {
    toastFolderError(error, 'delete the folder')
  }
}

// ---- Moving media (folders.md §6–§7) ---------------------------------------------------

export interface MoveItemsOptions {
  /**
   * Keyboard flows (M, Delete): when focus was on a moved item, keyboard
   * focus follows to the next remaining tile, so M → Enter → M continues.
   */
  moveKeyboardFocus?: boolean
  /** The toast's wording for remove-from-folder (system.md §2). */
  removeFrom?: number
}

function skippedText(skipped: readonly ItemFailure[]): string {
  if (skipped.length === 0) {
    return ''
  }
  const forbidden = skipped.every(
    (failure) => failure.error.code === 'wpu_forbidden',
  )
  return forbidden
    ? ` · ${plural(skipped.length, 'item')} skipped: you can only change your own media`
    : ` · ${plural(skipped.length, 'item')} couldn’t be moved`
}

/**
 * Where focus and the selection go when moved items leave the folder being
 * viewed: they leave the selection, and focus moves to the next item that
 * stays (else the previous one). In detail mode the stage shows that item,
 * or returns to the grid when the folder is now empty.
 */
function followItemsLeavingView(
  ids: readonly number[],
  target: number,
  moveKeyboardFocus: boolean,
): () => void {
  const viewed = urlStore().get().folder
  if (typeof viewed !== 'number' || viewed === target) {
    return () => {}
  }
  const moved = new Set(ids)
  const order = getCurrentCollection()?.ids ?? []
  const core = coreStore.getState()
  const detailItem = urlStore().get().item
  // What a move that never reached the server puts back.
  const before = {
    selection: [...core.selection],
    focus: core.focus,
    item: detailItem,
  }
  const restore = () => {
    const state = coreStore.getState()
    state.setSelection(before.selection)
    state.setFocus(before.focus)
    if (before.item !== null && urlStore().get().item !== before.item) {
      urlStore().openItem(before.item)
    }
    if (before.focus !== null && moveKeyboardFocus) {
      const id = before.focus
      requestAnimationFrame(() => centerApi.focusTile(id))
    }
  }
  const anchorId = detailItem ?? core.focus
  const position = anchorId === null ? -1 : order.indexOf(anchorId)
  const staying = (id: number) => !moved.has(id)
  let next: number | null = null
  if (position >= 0) {
    next =
      order.slice(position).find(staying) ??
      [...order.slice(0, position)].reverse().find(staying) ??
      null
  }
  const selection = [...core.selection].filter(staying)
  if (selection.length !== core.selection.size) {
    core.setSelection(selection)
  }
  if (detailItem !== null && moved.has(detailItem)) {
    if (next === null) {
      core.setFocus(null)
      runCommand('detail.close')
    } else {
      urlStore().openItem(next)
    }
    return restore
  }
  if (core.focus !== null && moved.has(core.focus)) {
    core.setFocus(next)
    if (next !== null && moveKeyboardFocus) {
      const id = next
      requestAnimationFrame(() => centerApi.focusTile(id))
    }
  }
  return restore
}

/**
 * Moves items into a folder (0 = Uncategorized): drag and drop, Move to…,
 * remove from folder. Toast with Undo, or "Already in …".
 */
export async function moveItemsTo(
  ids: readonly number[],
  folder: number,
  options: MoveItemsOptions = {},
): Promise<void> {
  if (ids.length === 0) {
    toast({ message: MESSAGES.selectFirst, tone: 'info' })
    return
  }
  if (!guardFolderChange('move-to-folder')) {
    return
  }
  const queryClient = client()
  if (!queryClient) {
    return
  }
  const index = currentIndex()
  const label = targetLabel(index, folder)
  if (folder !== ROOT_ID) {
    rememberRecent(folder)
  }
  // Items the user may not change (an Author's view of others' media) stay
  // put; the server skips them and the toast says so.
  const editable = ids.filter(
    (id) => cachedItem(queryClient, id)?.perms.edit !== false,
  )
  const restoreView = followItemsLeavingView(
    editable,
    folder,
    options.moveKeyboardFocus ?? false,
  )
  const outcome = await assignItemsToFolder(queryClient, folder, ids, {
    optimisticIds: editable,
  })
  if (outcome.done === 0 && (outcome.error !== null || outcome.aborted)) {
    // Nothing reached the server: the items stay, and so do the
    // selection, focus and the item on stage.
    restoreView()
    toastFolderError(outcome.error, 'move the items')
    return
  }
  const moved = outcome.movedIds.length
  const skipped = skippedText(outcome.skipped)
  if (moved === 0 && outcome.error === null) {
    if (outcome.skipped.length > 0) {
      toast({
        message: `Nothing was moved${skipped}`,
        tone: 'warning',
      })
      return
    }
    toast({
      message:
        ids.length === 1
          ? `Already in ${label}`
          : `All ${plural(ids.length, 'item')} are already in ${label}`,
    })
    return
  }
  const what = plural(moved, 'item')
  const removedFrom =
    options.removeFrom !== undefined && folder === ROOT_ID
      ? targetLabel(index, options.removeFrom)
      : null
  const message = removedFrom
    ? `Removed ${what} from ${removedFrom}`
    : `Moved ${what} to ${label}`
  toast({
    message: `${message}${skipped}`,
    tone: outcome.error === null ? 'info' : 'warning',
    undo: {
      run: async () => {
        assertFolderChange('move-to-folder')
        await undoRequest(() =>
          restoreItemFolders(queryClient, outcome.previous, folder),
        )
      },
      done: `Moved ${what} back`,
    },
  })
  if (outcome.error !== null) {
    toastFolderError(outcome.error, 'move the rest')
  }
}

/** The ids M and Delete act on: the selection, or the focused item. */
export function currentTargets(): number[] {
  const order = getCurrentCollection()?.ids ?? []
  const core = coreStore.getState()
  return targetIds(
    { selection: core.selection, anchor: core.anchor, focus: core.focus },
    order,
  )
}

/** `M` on media: the Move to… dialog for the targets. */
export function moveTargetsToFolder(): void {
  if (!guardFolderChange('move-to-folder')) {
    return
  }
  const ids = currentTargets()
  if (ids.length === 0) {
    toast({ message: MESSAGES.selectFirst, tone: 'info' })
    return
  }
  openMoveRequest({ kind: 'items', ids })
}

/** `Delete` inside a folder: the targets go to Uncategorized, with Undo. */
export async function removeTargetsFromFolder(): Promise<void> {
  const viewed = urlStore().get().folder
  if (typeof viewed !== 'number' || viewed === ROOT_ID) {
    return
  }
  const ids = currentTargets()
  if (ids.length === 0) {
    announce(MESSAGES.deleteWhat)
    return
  }
  await moveItemsTo(ids, ROOT_ID, {
    moveKeyboardFocus: true,
    removeFrom: viewed,
  })
}

// ---- Moving folders (folders.md §6–§7) ------------------------------------------------------

/**
 * Moves a folder to `move` (drag and drop, Move to… in folder mode). Toast
 * with Undo, which puts it back where it was.
 */
export async function moveFolderTo(
  id: number,
  move: FolderMove,
): Promise<void> {
  if (!guardFolderChange('folder-move')) {
    return
  }
  const queryClient = client()
  const index = currentIndex()
  const folder = index?.byId.get(id)
  const before = index ? currentPlacement(index, id) : null
  if (!queryClient || !index || !folder || !before) {
    return
  }
  try {
    await updateFolder(queryClient, id, move, movedFolders(id, move))
  } catch (error) {
    toastFolderError(error, 'move the folder')
    return
  }
  if (move.parent !== ROOT_ID) {
    expandFolders([move.parent])
  }
  flashRow(id)
  const message =
    move.parent === before.parent
      ? `Moved ${quoted(folder.name)}`
      : move.parent === ROOT_ID
        ? `Moved ${quoted(folder.name)} to the top level`
        : `Moved ${quoted(folder.name)} into ${targetLabel(index, move.parent)}`
  if (move.parent !== ROOT_ID) {
    rememberRecent(move.parent)
  }
  toast({
    message,
    undo: {
      run: async () => {
        assertFolderChange('folder-move')
        await undoRequest(() =>
          updateFolder(queryClient, id, before, movedFolders(id, before)),
        )
        flashRow(id)
      },
      done: `Moved ${quoted(folder.name)} back`,
    },
  })
}

/** Move to… in folder mode: into `parent` (0 = the top level), as its last child. */
export async function moveFolderInto(
  id: number,
  parent: number,
): Promise<void> {
  const index = currentIndex()
  if (!index) {
    return
  }
  const resolution = resolveFolderMove(
    index,
    id,
    parent === ROOT_ID
      ? { kind: 'root' }
      : { kind: 'row', targetId: parent, operation: 'combine' },
  )
  if (!resolution.ok) {
    toast({ message: MESSAGES.cycle, tone: 'error' })
    return
  }
  if (resolution.noop) {
    toast({
      message: `${quoted(index.byId.get(id)?.name ?? 'folder')} is already there`,
    })
    return
  }
  await moveFolderTo(id, resolution.move)
}

/**
 * "Create folder “query”" in the Move dialog: a new top-level folder, then
 * the move into it. Resolves with the new folder's id, or null.
 */
export async function createTopLevelFolder(
  name: string,
): Promise<number | null> {
  if (!guardFolderChange('folder-create')) {
    return null
  }
  const queryClient = client()
  const clean = cleanFolderName(name)
  if (!queryClient || clean === '') {
    return null
  }
  try {
    const response = await createFolder(queryClient, clean, ROOT_ID)
    flashRow(response.folder.id)
    if (response.renamed) {
      toast({
        message: `A folder named ${quoted(response.requestedName ?? clean)} is already there, so this one is ${quoted(response.folder.name)}.`,
      })
    }
    return response.folder.id
  } catch (error) {
    toastFolderError(error, 'create the folder')
    return null
  }
}

// ---- Pro colours (folders.md §9) ---------------------------------------------------------

export async function setFolderColor(
  id: number,
  color: string | null,
): Promise<void> {
  if (!guardFolderChange('folder-color')) {
    return
  }
  const queryClient = client()
  if (!queryClient) {
    return
  }
  try {
    await updateFolder(
      queryClient,
      id,
      { color },
      withFolderFields(id, { color }),
    )
    flashRow(id)
  } catch (error) {
    toastFolderError(error, 'change the colour')
  }
}

// ---- Menus and the Move dialog ------------------------------------------------------------------

/** Opens the context menu of a row (right-click, the ContextMenu key). */
export function openContextMenu(row: RowRef, anchor: MenuAnchor): void {
  if (!guardFolderChange('folder-create')) {
    return
  }
  const editing = folderUiStore.getState().editing
  if (editing) {
    void commitEditFrom(editing, currentDraft(), { refocus: false })
  }
  openColumn()
  if (typeof row === 'number' && row !== ROOT_ID) {
    revealRow(row)
  }
  folderUiStore.setState({ menu: { row, anchor }, focusedRow: row })
}

/** Move to… for a folder (its context menu, or `M` on its row). */
export function moveFolderWithDialog(id: number): void {
  if (!guardFolderChange('folder-move') || !isRealFolder(id)) {
    return
  }
  openMoveRequest({ kind: 'folder', folderId: id })
}
