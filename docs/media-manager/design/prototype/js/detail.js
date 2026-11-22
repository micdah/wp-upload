// Detail mode: big preview + filmstrip of the whole collection in grid order.
// It overlays the centre area; the grid stays mounted underneath (inert), so
// scroll position and selection survive the round trip.

import { KIND_ICONS, KIND_LABELS, pictureUrl } from './data.js'
import { focusTile, tileElement, tileHtml } from './grid.js'
import { registerAction } from './keymap.js'
import { toggle } from './selection.js'
import { collection, state, update } from './store.js'
import { morph } from './transition.js'
import { emit, openMenu, showToast } from './ui.js'
import { writeUrl } from './url.js'
import {
  announce,
  formatBytes,
  formatDuration,
  html,
  icon,
  truncateMiddle,
} from './util.js'

const detailEl = () => document.getElementById('detail')
const STAGE_PADDING = { x: 80, y: 32 }

function currentIndex() {
  return collection().findIndex((item) => item.id === state.focus)
}

function currentItem() {
  return collection()[currentIndex()]
}

// --- Rendering ---------------------------------------------------------------

// Fits the item inside the stage so the morph lands on the exact final box.
function fittedSize(item, stage) {
  const maxWidth = Math.max(100, stage.clientWidth - STAGE_PADDING.x)
  const maxHeight = Math.max(100, stage.clientHeight - STAGE_PADDING.y)
  const ratio = item.width / item.height
  let width = Math.min(maxWidth, item.width)
  let height = width / ratio
  if (height > maxHeight) {
    height = maxHeight
    width = height * ratio
  }
  return { width: Math.round(width), height: Math.round(height) }
}

// Zoom is a viewing aid, not app state: 'fit' or a scale of the original
// pixels (1 = 100 %). It resets when you step to another item.
const ZOOM_STEPS = ['fit', 0.5, 1, 2]
let zoom = 'fit'

function pictureSize(item, stage) {
  if (zoom === 'fit') return fittedSize(item, stage)
  return {
    width: Math.round(item.width * zoom),
    height: Math.round(item.height * zoom),
  }
}

// A media player bar (design only — the sample library has no real files).
function playerBar(item) {
  return html`<div class="player" role="group" aria-label="Player">
    <button class="icon-btn" title="Play">${icon('player-play')}</button>
    <span class="player__time num">0:00</span>
    <span class="player__track"><span style="width:0%"></span></span>
    <span class="player__time num">${formatDuration(item.duration)}</span>
  </div>`
}

function stageMedia(item, stage) {
  if (item.kind === 'image' || item.kind === 'video' || item.kind === 'svg') {
    const { width, height } = pictureSize(item, stage)
    const thumb = pictureUrl(item, 300)
    const picture = html`<img
        class="stage__media"
        src="${thumb}"
        data-full="${pictureUrl(item, Math.max(width, height) * devicePixelRatio)}"
        alt="${item.alt}"
        style="width:${width}px;height:${height}px"
        draggable="false"
      />`
    if (item.kind !== 'video') return picture
    return html`<div class="stage__video">
      ${picture}<span class="stage__play">${icon('player-play', 'icon--lg')}</span>
      ${playerBar(item)}
    </div>`
  }
  if (item.kind === 'audio') {
    return html`<div class="stage__media stage__media--doc stage__media--audio">
      ${icon('music')}
      <strong>${truncateMiddle(item.filename, 40)}</strong>
      <span class="num">Audio · ${formatDuration(item.duration)} · ${formatBytes(item.filesize)}</span>
      ${playerBar(item)}
    </div>`
  }
  if (item.kind === 'document') {
    // PDFs: WordPress generates a first-page preview image; shown as a sheet.
    return html`<div class="stage__pdf">
      <div class="stage__sheet" aria-hidden="true">
        <span class="stage__sheet-title"></span>
        ${Array.from({ length: 9 }, () => html`<span class="stage__sheet-line"></span>`)}
      </div>
      <div class="stage__pdf-meta">
        <strong>${truncateMiddle(item.filename, 40)}</strong>
        <span class="num">PDF · page 1 of ${item.pages} · ${formatBytes(item.filesize)}</span>
        <span class="actions">
          <button class="btn">${icon('external-link')}Open PDF</button>
          <button class="btn btn--ghost" data-mm-action="download">${icon('download')}Download</button>
        </span>
      </div>
    </div>`
  }
  return html`<div class="stage__media stage__media--doc">
    ${icon(KIND_ICONS[item.kind])}
    <strong>${truncateMiddle(item.filename, 40)}</strong>
    <span class="num">${KIND_LABELS[item.kind]} · ${formatBytes(item.filesize)}</span>
    <button class="btn" data-mm-action="download">${icon('download')}Download</button>
  </div>`
}

