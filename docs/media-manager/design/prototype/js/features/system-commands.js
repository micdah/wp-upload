// Shortcut sheet (`?`), command palette (Ctrl/Cmd+K) and Ctrl/Cmd+Z undo.
// Both the sheet and the palette read keymap BINDINGS when they open, so
// shortcuts added by any feature appear without changes here.

import { childFolders, folderPath, library, pictureUrl } from '../data.js'
import { openDetail } from '../detail.js'
import { BINDINGS, registerAction, registerBindings } from '../keymap.js'
import { targetItems } from '../selection.js'
import { collection, SORT_LABELS, state, update } from '../store.js'
import { emit, on, showToast } from '../ui.js'
import { writeUrl } from '../url.js'
import { announce, escapeHtml, html, icon, raw } from '../util.js'
import { openTrash, trashCount } from './system-delete.js'
import {
  closeOpenModal,
  elementFromHtml,
  folderLabel,
  hasTrash,
  isMac,
  isModalOpen,
  isPluginMissing,
  openModal,
} from './system-shared.js'

// --- Key labels ------------------------------------------------------------------------

const KEY_NAMES = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Escape: 'Esc',
  Enter: 'Enter',
  Delete: 'Del',
  Backspace: isMac ? '⌫' : 'Backspace',
  ContextMenu: 'Menu',
  ' ': 'Space',
  Home: 'Home',
  End: 'End',
  PageUp: 'PgUp',
  PageDown: 'PgDn',
}

// Keys of one binding, e.g. ['Ctrl', 'K'] or ['⇧', '⌘', '⌫'].
function keyParts(binding) {
  const parts = []
  if (binding.shift) parts.push(isMac ? '⇧' : 'Shift')
  if (binding.mod) parts.push(isMac ? '⌘' : 'Ctrl')
  parts.push(KEY_NAMES[binding.key] ?? binding.key.toUpperCase())
  return parts
}

function kbdHtml(binding) {
  return html`<span class="mm-keys">${keyParts(binding).map(
    (part) => html`<kbd>${part}</kbd>`,
  )}</span>`
}

// --- Shortcut sheet ------------------------------------------------------------------------

const GROUP_ORDER = [
  'Navigate',
  'View',
  'Select',
  'Panels',
  'Files',
  'Edit',
  'Folders',
  'General',
]

// Bindings that share a group, label and mode become one row with several
// key chords ("Move focus: ← → ↑ ↓").
function sheetGroups() {
  const groups = new Map()
  for (const binding of BINDINGS) {
    const group = binding.group ?? 'General'
    if (!groups.has(group)) groups.set(group, new Map())
    const mode = binding.mode === 'detail' ? ' (detail)' : ''
    const rowKey = `${binding.label}${mode}`
    const rows = groups.get(group)
    if (!rows.has(rowKey))
      rows.set(rowKey, { label: binding.label, mode, bindings: [] })
    rows.get(rowKey).bindings.push(binding)
  }
  const rank = (name) => {
    const index = GROUP_ORDER.indexOf(name)
    return index === -1 ? GROUP_ORDER.length : index
  }
  return [...groups.entries()].sort(([a], [b]) => rank(a) - rank(b))
}

const MOUSE_ROWS = [
  ['Select one', 'Click'],
  ['Add or remove from selection', isMac ? '⌘ Click' : 'Ctrl Click'],
  ['Select a range', 'Shift Click'],
  ['Open in detail mode', 'Double-click'],
  ['Upload', 'Drop files anywhere'],
]

function openSheet() {
  if (isPluginMissing()) return
  const groups = sheetGroups()
  const sheet =
    elementFromHtml(html`<div class="dialog mm-sheet" role="dialog" aria-modal="true" aria-labelledby="mm-sheet-title">
    <div class="mm-sheet__head">
      <h2 class="dialog__title" id="mm-sheet-title">${icon('keyboard')}Keyboard shortcuts</h2>
      <button class="icon-btn" data-close title="Close (Esc)">${icon('x')}</button>
    </div>
    <div class="mm-sheet__body">
      ${groups.map(
        ([name, rows]) => html`<section class="mm-sheet__group">
          <h3 class="section__title">${name}</h3>
          <dl class="mm-sheet__list">
            ${[...rows.values()].map(
              (row) => html`<div class="mm-sheet__row">
                <dt>${row.label}${row.mode ? html`<span class="mm-sheet__mode">${row.mode.trim()}</span>` : ''}</dt>
                <dd>${row.bindings.map(
                  (binding, index) =>
                    html`${index ? html`<span class="mm-sheet__or">or</span>` : ''}${kbdHtml(binding)}`,
                )}</dd>
              </div>`,
            )}
          </dl>
        </section>`,
      )}
      <section class="mm-sheet__group">
        <h3 class="section__title">Mouse</h3>
        <dl class="mm-sheet__list">
          ${MOUSE_ROWS.map(
            ([label, gesture]) =>
              html`<div class="mm-sheet__row"><dt>${label}</dt><dd><span class="mm-sheet__gesture">${gesture}</span></dd></div>`,
          )}
        </dl>
      </section>
    </div>
    <p class="mm-sheet__foot">
      ${icon('info-circle', 'icon--sm')}<span>Shortcuts follow the character you type, so they work on US and Danish keyboards, and none needs AltGr.
      Single keys pause while you type in a field; <kbd>Esc</kbd> leaves the field.</span>
    </p>
  </div>`)
  sheet.querySelector('[data-close]').addEventListener('click', closeOpenModal)
  openModal({ element: sheet, initialFocus: '[data-close]' })
  announce('Keyboard shortcuts')
}

