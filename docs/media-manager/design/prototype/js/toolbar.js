// Top toolbar (brand, breadcrumb, search, sort, layout, density, upload,
// panel and theme toggles) and the filter-chip row above the grid. The
// toolbar turns into a selection bar while two or more items are selected.

import { folderPath } from './data.js'
import { registerAction } from './keymap.js'
import { clearSelection } from './selection.js'
import {
  collection,
  DENSITIES,
  folderItems,
  isImageLike,
  kindGroup,
  monthOf,
  ORIENTATIONS,
  SIZE_FILTERS,
  SORT_LABELS,
  state,
  update,
} from './store.js'
import { openMenu } from './ui.js'
import { writeUrl } from './url.js'
import { formatBytes, html, icon, raw } from './util.js'

const toolbarEl = () => document.getElementById('toolbar')
const filterbarEl = () => document.getElementById('filterbar')

const TYPE_CHIPS = [
  { id: 'all', label: 'All' },
  { id: 'image', label: 'Images' },
  { id: 'video', label: 'Video' },
  { id: 'audio', label: 'Audio' },
  { id: 'document', label: 'Documents' },
]

// The brand mark: a neon viewfinder frame. Used by the toolbar and system page.
export function brandMark() {
  return raw(`<svg class="brand__mark" viewBox="0 0 20 20" aria-hidden="true">
    <defs><linearGradient id="brand-gradient" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#5cefff" /><stop offset=".45" stop-color="#00e5ff" /><stop offset="1" stop-color="#0099ff" />
    </linearGradient></defs>
    <rect x="1" y="1" width="18" height="18" rx="5" fill="url(#brand-gradient)" />
    <rect x="5" y="5" width="10" height="10" rx="2" fill="var(--surface-panel)" />
  </svg>`)
}

// FileBird is optional: without it there is no folder UI at all.
function hasFileBird() {
  return state.scenario !== 'no-filebird'
}

function breadcrumb() {
  if (state.folder === 'all') return [{ name: 'All files' }]
  if (state.folder === 0) return [{ name: 'Uncategorized' }]
  return folderPath(state.folder)
}

function normalToolbar() {
  const crumbs = breadcrumb()
  return html`
    <a class="brand" href="./" aria-label="wp-upload media manager">
      ${brandMark()}<span class="brand__wordmark">wp-upload</span>
    </a>
    <nav class="breadcrumb" aria-label="Current folder">
      ${crumbs.map(
        (crumb, index) =>
          html`${index ? icon('chevron-right', 'icon--sm') : ''}<span
              class="${index === crumbs.length - 1 ? 'breadcrumb__current' : ''}"
              >${crumb.name}</span
            >`,
      )}
    </nav>
    <span class="toolbar__spacer"></span>
    <label class="search">
      ${icon('search')}
      <input class="input" type="search" name="search" placeholder="Search title, file name, caption, alt…" value="${state.query}" aria-label="Search media" />
    </label>
    <button class="btn btn--ghost" data-action="sort" aria-haspopup="menu" title="Sort">
      ${icon(state.sort.endsWith('asc') ? 'sort-ascending' : 'sort-descending')}${SORT_LABELS[state.sort]}${icon('chevron-down', 'icon--sm')}
    </button>
    <div class="segmented" role="group" aria-label="Layout">
      <button class="icon-btn" data-layout="justified" aria-pressed="${String(state.layout === 'justified')}" title="Justified layout (L)">
        ${icon('layout-board')}
      </button>
      <button class="icon-btn" data-layout="square" aria-pressed="${String(state.layout === 'square')}" title="Square layout (L)">
        ${icon('layout-grid')}
      </button>
    </div>
    <input class="density" type="range" name="density" min="0" max="${DENSITIES.length - 1}" value="${state.density}" aria-label="Thumbnail size (+ / -)" title="Thumbnail size (+ / -)" />
    <span class="toolbar__divider"></span>
    <button class="btn btn--primary" data-mm-action="upload">${icon('upload')}Upload</button>
    <span class="toolbar__divider"></span>
    <div class="toolbar__group">
      ${
        hasFileBird()
          ? html`<button class="icon-btn" data-panel="folders" aria-pressed="${String(state.panels.folders)}" title="Folders (F)">
              ${icon('layout-sidebar')}
            </button>`
          : ''
      }
      <button class="icon-btn" data-panel="inspector" aria-pressed="${String(state.panels.inspector)}" title="Inspector (I)">
        ${icon('layout-sidebar-right')}
      </button>
      <button class="icon-btn" data-action="theme" title="Switch to ${state.theme === 'dark' ? 'light' : 'dark'} theme">
        ${icon(state.theme === 'dark' ? 'sun' : 'moon')}
      </button>
    </div>
  `
}

