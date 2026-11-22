// The single source of truth for keyboard shortcuts: handlers, the `?` sheet
// and a self-check all read this table.
//
// Rules (see brief.md §7): match `event.key` (the typed character), so keys
// work natively on US and Danish layouts. Characters needing AltGr on a
// Danish keyboard ([ ] { } \ | @ $ ~) and F-keys are forbidden.

import { state } from './store.js'

// mode: 'grid' | 'detail' | 'any'. `mod` = Ctrl on Windows/Linux, Cmd on Mac.
export const BINDINGS = [
  {
    key: 'ArrowLeft',
    mode: 'grid',
    action: 'focus-prev',
    group: 'Navigate',
    label: 'Move focus',
  },
  {
    key: 'ArrowRight',
    mode: 'grid',
    action: 'focus-next',
    group: 'Navigate',
    label: 'Move focus',
  },
  {
    key: 'ArrowUp',
    mode: 'grid',
    action: 'focus-up',
    group: 'Navigate',
    label: 'Move focus',
  },
  {
    key: 'ArrowDown',
    mode: 'grid',
    action: 'focus-down',
    group: 'Navigate',
    label: 'Move focus',
  },
  {
    key: 'ArrowLeft',
    shift: true,
    mode: 'grid',
    action: 'extend-prev',
    group: 'Select',
    label: 'Extend selection',
  },
  {
    key: 'ArrowRight',
    shift: true,
    mode: 'grid',
    action: 'extend-next',
    group: 'Select',
    label: 'Extend selection',
  },
  {
    key: 'ArrowUp',
    shift: true,
    mode: 'grid',
    action: 'extend-up',
    group: 'Select',
    label: 'Extend selection',
  },
  {
    key: 'ArrowDown',
    shift: true,
    mode: 'grid',
    action: 'extend-down',
    group: 'Select',
    label: 'Extend selection',
  },
  {
    key: 'Home',
    mode: 'grid',
    action: 'focus-first',
    group: 'Navigate',
    label: 'First item',
  },
  {
    key: 'End',
    mode: 'grid',
    action: 'focus-last',
    group: 'Navigate',
    label: 'Last item',
  },
  {
    key: 'Enter',
    mode: 'grid',
    action: 'open-detail',
    group: 'View',
    label: 'Open in detail mode',
  },
  {
    key: 'ArrowLeft',
    mode: 'detail',
    action: 'detail-prev',
    group: 'Navigate',
    label: 'Previous item',
  },
  {
    key: 'ArrowRight',
    mode: 'detail',
    action: 'detail-next',
    group: 'Navigate',
    label: 'Next item',
  },
  {
    key: 'g',
    mode: 'detail',
    action: 'close-detail',
    group: 'View',
    label: 'Back to grid',
  },
  {
    key: 'Escape',
    mode: 'detail',
    action: 'close-detail',
    group: 'View',
    label: 'Back to grid',
  },
  {
    key: 'Escape',
    mode: 'grid',
    action: 'clear-selection',
    group: 'Select',
    label: 'Clear selection',
  },
  {
    key: 'x',
    mode: 'any',
    action: 'toggle-selected',
    group: 'Select',
    label: 'Toggle selection',
  },
  {
    key: 'a',
    mod: true,
    mode: 'grid',
    action: 'select-all',
    group: 'Select',
    label: 'Select all',
  },
  {
    key: 'f',
    mode: 'any',
    action: 'toggle-folders',
    group: 'Panels',
    label: 'Toggle folder column',
  },
  {
    key: 'i',
    mode: 'any',
    action: 'toggle-inspector',
    group: 'Panels',
    label: 'Toggle inspector',
  },
  {
    key: '+',
    mode: 'grid',
    action: 'density-up',
    group: 'View',
    label: 'Larger thumbnails',
  },
  {
    key: '-',
    mode: 'grid',
    action: 'density-down',
    group: 'View',
    label: 'Smaller thumbnails',
  },
  {
    key: 'l',
    mode: 'grid',
    action: 'toggle-layout',
    group: 'View',
    label: 'Justified / square layout',
  },
  {
    key: ' ',
    mode: 'grid',
    action: 'peek-toggle',
    group: 'View',
    label: 'Quick peek',
  },
  {
    key: 'z',
    mode: 'detail',
    action: 'zoom-toggle',
    group: 'View',
    label: 'Zoom: fit / 100 %',
  },
  {
    key: '+',
    mode: 'detail',
    action: 'zoom-in',
    group: 'View',
    label: 'Zoom in',
  },
  {
    key: '-',
    mode: 'detail',
    action: 'zoom-out',
    group: 'View',
    label: 'Zoom out',
  },
]

