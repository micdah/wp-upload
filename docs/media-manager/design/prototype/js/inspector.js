// Right-hand inspector: an icon rail plus one panel slot (brief §4).
//
//   Info   metadata for 0 / 1 / N items       features/inspector-info.js
//   Edit   in-place image editing (E)          features/editor-panel.js + editor-overlay.js
//   Usage  where used, attach / detach         features/inspector-usage.js
//
// The panel is rebuilt on every relevant state change; autosave state,
// focus and scroll position are carried across rebuilds so editing never
// feels interrupted. Clicking the active rail tab collapses the panel.

import { openDetail } from './detail.js'
import { editPanel, initEditorPanel } from './features/editor-panel.js'
import { isDirty, session } from './features/editor-session.js'
import {
  captureFieldState,
  initAutosave,
  restoreFieldState,
  retrySave,
} from './features/inspector-autosave.js'
import { ensureSession, selectTab } from './features/inspector-edit.js'
import {
  batchPanel,
  initInfoActions,
  singlePanel,
  summaryPanel,
} from './features/inspector-info.js'
import {
  registerInspectorAction,
  runInspectorAction,
  setRenderer,
  ui,
} from './features/inspector-shared.js'
import { initUsageActions, usagePanel } from './features/inspector-usage.js'
import { targetItems } from './selection.js'
import { state } from './store.js'
import { html, icon } from './util.js'

const inspectorEl = () => document.getElementById('inspector')

const TABS = [
  { id: 'info', icon: 'info-circle', label: 'Info' },
  { id: 'edit', icon: 'crop', label: 'Edit image', key: 'E' },
  { id: 'usage', icon: 'link', label: 'Usage' },
]

// --- Rail -------------------------------------------------------------------------

// Small signals on the rail so a collapsed inspector still says something:
// a warn dot when the item lacks alt text, the usage count, unsaved edits.
function railBadge(tab, items) {
  const single = items.length === 1 ? items[0] : null
  if (
    tab.id === 'info' &&
    single &&
    (single.kind === 'image' || single.kind === 'svg') &&
    !single.alt
  ) {
    return html`<span class="rail__dot rail__dot--warn" aria-hidden="true"></span>`
  }
  if (tab.id === 'usage' && single?.usedIn.length) {
    return html`<span class="rail__count num" aria-hidden="true">${single.usedIn.length}</span>`
  }
  if (tab.id === 'edit' && isDirty()) {
    return html`<span class="rail__dot rail__dot--accent" aria-hidden="true"></span>`
  }
  return ''
}

function rail(items) {
  const open = state.panels.inspector
  return html`<nav class="rail" aria-label="Inspector panels">
    ${TABS.map((tab) => {
      const active = open && state.inspectorTab === tab.id
      const label = `${tab.label}${tab.key ? ` (${tab.key})` : ''}${active ? ' — click to collapse' : ''}`
      return html`<button class="icon-btn rail__tab" data-tab="${tab.id}" aria-pressed="${String(active)}"
        title="${label}" aria-label="${tab.label}">
        ${icon(tab.icon)}${railBadge(tab, items)}
      </button>`
    })}
  </nav>`
}

// --- Panel ------------------------------------------------------------------------

function panelContent(items) {
  if (state.inspectorTab === 'edit') return editPanel(items)
  if (state.inspectorTab === 'usage') return usagePanel(items)
  if (items.length === 0) return summaryPanel()
  if (items.length === 1) return singlePanel(items[0])
  return batchPanel(items)
}

function headerNote(items) {
  if (state.inspectorTab === 'edit' && session) {
    return html`<span class="panel-header__note ${isDirty() ? 'is-dirty' : ''}">${isDirty() ? 'Unsaved changes' : 'Editing'}</span>`
  }
  if (items.length > 1) {
    return html`<span class="panel-header__note num">${items.length} selected</span>`
  }
  return ''
}

// --- Focus carried across rebuilds -------------------------------------------------
// Tool buttons (rotate, ratio chips…) re-render the panel; keep keyboard
// focus on the "same" control so keyboard users can press it again.

const FOCUS_ATTRIBUTES = [
  'data-insp',
  'data-tab',
  'data-ratio',
  'data-dir',
  'data-axis',
  'data-mode',
  'data-id',
  'data-ed-input',
]

function focusSelector(root) {
  const active = document.activeElement
  if (
    !active ||
    !root.contains(active) ||
    active.matches('[data-ids] .input[name]')
  ) {
    return null
  }
  const parts = FOCUS_ATTRIBUTES.filter((name) =>
    active.hasAttribute(name),
  ).map((name) => `[${name}="${CSS.escape(active.getAttribute(name))}"]`)
  if (active.type === 'radio')
    parts.push(`[value="${CSS.escape(active.value)}"]`)
  return parts.length ? parts.join('') : null
}

// --- Rendering -----------------------------------------------------------------------

let rendering = false
let renderAgain = false

export function renderInspector() {
  // Starting an edit session re-renders from inside a render; queue it.
  if (rendering) {
    renderAgain = true
    return
  }
  rendering = true
  try {
    ensureSession()
    const root = inspectorEl()
    const items = targetItems()
    const snapshot = captureFieldState(root)
    const focus = focusSelector(root)
    const tab = TABS.find((entry) => entry.id === state.inspectorTab) ?? TABS[0]
    root.innerHTML = String(html`
      ${rail(items)}
      <div class="inspector__panel" data-tab-panel="${tab.id}">
        <div class="panel-header">
          <span class="panel-header__title">${tab.id === 'edit' ? 'Edit' : tab.label}</span>
          ${headerNote(items)}
        </div>
        ${panelContent(items)}
      </div>
    `)
    restoreFieldState(root, snapshot)
    if (focus) root.querySelector(focus)?.focus({ preventScroll: true })
  } finally {
    rendering = false
  }
  if (renderAgain) {
    renderAgain = false
    renderInspector()
  }
}

export function initInspector() {
  const root = inspectorEl()
  setRenderer(renderInspector)
  initAutosave(root)
  initInfoActions()
  initUsageActions()
  initEditorPanel(root)
  registerInspectorAction('retry-save', (button) =>
    retrySave(button.dataset.key),
  )
  registerInspectorAction('open-editor', () =>
    selectTab('edit', { toggle: false }),
  )
  registerInspectorAction('open-detail', () => {
    if (state.focus !== null) openDetail(state.focus)
  })

  root.addEventListener('click', (event) => {
    const tab = event.target.closest('[data-tab]')
    if (tab) {
      selectTab(tab.dataset.tab)
      return
    }
    const action = event.target.closest('[data-insp]')
    if (action && !action.disabled) {
      runInspectorAction(action.dataset.insp, action, event)
    }
  })
  // Remember which detail sections are collapsed (toggle doesn't bubble).
  root.addEventListener(
    'toggle',
    (event) => {
      const id = event.target.dataset?.section
      if (!id) return
      if (event.target.open) ui.collapsed.delete(id)
      else ui.collapsed.add(id)
    },
    true,
  )
}
