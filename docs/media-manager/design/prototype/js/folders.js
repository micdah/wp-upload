// FileBird folder column: header (new folder, options, hide), a folder
// search box, All files + Uncategorized, then the nested tree with live
// counts. The tree is an ARIA tree with a roving tabindex. The column is
// drag-resizable (220–480 px, remembered) and collapsible with F.
//
// Folder operations (create, rename, delete, drag and drop, Move to…) live in
// features/folders-ops.js; this module renders whatever state they set in
// `treeUi` (e.g. an inline name input) and owns navigation.

import { library } from './data.js'
import {
  directCounts,
  folderCount,
  foldersEditable,
  foldersEnabled,
  isPerUser,
  isPro,
  loadPrefs,
  prefs,
  setPref,
  sortedChildren,
} from './features/folders-model.js'
import { registerAction } from './keymap.js'
import { state, update } from './store.js'
import { emit, openMenu, showToast } from './ui.js'
import { writeUrl } from './url.js'
import { announce, clamp, html, icon, raw } from './util.js'

const foldersEl = () => document.getElementById('folders')
const treeEl = () => document.getElementById('folder-tree')
const WIDTH_KEY = 'mm-proto-folders-width'
const MIN_WIDTH = 220
const MAX_WIDTH = 480

// View state of the column that isn't app state (not in the URL).
export const treeUi = {
  search: '',
  // { mode: 'new' | 'rename', id?, parent } while a name input is shown.
  editing: null,
  // Row that holds the roving tabindex ('all' | 0 | folder id).
  focusId: null,
  // Folder being dragged, dimmed in the tree.
  dragId: null,
}

export function parseFolderId(value) {
  return value === 'all' ? 'all' : Number(value)
}

// --- Search -------------------------------------------------------------------------
// Client-side filter: matching folders plus their ancestors stay visible, and
// those ancestors are shown expanded without touching the saved expansion.

function searchVisibility() {
  const query = treeUi.search.trim().toLowerCase()
  if (!query) return null
  const visible = new Set()
  for (const folder of library.folders) {
    if (!folder.name.toLowerCase().includes(query)) continue
    for (
      let node = folder;
      node && !visible.has(node.id);
      node = library.folderById.get(node.parent)
    ) {
      visible.add(node.id)
    }
  }
  return visible
}

function highlight(name) {
  const query = treeUi.search.trim()
  if (!query) return name
  const start = name.toLowerCase().indexOf(query.toLowerCase())
  if (start === -1) return name
  const end = start + query.length
  return html`${name.slice(0, start)}<mark class="tree__match">${name.slice(start, end)}</mark>${name.slice(end)}`
}

// --- Rows ---------------------------------------------------------------------------

function folderIcon(folder, expanded) {
  const glyph = icon(expanded ? 'folder-open' : 'folder', 'icon--sm')
  if (!isPro() || !folder?.color) return glyph
  return html`<span class="tree__color" style="--folder-color:${folder.color}">${glyph}</span>`
}

function twisty(id, hasChildren, expanded) {
  if (!hasChildren) {
    return html`<span class="tree__twisty tree__twisty--empty"></span>`
  }
  return html`<span class="tree__twisty" data-toggle="${id}" data-expanded="${String(expanded)}"
    >${icon('chevron-right', 'icon--sm')}</span
  >`
}

function nameInput(value, label) {
  return html`<input
    class="input tree__rename"
    name="folder-name"
    value="${value}"
    maxlength="200"
    placeholder="Folder name"
    aria-label="${label}"
    autocomplete="off"
    spellcheck="false"
  />`
}

// A row is a focusable div (not a button) so it can hold the rename input
// and be dragged in every browser.
function row({
  id,
  name,
  count,
  depth = 0,
  iconHtml,
  hasChildren = false,
  expanded = false,
  folder = null,
  groupId = '',
}) {
  const current = state.folder === id
  const editingThis =
    treeUi.editing?.mode === 'rename' && treeUi.editing.id === id
  const draggable = folder && foldersEditable() && !editingThis
  return html`<div
    class="tree__row${editingThis ? ' is-editing' : ''}${treeUi.dragId === id ? ' is-drag-source' : ''}"
    role="treeitem"
    data-folder="${id}"
    aria-level="${depth + 1}"
    aria-selected="${String(current)}"
    aria-current="${String(current)}"
    ${hasChildren ? html`aria-expanded="${String(expanded)}" aria-owns="${groupId}"` : ''}
    tabindex="-1"
    ${draggable ? raw('draggable="true"') : ''}
    style="--depth:${depth}"
  >
    ${twisty(id, hasChildren, expanded)}${iconHtml}
    ${
      editingThis
        ? nameInput(name, `Rename folder ${name}`)
        : html`<span class="tree__name" title="${name}">${highlight(name)}</span>`
    }
    <span class="tree__count num">${count}</span>
  </div>`
}