// --- Command palette --------------------------------------------------------------------------

// Runs a keymap binding as if its key were pressed, so the palette reaches
// every action any module registered without importing its handler.
function runBinding(binding) {
  document.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: binding.key,
      shiftKey: Boolean(binding.shift),
      ctrlKey: Boolean(binding.mod),
      bubbles: true,
      cancelable: true,
    }),
  )
}

// Keymap actions that make no sense out of context (moving focus, ranges).
// Upload, shortcuts and delete have richer entries in featureCommands().
const SKIP_ACTIONS =
  /^(focus-|extend-|open-detail$|toggle-selected$|command-palette$|undo$|upload$|shortcuts$|delete)/

function bindingCommands() {
  const seen = new Set()
  const commands = []
  for (const binding of BINDINGS) {
    if (SKIP_ACTIONS.test(binding.action) || seen.has(binding.action)) continue
    if (binding.mode !== 'any' && binding.mode !== state.view) continue
    seen.add(binding.action)
    commands.push({
      group: 'Actions',
      label: binding.label,
      iconName: 'command',
      binding,
      run: () => runBinding(binding),
    })
  }
  return commands
}

function setCollection(patch) {
  update({ ...patch, selection: new Set(), focus: null, anchor: null }, [
    'collection',
    'folders',
    'selection',
  ])
  writeUrl()
}

function stateCommands() {
  const commands = [
    {
      label: `Switch to ${state.theme === 'dark' ? 'light' : 'dark'} theme`,
      iconName: state.theme === 'dark' ? 'sun' : 'moon',
      run: () =>
        update({ theme: state.theme === 'dark' ? 'light' : 'dark' }, ['theme']),
    },
    {
      label: state.missingAlt
        ? 'Filter: show all (not only missing alt)'
        : 'Filter: missing alt text',
      iconName: 'accessible',
      run: () => setCollection({ missingAlt: !state.missingAlt }),
    },
    ...[
      ['image', 'Images'],
      ['video', 'Video'],
      ['audio', 'Audio'],
      ['document', 'Documents'],
    ].map(([type, label]) => ({
      label: `Filter: ${label}`,
      iconName: 'filter',
      run: () => setCollection({ type }),
    })),
    ...Object.entries(SORT_LABELS).map(([sort, label]) => ({
      label: `Sort: ${label}`,
      iconName: 'sort-descending',
      run: () => setCollection({ sort }),
    })),
  ]
  if (state.query || state.type !== 'all' || state.missingAlt) {
    commands.unshift({
      label: 'Clear search and filters',
      iconName: 'x',
      run: () => setCollection({ query: '', type: 'all', missingAlt: false }),
    })
  }
  return commands
}

function featureCommands() {
  const selected = targetItems().length
  const commands = [
    {
      label: 'Upload files',
      iconName: 'upload',
      key: 'U',
      run: () => emit('upload'),
    },
    {
      label: 'Show keyboard shortcuts',
      iconName: 'keyboard',
      key: '?',
      run: openSheet,
    },
  ]
  if (selected) {
    commands.push(
      {
        label: `Download ${selected > 1 ? `${selected} items` : 'item'}`,
        iconName: 'download',
        run: () => emit('download'),
      },
      {
        label: `Delete ${selected > 1 ? `${selected} items` : 'item'}…`,
        iconName: 'trash',
        run: () => emit('delete'),
      },
    )
  }
  if (hasTrash()) {
    commands.push({
      label: `Go to Trash (${trashCount()})`,
      iconName: 'trash',
      run: openTrash,
    })
  }
  return commands.map((command) => ({ group: 'Actions', ...command }))
}

