// One state object for the whole prototype. Grid, detail mode, filmstrip and
// inspector are all views of it ("one collection, many views").

import { library } from './data.js'

export const state = {
  // Collection: which items, in which order.
  folder: 'all', // 'all' | 0 (Uncategorized) | folder id
  query: '',
  type: 'all', // 'all' | 'image' | 'video' | 'audio' | 'document'
  missingAlt: false,
  size: 'any', // 'any' | 'gt1' | 'gt5' (MB)
  orientation: 'any', // 'any' | 'landscape' | 'portrait' | 'square'
  month: '', // '' | 'YYYY-MM'
  sort: 'date-desc',
  // Presentation.
  layout: 'justified', // 'justified' | 'square'
  density: 2, // index into DENSITIES
  theme: 'dark',
  scenario: 'normal', // see SCENARIOS in app.js
  panels: { folders: true, inspector: true },
  inspectorTab: 'info',
  expandedFolders: new Set([4, 6]),
  // Interaction.
  selection: new Set(),
  anchor: null,
  focus: null,
  view: 'grid', // 'grid' | 'detail'
}

// Justified row heights / square cell sizes per density step.
export const DENSITIES = [120, 160, 200, 260, 340]

const listeners = new Set()

export function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// `changes` names what changed, so views re-render only what they must.
export function update(patch, changes = Object.keys(patch)) {
  Object.assign(state, patch)
  for (const listener of listeners) listener(new Set(changes))
}

// --- Derived collection ------------------------------------------------------

const SORTS = {
  'date-desc': (a, b) => b.uploaded.localeCompare(a.uploaded),
  'date-asc': (a, b) => a.uploaded.localeCompare(b.uploaded),
  'title-asc': (a, b) => a.title.localeCompare(b.title),
  'name-asc': (a, b) => a.filename.localeCompare(b.filename),
  'size-desc': (a, b) => b.filesize - a.filesize,
  'size-asc': (a, b) => a.filesize - b.filesize,
  'dimensions-desc': (a, b) => b.width * b.height - a.width * a.height,
  'type-asc': (a, b) =>
    a.mime.localeCompare(b.mime) || b.uploaded.localeCompare(a.uploaded),
}

export const SORT_LABELS = {
  'date-desc': 'Newest first',
  'date-asc': 'Oldest first',
  'title-asc': 'Title A–Z',
  'name-asc': 'File name A–Z',
  'size-desc': 'Largest file',
  'size-asc': 'Smallest file',
  'dimensions-desc': 'Largest dimensions',
  'type-asc': 'File type',
}

export const SIZE_FILTERS = {
  gt1: { label: 'Larger than 1 MB', bytes: 1_000_000 },
  gt5: { label: 'Larger than 5 MB', bytes: 5_000_000 },
}

export const ORIENTATIONS = {
  landscape: 'Landscape',
  portrait: 'Portrait',
  square: 'Square',
}

export function orientationOf(item) {
  const ratio = item.width / item.height
  if (ratio > 1.1) return 'landscape'
  if (ratio < 0.9) return 'portrait'
  return 'square'
}

export function monthOf(item) {
  return item.uploaded.slice(0, 7)
}

function matchesFolder(item) {
  if (state.folder === 'all') return true
  return item.folder === state.folder
}

function matchesFilters(item) {
  if (state.type !== 'all' && kindGroup(item) !== state.type) return false
  if (state.missingAlt && !(isImageLike(item) && !item.alt)) return false
  if (state.size !== 'any' && item.filesize <= SIZE_FILTERS[state.size].bytes) {
    return false
  }
  if (state.orientation !== 'any') {
    if (item.width <= 1 || orientationOf(item) !== state.orientation) {
      return false
    }
  }
  if (state.month && monthOf(item) !== state.month) return false
  if (state.query) {
    const query = state.query.toLowerCase()
    const haystack =
      `${item.title} ${item.filename} ${item.caption} ${item.alt}`.toLowerCase()
    if (!haystack.includes(query)) return false
  }
  return true
}

export function kindGroup(item) {
  if (item.kind === 'svg' || item.kind === 'image') return 'image'
  if (item.kind === 'archive') return 'document'
  return item.kind
}

export function isImageLike(item) {
  return item.kind === 'image' || item.kind === 'svg'
}

let cacheKey = ''
let cached = []

// The ordered list every view walks (grid, filmstrip, ←/→ in detail).
export function collection() {
  const key = [
    state.folder,
    state.query,
    state.type,
    state.missingAlt,
    state.size,
    state.orientation,
    state.month,
    state.sort,
    library.items.length,
  ].join('|')
  if (key !== cacheKey) {
    cacheKey = key
    cached = library.items
      .filter((item) => matchesFolder(item) && matchesFilters(item))
      .sort(SORTS[state.sort])
  }
  return cached
}

// Items in the current folder before type/search filters, for chip counts.
export function folderItems() {
  return library.items.filter(matchesFolder)
}

export function invalidateCollection() {
  cacheKey = ''
}
