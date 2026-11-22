// Autosave for inspector fields (principle 6: "edit inline, save quietly").
//
//   blur / Ctrl+Cmd+Enter   commit the field (Saving… → Saved ✓, or Not saved · Retry)
//   Enter (title, alt)      Save & next: commit, move to the next item, keep the field focused
//   Shift+Enter             Save & previous
//   Esc                     revert an unsaved edit; a second Esc leaves the field
//
// One item: the field writes that item. Several items: the field writes all
// of them (alt text only to images), a "Mixed" field left empty changes
// nothing, and an Undo toast restores every previous value.

import { library } from '../data.js'
import {
  collection,
  folderItems,
  isImageLike,
  state,
  update,
} from '../store.js'
import { libraryChanged, showToast } from '../ui.js'
import { writeUrl } from '../url.js'
import { announce, escapeHtml, icon } from '../util.js'
import {
  canEdit,
  fakeRequest,
  folderName,
  needsAlt,
  plural,
  requestRender,
  ui,
} from './inspector-shared.js'

const FIELD_LABELS = {
  title: 'title',
  alt: 'alt text',
  caption: 'caption',
  description: 'description',
}

// Single-line fields where Enter means "Save & next". Textareas keep Enter
// for new lines and commit with Ctrl/Cmd+Enter.
const SAVE_AND_NEXT_FIELDS = new Set(['title', 'alt'])

const SAVED_VISIBLE_MS = 1800

// --- Field status ------------------------------------------------------------------
// Keyed by "<ids>|<field>" so a status survives the panel re-rendering
// (e.g. Save & next moves on while the previous item is still saving).

const statuses = new Map()

export function statusKey(ids, name) {
  return `${ids.join(',')}|${name}`
}

export function fieldStatus(key) {
  return statuses.get(key)
}

function statusHtml(entry) {
  if (!entry) return ''
  if (entry.state === 'saving') return 'Saving…'
  if (entry.state === 'edited') return 'Unsaved'
  if (entry.state === 'saved') {
    return `${icon('check', 'icon--sm')}Saved`
  }
  return `${icon('alert-circle', 'icon--sm')}Not saved<button type="button" class="field__retry" data-insp="retry-save" data-key="${escapeHtml(entry.key)}">Retry</button>`
}

export function statusClass(entry) {
  if (!entry) return 'field__status'
  const modifier =
    entry.state === 'saved'
      ? ' field__status--saved'
      : entry.state === 'error'
        ? ' field__status--error'
        : ''
  return `field__status is-visible${modifier}`
}

export function renderStatus(key) {
  return statusHtml(statuses.get(key))
}

function paintStatus(key) {
  const entry = statuses.get(key)
  const root = document.getElementById('inspector')
  const status = root.querySelector(`[data-status-for="${CSS.escape(key)}"]`)
  if (!status) return
  status.className = statusClass(entry)
  status.innerHTML = statusHtml(entry)
  const field = status.closest('.field')
  field.classList.toggle('field--error', entry?.state === 'error')
  const hint = field.querySelector('.field__hint--error')
  if (hint) hint.hidden = entry?.state !== 'error'
}

function setStatus(key, entry) {
  if (entry) statuses.set(key, { key, ...entry })
  else statuses.delete(key)
  paintStatus(key)
}

// --- Committing values ------------------------------------------------------------------

function itemsFor(ids) {
  return ids.map((id) => library.byId.get(id)).filter(Boolean)
}

function missingAltIn(items) {
  return items.filter(needsAlt).length
}

// Writes `value` to `name` on the items behind `ids`. Returns false when
// there was nothing to save.
export function commitValues(ids, name, value, { mode = 'replace' } = {}) {
  const key = statusKey(ids, name)
  const batch = ids.length > 1
  const targets = itemsFor(ids)
    .filter(canEdit)
    .filter((item) => name !== 'alt' || isImageLike(item))
  // A Mixed field left empty keeps every item's own value.
  if (batch && value === '') return false
  const previous = new Map(targets.map((item) => [item.id, item[name]]))
  const nextValue = (item) =>
    mode === 'append' && item[name] ? `${item[name]}\n\n${value}` : value
  const changed = targets.filter((item) => item[name] !== nextValue(item))
  if (changed.length === 0) {
    if (statuses.get(key)?.state !== 'saving') setStatus(key, null)
    return false
  }
  // Alt saves in flight are counted so a quick Save & next run celebrates
  // once, after the last one lands, not once per save.
  if (name === 'alt') {
    if (altSavesInFlight === 0) missingAtRunStart = missingAltIn(folderItems())
    altSavesInFlight++
  }
  // Optimistic: the in-memory item changes now so Save & next can move on;
  // a failed request puts the old values back.
  for (const item of changed) item[name] = nextValue(item)
  setStatus(key, { state: 'saving' })
  announce('Saving…')
  fakeRequest(batch ? 700 : 450).then(
    () => {
      setStatus(key, { state: 'saved' })
      setTimeout(() => {
        if (statuses.get(key)?.state === 'saved') setStatus(key, null)
      }, SAVED_VISIBLE_MS)
      libraryChanged()
      if (batch) {
        showToast({
          text: `Updated ${FIELD_LABELS[name]} on ${plural(changed.length, 'item')}`,
          actionLabel: 'Undo',
          onAction: () => undoBatch(changed, name, previous),
        })
      } else {
        announce(`${capitalise(FIELD_LABELS[name])} saved`)
      }
      if (name === 'alt') altSaveSettled()
    },
    () => {
      if (name === 'alt') altSaveSettled()
      for (const item of changed) item[name] = previous.get(item.id)
      setStatus(key, {
        state: 'error',
        value,
        retry: () => commitValues(ids, name, value, { mode }),
      })
      announce(`${capitalise(FIELD_LABELS[name])} not saved`)
      // The user may have moved on (Save & next); tell them anyway.
      const visible = document.querySelector(
        `#inspector [data-status-for="${CSS.escape(key)}"]`,
      )
      if (!visible) {
        const item = itemsFor(ids)[0]
        showToast({
          text: `${capitalise(FIELD_LABELS[name])} for “${item?.title}” wasn't saved`,
          iconName: 'alert-circle',
          actionLabel: 'Retry',
          onAction: () => commitValues(ids, name, value, { mode }),
          duration: 8000,
        })
      }
    },
  )
  return true
}

