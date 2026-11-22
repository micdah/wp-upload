// Folder operations (Stage 4, area "Folders & organising"): create and
// rename in place, delete with confirm, the folder context menu, Pro folder
// colours, keyboard shortcuts N / R / M / ContextMenu, and the bus actions
// move-to-folder, new-folder and remove-from-folder. Drag and drop and the
// Move to… dialog live in folders-dnd.js and folders-move.js.

import { library } from '../data.js'
import { registerFeature } from '../features.js'
import {
  focusRow,
  parseFolderId,
  renderTree,
  returnFocusOnEscape,
  rowElement,
  syncColumnVisibility,
  treeUi,
} from '../folders.js'
import { registerAction, registerBindings } from '../keymap.js'
import { targetItems } from '../selection.js'
import { state, update } from '../store.js'
import { confirmDialog, on, openMenu, showToast } from '../ui.js'
import { announce, html, icon } from '../util.js'
import { initFolderDragAndDrop } from './folders-dnd.js'
import {
  cleanName,
  createFolder,
  deleteFolder,
  descendantIds,
  filesInSubtree,
  foldersEditable,
  foldersEnabled,
  isPerUser,
  isPro,
  renameFolder,
  setFolderColor,
} from './folders-model.js'
import { moveItems, openMoveDialog } from './folders-move.js'

const foldersEl = () => document.getElementById('folders')

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

// --- Guards --------------------------------------------------------------------------

// Explains why a folder change can't happen, instead of failing silently.
function ensureEditable() {
  if (state.scenario === 'offline') {
    showToast({
      text: 'WordPress can’t be reached, so folder changes can’t be saved right now.',
      iconName: 'wifi-off',
    })
    return false
  }
  if (foldersEditable()) return true
  showToast({
    text: isPerUser()
      ? 'Folder changes are off: FileBird’s per-user folders aren’t supported.'
      : 'Folders need the FileBird plugin on your WordPress site.',
    iconName: 'info-circle',
  })
  return false
}

function openColumn() {
  if (state.panels.folders) return
  update({ panels: { ...state.panels, folders: true } }, ['panels'])
}

// The folder a keyboard command applies to: the focused tree row when focus
// is in the tree, otherwise the folder being viewed.
function contextFolder() {
  const rowEl = document.activeElement?.closest?.('#folders .tree__row')
  if (rowEl?.dataset.folder !== undefined) {
    return parseFolderId(rowEl.dataset.folder)
  }
  return state.folder
}

function isRealFolder(id) {
  return typeof id === 'number' && library.folderById.has(id)
}

// --- Inline create / rename --------------------------------------------------------

function nameInput() {
  return foldersEl().querySelector('.tree__rename')
}

function focusNameInput({ select = true } = {}) {
  const input = nameInput()
  if (!input) return
  input.focus()
  if (select) input.select()
  input.scrollIntoView({ block: 'nearest' })
}

// Expands every ancestor of `folderId` (and the folder itself when
// `includeSelf`), and clears the folder search, so an edited row is visible.
function revealFolder(folderId, { includeSelf = false } = {}) {
  const expandedFolders = new Set(state.expandedFolders)
  let id = includeSelf ? folderId : library.folderById.get(folderId)?.parent
  while (id) {
    expandedFolders.add(id)
    id = library.folderById.get(id)?.parent
  }
  treeUi.search = ''
  const search = foldersEl().querySelector('[name="folder-search"]')
  if (search) search.value = ''
  update({ expandedFolders }, ['folders'])
}

// Shows a name input as the last child of `parentId` (0 = top level).
export function startNewFolder(parentId = 0) {
  if (!ensureEditable()) return
  finishEditing()
  openColumn()
  treeUi.editing = { mode: 'new', parent: parentId }
  revealFolder(parentId, { includeSelf: true })
  focusNameInput()
  announce('New folder. Type a name, Enter to create, Escape to cancel.')
}

export function startRename(folderId) {
  if (!ensureEditable()) return
  if (!isRealFolder(folderId)) {
    showToast({
      text: 'Open or focus a folder to rename it.',
      iconName: 'info-circle',
    })
    return
  }
  finishEditing()
  openColumn()
  treeUi.editing = { mode: 'rename', id: folderId }
  revealFolder(folderId)
  focusNameInput()
}

