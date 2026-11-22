// Drag and drop for folders:
//  - media tiles (grid and filmstrip) onto a folder row moves them; dragging
//    a selected tile carries the whole selection;
//  - folder rows onto another row nest them (middle of the row) or reorder
//    them (top/bottom edge), or onto the empty tree area for the top level.
// The native drag image is replaced by an in-page preview that follows the
// pointer and names the drop target ("Move 3 items · to “Blog”").

import { library } from '../data.js'
import { parseFolderId, setExpanded, treeUi } from '../folders.js'
import { collection, state } from '../store.js'
import { html, icon } from '../util.js'
import {
  folderName,
  foldersEditable,
  isPro,
  isSelfOrDescendant,
  prefs,
} from './folders-model.js'
import { moveFolderTo, moveItems } from './folders-move.js'

const TRANSPARENT_PIXEL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
const AUTO_EXPAND_MS = 700
const EDGE_SCROLL_PX = 28

const blankImage = new Image()
blankImage.src = TRANSPARENT_PIXEL

// Current drag: { kind: 'media', ids } | { kind: 'folder', id }, or null when
// the drag didn't start here (e.g. files from the desktop, for upload).
let drag = null
let preview = null
let expandTimer = 0
let expandRowId = null

const foldersEl = () => document.getElementById('folders')
const treeEl = () => document.getElementById('folder-tree')

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

// --- Preview ------------------------------------------------------------------------

function thumbnails(ids) {
  return ids.slice(0, 3).map((id) => {
    const src = document.querySelector(`.tile[data-id="${id}"] img`)?.src
    return src
      ? html`<span class="drag-preview__thumb"><img src="${src}" alt="" /></span>`
      : html`<span class="drag-preview__thumb drag-preview__thumb--doc">${icon('file', 'icon--sm')}</span>`
  })
}

function showPreview(title, thumbsHtml) {
  preview = document.createElement('div')
  preview.className = 'drag-preview'
  preview.setAttribute('aria-hidden', 'true')
  preview.innerHTML = String(html`
    <span class="drag-preview__stack">${thumbsHtml}</span>
    <span class="drag-preview__text">
      <strong class="drag-preview__title">${title}</strong>
      <span class="drag-preview__target">Drop on a folder</span>
    </span>`)
  document.body.append(preview)
}

function placePreview(x, y) {
  if (!preview || (x === 0 && y === 0)) return
  preview.style.transform = `translate(${x + 16}px, ${y + 18}px)`
}

function setPreviewTarget(text, valid) {
  if (!preview) return
  preview.querySelector('.drag-preview__target').textContent = text
  preview.classList.toggle('is-invalid', !valid)
  preview.classList.toggle('is-valid', valid === true)
}

// --- Drop target bookkeeping ----------------------------------------------------------

function clearIndicators() {
  for (const element of document.querySelectorAll(
    '.is-drop-target, .is-drop-before, .is-drop-after, .is-drop-root',
  )) {
    element.classList.remove(
      'is-drop-target',
      'is-drop-before',
      'is-drop-after',
      'is-drop-root',
    )
  }
}

function cancelAutoExpand() {
  clearTimeout(expandTimer)
  expandRowId = null
}

// Hovering a collapsed folder during a drag opens it after a moment, so you
// can reach nested folders without letting go.
function scheduleAutoExpand(rowEl, id) {
  if (rowEl.getAttribute('aria-expanded') !== 'false') {
    cancelAutoExpand()
    return
  }
  if (expandRowId === id) return
  cancelAutoExpand()
  expandRowId = id
  expandTimer = setTimeout(() => {
    setExpanded(id, true)
    expandRowId = null
  }, AUTO_EXPAND_MS)
}

// Scrolls the tree when the pointer is near its top or bottom edge.
function edgeScroll(clientY) {
  const tree = treeEl()
  const rect = tree.getBoundingClientRect()
  if (clientY < rect.top + EDGE_SCROLL_PX) tree.scrollTop -= 8
  else if (clientY > rect.bottom - EDGE_SCROLL_PX) tree.scrollTop += 8
}

// Where a folder would land: inside the row, or before/after it as a
// sibling. Name-sorted trees have no manual order, so only "inside" exists.
function folderZone(rowEl, clientY) {
  const rect = rowEl.getBoundingClientRect()
  const ratio = (clientY - rect.top) / rect.height
  const manual = !isPro() || prefs.sort === 'manual'
  if (!manual) return 'inside'
  if (ratio < 0.28) return 'before'
  // The bottom edge of an open folder sits above its first child, so it
  // means "into this folder" there.
  if (ratio > 0.72 && rowEl.getAttribute('aria-expanded') !== 'true') {
    return 'after'
  }
  return 'inside'
}

// Decides what a drop at this point would do, or why it can't.
function evaluate(event) {
  const rowEl = event.target.closest?.('.tree__row[data-folder]')
  if (drag.kind === 'media') {
    if (!rowEl) return { valid: null }
    const id = parseFolderId(rowEl.dataset.folder)
    if (id === 'all') {
      return { rowEl, valid: false, text: 'All files isn’t a folder' }
    }
    return {
      rowEl,
      valid: true,
      id,
      zone: 'inside',
      text: id === 0 ? 'to Uncategorized' : `to “${folderName(id)}”`,
    }
  }
  // Folder drags.
  if (!rowEl) {
    const overTree = event.target.closest?.('#folder-tree')
    return overTree
      ? { valid: true, zone: 'root', id: 0, text: 'to the top level' }
      : { valid: null }
  }
  const id = parseFolderId(rowEl.dataset.folder)
  if (id === 'all' || id === 0) {
    return { rowEl, valid: false, text: 'Folders can’t go here' }
  }
  const zone = folderZone(rowEl, event.clientY)
  const target = library.folderById.get(id)
  const parent = zone === 'inside' ? id : target.parent
  if (id === drag.id && zone !== 'inside') return { valid: null }
  if (parent !== 0 && isSelfOrDescendant(drag.id, parent)) {
    return { rowEl, valid: false, text: 'Can’t move into itself' }
  }
  if (zone === 'inside' && id === drag.id) {
    return { rowEl, valid: false, text: 'Can’t move into itself' }
  }
  const text =
    zone === 'inside' ? `into “${target.name}”` : `${zone} “${target.name}”`
  return { rowEl, valid: true, id, zone, parent, text }
}

