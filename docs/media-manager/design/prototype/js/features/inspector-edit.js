// Inspector & editing feature (Agent B): wires the inspector panels to the
// rest of the app — shortcuts (E edit image, A alt text), the action bus
// (edit-image, edit-details), and the image-edit session's lifecycle
// (start when the Edit panel shows one editable image, guard unsaved
// edits, save in place).
//
// Panels: inspector.js (shell) · inspector-info.js · inspector-usage.js ·
// editor-panel.js · editor-overlay.js · editor-session.js ·
// inspector-autosave.js · inspector-shared.js. Spec: specs/inspector.md.

import { library } from '../data.js'
import { registerFeature } from '../features.js'
import { registerAction, registerBindings } from '../keymap.js'
import { targetItems } from '../selection.js'
import { state, update } from '../store.js'
import { confirmDialog, libraryChanged, on, showToast } from '../ui.js'
import { announce } from '../util.js'
import {
  applyInert,
  isOverlayOpen,
  mountOverlay,
  unmountOverlay,
} from './editor-overlay.js'
import {
  endSession,
  isDirty,
  output,
  session,
  sessionItem,
  setStatus,
  startSession,
} from './editor-session.js'
import {
  canEdit,
  devHooks,
  fakeRequest,
  isEditableImage,
  plural,
  requestRender,
  subSizes,
  ui,
} from './inspector-shared.js'

// --- Tabs ---------------------------------------------------------------------

function returnTab() {
  return ui.previousTab && ui.previousTab !== 'edit' ? ui.previousTab : 'info'
}

async function confirmDiscard() {
  if (!isDirty()) return true
  return confirmDialog({
    title: 'Discard your edits?',
    text: `The crop, rotation and other changes to “${sessionItem()?.title}” haven’t been saved.`,
    confirmLabel: 'Discard edits',
    cancelLabel: 'Keep editing',
    danger: true,
  })
}

// Rail click, E, or the detail-mode menu. Clicking the active tab collapses
// the panel (to the rail); leaving the Edit tab asks before dropping edits.
export async function selectTab(tab, { toggle = true } = {}) {
  const open = state.panels.inspector
  const same = state.inspectorTab === tab && open
  if (same && !toggle) return
  if (session && (tab !== 'edit' || same)) {
    if (!(await confirmDiscard())) return
  }
  if (tab === 'edit' && state.inspectorTab !== 'edit') {
    ui.previousTab = state.inspectorTab
  }
  update({ inspectorTab: tab, panels: { ...state.panels, inspector: !same } }, [
    'inspectorTab',
    'panels',
  ])
}

async function leaveEditor(patch) {
  if (!(await confirmDiscard())) return
  update(patch, Object.keys(patch))
  returnFocus()
}

// After the editor closes, keyboard focus goes back to the item.
function returnFocus() {
  const selector =
    state.view === 'grid'
      ? `#grid .tile[data-id="${state.focus}"]`
      : '#detail .stage'
  document.querySelector(selector)?.focus?.({ preventScroll: true })
}

// --- Edit session lifecycle ----------------------------------------------------------

const overlayHandlers = {
  save: () => saveEdits(),
  cancel: () => leaveEditor({ inspectorTab: returnTab() }),
  leave: (key) =>
    leaveEditor(
      key === 'i'
        ? { panels: { ...state.panels, inspector: false } }
        : { inspectorTab: returnTab() },
    ),
  dismissError: () => setStatus('idle'),
}

function closeEditor() {
  endSession()
  unmountOverlay()
}

// Called by inspector.js before every render: the canvas is open exactly
// while the Edit panel shows a single image the user may edit.
export function ensureSession() {
  const items = targetItems()
  const item = items.length === 1 ? items[0] : null
  const wanted =
    state.panels.inspector &&
    state.inspectorTab === 'edit' &&
    item &&
    isEditableImage(item) &&
    canEdit(item)
  if (wanted && session?.itemId !== item.id) {
    if (session) closeEditor()
    startSession(item)
    mountOverlay(item, overlayHandlers)
  } else if (!wanted && session) {
    closeEditor()
  }
}