function cancelEditing() {
  const editing = treeUi.editing
  if (!editing) return
  treeUi.editing = null
  renderTree()
  focusRow(editing.mode === 'rename' ? editing.id : editing.parent || 'all')
}

// Briefly highlights a row that just appeared or changed.
function flashRow(id) {
  const rowEl = rowElement(id)
  if (!rowEl) return
  rowEl.classList.add('is-flash')
  setTimeout(() => rowElement(id)?.classList.remove('is-flash'), 1200)
}

function commitNew(editing, name) {
  treeUi.editing = null
  const { folder, renamed } = createFolder(editing.parent, name)
  focusRow(folder.id)
  flashRow(folder.id)
  if (renamed) {
    showToast({
      text: `A folder named “${name}” is already there, so this one is “${folder.name}”.`,
      iconName: 'info-circle',
    })
  } else {
    announce(`Folder “${folder.name}” created`)
  }
}

function commitRename(editing, name) {
  treeUi.editing = null
  const folder = library.folderById.get(editing.id)
  if (!folder || name === folder.name) {
    renderTree()
    focusRow(editing.id)
    return
  }
  const result = renameFolder(editing.id, name)
  focusRow(editing.id)
  flashRow(editing.id)
  showToast({
    text: result.renamed
      ? `“${name}” is taken here, so it’s now “${result.name}”`
      : `Renamed to “${result.name}”`,
    iconName: 'pencil',
    actionLabel: 'Undo',
    onAction: () => renameFolder(editing.id, result.previous),
  })
}

// Enter or leaving the field saves; an empty name cancels.
function finishEditing() {
  const editing = treeUi.editing
  const input = nameInput()
  if (!editing || !input) return
  const name = cleanName(input.value)
  if (!name) {
    cancelEditing()
    return
  }
  if (editing.mode === 'new') commitNew(editing, name)
  else commitRename(editing, name)
}

function onNameKeyDown(event) {
  if (!event.target.matches('.tree__rename')) return
  if (event.key === 'Enter') {
    event.preventDefault()
    finishEditing()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    cancelEditing()
  }
}

function onNameFocusOut(event) {
  if (!event.target.matches('.tree__rename')) return
  // A re-render swaps the input for a new one that gets focus back; only
  // save when focus really left the field.
  setTimeout(() => {
    if (document.activeElement?.matches?.('.tree__rename')) return
    if (treeUi.editing) finishEditing()
  })
}

// --- Delete -------------------------------------------------------------------------

export async function confirmDeleteFolder(folderId) {
  if (!ensureEditable() || !isRealFolder(folderId)) return
  const folder = library.folderById.get(folderId)
  const subfolders = descendantIds(folderId).length
  const files = filesInSubtree(folderId)
  const scope = subfolders
    ? `“${folder.name}” and its ${plural(subfolders, 'subfolder')} will be deleted.`
    : `“${folder.name}” will be deleted.`
  const fileText = files
    ? `The ${plural(files, 'file')} in ${subfolders ? 'them' : 'it'} move to Uncategorized.`
    : 'There are no files in it.'
  const confirmed = await confirmDialog({
    title: subfolders
      ? `Delete “${folder.name}” and ${plural(subfolders, 'subfolder')}?`
      : `Delete “${folder.name}”?`,
    text: `${scope} ${fileText} No media is deleted.`,
    notice: 'Deleted folders can’t be restored.',
    confirmLabel: subfolders
      ? `Delete ${subfolders + 1} folders`
      : 'Delete folder',
    danger: true,
  })
  if (!confirmed) return
  const parent = folder.parent
  const result = deleteFolder(folderId)
  focusRow(parent || 'all')
  showToast({
    text: result.movedFiles
      ? `Deleted “${folder.name}” · ${plural(result.movedFiles, 'file')} moved to Uncategorized`
      : `Deleted “${folder.name}”`,
    iconName: 'trash',
  })
}

// --- Pro colours ------------------------------------------------------------------------

const COLOURS = [
  ['Grey', '#8f8f8f'],
  ['Red', '#ff4d5e'],
  ['Orange', '#ff7a59'],
  ['Yellow', '#ffc82c'],
  ['Green', '#13ce66'],
  ['Teal', '#14b8a6'],
  ['Blue', '#1fb6ff'],
  ['Purple', '#7c5cff'],
  ['Pink', '#ff49db'],
]

