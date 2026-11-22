// Delete, trash and download. `Delete` is context-sensitive (brief §7):
//   - inside a folder it removes the items from the folder (undo toast);
//   - Shift+Delete, or Delete outside a folder, deletes from the library:
//     with MEDIA_TRASH → Trash (undo toast + Trash view, restore via the
//     companion plugin); without → a confirm dialog that shows where the
//     items are used (D8).

import { library, pictureUrl } from '../data.js'
import { focusTile, tileHtml } from '../grid.js'
import { registerAction, registerBindings } from '../keymap.js'
import { targetItems } from '../selection.js'
import { collection, state, update } from '../store.js'
import { libraryChanged, on, openMenu, showToast } from '../ui.js'
import { writeUrl } from '../url.js'
import {
  announce,
  formatBytes,
  html,
  icon,
  raw,
  truncateMiddle,
} from '../util.js'
import {
  adjustFolderCount,
  canEdit,
  closeOpenModal,
  elementFromHtml,
  folderLabel,
  guardMutation,
  hasTrash,
  inFolder,
  isMac,
  openModal,
  plural,
} from './system-shared.js'

// WordPress empties the trash after EMPTY_TRASH_DAYS (default 30).
const TRASH_DAYS = 30
const TYPE_TO_CONFIRM_FROM = 25
const DAY_MS = 86_400_000

// Trashed items: { item, trashedAt, index } — `index` restores grid order.
const trash = []

// --- Shared bookkeeping ------------------------------------------------------------

function quoted(items) {
  return items.length === 1
    ? `“${items[0].title}”`
    : plural(items.length, 'item')
}

// After items leave the collection, keep keyboard focus on the item that
// took the first removed item's place (Finder-style), or close detail mode
// when nothing is left to show.
function settleFocus(firstIndex) {
  const items = collection()
  const next = items[Math.min(firstIndex, items.length - 1)]
  const patch = { selection: new Set(), anchor: null, focus: next?.id ?? null }
  if (state.view === 'detail' && !next) patch.view = 'grid'
  update(patch, ['selection', 'focus', 'folders', 'view'])
  if (state.view === 'detail') writeUrl()
  else if (next) requestAnimationFrame(() => focusTile(next.id))
}

function removeFromLibrary(items) {
  const ids = new Set(items.map((item) => item.id))
  const firstIndex = collection().findIndex((item) => ids.has(item.id))
  library.items = library.items.filter((item) => !ids.has(item.id))
  for (const item of items) {
    library.byId.delete(item.id)
    adjustFolderCount(item.folder, -1)
  }
  libraryChanged()
  settleFocus(Math.max(0, firstIndex))
}

function putBack(entries) {
  for (const { item, index } of entries.sort((a, b) => a.index - b.index)) {
    library.items.splice(Math.min(index, library.items.length), 0, item)
    library.byId.set(item.id, item)
    adjustFolderCount(item.folder, 1)
  }
  libraryChanged()
  update({ selection: new Set(entries.map(({ item }) => item.id)) }, [
    'selection',
    'folders',
  ])
}

// Authors may only delete their own uploads (D9); say what was skipped.
function permitted(items) {
  const allowed = items.filter(canEdit)
  if (allowed.length < items.length) {
    const skipped = items.length - allowed.length
    showToast({
      text: `${plural(skipped, 'item')} skipped — you can only delete media you uploaded`,
      iconName: 'lock',
    })
  }
  return allowed
}

// --- Remove from folder ---------------------------------------------------------------

function removeFromFolder(items) {
  const folderId = state.folder
  const name = folderLabel(folderId)
  const firstIndex = collection().findIndex((item) => items.includes(item))
  for (const item of items) item.folder = 0
  adjustFolderCount(folderId, -items.length)
  update({}, ['collection'])
  settleFocus(Math.max(0, firstIndex))
  showToast({
    text: `Removed ${quoted(items)} from “${name}”`,
    iconName: 'folder',
    actionLabel: 'Undo',
    duration: 8000,
    onAction: () => {
      for (const item of items) item.folder = folderId
      adjustFolderCount(folderId, items.length)
      update({ selection: new Set(items.map((item) => item.id)) }, [
        'collection',
        'selection',
      ])
      announce(`Put ${plural(items.length, 'item')} back in ${name}`)
    },
  })
}

// --- Trash ---------------------------------------------------------------------------

