// Prototype bootstrap: reads URL and dev params, loads the sample library,
// wires the views to the store and handles Back/Forward.

import { loadLibrary } from './data.js'
import { closeDetail, initDetail, openDetail, syncDetail } from './detail.js'
import { initFeatures, notifyFeatures } from './features.js'
import { initFolders, renderFolders } from './folders.js'
import { initGrid, renderGrid, setOpenDetail, syncGridState } from './grid.js'
import { initInspector, renderInspector } from './inspector.js'
import { installKeymap } from './keymap.js'
import { invalidateCollection, state, subscribe, update } from './store.js'
import { initToolbar, renderFilterbar, renderToolbar } from './toolbar.js'
import { readUrl } from './url.js'
import { html } from './util.js'
import './peek.js'
import './features/index.js'

const root = document.documentElement

// Simulated site situations, so every state can be designed and screenshot.
// ?scenario=<id>; features read state.scenario.
export const SCENARIOS = {
  normal: 'Normal site',
  pro: 'FileBird Pro detected',
  'per-user': 'FileBird per-user folders on',
  'no-filebird': 'FileBird not installed',
  'no-plugin': 'Companion plugin missing',
  author: 'WP user is an Author',
  trash: 'MEDIA_TRASH enabled',
  offline: 'WordPress unreachable',
  loading: 'Loading (slow site)',
  empty: 'Empty library',
}

// --- Dev params: ?theme=dark|light&chrome=0&scenario=<id> ------------------------

function readDevParams() {
  const params = new URLSearchParams(location.search)
  const theme =
    params.get('theme') ??
    (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
  root.dataset.chrome = params.get('chrome') ?? '1'
  const scenario = params.get('scenario')
  root.dataset.scenario = scenario in SCENARIOS ? scenario : 'normal'
  return {
    theme: theme === 'light' ? 'light' : 'dark',
    scenario: root.dataset.scenario,
  }
}

function setDevParam(name, value) {
  const params = new URLSearchParams(location.search)
  params.set(name, value)
  history.replaceState(null, '', `${location.pathname}?${params}`)
}

function applyTheme() {
  root.dataset.theme = state.theme
}

function applyPanels() {
  const app = document.getElementById('app')
  app.dataset.folders = state.panels.folders ? 'open' : 'closed'
  app.dataset.inspector = state.panels.inspector ? 'open' : 'closed'
}

function renderDevbar() {
  document.getElementById('devbar').innerHTML = String(html`
    <span>Prototype</span>
    <select class="select" name="scenario" aria-label="Simulated scenario">
      ${Object.entries(SCENARIOS).map(
        ([value, label]) =>
          html`<option value="${value}" ${value === state.scenario ? 'selected' : ''}>${label}</option>`,
      )}
    </select>
    <a class="btn btn--sm btn--ghost" href="system.html">Design system</a>
  `)
}

// --- Store → views --------------------------------------------------------------

function render(changes) {
  if (changes.has('collection')) invalidateCollection()
  if (changes.has('theme')) {
    applyTheme()
    setDevParam('theme', state.theme)
  }
  if (changes.has('panels')) applyPanels()
  if (changes.has('folders') || changes.has('collection')) renderFolders()
  if (
    ['collection', 'layout', 'density'].some((change) => changes.has(change))
  ) {
    renderGrid()
  } else if (changes.has('selection') || changes.has('focus')) {
    syncGridState()
  }
  if (changes.has('collection')) renderFilterbar()
  if (
    [
      'collection',
      'folders',
      'selection',
      'layout',
      'density',
      'panels',
      'theme',
    ].some((change) => changes.has(change))
  ) {
    renderToolbar()
  }
  if (
    ['collection', 'selection', 'focus', 'view', 'panels', 'inspectorTab'].some(
      (change) => changes.has(change),
    )
  ) {
    renderInspector()
  }
  syncDetail(changes)
  notifyFeatures(changes)
}

function onPopState() {
  const next = readUrl()
  if (next.view === 'detail' && state.view === 'grid') {
    update({ ...next, view: 'grid' }, ['collection'])
    openDetail(next.focus)
  } else if (next.view === 'grid' && state.view === 'detail') {
    closeDetail({ fromHistory: true })
  } else {
    update(next, ['collection', 'focus', 'layout', 'density'])
  }
}

async function start() {
  const dev = readDevParams()
  const narrow = innerWidth < 1200
  const fromUrl = readUrl()
  Object.assign(state, dev, fromUrl, {
    panels: {
      folders: innerWidth >= 900 && dev.scenario !== 'no-filebird',
      inspector: !narrow,
    },
  })
  applyTheme()
  applyPanels()
  renderDevbar()

  await loadLibrary()
  initGrid()
  setOpenDetail(openDetail)
  initDetail()
  initFolders()
  initInspector()
  initToolbar()
  installKeymap()
  initFeatures()

  if (state.focus !== null) state.selection = new Set([state.focus])
  render(
    new Set([
      'collection',
      'folders',
      'selection',
      'focus',
      'view',
      'panels',
      'layout',
    ]),
  )

  subscribe(render)
  window.addEventListener('popstate', onPopState)
  document.addEventListener('library-changed', () => {
    invalidateCollection()
    renderGrid()
    renderFilterbar()
    // Detail mode's index and filmstrip follow items leaving the view.
    syncDetail(new Set(['collection']))
    notifyFeatures(new Set(['library']))
  })
  // Switching scenario reloads, so every module starts from a clean state.
  document.getElementById('devbar').addEventListener('change', (event) => {
    if (event.target.name !== 'scenario') return
    setDevParam('scenario', event.target.value)
    location.reload()
  })
}

start()