// A small popover of swatches; FileBird Pro stores one colour per folder.
function openColourPicker(folderId, x, y) {
  const folder = library.folderById.get(folderId)
  const menu = openMenu({
    x,
    y,
    label: `Colour of “${folder.name}”`,
    items: [
      {
        label: 'No colour',
        icon: 'circle',
        onSelect: () => setFolderColor(folderId, null),
      },
    ],
  })
  menu.classList.add('folders-menu', 'colour-menu')
  const swatches = document.createElement('div')
  swatches.className = 'colour-menu__swatches'
  swatches.setAttribute('role', 'group')
  swatches.setAttribute('aria-label', 'Colours')
  swatches.innerHTML = COLOURS.map(([name, value]) =>
    String(html`<button
      class="colour-menu__swatch"
      role="menuitemradio"
      aria-checked="${String(folder.color === value)}"
      aria-label="${name}"
      title="${name}"
      data-colour="${value}"
      style="--folder-color:${value}"
    >${folder.color === value ? icon('check', 'icon--sm') : ''}</button>`),
  ).join('')
  menu.querySelector('.menu__label').after(swatches)
  swatches.addEventListener('click', (event) => {
    const value = event.target.closest('[data-colour]')?.dataset.colour
    if (!value) return
    menu.remove()
    setFolderColor(folderId, value)
    focusRow(folderId)
  })
  // Arrow keys walk the swatches like the rest of the menu.
  swatches.addEventListener('keydown', (event) => {
    const buttons = [...swatches.querySelectorAll('button')]
    const index = buttons.indexOf(document.activeElement)
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key]
    if (!step) return
    event.preventDefault()
    buttons[(index + step + buttons.length) % buttons.length].focus()
  })
  const current = swatches.querySelector('[aria-checked="true"]')
  ;(current ?? swatches.querySelector('button')).focus()
  returnFocusOnEscape(menu, rowElement(folderId))
}

// --- Context menu ------------------------------------------------------------------------

function folderMenuItems(id, position) {
  if (!isRealFolder(id)) {
    return [
      {
        label: 'New folder',
        icon: 'folder-plus',
        kbd: 'N',
        onSelect: () => startNewFolder(0),
      },
    ]
  }
  const items = [
    {
      label: 'New subfolder',
      icon: 'folder-plus',
      kbd: 'N',
      onSelect: () => startNewFolder(id),
    },
    {
      label: 'Rename',
      icon: 'pencil',
      kbd: 'R',
      onSelect: () => startRename(id),
    },
    {
      label: 'Move to…',
      icon: 'folders',
      onSelect: () => openMoveDialog({ kind: 'folder', folderId: id }),
    },
  ]
  if (isPro()) {
    items.push({
      label: 'Colour…',
      icon: 'circle',
      onSelect: () => openColourPicker(id, position.x, position.y),
    })
  }
  items.push('separator', {
    label: 'Delete folder',
    icon: 'trash',
    kbd: 'Del',
    danger: true,
    onSelect: () => confirmDeleteFolder(id),
  })
  return items
}

export function openFolderMenu(id, x, y) {
  if (!ensureEditable()) return
  finishEditing()
  const label = isRealFolder(id) ? library.folderById.get(id).name : 'Folders'
  const menu = openMenu({ x, y, label, items: folderMenuItems(id, { x, y }) })
  menu.classList.add('folders-menu')
  // Show the folder's own colour on the "Colour…" item.
  const colour = isPro() && library.folderById.get(id)?.color
  if (colour) {
    menu
      .querySelector('.menu__item[data-index="3"] .icon')
      ?.style.setProperty('color', colour)
  }
  returnFocusOnEscape(menu, rowElement(id))
  rowElement(id)?.classList.add('is-menu-open')
  const observer = new MutationObserver(() => {
    if (menu.isConnected) return
    rowElement(id)?.classList.remove('is-menu-open')
    observer.disconnect()
  })
  observer.observe(document.body, { childList: true })
}

function openMenuForRow(rowEl) {
  const rect = rowEl.getBoundingClientRect()
  openFolderMenu(
    parseFolderId(rowEl.dataset.folder),
    rect.left + 24,
    rect.bottom + 2,
  )
}

// --- Keyboard and bus actions ----------------------------------------------------------

function newFolderFromContext() {
  const id = contextFolder()
  startNewFolder(isRealFolder(id) ? id : 0)
}