async function saveEdits() {
  if (!session || !isDirty() || session.status === 'saving') return
  const item = sessionItem()
  const out = output()
  const applyTo = session.applyTo
  setStatus('saving')
  announce('Saving edits')
  try {
    await fakeRequest(1400)
  } catch {
    setStatus('error')
    announce('Edits not saved. WordPress didn’t respond.')
    return
  }
  const before = {
    width: item.width,
    height: item.height,
    filesize: item.filesize,
    edit: item.edit ?? null,
  }
  const now = new Date().toISOString()
  item.edit = {
    at: now,
    applyTo,
    from: item.edit?.from ?? { width: item.width, height: item.height },
  }
  if (applyTo !== 'thumbnail') {
    const area = (out.w * out.h) / (item.width * item.height)
    item.width = out.w
    item.height = out.h
    item.filesize = Math.round(item.filesize * area)
  }
  item.modified = now
  closeEditor()
  update({ inspectorTab: returnTab() }, ['inspectorTab'])
  libraryChanged()
  returnFocus()
  const sizes = subSizes(item).length + 1
  showToast({
    text:
      applyTo === 'thumbnail'
        ? 'Thumbnail saved'
        : `Saved — ${plural(sizes, 'size')} regenerated`,
    actionLabel: 'Undo',
    onAction: () => undoSave(item, before),
  })
}

// The plugin keeps a backup per edit (like _wp_attachment_backup_sizes),
// so the last save can be undone, not just "restore original".
async function undoSave(item, before) {
  try {
    await fakeRequest(600)
  } catch {
    showToast({
      text: 'Couldn’t undo — WordPress didn’t respond',
      iconName: 'alert-circle',
    })
    return
  }
  Object.assign(item, before)
  item.edit = before.edit
  libraryChanged()
  requestRender()
  announce('Edit undone')
}

// --- Shortcuts and actions ---------------------------------------------------------------

function focusField(name) {
  ui.pendingFocus = name
  if (state.inspectorTab === 'info' && state.panels.inspector) {
    requestRender()
  } else {
    update(
      { inspectorTab: 'info', panels: { ...state.panels, inspector: true } },
      ['inspectorTab', 'panels'],
    )
  }
}

function focusAlt() {
  const items = targetItems()
  if (items.length === 0) {
    announce('Select an image first')
    return
  }
  const hasAlt = items.some(
    (item) => item.kind === 'image' || item.kind === 'svg',
  )
  focusField(hasAlt ? 'alt' : 'title')
}

function seedSampleEdits() {
  // One image starts out "edited earlier", so Restore original and the
  // Edited badge can be seen without editing first.
  const item = library.items.find(
    (entry) =>
      entry.kind === 'image' && entry.author === 'Site Admin' && entry.exif,
  )
  if (item && !item.edit) {
    item.edit = {
      at: '2026-11-19T10:12:00.000Z',
      applyTo: 'all',
      from: { width: item.width, height: item.height },
    }
  }
}

registerFeature({
  init() {
    seedSampleEdits()
    registerBindings([
      {
        key: 'e',
        mode: 'any',
        action: 'edit-image',
        group: 'Edit',
        label: 'Edit image (crop, rotate, flip)',
      },
      {
        key: 'a',
        mode: 'any',
        action: 'focus-alt',
        group: 'Edit',
        label: 'Jump to alt text',
      },
    ])
    registerAction('edit-image', () => selectTab('edit'))
    registerAction('focus-alt', focusAlt)
    on('edit-image', () => selectTab('edit', { toggle: false }))
    on('edit-details', () => focusField('title'))
    // Prototype-only hook for screenshots and checks.
    window.mmInspector = devHooks
  },
  onChange(changes) {
    if (isOverlayOpen()) applyInert()
    if (changes.has('library')) requestRender()
  },
})