function moveToTrash(items) {
  const now = Date.now()
  const entries = items.map((item) => ({
    item,
    trashedAt: now,
    index: library.items.indexOf(item),
  }))
  trash.unshift(...entries)
  removeFromLibrary(items)
  renderTrashRow()
  showToast({
    text: `Moved ${quoted(items)} to Trash`,
    iconName: 'trash',
    actionLabel: 'Undo',
    duration: 8000,
    onAction: () => restore(entries, { quiet: true }),
  })
}

function restore(entries, { quiet = false } = {}) {
  for (const entry of entries) trash.splice(trash.indexOf(entry), 1)
  putBack(entries)
  renderTrashRow()
  renderTrashView()
  const text = `Restored ${quoted(entries.map(({ item }) => item))}`
  if (quiet) announce(text)
  else showToast({ text, iconName: 'arrow-back-up' })
}

async function purge(entries) {
  const ok = await confirmPermanent(
    entries.map(({ item }) => item),
    {
      fromTrash: true,
    },
  )
  if (!ok) return
  for (const entry of entries) trash.splice(trash.indexOf(entry), 1)
  renderTrashRow()
  renderTrashView()
  showToast({
    text: `Deleted ${quoted(entries.map(({ item }) => item))} permanently`,
    iconName: 'trash',
  })
}

// --- Permanent delete confirm ------------------------------------------------------------

// The sample data has no featured-image flag; the companion plugin's used-in
// endpoint will return it. Simulated: every third post uses it as featured.
function usages(items) {
  return items.flatMap((item) =>
    item.usedIn.map((post) => ({
      ...post,
      featured: post.id % 3 === 0,
      item,
    })),
  )
}

function usageNotice(items) {
  const found = usages(items)
  if (found.length === 0) {
    return html`<div class="notice">${icon('info-circle')}<span>Not used in any post or page we know of.</span></div>`
  }
  const shown = found.slice(0, 4)
  const featured = found.filter((usage) => usage.featured).length
  return html`<div class="notice notice--danger mm-usage">
    ${icon('alert-triangle')}
    <div>
      <strong>Used in ${plural(found.length, 'place')}.</strong>
      These will show a broken image or link${featured ? html`, and lose their featured image` : ''}.
      <ul class="mm-usage__list">
        ${shown.map(
          (usage) => html`<li>
            <span class="mm-usage__title">${usage.title}</span>
            <span class="mm-usage__meta">${usage.type}${usage.featured ? ' · featured image' : ''}${items.length > 1 ? html` · ${truncateMiddle(usage.item.filename, 24)}` : ''}</span>
          </li>`,
        )}
      </ul>
      ${found.length > shown.length ? html`<span class="mm-usage__more">and ${found.length - shown.length} more</span>` : ''}
    </div>
  </div>`
}

function thumbStrip(items) {
  const shown = items.slice(0, 5)
  return html`<div class="mm-thumbs" aria-hidden="true">
    ${shown.map((item) => {
      const url = pictureUrl(item, 96)
      return url
        ? html`<img src="${url}" alt="" />`
        : html`<span class="mm-thumbs__doc">${icon('file', 'icon--sm')}</span>`
    })}
    ${items.length > shown.length ? html`<span class="mm-thumbs__more num">+${items.length - shown.length}</span>` : ''}
  </div>`
}

// A richer confirm than ui.confirmDialog: thumbnails, a usage list, and
// type-to-confirm for large batches (research 07 §9).
function confirmPermanent(items, { fromTrash = false } = {}) {
  return new Promise((resolve) => {
    const count = items.length
    const typeToConfirm = count >= TYPE_TO_CONFIRM_FROM
    const title =
      count === 1
        ? `Delete “${truncateMiddle(items[0].title, 40)}” permanently?`
        : `Delete ${count} items permanently?`
    const text = fromTrash
      ? 'They’re removed from the server with all their sizes. This can’t be undone.'
      : 'This site has no media trash, so this can’t be undone. The files and all their sizes are removed from the server.'
    const dialog =
      elementFromHtml(html`<div class="dialog mm-confirm" role="alertdialog" aria-modal="true" aria-labelledby="mm-confirm-title" aria-describedby="mm-confirm-text">
      ${thumbStrip(items)}
      <h2 class="dialog__title" id="mm-confirm-title">${title}</h2>
      <p class="dialog__text" id="mm-confirm-text">${text}</p>
      ${usageNotice(items)}
      ${
        typeToConfirm
          ? html`<label class="field mm-confirm__type"><span class="field__label">Type <strong class="num">${count}</strong> to confirm</span><input class="input" name="confirm-count" inputmode="numeric" autocomplete="off" /></label>`
          : ''
      }
      <div class="dialog__actions">
        <button class="btn" data-answer="no">Cancel</button>
        <button class="btn btn--danger-solid" data-answer="yes" ${typeToConfirm ? 'disabled' : ''}>${icon('trash')}Delete permanently</button>
      </div>
    </div>`)
    let answer = false
    const close = openModal({
      element: dialog,
      initialFocus: typeToConfirm ? 'input' : '[data-answer="no"]',
      onClose: () => resolve(answer),
    })
    dialog.addEventListener('click', (event) => {
      const choice = event.target.closest('[data-answer]')?.dataset.answer
      if (!choice) return
      answer = choice === 'yes'
      close()
    })
    dialog.addEventListener('input', (event) => {
      const confirmButton = dialog.querySelector('[data-answer="yes"]')
      confirmButton.disabled = event.target.value.trim() !== String(count)
    })
  })
}