function undoBatch(items, name, previous) {
  for (const item of items) item[name] = previous.get(item.id)
  libraryChanged()
  requestRender()
  announce(
    `${capitalise(FIELD_LABELS[name])} restored on ${plural(items.length, 'item')}`,
  )
}

let altSavesInFlight = 0
let missingAtRunStart = 0

// The alt-text pass is a chore; finishing it deserves a moment. When the
// "Missing alt" view runs empty, the filter switches off so the last item
// stays in view (and keeps focus) instead of the panel going blank.
function altSaveSettled() {
  altSavesInFlight--
  if (altSavesInFlight > 0) return
  const viewEmptied = state.missingAlt && collection().length === 0
  if (viewEmptied) {
    ui.pendingFocus = 'alt'
    update({ missingAlt: false }, ['collection'])
    writeUrl()
  }
  if (missingAtRunStart === 0 || missingAltIn(folderItems()) > 0) return
  const scope =
    state.folder === 'all' ? 'the library' : folderName(state.folder)
  showToast({
    text: `Every image in ${scope} now has alt text${viewEmptied ? ' — showing all files again' : ''}`,
    iconName: 'accessible',
  })
}

function capitalise(text) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function retrySave(key) {
  statuses.get(key)?.retry?.()
}

// --- Reading a field element ----------------------------------------------------------------

function fieldIds(input) {
  return (input.closest('[data-ids]')?.dataset.ids ?? '')
    .split(',')
    .filter(Boolean)
    .map(Number)
}

function isDirty(input) {
  return input.value !== (input.dataset.original ?? '')
}

function commitInput(input) {
  if (input.readOnly || input.dataset.original === undefined) return
  const ids = fieldIds(input)
  if (ids.length === 0 || !isDirty(input)) return
  const mode = input.dataset.mode ?? 'replace'
  const saved = commitValues(ids, input.name, input.value, { mode })
  if (!saved) return
  // Append adds to every item, so the field starts empty again.
  if (mode === 'append') input.value = ''
  input.dataset.original = input.value
}

// --- Save & next ----------------------------------------------------------------------------

function scrollTileIntoView(id) {
  document
    .querySelector(`#grid .tile[data-id="${id}"]`)
    ?.scrollIntoView({ block: 'nearest' })
}

// Commits the field, then moves focus (and the single selection) by
// `offset` in collection order, keeping the same field focused.
export function saveAndMove(input, offset) {
  const ids = fieldIds(input)
  const items = collection()
  const index = items.findIndex((item) => item.id === ids[0])
  const next = items[index + offset]
  commitInput(input)
  if (!next) {
    announce(offset > 0 ? 'Last item in this view' : 'First item in this view')
    input.closest('.field')?.classList.add('field--bump')
    setTimeout(
      () => input.closest('.field')?.classList.remove('field--bump'),
      300,
    )
    return
  }
  ui.pendingFocus = input.name
  update({ focus: next.id, selection: new Set([next.id]), anchor: next.id }, [
    'focus',
    'selection',
  ])
  if (state.view === 'detail') writeUrl()
  else scrollTileIntoView(next.id)
  announce(`${next.title}, ${items.indexOf(next) + 1} of ${items.length}`)
}

// Turns on the "Missing alt" filter, focuses the first image without alt
// text and puts the cursor in its alt field — the accessibility pass.
export function startAltPass() {
  update({ missingAlt: true }, ['collection'])
  const first = collection().find(needsAlt)
  if (!first) return
  ui.pendingFocus = 'alt'
  update(
    {
      focus: first.id,
      selection: new Set([first.id]),
      anchor: first.id,
      inspectorTab: 'info',
      panels: { ...state.panels, inspector: true },
    },
    ['focus', 'selection', 'inspectorTab', 'panels'],
  )
  writeUrl()
  scrollTileIntoView(first.id)
}