function folderCommands() {
  const commands = [
    { label: 'All files', folder: 'all', path: '' },
    { label: 'Uncategorized', folder: 0, path: '' },
  ]
  const walk = (parentId) => {
    for (const folder of childFolders(parentId)) {
      const path = folderPath(folder.id)
        .slice(0, -1)
        .map((parent) => parent.name)
        .join(' / ')
      commands.push({ label: folder.name, folder: folder.id, path })
      walk(folder.id)
    }
  }
  walk(0)
  return commands.map(({ label, folder, path }) => ({
    group: 'Go to folder',
    label,
    hint: path,
    iconName: 'folder',
    run: () => setCollection({ folder }),
  }))
}

function mediaCommands() {
  return library.items.map((item) => ({
    group: 'Media',
    label: item.title,
    hint: `${item.filename} · ${folderLabel(item.folder)}`,
    item,
    run: () => openItem(item),
  }))
}

// Opens a media item even when the current folder or filters hide it.
function openItem(item) {
  if (!collection().includes(item)) {
    setCollection({ folder: 'all', query: '', type: 'all', missingAlt: false })
  }
  if (state.view === 'detail') {
    update({ focus: item.id, anchor: item.id }, ['focus'])
    writeUrl()
  } else {
    openDetail(item.id)
  }
}

// Subsequence match with bonuses for word starts and runs. Returns null when
// some query character is missing.
function fuzzy(query, text) {
  const needle = query.toLowerCase()
  const haystack = text.toLowerCase()
  const exact = haystack.indexOf(needle)
  if (exact !== -1) {
    const indices = Array.from({ length: needle.length }, (_, i) => exact + i)
    const wordStart = exact === 0 || /[\s/:._-]/.test(haystack[exact - 1])
    return { score: 100 + (wordStart ? 50 : 0) - exact * 0.5, indices }
  }
  const indices = []
  let score = 0
  let from = 0
  for (const char of needle) {
    if (char === ' ') continue
    const index = haystack.indexOf(char, from)
    if (index === -1) return null
    const wordStart = index === 0 || /[\s/:._-]/.test(haystack[index - 1])
    score += wordStart ? 8 : indices.at(-1) === index - 1 ? 5 : 1
    indices.push(index)
    from = index + 1
  }
  return { score, indices }
}

function highlight(text, indices) {
  if (!indices?.length) return escapeHtml(text)
  const marks = new Set(indices)
  let out = ''
  for (let i = 0; i < text.length; i++) {
    const char = escapeHtml(text[i])
    out += marks.has(i) ? `<mark>${char}</mark>` : char
  }
  return out
}

const GROUP_LIMITS = { Actions: 8, 'Go to folder': 5, Media: 6 }
const PALETTE_GROUPS = ['Actions', 'Go to folder', 'Media']

function search(query) {
  const actions = [
    ...featureCommands(),
    ...bindingCommands(),
    ...stateCommands().map((command) => ({ group: 'Actions', ...command })),
  ]
  const all = [
    ...actions,
    ...folderCommands(),
    ...(query ? mediaCommands() : []),
  ]
  if (!query.trim()) {
    // Without a query, suggest the common actions and the top folders.
    return [...actions.slice(0, 7), ...folderCommands().slice(0, 4)]
  }
  const scored = []
  for (const command of all) {
    const match = fuzzy(query.trim(), command.label)
    const hintMatch =
      !match && command.hint ? fuzzy(query.trim(), command.hint) : null
    if (match)
      scored.push({ ...command, score: match.score, indices: match.indices })
    else if (hintMatch && hintMatch.score >= 100)
      scored.push({ ...command, score: hintMatch.score / 4 })
  }
  scored.sort((a, b) => b.score - a.score)
  return PALETTE_GROUPS.flatMap((group) =>
    scored
      .filter((command) => command.group === group)
      .slice(0, GROUP_LIMITS[group]),
  )
}

function commandIcon(command) {
  if (command.item) {
    const url = pictureUrl(command.item, 64)
    return url
      ? html`<img class="mm-palette__thumb" src="${url}" alt="" />`
      : html`<span class="mm-palette__thumb">${icon('file', 'icon--sm')}</span>`
  }
  return html`<span class="mm-palette__icon">${icon(command.iconName ?? 'command', 'icon--sm')}</span>`
}

function commandKey(command) {
  if (command.binding) return kbdHtml(command.binding)
  if (command.key)
    return html`<span class="mm-keys"><kbd>${command.key}</kbd></span>`
  return ''
}

