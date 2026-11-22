// The media grid: justified rows (aspect-preserving) or square cells, with
// hover check circles, selection, roving keyboard focus and badges.

import { aspectRatio, KIND_ICONS, library, pictureUrl } from './data.js'
import { registerAction } from './keymap.js'
import {
  clearSelection,
  rangeTo,
  selectAll,
  selectOnly,
  toggle,
} from './selection.js'
import { collection, DENSITIES, isImageLike, state, update } from './store.js'
import { formatDuration, html, icon, truncateMiddle } from './util.js'

const gridEl = () => document.getElementById('grid')
const scrollEl = () => document.getElementById('grid-scroll')

let openDetail = () => {}

export function setOpenDetail(handler) {
  openDetail = handler
}

// --- Tiles ---------------------------------------------------------------

function badges(item) {
  const parts = []
  if (isImageLike(item) && !item.alt) {
    parts.push(html`<span class="badge badge--warn" title="Missing alt text"
      >${icon('accessible', 'icon--sm')}Alt</span
    >`)
  }
  if (item.kind === 'video' || item.kind === 'audio') {
    parts.push(
      html`<span class="badge">${icon(KIND_ICONS[item.kind], 'icon--sm')}${formatDuration(item.duration)}</span>`,
    )
  }
  if (item.kind === 'document' && item.pages) {
    parts.push(html`<span class="badge">PDF · ${item.pages} p</span>`)
  }
  return parts
}

function tileMedia(item, neededPx) {
  const src = pictureUrl(item, neededPx)
  if (item.kind === 'svg') {
    return html`<div class="tile__doc tile__doc--svg">
      <img src="${src}" alt="" />
    </div>`
  }
  if (!src) {
    return html`<div class="tile__doc">
      ${icon(KIND_ICONS[item.kind])}
      <span class="tile__doc-name">${truncateMiddle(item.filename, 28)}</span>
    </div>`
  }
  return html`<div class="tile__media">
    <img src="${src}" alt="" loading="lazy" decoding="async" />
  </div>`
}

export function tileHtml(item, { width, height, extraClass = '' }) {
  const neededPx = Math.max(width, height) * Math.min(devicePixelRatio, 2)
  const style = width ? `width:${Math.round(width)}px` : ''
  return html`<div
    class="tile ${extraClass}"
    role="gridcell"
    tabindex="-1"
    draggable="true"
    data-id="${item.id}"
    style="${style}"
    aria-selected="false"
    aria-label="${item.title}"
  >
    ${tileMedia(item, neededPx)}
    <button class="tile__check" tabindex="-1" aria-label="Select ${item.title}">
      ${icon('check')}
    </button>
    <div class="tile__badges">${badges(item)}</div>
    <div class="tile__name">${truncateMiddle(item.filename, 40)}</div>
  </div>`
}

// --- Empty and loading states ---------------------------------------------------

// Skeleton rows shaped like a justified grid, so loading never shows spinners.
function skeletonRows(rowHeight) {
  const pattern = [
    [1.5, 0.7, 1.3, 1, 1.4],
    [1, 1.5, 0.75, 1.5],
    [0.7, 1.3, 1.5, 1, 0.8],
  ]
  return html`${pattern.map(
    (row) =>
      html`<div class="grid-row" style="height:${rowHeight}px">${row.map(
        (grow) => html`<div class="skeleton tile" style="flex:${grow}"></div>`,
      )}</div>`,
  )}`
}

function emptyState() {
  if (library.items.length === 0) {
    return html`<div class="empty">
      <div class="empty__art">${icon('cloud-upload')}</div>
      <h3 class="empty__title">Your media library is empty</h3>
      <p class="empty__text">Drop files anywhere in this window, or upload them from your computer.</p>
      <button class="btn btn--primary" data-mm-action="upload">${icon('upload')}Upload files</button>
    </div>`
  }
  const filtered =
    state.query ||
    state.type !== 'all' ||
    state.missingAlt ||
    state.size !== 'any' ||
    state.orientation !== 'any' ||
    state.month
  if (filtered) {
    return html`<div class="empty">
      <div class="empty__art">${icon('search')}</div>
      <h3 class="empty__title">No media matches</h3>
      <p class="empty__text">Nothing in this folder matches the current search and filters.</p>
      <button class="btn" data-clear-filters>${icon('x')}Clear filters</button>
    </div>`
  }
  return html`<div class="empty">
    <div class="empty__art">${icon('folder-open')}</div>
    <h3 class="empty__title">This folder is empty</h3>
    <p class="empty__text">Drop files here to upload them into it, or drag media onto the folder in the sidebar.</p>
    <button class="btn btn--primary" data-mm-action="upload">${icon('upload')}Upload</button>
  </div>`
}