function moveToFolder() {
  if (!ensureEditable()) return
  // With focus on a folder row, M moves that folder; otherwise the media.
  const id = contextFolder()
  if (
    document.activeElement?.closest?.('#folders .tree__row') &&
    isRealFolder(id)
  ) {
    openMoveDialog({ kind: 'folder', folderId: id })
    return
  }
  const ids = targetItems().map((item) => item.id)
  if (ids.length === 0) {
    showToast({
      text: 'Select media first, then move it to a folder.',
      iconName: 'info-circle',
    })
    return
  }
  openMoveDialog({ kind: 'items', ids })
}

function removeFromFolder() {
  if (!ensureEditable()) return
  const ids = targetItems().map((item) => item.id)
  if (ids.length) moveItems(ids, 0)
}

function folderMenuFromKeyboard() {
  const rowEl =
    document.activeElement?.closest?.('#folders .tree__row[data-folder]') ??
    rowElement(state.folder)
  if (rowEl) openMenuForRow(rowEl)
}

function registerKeys() {
  registerBindings([
    {
      key: 'n',
      mode: 'grid',
      action: 'new-folder',
      group: 'Folders',
      label: 'New folder (inside the current or focused folder)',
    },
    {
      key: 'r',
      mode: 'grid',
      action: 'rename-folder',
      group: 'Folders',
      label: 'Rename the current or focused folder',
    },
    {
      key: 'm',
      mode: 'any',
      action: 'move-to-folder',
      group: 'Folders',
      label: 'Move selection to folder…',
    },
    {
      key: 'ContextMenu',
      mode: 'grid',
      action: 'folder-menu',
      group: 'Folders',
      label: 'Folder menu',
    },
  ])
  registerAction('new-folder', newFolderFromContext)
  registerAction('rename-folder', () => startRename(contextFolder()))
  registerAction('move-to-folder', moveToFolder)
  registerAction('folder-menu', folderMenuFromKeyboard)
}

// --- Pointer events on the column ---------------------------------------------------------

function onColumnDoubleClick(event) {
  if (event.target.closest('.tree__twisty, .tree__rename')) return
  const rowEl = event.target.closest('.tree__row[data-folder]')
  const id = rowEl && parseFolderId(rowEl.dataset.folder)
  if (isRealFolder(id) && foldersEditable()) startRename(id)
}

function onColumnContextMenu(event) {
  const rowEl = event.target.closest('.tree__row[data-folder]')
  if (!rowEl || event.target.closest('.tree__rename')) return
  event.preventDefault()
  if (event.button === 0 && event.clientX === 0) openMenuForRow(rowEl)
  else {
    openFolderMenu(
      parseFolderId(rowEl.dataset.folder),
      event.clientX,
      event.clientY,
    )
  }
}

// Delete on a focused folder row deletes the folder (the global Delete key
// acts on media). Handled here so it never reaches the media handler.
function onColumnKeyDown(event) {
  const rowEl = event.target.closest('.tree__row[data-folder]')
  if (!rowEl || event.target.closest('input')) return
  if (event.key !== 'Delete' && event.key !== 'Backspace') return
  event.preventDefault()
  confirmDeleteFolder(parseFolderId(rowEl.dataset.folder))
}

// --- Feature registration ------------------------------------------------------------------

function init() {
  syncColumnVisibility()
  // No FileBird: no folder shortcuts, and folder actions explain why.
  if (!foldersEnabled()) {
    registerAction('move-to-folder', ensureEditable)
    on('move-to-folder', ensureEditable)
    on('new-folder', ensureEditable)
    on('remove-from-folder', ensureEditable)
    return
  }
  registerKeys()
  const folders = foldersEl()
  folders.addEventListener('dblclick', onColumnDoubleClick)
  folders.addEventListener('contextmenu', onColumnContextMenu)
  folders.addEventListener('keydown', onColumnKeyDown)
  folders.addEventListener('keydown', onNameKeyDown)
  folders.addEventListener('focusout', onNameFocusOut)
  on('move-to-folder', moveToFolder)
  on('new-folder', newFolderFromContext)
  on('remove-from-folder', removeFromFolder)
  initFolderDragAndDrop()
}

function onChange(changes) {
  if (changes.has('panels')) syncColumnVisibility()
}

registerFeature({ init, onChange })