function openPalette() {
  if (isPluginMissing()) return
  const palette =
    elementFromHtml(html`<div class="mm-palette" role="dialog" aria-modal="true" aria-label="Command palette">
    <label class="mm-palette__search">
      ${icon('search')}
      <input class="mm-palette__input" type="text" role="combobox" aria-expanded="true" aria-controls="mm-palette-list" aria-autocomplete="list" placeholder="Search actions, folders and media…" autocomplete="off" spellcheck="false" />
      <kbd>Esc</kbd>
    </label>
    <div class="mm-palette__list" id="mm-palette-list" role="listbox" aria-label="Results"></div>
    <div class="mm-palette__foot">
      <span><kbd>↑</kbd><kbd>↓</kbd> to move</span>
      <span><kbd>Enter</kbd> to run</span>
      <span><kbd>Esc</kbd> to close</span>
    </div>
  </div>`)
  const input = palette.querySelector('input')
  const list = palette.querySelector('.mm-palette__list')
  let results = []
  let active = 0

  const render = () => {
    results = search(input.value)
    active = Math.min(active, Math.max(0, results.length - 1))
    if (results.length === 0) {
      list.innerHTML = String(
        html`<div class="mm-palette__empty">No matches for “${input.value}”</div>`,
      )
      input.removeAttribute('aria-activedescendant')
      return
    }
    let lastGroup = ''
    list.innerHTML = results
      .map((command, index) => {
        const heading =
          command.group !== lastGroup
            ? `<div class="mm-palette__group" role="presentation">${escapeHtml(command.group)}</div>`
            : ''
        lastGroup = command.group
        return `${heading}${html`<div class="mm-palette__item" role="option" id="mm-cmd-${index}" data-index="${index}" aria-selected="${String(index === active)}">
          ${commandIcon(command)}
          <span class="mm-palette__label">${raw(highlight(command.label, command.indices))}</span>
          ${command.hint ? html`<span class="mm-palette__hint">${command.hint}</span>` : ''}
          ${commandKey(command)}
        </div>`}`
      })
      .join('')
    input.setAttribute('aria-activedescendant', `mm-cmd-${active}`)
  }

  const setActive = (index) => {
    if (results.length === 0) return
    active = (index + results.length) % results.length
    for (const option of list.querySelectorAll('[role="option"]')) {
      option.setAttribute(
        'aria-selected',
        String(Number(option.dataset.index) === active),
      )
    }
    input.setAttribute('aria-activedescendant', `mm-cmd-${active}`)
    list
      .querySelector(`#mm-cmd-${active}`)
      ?.scrollIntoView({ block: 'nearest' })
  }

  const run = (index) => {
    const command = results[index]
    if (!command) return
    closeOpenModal()
    // After the palette closes and focus is back, so the action sees the
    // app as the user left it.
    requestAnimationFrame(() => command.run())
  }

  input.addEventListener('input', () => {
    active = 0
    render()
  })
  list.addEventListener('pointermove', (event) => {
    const option = event.target.closest('[role="option"]')
    if (option && Number(option.dataset.index) !== active)
      setActive(Number(option.dataset.index))
  })
  list.addEventListener('click', (event) => {
    const option = event.target.closest('[role="option"]')
    if (option) run(Number(option.dataset.index))
  })

  openModal({
    element: palette,
    variant: 'mm-scrim--top',
    initialFocus: 'input',
    onKeyDown: (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setActive(active + (event.key === 'ArrowDown' ? 1 : -1))
        return true
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        run(active)
        return true
      }
      if (event.key === 'Tab') {
        // The palette is one field; Tab moves through results instead.
        event.preventDefault()
        setActive(active + (event.shiftKey ? -1 : 1))
        return true
      }
      if (event.key.toLowerCase() === 'k' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        closeOpenModal()
        return true
      }
      return false
    },
  })
  render()
}

// --- Undo -----------------------------------------------------------------------------------

// Ctrl/Cmd+Z presses the Undo button of the newest toast that has one, so
// every feature's undo toast is reachable from the keyboard.
function undo(event) {
  if (event?.shiftKey) return // Redo isn't supported.
  const buttons = [
    ...document.querySelectorAll('#toast-region .toast__action'),
  ].filter((button) => button.textContent.trim() === 'Undo')
  const latest = buttons.at(-1)
  if (latest) {
    latest.click()
    return
  }
  showToast({
    text: 'Nothing to undo',
    iconName: 'arrow-back-up',
    duration: 2000,
  })
}

// --- Wiring ------------------------------------------------------------------------------------

export function initCommands() {
  on('shortcuts', openSheet)
  on('command-palette', openPalette)
  registerAction('shortcuts', () => {
    if (!isModalOpen()) openSheet()
  })
  registerAction('command-palette', openPalette)
  registerAction('undo', undo)
  registerBindings([
    {
      key: '?',
      mode: 'any',
      action: 'shortcuts',
      group: 'General',
      label: 'Keyboard shortcuts',
    },
    {
      key: 'k',
      mod: true,
      mode: 'any',
      action: 'command-palette',
      group: 'General',
      label: 'Command palette',
    },
    {
      key: 'z',
      mod: true,
      mode: 'any',
      action: 'undo',
      group: 'General',
      label: 'Undo the last change',
    },
  ])
}