async function deletePermanently(items) {
  if (!(await confirmPermanent(items))) return
  removeFromLibrary(items)
  showToast({
    text: `Deleted ${quoted(items)} permanently`,
    iconName: 'trash',
  })
}

// --- Entry points ----------------------------------------------------------------------

function deleteFromLibrary(items) {
  const allowed = permitted(items)
  if (allowed.length === 0) return
  if (hasTrash()) moveToTrash(allowed)
  else deletePermanently(allowed)
}

function currentTargets() {
  const items = targetItems()
  if (items.length === 0) announce('Select media to delete first')
  return items
}

function onDeleteKey({ fromLibrary = false } = {}) {
  if (trashView && !trashView.hidden) {
    deleteSelectedInTrash()
    return
  }
  const items = currentTargets()
  if (items.length === 0 || !guardMutation()) return
  if (inFolder() && !fromLibrary) removeFromFolder(permitted(items))
  else deleteFromLibrary(items)
}

function keyHint(shift) {
  if (isMac) return shift ? '⇧⌘⌫' : '⌘⌫'
  return shift ? 'Shift+Del' : 'Del'
}

// The Delete button (selection bar, inspector, context menus). In a folder
// it asks which delete is meant, so mouse users get the same two choices
// the keyboard has.
function onDeleteAction({ source } = {}) {
  const items = currentTargets()
  if (items.length === 0 || !guardMutation()) return
  if (!inFolder() || !source) {
    deleteFromLibrary(items)
    return
  }
  const rect = source.getBoundingClientRect()
  openMenu({
    x: rect.left,
    y: rect.bottom + 4,
    label: plural(items.length, 'item'),
    items: [
      {
        label: `Remove from “${folderLabel()}”`,
        icon: 'folder',
        kbd: keyHint(false),
        onSelect: () => removeFromFolder(permitted(items)),
      },
      {
        label: hasTrash() ? 'Move to Trash' : 'Delete permanently…',
        icon: 'trash',
        kbd: keyHint(true),
        danger: true,
        onSelect: () => deleteFromLibrary(items),
      },
    ],
  })
}

// --- Download --------------------------------------------------------------------------

function triggerDownload(item) {
  // The real app links to the original file (`source_url`) with `download`.
  announce(`Downloading ${item.filename}`)
}

function onDownload() {
  const items = targetItems()
  if (items.length === 0) {
    announce('Select media to download first')
    return
  }
  if (items.length === 1) {
    const [item] = items
    showToast({
      text: `Downloading “${truncateMiddle(item.filename, 36)}” · ${formatBytes(item.filesize)}`,
      iconName: 'download',
      duration: 3000,
    })
    triggerDownload(item)
    return
  }
  // ZIP downloads are out of v1 scope (brief §3); say so, and offer the
  // honest alternative. Browsers ask once before allowing several downloads.
  showToast({
    text: `ZIP download isn’t available yet. Download the ${items.length} files one by one? Your browser may ask to allow multiple downloads.`,
    iconName: 'download',
    actionLabel: `Download ${items.length}`,
    duration: 10000,
    onAction: () => {
      for (const item of items) triggerDownload(item)
      showToast({
        text: `Started ${plural(items.length, 'download')}`,
        iconName: 'download',
        duration: 3000,
      })
    },
  })
}

// --- Trash view ---------------------------------------------------------------------------

let trashView = null
let trashSelection = new Set()

function daysLeft(entry) {
  const elapsed = Math.floor((Date.now() - entry.trashedAt) / DAY_MS)
  return Math.max(0, TRASH_DAYS - elapsed)
}