function newFolderRow(depth) {
  return html`<li role="none">
    <div class="tree__row is-editing is-new" style="--depth:${depth}">
      <span class="tree__twisty tree__twisty--empty"></span>${icon('folder-plus', 'icon--sm')}
      ${nameInput('', 'New folder name')}
    </div>
  </li>`
}

function branch(parentId, depth, context) {
  const { counts, visible } = context
  const children = sortedChildren(parentId).filter(
    (folder) => !visible || visible.has(folder.id),
  )
  const rows = children.map((folder) => {
    const grandchildren = sortedChildren(folder.id).filter(
      (child) => !visible || visible.has(child.id),
    )
    const addingHere =
      treeUi.editing?.mode === 'new' && treeUi.editing.parent === folder.id
    const hasChildren = grandchildren.length > 0 || addingHere
    const expanded =
      hasChildren &&
      (Boolean(visible) || addingHere || state.expandedFolders.has(folder.id))
    const groupId = `tree-group-${folder.id}`
    return html`<li role="none">
      ${row({
        id: folder.id,
        name: folder.name,
        count: folderCount(folder.id, counts),
        depth,
        iconHtml: folderIcon(folder, expanded),
        hasChildren,
        expanded,
        folder,
        groupId,
      })}${
        expanded
          ? html`<ul class="tree__group" role="group" id="${groupId}">${branch(folder.id, depth + 1, context)}</ul>`
          : ''
      }
    </li>`
  })
  if (treeUi.editing?.mode === 'new' && treeUi.editing.parent === parentId) {
    rows.push(newFolderRow(depth))
  }
  return rows
}

function emptyTree() {
  if (treeUi.search.trim()) {
    return html`<li role="none" class="folders__empty">
      <span>No folders match “${treeUi.search.trim()}”.</span>
      <button class="btn btn--ghost btn--sm" data-action="clear-search">${icon('x')}Clear search</button>
    </li>`
  }
  if (treeUi.editing?.mode === 'new') return ''
  return html`<li role="none" class="folders__empty">
    <span>No folders yet. Folders help you group media; a file lives in one folder.</span>
    ${
      foldersEditable()
        ? html`<button class="btn btn--sm" data-mm-action="new-folder">${icon('folder-plus')}New folder</button>`
        : ''
    }
  </li>`
}

function treeHtml() {
  const counts = directCounts()
  const visible = searchVisibility()
  const folders = branch(0, 0, { counts, visible })
  const pseudo = visible
    ? ''
    : html`<li role="none">${row({
        id: 'all',
        name: 'All files',
        count: folderCount('all', counts),
        iconHtml: icon('photo', 'icon--sm'),
      })}</li>
      <li role="none">${row({
        id: 0,
        name: 'Uncategorized',
        count: folderCount(0, counts),
        iconHtml: icon('folder', 'icon--sm tree__icon--muted'),
      })}</li>
      <li role="none"><div class="tree__separator"></div></li>`
  const hasFolders = folders.length > 0
  return html`${pseudo}${hasFolders ? folders : emptyTree()}`
}

// --- Rendering ---------------------------------------------------------------------

function perUserNotice() {
  return html`<div class="notice notice--warn folders__notice" role="note">
    ${icon('alert-triangle')}
    <div class="folders__notice-body">
      <strong>Per-user folders aren’t supported</strong>
      <p>FileBird gives each user their own folders, so you see only this account’s folders, read-only.</p>
      <p>Turn off “Each user has his own folders” in FileBird to organise media here.</p>
    </div>
  </div>`
}