// --- Layout ----------------------------------------------------------------

// Flickr-style row packing: fill a row at the target height, then scale the
// row so it exactly fits the width. The last row keeps the target height.
function justifiedRows(items, containerWidth, targetHeight, gap) {
  const rows = []
  let row = []
  let ratioSum = 0
  for (const item of items) {
    row.push(item)
    ratioSum += aspectRatio(item)
    const rowWidth = ratioSum * targetHeight + gap * (row.length - 1)
    if (rowWidth >= containerWidth) {
      const height = (containerWidth - gap * (row.length - 1)) / ratioSum
      rows.push({ items: row, height, full: true })
      row = []
      ratioSum = 0
    }
  }
  if (row.length) rows.push({ items: row, height: targetHeight, full: false })
  return rows
}

function gridGap() {
  return parseFloat(getComputedStyle(gridEl()).rowGap) || 0
}

export function renderGrid() {
  const grid = gridEl()
  const items = collection()
  const targetHeight = DENSITIES[state.density]
  grid.dataset.layout = state.layout
  grid.style.setProperty('--cell', `${targetHeight}px`)

  if (state.scenario === 'loading') {
    grid.innerHTML = String(skeletonRows(targetHeight))
    return
  }

  if (items.length === 0) {
    grid.innerHTML = String(emptyState())
    return
  }

  if (state.layout === 'square') {
    grid.innerHTML = items
      .map((item) => String(tileHtml(item, { width: 0, height: targetHeight })))
      .join('')
  } else {
    const styles = getComputedStyle(grid)
    const width =
      grid.clientWidth -
      parseFloat(styles.paddingLeft) -
      parseFloat(styles.paddingRight)
    const gap = gridGap()
    grid.innerHTML = justifiedRows(items, width, targetHeight, gap)
      .map(
        (row) =>
          `<div class="grid-row" role="row" style="height:${row.height.toFixed(2)}px">${row.items
            .map((item) =>
              String(
                tileHtml(item, {
                  width: aspectRatio(item) * row.height,
                  height: row.height,
                }),
              ),
            )
            .join('')}</div>`,
      )
      .join('')
  }

  for (const img of grid.querySelectorAll('img')) {
    if (img.complete) img.classList.add('is-loaded')
    else img.addEventListener('load', () => img.classList.add('is-loaded'))
  }
  syncGridState()
}

// Updates selection/focus classes without rebuilding tiles.
export function syncGridState() {
  const grid = gridEl()
  grid.classList.toggle('is-selecting', state.selection.size >= 2)
  let focusable = null
  for (const tile of grid.querySelectorAll('.tile')) {
    const id = Number(tile.dataset.id)
    tile.setAttribute('aria-selected', String(state.selection.has(id)))
    const isFocus = id === state.focus
    tile.tabIndex = isFocus ? 0 : -1
    if (isFocus) focusable = tile
  }
  if (!focusable) grid.querySelector('.tile')?.setAttribute('tabindex', '0')
}

export function tileElement(id) {
  return gridEl().querySelector(`.tile[data-id="${id}"]`)
}

export function focusTile(id, { scroll = true } = {}) {
  const tile = tileElement(id)
  if (!tile) return
  tile.focus({ preventScroll: true })
  if (scroll) tile.scrollIntoView({ block: 'nearest' })
}

// --- Keyboard navigation ---------------------------------------------------

function currentIndex() {
  const items = collection()
  const index = items.findIndex((item) => item.id === state.focus)
  return index === -1 ? 0 : index
}