function trashTile(entry) {
  const days = daysLeft(entry)
  const tile = String(tileHtml(entry.item, { width: 0, height: 160 }))
  // The core tile's badges are replaced by the time left before purge.
  return tile.replace(
    /<div class="tile__badges">[\s\S]*?<\/div>\s*<div class="tile__name">/,
    `<div class="tile__badges"><span class="badge ${days <= 3 ? 'badge--danger' : ''}">${days} ${days === 1 ? 'day' : 'days'} left</span></div><div class="tile__name">`,
  )
}

function trashBar() {
  const total = trash.reduce((sum, entry) => sum + entry.item.filesize, 0)
  const selected = trashSelection.size
  return html`<div class="mm-trash__bar ${selected ? 'is-selection' : ''}">
    <button class="icon-btn" data-trash="close" title="Back to library (Esc)">${icon('arrow-left')}</button>
    <h2 class="mm-trash__title" id="mm-trash-title">${icon('trash')}Trash</h2>
    <span class="mm-trash__count num">${plural(trash.length, 'item')} · ${formatBytes(total)}</span>
    <span class="toolbar__spacer"></span>
    ${
      selected
        ? html`<span class="selection-bar__count num">${selected} selected</span>
          <button class="btn btn--ghost" data-trash="restore">${icon('arrow-back-up')}Restore</button>
          <button class="btn btn--ghost btn--danger" data-trash="purge">${icon('trash')}Delete permanently</button>`
        : html`<button class="btn btn--ghost" data-trash="select-all" ${trash.length ? '' : 'disabled'}>${icon('checks')}Select all</button>`
    }
    <button class="btn" data-trash="empty" ${trash.length ? '' : 'disabled'}>Empty trash</button>
  </div>`
}

function renderTrashView() {
  if (!trashView || trashView.hidden) return
  for (const id of trashSelection) {
    if (!trash.some((entry) => entry.item.id === id)) trashSelection.delete(id)
  }
  const focusedId =
    document.activeElement?.closest?.('.mm-trash .tile')?.dataset.id
  trashView.innerHTML = String(html`
    ${trashBar()}
    <div class="mm-trash__scroll">
      <div class="notice mm-trash__notice">${icon('info-circle')}<span>Items in the Trash are deleted permanently after ${TRASH_DAYS} days. Restoring puts an item back in its folder.</span></div>
      ${
        trash.length
          ? html`<div class="mm-trash__grid" role="grid" aria-labelledby="mm-trash-title" aria-multiselectable="true"><div class="mm-trash__row" role="row">${trash.map((entry) => raw(trashTile(entry)))}</div></div>`
          : html`<div class="empty">
              <div class="empty__art">${icon('trash')}</div>
              <h3 class="empty__title">Trash is empty</h3>
              <p class="empty__text">Deleted media waits here for ${TRASH_DAYS} days before it’s removed for good.</p>
            </div>`
      }
    </div>`)
  for (const tile of trashView.querySelectorAll('.tile')) {
    tile.tabIndex = 0
    tile.removeAttribute('draggable')
    tile.setAttribute(
      'aria-selected',
      String(trashSelection.has(Number(tile.dataset.id))),
    )
    const img = tile.querySelector('img')
    if (img?.complete) img.classList.add('is-loaded')
    else img?.addEventListener('load', () => img.classList.add('is-loaded'))
  }
  if (focusedId)
    trashView.querySelector(`.tile[data-id="${focusedId}"]`)?.focus()
}

function selectedEntries() {
  return trash.filter((entry) => trashSelection.has(entry.item.id))
}

function deleteSelectedInTrash() {
  const entries = selectedEntries()
  if (entries.length) purge(entries)
}

function toggleTrashTile(id) {
  if (trashSelection.has(id)) trashSelection.delete(id)
  else trashSelection.add(id)
  renderTrashView()
  announce(`${trashSelection.size} selected`)
}

function onTrashClick(event) {
  const action = event.target.closest('[data-trash]')?.dataset.trash
  if (action === 'close') closeTrash()
  else if (action === 'select-all') {
    trashSelection = new Set(trash.map((entry) => entry.item.id))
    renderTrashView()
  } else if (action === 'restore') {
    if (guardMutation()) restore(selectedEntries())
  } else if (action === 'purge') {
    if (guardMutation()) deleteSelectedInTrash()
  } else if (action === 'empty') {
    if (guardMutation()) purge([...trash])
  }
  if (action) return
  const tile = event.target.closest('.tile')
  if (tile) toggleTrashTile(Number(tile.dataset.id))
}

function onTrashKey(event) {
  const tile = event.target.closest('.tile')
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    if (trashSelection.size) {
      trashSelection.clear()
      renderTrashView()
    } else closeTrash()
  } else if (tile && (event.key === ' ' || event.key === 'Enter')) {
    event.preventDefault()
    event.stopPropagation()
    toggleTrashTile(Number(tile.dataset.id))
  }
}