function shellHtml() {
  const editable = foldersEditable()
  return html`
    <div class="folders__inner">
      <div class="panel-header">
        <span class="panel-header__title" id="folders-title">Folders</span>
        <button class="icon-btn" data-mm-action="new-folder" title="New folder (N)" aria-label="New folder" ${editable ? '' : 'disabled'}>
          ${icon('folder-plus')}
        </button>
        <button class="icon-btn" data-action="options" title="Folder options" aria-label="Folder options" aria-haspopup="menu">
          ${icon('dots')}
        </button>
        <button class="icon-btn" data-action="collapse" title="Hide folders (F)" aria-label="Hide folders">
          ${icon('layout-sidebar')}
        </button>
      </div>
      <div class="folders__search">
        <label class="search">
          ${icon('search', 'icon--sm')}
          <input class="input" type="search" name="folder-search" placeholder="Find folder" aria-label="Find folder" aria-controls="folder-tree" autocomplete="off" />
        </label>
      </div>
      ${isPerUser() ? perUserNotice() : ''}
      <ul class="tree" id="folder-tree" role="tree" aria-labelledby="folders-title" data-sort="${isPro() ? prefs.sort : 'manual'}"></ul>
    </div>
    <div class="resizer" role="separator" aria-orientation="vertical" aria-label="Resize folder column" tabindex="0"></div>
  `
}

// The row that should carry tabindex=0: the remembered one, else the
// current folder, else All files.
function rovingRow(tree) {
  const find = (id) =>
    id === null || id === undefined
      ? null
      : tree.querySelector(`.tree__row[data-folder="${id}"]`)
  return (
    find(treeUi.focusId) ??
    find(state.folder) ??
    tree.querySelector('.tree__row[data-folder]')
  )
}

// Re-renders only the tree, keeping keyboard focus, the scroll position and
// a half-typed folder name across the re-render.
export function renderTree() {
  const tree = treeEl()
  if (!tree) return
  const active = document.activeElement
  const hadFocus = tree.contains(active)
  const focusedId = active?.closest?.('.tree__row[data-folder]')?.dataset.folder
  const liveInput = tree.querySelector('.tree__rename')
  const draft = liveInput && {
    value: liveInput.value,
    start: liveInput.selectionStart,
    end: liveInput.selectionEnd,
    focused: active === liveInput,
  }
  const scrollTop = tree.scrollTop
  tree.dataset.sort = isPro() ? prefs.sort : 'manual'
  tree.innerHTML = String(treeHtml())
  tree.scrollTop = scrollTop

  if (focusedId !== undefined) treeUi.focusId = parseFolderId(focusedId)
  const roving = rovingRow(tree)
  roving?.setAttribute('tabindex', '0')

  const newInput = tree.querySelector('.tree__rename')
  if (draft && newInput) {
    newInput.value = draft.value
    if (draft.focused) {
      newInput.focus()
      newInput.setSelectionRange(draft.start, draft.end)
    }
  } else if (hadFocus && !newInput) {
    roving?.focus({ preventScroll: true })
  }
  // Hook for features that add rows to the tree (e.g. Trash): the tree's
  // content is replaced on every render, so they re-add them here.
  emit('folders-rendered', { tree })
}

export function renderFolders() {
  const folders = foldersEl()
  // No FileBird: no column and no folder UI at all.
  if (!foldersEnabled()) {
    folders.hidden = true
    folders.innerHTML = ''
    return
  }
  if (!folders.querySelector('.folders__inner')) {
    folders.innerHTML = String(shellHtml())
  }
  renderTree()
}

export function rowElement(id) {
  return treeEl()?.querySelector(`.tree__row[data-folder="${id}"]`)
}

export function focusRow(id) {
  const target = rowElement(id)
  if (!target) return
  treeUi.focusId = id
  for (const other of treeEl().querySelectorAll('.tree__row[tabindex="0"]')) {
    other.tabIndex = -1
  }
  target.tabIndex = 0
  target.focus()
  target.scrollIntoView({ block: 'nearest' })
}

// --- Navigation ---------------------------------------------------------------------

export function openFolder(id) {
  treeUi.focusId = id
  if (state.folder === id && state.view === 'grid') return
  update(
    {
      folder: id,
      view: 'grid',
      selection: new Set(),
      focus: null,
      anchor: null,
    },
    ['collection', 'folders', 'selection', 'view'],
  )
  writeUrl()
  announce(
    `Showing ${rowElement(id)?.querySelector('.tree__name')?.textContent ?? 'folder'}`,
  )
}

export function setExpanded(id, expanded) {
  const next = new Set(state.expandedFolders)
  if (expanded) next.add(id)
  else next.delete(id)
  update({ expandedFolders: next }, ['folders'])
}