function selectionToolbar() {
  return html`<div class="selection-bar">
    <button class="icon-btn" data-action="clear" title="Clear selection (Esc)">${icon('x')}</button>
    <span class="selection-bar__count num">${state.selection.size} selected</span>
    ${
      hasFileBird()
        ? html`<button class="btn btn--ghost" data-mm-action="move-to-folder">${icon('folder')}Move to folder</button>`
        : ''
    }
    <button class="btn btn--ghost" data-mm-action="edit-details">${icon('pencil')}Edit details</button>
    <button class="btn btn--ghost" data-mm-action="download">${icon('download')}Download</button>
    <span class="toolbar__spacer"></span>
    <button class="btn btn--ghost btn--danger" data-mm-action="delete">${icon('trash')}Delete</button>
  </div>`
}

export function renderToolbar() {
  const toolbar = toolbarEl()
  const hadFocusInSearch = document.activeElement?.name === 'search'
  toolbar.classList.toggle('is-selection', state.selection.size >= 2)
  toolbar.innerHTML = String(
    state.selection.size >= 2 ? selectionToolbar() : normalToolbar(),
  )
  if (hadFocusInSearch) {
    const search = toolbar.querySelector('[name="search"]')
    search?.focus()
    search?.setSelectionRange(search.value.length, search.value.length)
  }
}

export function renderFilterbar() {
  const inFolder = folderItems()
  const counts = { all: inFolder.length }
  for (const item of inFolder) {
    const group = kindGroup(item)
    counts[group] = (counts[group] ?? 0) + 1
  }
  const missingAlt = inFolder.filter(
    (item) => isImageLike(item) && !item.alt,
  ).length
  const shown = collection()
  const total = shown.reduce((sum, item) => sum + item.filesize, 0)
  filterbarEl().innerHTML = String(html`
    ${TYPE_CHIPS.filter((chip) => chip.id === 'all' || counts[chip.id]).map(
      (chip) =>
        html`<button class="chip" data-type="${chip.id}" aria-pressed="${String(state.type === chip.id)}">
          ${chip.label}<span class="chip__count">${counts[chip.id] ?? 0}</span>
        </button>`,
    )}
    <button class="chip" data-missing-alt aria-pressed="${String(state.missingAlt)}">
      ${icon('accessible', 'icon--sm')}Missing alt<span class="chip__count">${missingAlt}</span>
    </button>
    ${activeFilterChips()}
    <button class="chip" data-action="add-filter" aria-haspopup="menu">
      ${icon('plus', 'icon--sm')}Filter
    </button>
    <span class="filterbar__summary num">${shown.length} items · ${formatBytes(total)}</span>
  `)
}

// --- Extra filters (size, orientation, month) ------------------------------------

function monthLabel(month) {
  const [year, number] = month.split('-').map(Number)
  return new Date(year, number - 1).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
  })
}

// Removable chips for the active extra filters, so they're visible and easy
// to clear without reopening the menu.
function activeFilterChips() {
  const chips = []
  if (state.size !== 'any') {
    chips.push(['size', SIZE_FILTERS[state.size].label])
  }
  if (state.orientation !== 'any') {
    chips.push(['orientation', ORIENTATIONS[state.orientation]])
  }
  if (state.month) chips.push(['month', monthLabel(state.month)])
  return chips.map(
    ([key, label]) =>
      html`<button class="chip" aria-pressed="true" data-clear="${key}" title="Remove filter">
        ${label}<span class="chip__remove">${icon('x', 'icon--sm')}</span>
      </button>`,
  )
}