function paint(result) {
  clearIndicators()
  if (!result.valid) return
  if (result.zone === 'root') treeEl().classList.add('is-drop-root')
  else if (result.zone === 'before')
    result.rowEl.classList.add('is-drop-before')
  else if (result.zone === 'after') result.rowEl.classList.add('is-drop-after')
  else result.rowEl.classList.add('is-drop-target')
}

// --- Event handlers --------------------------------------------------------------------

function dragIds(tile) {
  const id = Number(tile.dataset.id)
  if (!state.selection.has(id)) return [id]
  // Keep collection order so Undo and toasts read naturally.
  return collection()
    .filter((item) => state.selection.has(item.id))
    .map((item) => item.id)
}

function startMediaDrag(event, tile) {
  const ids = dragIds(tile)
  drag = { kind: 'media', ids }
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('application/x-mm-media', JSON.stringify(ids))
  event.dataTransfer.setDragImage(blankImage, 0, 0)
  for (const id of ids) {
    document
      .querySelector(`#grid .tile[data-id="${id}"]`)
      ?.classList.add('is-drag-source')
  }
  showPreview(`Move ${plural(ids.length, 'item')}`, thumbnails(ids))
  placePreview(event.clientX, event.clientY)
}

function startFolderDrag(event, rowEl) {
  const id = parseFolderId(rowEl.dataset.folder)
  drag = { kind: 'folder', id }
  // Kept in treeUi so the dimmed source row survives re-renders.
  treeUi.dragId = id
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('application/x-mm-folder', String(id))
  event.dataTransfer.setDragImage(blankImage, 0, 0)
  rowEl.classList.add('is-drag-source')
  const folder = library.folderById.get(id)
  const glyph =
    isPro() && folder.color
      ? html`<span class="tree__color" style="--folder-color:${folder.color}">${icon('folder')}</span>`
      : icon('folder')
  showPreview(
    `Move “${folder.name}”`,
    html`<span class="drag-preview__thumb drag-preview__thumb--doc">${glyph}</span>`,
  )
  placePreview(event.clientX, event.clientY)
}

function onDragStart(event) {
  if (treeUi.editing) return
  const tile = event.target.closest?.('.tile[data-id]')
  const rowEl = event.target.closest?.('#folders .tree__row[draggable="true"]')
  if (!tile && !rowEl) return
  if (!foldersEditable()) {
    // Per-user mode: folders are read-only, so there is nothing to drop on.
    if (rowEl) event.preventDefault()
    return
  }
  if (tile) startMediaDrag(event, tile)
  else startFolderDrag(event, rowEl)
}

function onDocumentDragOver(event) {
  if (drag) placePreview(event.clientX, event.clientY)
}

function onFoldersDragOver(event) {
  if (!drag) return
  edgeScroll(event.clientY)
  const result = evaluate(event)
  paint(result)
  if (result.rowEl && result.id !== undefined && result.id !== 0) {
    scheduleAutoExpand(result.rowEl, result.id)
  } else {
    cancelAutoExpand()
  }
  if (result.valid) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setPreviewTarget(result.text, true)
  } else if (result.valid === false) {
    setPreviewTarget(result.text, false)
  } else {
    setPreviewTarget('Drop on a folder', null)
  }
}

function onFoldersDragLeave(event) {
  if (!drag || foldersEl().contains(event.relatedTarget)) return
  clearIndicators()
  cancelAutoExpand()
  setPreviewTarget('Drop on a folder', null)
}

function onFoldersDrop(event) {
  if (!drag) return
  const result = evaluate(event)
  const current = drag
  endDrag()
  if (!result.valid) return
  event.preventDefault()
  if (current.kind === 'media') {
    moveItems(current.ids, result.id)
  } else if (result.zone === 'root') {
    moveFolderTo(current.id, 0)
  } else if (result.zone === 'inside') {
    moveFolderTo(current.id, result.id)
  } else {
    moveFolderTo(current.id, result.parent, { [result.zone]: result.id })
  }
}

function endDrag() {
  drag = null
  treeUi.dragId = null
  cancelAutoExpand()
  clearIndicators()
  preview?.remove()
  preview = null
  for (const element of document.querySelectorAll('.is-drag-source')) {
    element.classList.remove('is-drag-source')
  }
}

export function initFolderDragAndDrop() {
  document.addEventListener('dragstart', onDragStart)
  document.addEventListener('dragover', onDocumentDragOver)
  document.addEventListener('dragend', endDrag)
  document.addEventListener('drop', () => {
    // A drop outside the folder column still ends our drag cleanly.
    if (drag) setTimeout(endDrag)
  })
  const folders = foldersEl()
  folders.addEventListener('dragover', onFoldersDragOver)
  folders.addEventListener('dragleave', onFoldersDragLeave)
  folders.addEventListener('drop', onFoldersDrop)
}