function setAllExpanded(expanded) {
  const next = expanded
    ? new Set(
        library.folders
          .filter((folder) => sortedChildren(folder.id).length)
          .map((folder) => folder.id),
      )
    : new Set()
  update({ expandedFolders: next }, ['folders'])
  announce(expanded ? 'All folders expanded' : 'All folders collapsed')
}

function visibleRows() {
  return [...treeEl().querySelectorAll('.tree__row[data-folder]')]
}

function parentRow(rowEl) {
  return rowEl
    .closest('.tree__group')
    ?.closest('li')
    ?.querySelector('.tree__row')
}

// Arrow keys follow the WAI-ARIA tree pattern. Enter / Space open a folder.
function onTreeKeyDown(event) {
  const rowEl = event.target.closest('.tree__row[data-folder]')
  if (!rowEl || event.target.closest('input')) return
  if (event.altKey || event.ctrlKey || event.metaKey) return
  const rows = visibleRows()
  const index = rows.indexOf(rowEl)
  const id = parseFolderId(rowEl.dataset.folder)
  const expandable = rowEl.hasAttribute('aria-expanded')
  const expanded = rowEl.getAttribute('aria-expanded') === 'true'
  const moveTo = (target) => {
    if (target) focusRow(parseFolderId(target.dataset.folder))
  }
  switch (event.key) {
    case 'ArrowDown':
      moveTo(rows[index + 1])
      break
    case 'ArrowUp':
      moveTo(rows[index - 1])
      break
    case 'Home':
      moveTo(rows[0])
      break
    case 'End':
      moveTo(rows.at(-1))
      break
    case 'ArrowRight':
      if (expandable && !expanded) setExpanded(id, true)
      else if (expanded) moveTo(rows[index + 1])
      break
    case 'ArrowLeft':
      if (expanded && !treeUi.search) setExpanded(id, false)
      else moveTo(parentRow(rowEl))
      break
    case 'Enter':
    case ' ':
      openFolder(id)
      break
    default:
      return
  }
  event.preventDefault()
}

// --- Search box ---------------------------------------------------------------------

function setSearch(value) {
  treeUi.search = value
  renderTree()
  const matches = treeEl().querySelectorAll('.tree__match').length
  if (value.trim()) {
    announce(`${matches} ${matches === 1 ? 'folder matches' : 'folders match'}`)
  }
}

function onSearchKeyDown(event) {
  const input = event.target
  if (event.key === 'Escape' && input.value) {
    // First Esc clears the search; a second one leaves the field.
    event.preventDefault()
    event.stopPropagation()
    input.value = ''
    setSearch('')
  } else if (event.key === 'ArrowDown') {
    event.preventDefault()
    const first = visibleRows()[0]
    if (first) focusRow(parseFolderId(first.dataset.folder))
  } else if (event.key === 'Enter') {
    event.preventDefault()
    const match = treeEl().querySelector('.tree__match')?.closest('.tree__row')
    if (match) openFolder(parseFolderId(match.dataset.folder))
  }
}

// --- Options menu (⋯) ------------------------------------------------------------------

function radio(on) {
  return on ? 'circle-check' : 'circle'
}

function openOptionsMenu(button) {
  const rect = button.getBoundingClientRect()
  const items = [
    {
      label: 'Expand all',
      icon: 'chevron-down',
      onSelect: () => setAllExpanded(true),
    },
    {
      label: 'Collapse all',
      icon: 'chevron-up',
      onSelect: () => setAllExpanded(false),
    },
    'separator',
    {
      label: 'Count files in the folder only',
      icon: radio(prefs.countMode === 'direct'),
      onSelect: () => setPref('countMode', 'direct'),
    },
    {
      label: 'Count files in subfolders too',
      icon: radio(prefs.countMode === 'nested'),
      onSelect: () => setPref('countMode', 'nested'),
    },
  ]
  // Folder sorting is FileBird Pro; without Pro the menu simply omits it.
  if (isPro()) {
    items.push(
      'separator',
      {
        label: 'Sort folders: manual order',
        icon: radio(prefs.sort === 'manual'),
        onSelect: () => setPref('sort', 'manual'),
      },
      {
        label: 'Sort folders: name A–Z',
        icon: radio(prefs.sort === 'name-asc'),
        onSelect: () => setPref('sort', 'name-asc'),
      },
      {
        label: 'Sort folders: name Z–A',
        icon: radio(prefs.sort === 'name-desc'),
        onSelect: () => setPref('sort', 'name-desc'),
      },
    )
  }
  const menu = openMenu({
    x: rect.left,
    y: rect.bottom + 4,
    label: 'Folder options',
    items,
  })
  menu.classList.add('folders-menu')
  returnFocusOnEscape(menu, button)
}

