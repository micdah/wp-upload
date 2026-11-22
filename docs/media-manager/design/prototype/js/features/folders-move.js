// "Move to…": the keyboard and touch alternative to drag and drop. A dialog
// with a searchable folder list moves media (M, selection bar, inspector) or
// a folder (folder context menu). Also home to the shared move helpers that
// drag and drop uses, so both paths give the same toast with Undo.

import { library } from '../data.js'
import { closeDetail } from '../detail.js'
import { state } from '../store.js'
import { showToast } from '../ui.js'
import { writeUrl } from '../url.js'
import { announce, html, icon } from '../util.js'
import {
  assignItems,
  cleanName,
  createFolder,
  descendantIds,
  flatTree,
  folderName,
  isPro,
  moveFolder,
  restoreTree,
  treeSnapshot,
} from './folders-model.js'

function plural(count, word) {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

// --- Shared move helpers --------------------------------------------------------

// Moves media into a folder with a toast that can undo it.
export function moveItems(ids, targetFolder) {
  const result = assignItems(ids, targetFolder)
  const target = folderName(targetFolder)
  if (!result) {
    showToast({
      text:
        ids.length === 1
          ? `Already in “${target}”`
          : `All ${ids.length} items are already in “${target}”`,
      iconName: 'info-circle',
    })
    return
  }
  // The item on the stage left the folder being viewed and nothing is left.
  if (state.view === 'detail') {
    if (state.focus === null) closeDetail()
    else writeUrl()
  }
  const what = plural(result.count, 'item')
  showToast({
    text:
      targetFolder === 0
        ? `Moved ${what} to Uncategorized`
        : `Moved ${what} to “${target}”`,
    iconName: 'folder',
    actionLabel: 'Undo',
    onAction: () => {
      result.undo()
      announce(`Moved ${what} back`)
    },
  })
}

// Moves a folder (and its subtree) under a new parent, with Undo.
export function moveFolderTo(folderId, parentId, position = {}) {
  const snapshot = treeSnapshot()
  const folder = library.folderById.get(folderId)
  const sameParent = folder.parent === parentId
  if (!moveFolder(folderId, parentId, position)) {
    showToast({
      text: 'A folder can’t move into itself or one of its subfolders.',
      iconName: 'alert-circle',
    })
    return false
  }
  const text = sameParent
    ? `Moved “${folder.name}”`
    : parentId === 0
      ? `Moved “${folder.name}” to the top level`
      : `Moved “${folder.name}” into “${folderName(parentId)}”`
  showToast({
    text,
    iconName: 'folders',
    actionLabel: 'Undo',
    onAction: () => restoreTree(snapshot),
  })
  return true
}

// --- Dialog model -------------------------------------------------------------------

// Folders the session moved things to, newest first, offered as "Recent".
const recentTargets = []

function rememberTarget(folderId) {
  const index = recentTargets.indexOf(folderId)
  if (index !== -1) recentTargets.splice(index, 1)
  recentTargets.unshift(folderId)
  recentTargets.length = Math.min(recentTargets.length, 3)
}

function pathLabel(folderId) {
  const names = []
  let folder = library.folderById.get(library.folderById.get(folderId)?.parent)
  while (folder) {
    names.unshift(folder.name)
    folder = library.folderById.get(folder.parent)
  }
  return names.join(' / ')
}

// Builds the option list for the current query.
//  - media mode: Uncategorized + every folder;
//  - folder mode: "Top level" + every folder except itself and its subtree.
function buildOptions(context, query) {
  const needle = query.trim().toLowerCase()
  const options = []
  const isCurrent = (id) => context.currentIds.has(id)
  const rootLabel = context.kind === 'folder' ? 'Top level' : 'Uncategorized'
  if (!needle || rootLabel.toLowerCase().includes(needle)) {
    options.push({
      id: 0,
      name: rootLabel,
      depth: 0,
      icon: context.kind === 'folder' ? 'folders' : 'folder',
      current: isCurrent(0),
    })
  }
  const blocked = new Set(
    context.kind === 'folder'
      ? [context.folderId, ...descendantIds(context.folderId)]
      : [],
  )
  if (!needle && recentTargets.some((id) => library.folderById.has(id))) {
    for (const id of recentTargets) {
      if (!library.folderById.has(id) || blocked.has(id) || id === 0) continue
      options.push({
        id,
        name: folderName(id),
        path: pathLabel(id),
        depth: 0,
        group: 'Recent',
        current: isCurrent(id),
        recent: true,
      })
    }
  }
  for (const { folder, depth } of flatTree()) {
    if (blocked.has(folder.id)) continue
    if (needle && !folder.name.toLowerCase().includes(needle)) continue
    options.push({
      id: folder.id,
      name: folder.name,
      // While searching, the list is flat and shows each match's path.
      path: needle ? pathLabel(folder.id) : '',
      depth: needle ? 0 : depth,
      color: isPro() ? folder.color : undefined,
      current: isCurrent(folder.id),
      group: !needle && recentTargets.length ? 'All folders' : undefined,
    })
  }
  const cleaned = cleanName(query)
  const exact = library.folders.some(
    (folder) => folder.name.toLowerCase() === cleaned.toLowerCase(),
  )
  if (cleaned && !exact) {
    options.push({ id: 'create', name: cleaned, create: true, depth: 0 })
  }
  return options
}

// --- Dialog view ---------------------------------------------------------------------

function optionIcon(option) {
  if (option.create) return icon('folder-plus', 'icon--sm')
  const glyph = icon(option.icon ?? 'folder', 'icon--sm')
  if (!option.color) return glyph
  return html`<span class="tree__color" style="--folder-color:${option.color}">${glyph}</span>`
}

function optionHtml(option, index, activeIndex) {
  const label = option.create
    ? html`<span class="move-dialog__name">Create folder “<strong>${option.name}</strong>”</span>`
    : html`<span class="move-dialog__name">${option.name}</span>${
        option.path
          ? html`<span class="move-dialog__path">${option.path}</span>`
          : ''
      }`
  return html`<li
    class="move-dialog__option${option.create ? ' is-create' : ''}"
    role="option"
    id="move-option-${index}"
    data-index="${index}"
    aria-selected="${String(index === activeIndex)}"
    aria-disabled="${String(Boolean(option.current))}"
    style="--depth:${option.depth}"
  >
    ${optionIcon(option)}${label}
    ${option.current ? html`<span class="move-dialog__tag">Current</span>` : ''}
  </li>`
}

function listHtml(options, activeIndex) {
  if (options.length === 0) {
    return html`<li class="move-dialog__empty" role="presentation">No folders match.</li>`
  }
  let lastGroup
  const rows = options.map((option, index) => {
    const heading =
      option.group && option.group !== lastGroup
        ? html`<li class="move-dialog__group" role="presentation">${option.group}</li>`
        : ''
    lastGroup = option.group
    return html`${heading}${optionHtml(option, index, activeIndex)}`
  })
  return html`${rows}`
}

function firstChoosable(options, from = 0, step = 1) {
  for (let index = from; index >= 0 && index < options.length; index += step) {
    if (!options[index].current) return index
  }
  return -1
}

// openMoveDialog({ kind: 'items', ids } | { kind: 'folder', folderId })
export function openMoveDialog(request) {
  const context = describe(request)
  const previousFocus = document.activeElement
  const scrim = document.createElement('div')
  scrim.className = 'scrim'
  scrim.innerHTML = String(html`<div
    class="dialog move-dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="move-dialog-title"
    aria-describedby="move-dialog-sub"
  >
    <h2 class="dialog__title" id="move-dialog-title">${context.title}</h2>
    <p class="dialog__text move-dialog__sub" id="move-dialog-sub">${context.subtitle}</p>
    <label class="search move-dialog__search">
      ${icon('search')}
      <input
        class="input"
        type="search"
        name="move-search"
        placeholder="Find or create a folder"
        role="combobox"
        aria-expanded="true"
        aria-autocomplete="list"
        aria-controls="move-dialog-list"
        aria-label="Find a folder"
        autocomplete="off"
      />
    </label>
    <ul class="move-dialog__list" id="move-dialog-list" role="listbox" aria-label="Folders"></ul>
    <div class="dialog__actions move-dialog__actions">
      <span class="move-dialog__hint"><kbd>↑</kbd><kbd>↓</kbd> choose · <kbd>Enter</kbd> move</span>
      <button class="btn" data-answer="cancel">Cancel</button>
      <button class="btn btn--primary" data-answer="move">${context.confirmLabel}</button>
    </div>
  </div>`)
  const input = scrim.querySelector('input')
  const list = scrim.querySelector('.move-dialog__list')
  const moveButton = scrim.querySelector('[data-answer="move"]')
  let options = []
  let activeIndex = -1

  const render = () => {
    options = buildOptions(context, input.value)
    if (activeIndex >= options.length || options[activeIndex]?.current) {
      activeIndex = firstChoosable(options)
    }
    list.innerHTML = String(listHtml(options, activeIndex))
    moveButton.disabled = activeIndex === -1
    if (activeIndex === -1) input.removeAttribute('aria-activedescendant')
    else
      input.setAttribute('aria-activedescendant', `move-option-${activeIndex}`)
    list
      .querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }

  const setActive = (index) => {
    if (index === -1) return
    activeIndex = index
    render()
  }

  const close = () => {
    scrim.remove()
    document.removeEventListener('keydown', onKey, true)
    if (previousFocus?.isConnected) previousFocus.focus()
  }

  const confirm = () => {
    const option = options[activeIndex]
    if (!option || option.current) return
    close()
    let target = option.id
    // "Create folder …" makes a top-level folder, then moves into it.
    if (option.create) target = createFolder(0, option.name).folder.id
    rememberTarget(target)
    if (context.kind === 'items') moveItems(context.ids, target)
    else moveFolderTo(context.folderId, target)
  }

  // Captured so the global keymap and other Esc handlers don't see these.
  const onKey = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive(firstChoosable(options, activeIndex + step, step))
    } else if (event.key === 'Enter' && event.target === input) {
      event.preventDefault()
      confirm()
    }
  }

  input.addEventListener('input', () => {
    activeIndex = 0
    render()
  })
  list.addEventListener('click', (event) => {
    const index = event.target.closest('[data-index]')?.dataset.index
    if (index === undefined || options[Number(index)].current) return
    setActive(Number(index))
    input.focus()
  })
  list.addEventListener('dblclick', (event) => {
    if (event.target.closest('[data-index]')) confirm()
  })
  scrim.addEventListener('click', (event) => {
    const answer = event.target.closest('[data-answer]')?.dataset.answer
    if (answer === 'move') confirm()
    else if (answer === 'cancel' || event.target === scrim) close()
  })
  document.addEventListener('keydown', onKey, true)
  document.body.append(scrim)
  render()
  input.focus()
}

// Title, subtitle and "current" markers for the dialog.
function describe(request) {
  if (request.kind === 'folder') {
    const folder = library.folderById.get(request.folderId)
    return {
      ...request,
      title: `Move “${folder.name}”`,
      subtitle:
        'Choose its new parent folder. Its subfolders and files move with it.',
      confirmLabel: 'Move folder',
      currentIds: new Set([folder.parent]),
    }
  }
  const items = request.ids.map((id) => library.byId.get(id))
  const folders = new Set(items.map((item) => item.folder || 0))
  const from =
    folders.size === 1
      ? `From “${folderName([...folders][0])}”.`
      : `From ${folders.size} folders.`
  return {
    ...request,
    title:
      items.length === 1
        ? `Move “${items[0].title}”`
        : `Move ${items.length} items`,
    subtitle: `${from} A file lives in one folder, so this replaces its current folder.`,
    confirmLabel: 'Move here',
    // Only mark a folder "current" when every item is already in it.
    currentIds: folders.size === 1 ? folders : new Set(),
  }
}