// Finds the tile in the row above/below whose centre is nearest horizontally.
function verticalNeighbour(direction) {
  const current = tileElement(state.focus)
  if (!current) return collection()[0]?.id
  const rect = current.getBoundingClientRect()
  const centre = rect.left + rect.width / 2
  const tiles = [...gridEl().querySelectorAll('.tile')].map((tile) => ({
    id: Number(tile.dataset.id),
    rect: tile.getBoundingClientRect(),
  }))
  const candidates = tiles.filter(({ rect: other }) =>
    direction > 0 ? other.top >= rect.bottom - 1 : other.bottom <= rect.top + 1,
  )
  if (candidates.length === 0) return state.focus
  const rowTop =
    direction > 0
      ? Math.min(...candidates.map(({ rect: other }) => other.top))
      : Math.max(...candidates.map(({ rect: other }) => other.top))
  const row = candidates.filter(
    ({ rect: other }) => Math.abs(other.top - rowTop) < 2,
  )
  row.sort(
    (a, b) =>
      Math.abs(a.rect.left + a.rect.width / 2 - centre) -
      Math.abs(b.rect.left + b.rect.width / 2 - centre),
  )
  return row[0].id
}

function moveFocus(targetId, { extend = false } = {}) {
  if (targetId === undefined || targetId === null) return
  if (extend) rangeTo(targetId)
  else selectOnly(targetId)
  focusTile(targetId)
}

function byOffset(offset) {
  const items = collection()
  const index = Math.min(items.length - 1, Math.max(0, currentIndex() + offset))
  return items[index]?.id
}

// --- Events ----------------------------------------------------------------

function onClick(event) {
  if (event.target.closest('[data-clear-filters]')) {
    update(
      {
        query: '',
        type: 'all',
        missingAlt: false,
        size: 'any',
        orientation: 'any',
        month: '',
      },
      ['collection'],
    )
    return
  }
  const tile = event.target.closest('.tile')
  if (!tile) return
  const id = Number(tile.dataset.id)
  if (event.target.closest('.tile__check') || event.ctrlKey || event.metaKey) {
    toggle(id)
  } else if (event.shiftKey) {
    rangeTo(id)
  } else {
    selectOnly(id)
  }
  tile.focus({ preventScroll: true })
}

function onDoubleClick(event) {
  const tile = event.target.closest('.tile')
  if (tile && !event.target.closest('.tile__check')) {
    openDetail(Number(tile.dataset.id))
  }
}

let resizeFrame = 0

export function initGrid() {
  const grid = gridEl()
  grid.addEventListener('click', onClick)
  grid.addEventListener('dblclick', onDoubleClick)
  grid.addEventListener('focusin', (event) => {
    const tile = event.target.closest('.tile')
    if (tile && Number(tile.dataset.id) !== state.focus) {
      update({ focus: Number(tile.dataset.id) }, ['focus'])
    }
  })

  let lastWidth = 0
  new ResizeObserver(() => {
    const width = scrollEl().clientWidth
    if (width === lastWidth) return
    lastWidth = width
    cancelAnimationFrame(resizeFrame)
    resizeFrame = requestAnimationFrame(renderGrid)
  }).observe(scrollEl())

  registerAction('focus-prev', () => moveFocus(byOffset(-1)))
  registerAction('focus-next', () => moveFocus(byOffset(1)))
  registerAction('focus-up', () => moveFocus(verticalNeighbour(-1)))
  registerAction('focus-down', () => moveFocus(verticalNeighbour(1)))
  registerAction('extend-prev', () => moveFocus(byOffset(-1), { extend: true }))
  registerAction('extend-next', () => moveFocus(byOffset(1), { extend: true }))
  registerAction('extend-up', () =>
    moveFocus(verticalNeighbour(-1), { extend: true }),
  )
  registerAction('extend-down', () =>
    moveFocus(verticalNeighbour(1), { extend: true }),
  )
  registerAction('focus-first', () => moveFocus(collection()[0]?.id))
  registerAction('focus-last', () => moveFocus(collection().at(-1)?.id))
  registerAction('open-detail', () => {
    if (state.focus !== null) openDetail(state.focus)
  })
  registerAction('toggle-selected', () => {
    if (state.focus !== null) toggle(state.focus)
  })
  registerAction('select-all', selectAll)
  registerAction('clear-selection', clearSelection)
  registerAction('density-up', () =>
    update({ density: Math.min(DENSITIES.length - 1, state.density + 1) }),
  )
  registerAction('density-down', () =>
    update({ density: Math.max(0, state.density - 1) }),
  )
  registerAction('toggle-layout', () =>
    update({ layout: state.layout === 'justified' ? 'square' : 'justified' }),
  )
}