// openMenu leaves focus on <body> after Esc; put it back where it was.
export function returnFocusOnEscape(menu, target) {
  menu.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') target?.focus()
  })
}

// --- Column width and visibility -------------------------------------------------------

function setWidth(width) {
  const clamped = clamp(width, MIN_WIDTH, MAX_WIDTH)
  document.documentElement.style.setProperty('--folders-w', `${clamped}px`)
  try {
    localStorage.setItem(WIDTH_KEY, String(clamped))
  } catch {
    // Storage can be unavailable (private mode); the width just isn't kept.
  }
}

function startResize(event) {
  const app = document.getElementById('app')
  const startX = event.clientX
  const startWidth = foldersEl().getBoundingClientRect().width
  app.classList.add('is-resizing')
  const onMove = (moveEvent) =>
    setWidth(startWidth + moveEvent.clientX - startX)
  const onUp = () => {
    app.classList.remove('is-resizing')
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

export function toggleFolders() {
  if (!foldersEnabled()) {
    showToast({
      text: 'Folders need the FileBird plugin on your WordPress site.',
      iconName: 'info-circle',
    })
    return
  }
  const open = !state.panels.folders
  update({ panels: { ...state.panels, folders: open } }, ['panels'])
  announce(open ? 'Folders shown' : 'Folders hidden')
}

// A hidden column must not take Tab stops or screen-reader focus.
export function syncColumnVisibility() {
  const folders = foldersEl()
  const open = foldersEnabled() && state.panels.folders
  folders.inert = !open
  if (!open && folders.contains(document.activeElement)) {
    document.querySelector('#grid .tile[tabindex="0"]')?.focus()
  }
}

// --- Events ----------------------------------------------------------------------------

function onClick(event) {
  const action = event.target.closest('[data-action]')?.dataset.action
  if (action === 'collapse') {
    toggleFolders()
    return
  }
  if (action === 'options') {
    openOptionsMenu(event.target.closest('button'))
    return
  }
  if (action === 'clear-search') {
    const input = foldersEl().querySelector('[name="folder-search"]')
    input.value = ''
    setSearch('')
    input.focus()
    return
  }
  if (event.target.closest('.tree__rename')) return
  const toggleId = event.target.closest('[data-toggle]')?.dataset.toggle
  if (toggleId) {
    const id = Number(toggleId)
    treeUi.focusId = id
    setExpanded(id, !state.expandedFolders.has(id))
    return
  }
  const folderId = event.target.closest('.tree__row[data-folder]')?.dataset
    .folder
  if (folderId !== undefined) openFolder(parseFolderId(folderId))
}

export function initFolders() {
  loadPrefs()
  try {
    const saved = Number(localStorage.getItem(WIDTH_KEY))
    if (saved) setWidth(saved)
  } catch {
    // Ignore unavailable storage.
  }
  const folders = foldersEl()
  folders.addEventListener('click', onClick)
  folders.addEventListener('keydown', onTreeKeyDown)
  folders.addEventListener('input', (event) => {
    if (event.target.name === 'folder-search') setSearch(event.target.value)
  })
  folders.addEventListener('keydown', (event) => {
    if (event.target.name === 'folder-search') onSearchKeyDown(event)
  })
  folders.addEventListener('focusin', (event) => {
    const rowEl = event.target.closest('.tree__row[data-folder]')
    if (rowEl) treeUi.focusId = parseFolderId(rowEl.dataset.folder)
  })
  folders.addEventListener('pointerdown', (event) => {
    if (event.target.closest('.resizer')) startResize(event)
  })
  folders.addEventListener('dblclick', (event) => {
    if (event.target.closest('.resizer')) toggleFolders()
  })
  folders.addEventListener('keydown', (event) => {
    if (!event.target.closest('.resizer')) return
    const current = foldersEl().getBoundingClientRect().width
    if (event.key === 'ArrowLeft') setWidth(current - 16)
    else if (event.key === 'ArrowRight') setWidth(current + 16)
    else return
    event.preventDefault()
    event.stopPropagation()
  })
  registerAction('toggle-folders', toggleFolders)
}