export function openTrash() {
  if (!hasTrash()) return
  closeOpenModal()
  if (!trashView) {
    trashView = document.createElement('section')
    trashView.className = 'mm-trash'
    trashView.setAttribute('aria-labelledby', 'mm-trash-title')
    trashView.addEventListener('click', onTrashClick)
    trashView.addEventListener('keydown', onTrashKey)
    document.getElementById('center').append(trashView)
  }
  if (state.view === 'detail') update({ view: 'grid' }, ['view'])
  trashSelection = new Set()
  trashView.hidden = false
  document.getElementById('grid-scroll').inert = true
  document.getElementById('filterbar').inert = true
  document.getElementById('folders').dataset.mmTrash = 'open'
  renderTrashRow()
  renderTrashView()
  trashView.querySelector('[data-trash="close"]').focus()
  announce('Trash')
}

export function closeTrash() {
  if (!trashView || trashView.hidden) return
  trashView.hidden = true
  document.getElementById('grid-scroll').inert = false
  document.getElementById('filterbar').inert = false
  delete document.getElementById('folders').dataset.mmTrash
  renderTrashRow()
  if (state.focus !== null) focusTile(state.focus)
  announce('Library')
}

export function trashCount() {
  return trash.length
}

// --- Trash row in the folder column ----------------------------------------------------

function renderTrashRow() {
  const tree = document.querySelector('#folders .tree')
  if (!tree || !hasTrash()) return
  let item = tree.querySelector('.mm-trash-row')
  if (!item) {
    item = document.createElement('li')
    item.className = 'mm-trash-row'
    item.setAttribute('role', 'treeitem')
    // Right after "Uncategorized", before the folder separator.
    const separator = tree.querySelector('.tree__separator')?.closest('li')
    tree.insertBefore(item, separator ?? null)
  }
  const open = trashView && !trashView.hidden
  item.innerHTML =
    String(html`<button class="tree__row" data-mm-trash aria-current="${String(Boolean(open))}" style="--depth:0">
    <span class="tree__twisty tree__twisty--empty"></span>${icon('trash', 'icon--sm')}
    <span class="tree__name">Trash</span>
    <span class="tree__count">${trash.length}</span>
  </button>`)
}

// Starts the trash scenario with a few items already in it, as a real site
// would have, so the Trash view isn't empty on first visit.
function seedTrash() {
  const picks = library.items
    .filter((item) => item.usedIn.length === 0)
    .slice(4, 8)
  picks.forEach((item, index) => {
    trash.push({
      item,
      trashedAt: Date.now() - [2, 9, 16, 28][index] * DAY_MS,
      index: library.items.indexOf(item),
    })
  })
  library.items = library.items.filter((item) => !picks.includes(item))
  for (const item of picks) adjustFolderCount(item.folder, -1)
}

// --- Wiring ------------------------------------------------------------------------------

export function initDelete() {
  if (hasTrash()) {
    seedTrash()
    libraryChanged()
    update({}, ['folders'])
    // folders.js replaces the tree's content on every render and announces it.
    on('folders-rendered', renderTrashRow)
    renderTrashRow()
    document.getElementById('folders').addEventListener('click', (event) => {
      if (event.target.closest('[data-mm-trash]')) openTrash()
      else if (event.target.closest('[data-folder]')) closeTrash()
    })
  }
  on('delete', onDeleteAction)
  on('download', onDownload)
  registerAction('delete', () => onDeleteKey())
  registerAction('delete-from-library', () =>
    onDeleteKey({ fromLibrary: true }),
  )
  const deleteLabel = 'Remove from folder, or delete'
  const libraryLabel = hasTrash() ? 'Move to Trash' : 'Delete from library'
  registerBindings([
    {
      key: 'Delete',
      mode: 'any',
      action: 'delete',
      group: 'Files',
      label: deleteLabel,
    },
    {
      key: 'Delete',
      shift: true,
      mode: 'any',
      action: 'delete-from-library',
      group: 'Files',
      label: libraryLabel,
    },
  ])
  // Mac keyboards have no Delete key; Finder uses Cmd+Backspace.
  if (isMac) {
    registerBindings([
      {
        key: 'Backspace',
        mod: true,
        mode: 'any',
        action: 'delete',
        group: 'Files',
        label: deleteLabel,
      },
      {
        key: 'Backspace',
        mod: true,
        shift: true,
        mode: 'any',
        action: 'delete-from-library',
        group: 'Files',
        label: libraryLabel,
      },
    ])
  }
}