const ALLOWED_NAMED_KEYS = new Set([
  'Enter',
  'Escape',
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  ' ',
  'Tab',
  'Delete',
  'Backspace',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'ContextMenu',
])
const ALLOWED_CHARACTER = /^[a-z0-9,.\-+?]$/

// Throws at startup if a binding breaks the US + DK keyboard rule.
export function assertKeymapIsLayoutSafe(bindings = BINDINGS) {
  for (const binding of bindings) {
    const ok =
      ALLOWED_NAMED_KEYS.has(binding.key) || ALLOWED_CHARACTER.test(binding.key)
    if (!ok) {
      throw new Error(
        `Shortcut "${binding.key}" (${binding.action}) is not layout-safe for US + DK keyboards`,
      )
    }
  }
}

const actions = new Map()

export function registerAction(name, handler) {
  actions.set(name, handler)
}

// Runs an action by name (command palette, menus) without faking a keypress.
export function runAction(name, event) {
  const handler = actions.get(name)
  if (!handler) return false
  handler(event ?? new KeyboardEvent('keydown'))
  return true
}

// While focus is inside a modal (dialog, sheet, palette), app shortcuts
// pause; the modal handles its own keys (Esc, arrows, Enter). Checking focus
// rather than presence ignores a modal that is still animating out.
function modalIsOpen() {
  return Boolean(document.activeElement?.closest('[aria-modal="true"]'))
}

export function registerBindings(bindings) {
  assertKeymapIsLayoutSafe(bindings)
  BINDINGS.push(...bindings)
}

function isTextField(element) {
  if (!element) return false
  if (element.isContentEditable) return true
  if (element.tagName === 'TEXTAREA' || element.tagName === 'SELECT') {
    return true
  }
  if (element.tagName !== 'INPUT') return false
  return !['checkbox', 'radio', 'range', 'button'].includes(element.type)
}

function normalisedKey(event) {
  return event.key.length === 1 ? event.key.toLowerCase() : event.key
}

function matches(binding, event, key) {
  if (binding.key !== key) return false
  const mod = event.ctrlKey || event.metaKey
  if (Boolean(binding.mod) !== mod) return false
  if (event.altKey) return false
  // Shift only matters for named keys; for characters it is part of the
  // typed character (e.g. `?` or `+` need Shift on US but not on DK).
  if (key.length > 1 && Boolean(binding.shift) !== event.shiftKey) return false
  return binding.mode === 'any' || binding.mode === state.view
}

function onKeyDown(event) {
  if (event.defaultPrevented) return
  const key = normalisedKey(event)
  // Single-key shortcuts never fire while typing; Esc still leaves the field.
  if (isTextField(event.target)) {
    if (key === 'Escape') event.target.blur()
    return
  }
  if (modalIsOpen()) return
  const binding = BINDINGS.find((candidate) => matches(candidate, event, key))
  const handler = binding && actions.get(binding.action)
  if (!handler) return
  event.preventDefault()
  handler(event)
}

export function installKeymap() {
  assertKeymapIsLayoutSafe()
  document.addEventListener('keydown', onKeyDown)
}