// --- Keeping the field alive across re-renders ----------------------------------------------
// The panel is rebuilt with innerHTML on every relevant state change. These
// two functions carry the focused field (value, caret, dirty state) and
// the scroll position over to the new DOM.

export function captureFieldState(root) {
  const panel = root.querySelector('.inspector__panel')
  const active = document.activeElement
  const field = active?.closest?.('#inspector [data-ids]') ? active : null
  return {
    ids: root.querySelector('[data-ids]')?.dataset.ids ?? null,
    tab: state.inspectorTab,
    scrollTop: panel?.scrollTop ?? 0,
    field:
      field?.name && (field.tagName === 'INPUT' || field.tagName === 'TEXTAREA')
        ? {
            name: field.name,
            ids: fieldIds(field),
            value: field.value,
            original: field.dataset.original,
            dirty: field.dataset.original !== undefined && isDirty(field),
            mode: field.dataset.mode,
            start: field.selectionStart,
            end: field.selectionEnd,
          }
        : null,
  }
}

export function restoreFieldState(root, snapshot) {
  const ids = root.querySelector('[data-ids]')?.dataset.ids ?? null
  const sameTarget = ids === snapshot.ids && snapshot.tab === state.inspectorTab
  const panel = root.querySelector('.inspector__panel')
  if (sameTarget && panel) panel.scrollTop = snapshot.scrollTop
  const field = snapshot.field
  if (field && !sameTarget && field.dirty) {
    // The selection changed under a half-typed edit: save it to the items
    // it was typed for rather than dropping it.
    commitValues(field.ids, field.name, field.value, { mode: field.mode })
  }
  if (field && sameTarget) {
    const input = root.querySelector(`[data-ids] [name="${field.name}"]`)
    if (input) {
      input.value = field.value
      input.dataset.original = field.original ?? ''
      input.focus({ preventScroll: true })
      input.setSelectionRange?.(field.start, field.end)
    }
  }
  if (ui.pendingFocus) {
    const input = root.querySelector(`[data-ids] [name="${ui.pendingFocus}"]`)
    ui.pendingFocus = null
    if (input && !input.readOnly) {
      input.focus({ preventScroll: true })
      input.setSelectionRange?.(input.value.length, input.value.length)
      input.scrollIntoView({ block: 'nearest' })
    }
  }
}

// --- Wiring ------------------------------------------------------------------------------------

function isFieldControl(element) {
  return (
    element?.matches?.('.input[name]') &&
    element.closest('#inspector [data-ids]')
  )
}

function leaveField(input) {
  input.blur()
  // Esc steps back one layer: from the field to the item it describes.
  if (state.view === 'grid') {
    document
      .querySelector(`#grid .tile[data-id="${state.focus}"]`)
      ?.focus({ preventScroll: true })
  }
}

function onKeyDown(event) {
  const input = event.target
  if (!isFieldControl(input) || event.isComposing) return
  const mod = event.ctrlKey || event.metaKey
  if (event.key === 'Enter' && mod) {
    event.preventDefault()
    // With the "Missing alt" filter on, a saved item leaves the view, so
    // committing alt text there moves on as well.
    if (
      state.missingAlt &&
      input.name === 'alt' &&
      fieldIds(input).length === 1
    ) {
      saveAndMove(input, 1)
    } else {
      commitInput(input)
    }
    return
  }
  if (
    event.key === 'Enter' &&
    !event.altKey &&
    SAVE_AND_NEXT_FIELDS.has(input.name) &&
    !input.readOnly
  ) {
    event.preventDefault()
    if (fieldIds(input).length === 1)
      saveAndMove(input, event.shiftKey ? -1 : 1)
    else commitInput(input)
    return
  }
  if (event.key === 'Escape') {
    // Handled here so the keymap's "blur on Esc" doesn't run too.
    event.preventDefault()
    const key = statusKey(fieldIds(input), input.name)
    if (isDirty(input) || statuses.get(key)?.state === 'error') {
      input.value = input.dataset.original ?? ''
      if (statuses.get(key)?.state !== 'saving') setStatus(key, null)
      announce('Edit reverted')
    } else {
      leaveField(input)
    }
  }
}

function onInput(event) {
  const input = event.target
  if (!isFieldControl(input)) return
  const key = statusKey(fieldIds(input), input.name)
  const current = statuses.get(key)?.state
  if (current === 'saving') return
  if (isDirty(input)) {
    if (current !== 'edited' && current !== 'error') {
      setStatus(key, { state: 'edited' })
    }
  } else if (current === 'edited') {
    setStatus(key, null)
  }
}

export function initAutosave(root) {
  root.addEventListener('keydown', onKeyDown)
  root.addEventListener('input', onInput)
  root.addEventListener('focusout', (event) => {
    if (isFieldControl(event.target)) commitInput(event.target)
  })
}