// Months that have media (newest first) with counts, like core's date
// dropdown; the companion plugin provides this list in the real app.
function monthsWithMedia() {
  const counts = new Map()
  for (const item of folderItems()) {
    const month = monthOf(item)
    counts.set(month, (counts.get(month) ?? 0) + 1)
  }
  return [...counts].sort((a, b) => b[0].localeCompare(a[0]))
}

function setFilter(patch) {
  update(patch, ['collection'])
  writeUrl()
}

function openFilterMenu(anchor) {
  const rect = anchor.getBoundingClientRect()
  const months = monthsWithMedia().slice(0, 8)
  openMenu({
    x: rect.left,
    y: rect.bottom + 4,
    label: 'Size',
    items: [
      ...Object.entries(SIZE_FILTERS).map(([key, { label }]) => ({
        label,
        icon: state.size === key ? 'check' : 'dimensions',
        onSelect: () => setFilter({ size: state.size === key ? 'any' : key }),
      })),
      'separator',
      { heading: 'Orientation' },
      ...Object.entries(ORIENTATIONS).map(([key, label]) => ({
        label,
        icon: state.orientation === key ? 'check' : 'photo',
        onSelect: () =>
          setFilter({ orientation: state.orientation === key ? 'any' : key }),
      })),
      'separator',
      { heading: 'Uploaded' },
      ...months.map(([month, count]) => ({
        label: `${monthLabel(month)} · ${count}`,
        icon: state.month === month ? 'check' : 'calendar',
        onSelect: () =>
          setFilter({ month: state.month === month ? '' : month }),
      })),
    ],
  })
}

function openSortMenu(anchor) {
  const rect = anchor.getBoundingClientRect()
  openMenu({
    x: rect.left,
    y: rect.bottom + 4,
    label: 'Sort by',
    items: Object.entries(SORT_LABELS).map(([value, label]) => ({
      label,
      icon: value === state.sort ? 'check' : undefined,
      onSelect: () => setFilter({ sort: value }),
    })),
  })
}

let searchTimer = 0

export function initToolbar() {
  const toolbar = toolbarEl()
  toolbar.addEventListener('input', (event) => {
    const { name, value } = event.target
    if (name === 'search') {
      clearTimeout(searchTimer)
      searchTimer = setTimeout(() => {
        update({ query: value.trim() }, ['collection'])
        writeUrl()
      }, 150)
    } else if (name === 'density') {
      update({ density: Number(value) }, ['density'])
      writeUrl()
    }
  })
  toolbar.addEventListener('click', (event) => {
    const target = event.target.closest('button')
    if (!target) return
    if (target.dataset.action === 'sort') {
      openSortMenu(target)
    } else if (target.dataset.layout) {
      update({ layout: target.dataset.layout }, ['layout'])
      writeUrl()
    } else if (target.dataset.panel) {
      const name = target.dataset.panel
      update({ panels: { ...state.panels, [name]: !state.panels[name] } }, [
        'panels',
      ])
    } else if (target.dataset.action === 'theme') {
      update({ theme: state.theme === 'dark' ? 'light' : 'dark' }, ['theme'])
    } else if (target.dataset.action === 'clear') {
      clearSelection()
    }
  })

  const filterbar = filterbarEl()
  filterbar.addEventListener('click', (event) => {
    const chip = event.target.closest('.chip')
    if (!chip) return
    if (chip.dataset.action === 'add-filter') {
      openFilterMenu(chip)
      return
    }
    const cleared = chip.dataset.clear
    if (cleared === 'size') setFilter({ size: 'any' })
    else if (cleared === 'orientation') setFilter({ orientation: 'any' })
    else if (cleared === 'month') setFilter({ month: '' })
    else if (chip.dataset.type) setFilter({ type: chip.dataset.type })
    else setFilter({ missingAlt: !state.missingAlt })
  })

  registerAction('toggle-inspector', () =>
    update(
      { panels: { ...state.panels, inspector: !state.panels.inspector } },
      ['panels'],
    ),
  )
}
