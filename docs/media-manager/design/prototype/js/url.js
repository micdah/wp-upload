// State ↔ URL query parameters. Query params (not paths) keep the app working
// under any sub-path. Entering detail pushes a history entry; stepping between
// items and changing filters replaces it, so Back returns to the grid.

import { state } from './store.js'

const DEFAULTS = {
  folder: 'all',
  q: '',
  type: 'all',
  alt: '',
  size: 'any',
  orient: 'any',
  month: '',
  sort: 'date-desc',
  layout: 'justified',
  density: '2',
}

function folderParam(folder) {
  return folder === 'all' ? 'all' : String(folder)
}

export function readUrl() {
  const params = new URLSearchParams(location.search)
  const folder = params.get('folder') ?? DEFAULTS.folder
  const item = params.get('item')
  return {
    folder: folder === 'all' ? 'all' : Number(folder),
    query: params.get('q') ?? '',
    type: params.get('type') ?? 'all',
    missingAlt: params.get('alt') === 'missing',
    size: params.get('size') ?? DEFAULTS.size,
    orientation: params.get('orient') ?? DEFAULTS.orient,
    month: params.get('month') ?? DEFAULTS.month,
    sort: params.get('sort') ?? DEFAULTS.sort,
    layout: params.get('layout') ?? DEFAULTS.layout,
    density: Number(params.get('density') ?? DEFAULTS.density),
    view: item ? 'detail' : 'grid',
    focus: item ? Number(item) : null,
  }
}

// Dev-only params (direction, theme, chrome) are carried over untouched.
export function writeUrl({ push = false } = {}) {
  const params = new URLSearchParams(location.search)
  const values = {
    folder: folderParam(state.folder),
    q: state.query,
    type: state.type,
    alt: state.missingAlt ? 'missing' : '',
    size: state.size,
    orient: state.orientation,
    month: state.month,
    sort: state.sort,
    layout: state.layout,
    density: String(state.density),
  }
  for (const [name, value] of Object.entries(values)) {
    if (value === DEFAULTS[name]) params.delete(name)
    else params.set(name, value)
  }
  if (state.view === 'detail' && state.focus !== null) {
    params.set('item', String(state.focus))
  } else {
    params.delete('item')
  }
  const query = params.toString()
  const url = `${location.pathname}${query ? `?${query}` : ''}`
  if (url === `${location.pathname}${location.search}`) return
  if (push) history.pushState(null, '', url)
  else history.replaceState(null, '', url)
}