function zoomLabel() {
  return zoom === 'fit' ? 'Fit' : `${Math.round(zoom * 100)}%`
}

function setZoom(next) {
  const item = currentItem()
  if (!item || item.width <= 1 || !['image', 'svg'].includes(item.kind)) return
  zoom = next
  renderStage()
}

function stepZoom(direction) {
  const index = ZOOM_STEPS.indexOf(zoom)
  const next =
    ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, index + direction))]
  setZoom(next)
}

// Drag to pan a zoomed image. The stage is created lazily, so look it up
// from the event rather than at setup time.
function enablePanning(container) {
  container.addEventListener('pointerdown', (event) => {
    const stage = event.target.closest('.stage')
    if (!stage || zoom === 'fit' || event.target.closest('button')) return
    const start = { x: event.clientX, y: event.clientY }
    const scroll = { left: stage.scrollLeft, top: stage.scrollTop }
    stage.classList.add('is-panning')
    const onMove = (moveEvent) => {
      stage.scrollLeft = scroll.left - (moveEvent.clientX - start.x)
      stage.scrollTop = scroll.top - (moveEvent.clientY - start.y)
    }
    const onUp = () => {
      stage.classList.remove('is-panning')
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  })
}

function renderStage() {
  const item = currentItem()
  const detail = detailEl()
  if (!item) return
  const index = currentIndex()
  detail.querySelector('.detail__title').textContent = item.title
  detail.querySelector('.detail__index').textContent =
    `${index + 1} / ${collection().length}`
  const stage = detail.querySelector('.stage')
  stage.classList.toggle('is-zoomed', zoom !== 'fit')
  const zoomButton = detail.querySelector('[data-action="zoom"]')
  zoomButton.querySelector('.detail__zoom-label').textContent = zoomLabel()
  zoomButton.disabled = !['image', 'svg'].includes(item.kind)
  stage.querySelector('.stage__slot').innerHTML = String(
    stageMedia(item, stage),
  )
  if (zoom !== 'fit') {
    // Start a zoomed view centred on the image.
    stage.scrollLeft = (stage.scrollWidth - stage.clientWidth) / 2
    stage.scrollTop = (stage.scrollHeight - stage.clientHeight) / 2
  }
  upgradeToFullSize(stage.querySelector('img.stage__media'))
  preloadNeighbours(index)
}

// Shows the cached thumbnail instantly, then swaps in the right sub-size.
function upgradeToFullSize(img) {
  if (!img?.dataset.full) return
  const full = new Image()
  full.onload = () => {
    if (img.isConnected) img.src = full.src
  }
  full.src = img.dataset.full
}

function preloadNeighbours(index) {
  const items = collection()
  for (const neighbour of [items[index - 1], items[index + 1]]) {
    const url = neighbour && pictureUrl(neighbour, 1536)
    if (url) new Image().src = url
  }
}

function renderFilmstrip() {
  const strip = detailEl().querySelector('.filmstrip')
  const size = 80
  strip.innerHTML = collection()
    .map((item) => String(tileHtml(item, { width: 0, height: size })))
    .join('')
  for (const img of strip.querySelectorAll('img')) {
    img.loading = 'lazy'
    if (img.complete) img.classList.add('is-loaded')
    else img.addEventListener('load', () => img.classList.add('is-loaded'))
  }
  syncFilmstrip()
}

function syncFilmstrip() {
  const strip = detailEl().querySelector('.filmstrip')
  let current = null
  for (const tile of strip.querySelectorAll('.tile')) {
    const id = Number(tile.dataset.id)
    const isCurrent = id === state.focus
    tile.classList.toggle('is-current', isCurrent)
    tile.setAttribute('aria-selected', String(state.selection.has(id)))
    if (isCurrent) current = tile
  }
  current?.scrollIntoView({ inline: 'center', block: 'nearest' })
}

function renderShell() {
  detailEl().innerHTML = String(html`
    <div class="detail__bar">
      <button class="icon-btn" data-action="close" title="Back to grid (Esc or G)">
        ${icon('arrow-left')}
      </button>
      <span class="detail__title"></span>
      <span class="detail__index num"></span>
      <span class="toolbar__spacer"></span>
      <button class="btn btn--ghost btn--sm" data-action="zoom" title="Zoom: fit / 100 % (Z), + and - to step">
        ${icon('zoom-in')}<span class="detail__zoom-label num">Fit</span>
      </button>
      <button class="icon-btn" data-mm-action="download" title="Download">${icon('download')}</button>
      <button class="icon-btn" data-action="more" title="More actions" aria-haspopup="menu">${icon('dots')}</button>
    </div>
    <div class="stage">
      <button class="stage__nav stage__nav--prev icon-btn" data-action="prev" title="Previous (←)">
        ${icon('chevron-left', 'icon--lg')}
      </button>
      <div class="stage__slot"></div>
      <button class="stage__nav stage__nav--next icon-btn" data-action="next" title="Next (→)">
        ${icon('chevron-right', 'icon--lg')}
      </button>
    </div>
    <div class="filmstrip" role="listbox" aria-label="Filmstrip"></div>
  `)
}

// --- Navigation ----------------------------------------------------------------

export function openDetail(id) {
  const fromTile = tileElement(id)
  const from = fromTile?.querySelector('img') ?? fromTile
  const selection = state.selection.has(id) ? state.selection : new Set([id])
  morph(
    () => {
      update({ view: 'detail', focus: id, selection, anchor: id }, [
        'view',
        'focus',
        'selection',
      ])
      writeUrl({ push: true })
    },
    { from, to: () => detailEl().querySelector('.stage__media') },
  )
  announce('Detail mode')
}

// Secondary actions for the current item; features handle them via the bus.
function openMoreMenu(anchor) {
  const rect = anchor.getBoundingClientRect()
  openMenu({
    x: rect.right - 220,
    y: rect.bottom + 4,
    items: [
      {
        label: 'Copy URL',
        icon: 'copy',
        onSelect: () => showToast({ text: 'URL copied' }),
      },
      { label: 'Open in wp-admin', icon: 'external-link' },
      'separator',
      {
        label: 'Move to folder…',
        icon: 'folder',
        kbd: 'M',
        onSelect: () => emit('move-to-folder'),
      },
      {
        label: 'Edit image',
        icon: 'crop',
        kbd: 'E',
        onSelect: () => emit('edit-image'),
      },
      'separator',
      {
        label: 'Delete',
        icon: 'trash',
        danger: true,
        onSelect: () => emit('delete'),
      },
    ],
  })
}

export function closeDetail({ fromHistory = false } = {}) {
  zoom = 'fit'
  const id = state.focus
  const from = detailEl().querySelector('.stage__media')
  morph(
    () => {
      update({ view: 'grid' }, ['view'])
      if (!fromHistory) writeUrl({ push: false })
      focusTile(id, { scroll: false })
      tileElement(id)?.scrollIntoView({ block: 'nearest' })
    },
    {
      from,
      to: () => {
        const tile = tileElement(id)
        tile?.classList.add('is-returning')
        setTimeout(() => tile?.classList.remove('is-returning'), 1000)
        return tile?.querySelector('img') ?? tile
      },
    },
  )
  announce('Grid')
}

function step(offset) {
  const items = collection()
  const next = items[currentIndex() + offset]
  if (!next) return
  zoom = 'fit'
  update({ focus: next.id, anchor: next.id }, ['focus'])
  writeUrl()
}

// --- Wiring --------------------------------------------------------------------

export function syncDetail(changes) {
  const detail = detailEl()
  const isOpen = state.view === 'detail'
  detail.hidden = !isOpen
  document.getElementById('grid-scroll').inert = isOpen
  document.getElementById('filterbar').inert = isOpen
  if (!isOpen) return
  if (!detail.firstElementChild) renderShell()
  if (changes.has('view') || changes.has('collection')) renderFilmstrip()
  if (
    changes.has('view') ||
    changes.has('focus') ||
    changes.has('collection')
  ) {
    renderStage()
  }
  if (changes.has('focus') || changes.has('selection')) syncFilmstrip()
}

export function initDetail() {
  const detail = detailEl()
  detail.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action
    if (action === 'close') closeDetail()
    else if (action === 'prev') step(-1)
    else if (action === 'next') step(1)
    else if (action === 'zoom') setZoom(zoom === 'fit' ? 1 : 'fit')
    else if (action === 'more') openMoreMenu(event.target.closest('button'))
    const tile = event.target.closest('.filmstrip .tile')
    if (!tile) return
    const id = Number(tile.dataset.id)
    if (
      event.ctrlKey ||
      event.metaKey ||
      event.target.closest('.tile__check')
    ) {
      toggle(id)
    } else {
      update({ focus: id, anchor: id }, ['focus'])
      writeUrl()
    }
  })
  window.addEventListener('resize', () => {
    if (state.view === 'detail') renderStage()
  })
  enablePanning(detail)
  registerAction('zoom-toggle', () => setZoom(zoom === 'fit' ? 1 : 'fit'))
  registerAction('zoom-in', () => stepZoom(1))
  registerAction('zoom-out', () => stepZoom(-1))
  registerAction('detail-prev', () => step(-1))
  registerAction('detail-next', () => step(1))
  registerAction('close-detail', () => closeDetail())
}
