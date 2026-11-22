// Upload: drop files anywhere (full-window overlay naming the destination),
// the `upload` action / `U` key (native file picker), new tiles at the top
// of the grid with a progress ring, a "Processing" phase while WordPress
// generates sub-sizes, and a compact tray bottom-right.
//
// Everything is simulated on a clock that tests can freeze and step
// (window.__mmUpload), so screenshots of in-between states are repeatable.

import { library } from '../data.js'
import { focusTile, tileElement } from '../grid.js'
import { registerAction, registerBindings } from '../keymap.js'
import { selectOnly } from '../selection.js'
import { state, update } from '../store.js'
import { libraryChanged, on } from '../ui.js'
import { announce, formatBytes, html, icon, truncateMiddle } from '../util.js'
import {
  adjustFolderCount,
  currentUser,
  elementFromHtml,
  folderLabel,
  guardMutation,
  inFolder,
  isOffline,
  isPluginMissing,
  keepInjected,
  matches,
  PHONE,
  plural,
} from './system-shared.js'

// The site's limits, as WordPress reports them (upload_max_filesize and the
// allowed MIME types from the companion plugin).
const MAX_BYTES = 64 * 1024 * 1024
const CONCURRENCY = 3
const TICK_MS = 100
const AUTO_HIDE_MS = 4000

const EXTENSIONS = {
  image: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'heic'],
  svg: ['svg'],
  video: ['mp4', 'mov', 'm4v', 'webm'],
  audio: ['mp3', 'm4a', 'wav', 'ogg'],
  document: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'csv'],
  archive: ['zip'],
}
const KIND_BY_EXTENSION = new Map(
  Object.entries(EXTENSIONS).flatMap(([kind, list]) =>
    list.map((extension) => [extension, kind]),
  ),
)
const ACCEPT = [...KIND_BY_EXTENSION.keys()].map((ext) => `.${ext}`).join(',')

// id → upload entry. Entries stay until the tray is cleared.
const uploads = new Map()
// id → object URL, kept after upload so the new tile keeps its picture.
const previews = new Map()
let nextTempId = -1
let batchCount = 0
let ticker = 0
let frozen = false
let failedOnce = false
let hideTimer = 0

// --- Files → upload entries ---------------------------------------------------------

function extensionOf(name) {
  return name.includes('.') ? name.split('.').pop().toLowerCase() : ''
}

function validate(file) {
  const extension = extensionOf(file.name)
  if (!KIND_BY_EXTENSION.has(extension)) {
    return `.${extension || '?'} files aren’t allowed on this site`
  }
  if (file.size > MAX_BYTES) {
    return `Larger than the site’s ${formatBytes(MAX_BYTES)} limit`
  }
  return null
}

// Reads real pixel dimensions so the justified row doesn't jump when the
// picture arrives. Gives up quickly: a tile must appear immediately.
async function imageSize(url) {
  const probe = new Promise((resolve) => {
    const img = new Image()
    img.onload = () =>
      resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => resolve(null)
    img.src = url
  })
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), 200))
  return (await Promise.race([probe, timeout])) ?? { width: 1600, height: 1067 }
}

function titleFrom(name) {
  return name
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .trim()
}

async function itemFor(file, folder, now) {
  const extension = extensionOf(file.name)
  const kind = KIND_BY_EXTENSION.get(extension)
  let size = { width: 1, height: 1 }
  let preview = null
  if (kind === 'image' || kind === 'svg') {
    preview = URL.createObjectURL(file)
    size = await imageSize(preview)
  } else if (kind === 'video') {
    size = { width: 1920, height: 1080 }
  }
  return {
    item: {
      id: nextTempId--,
      kind,
      mime: file.type || `application/${extension}`,
      title: titleFrom(file.name),
      filename: file.name,
      alt: '',
      caption: '',
      description: '',
      ...size,
      filesize: file.size,
      uploaded: now,
      modified: now,
      author: currentUser(),
      folder,
      attachedTo: null,
      usedIn: [],
      duration: kind === 'video' || kind === 'audio' ? 0 : undefined,
    },
    preview,
  }
}

// Upload time scales with size; processing with pixels (sub-size generation).
function durations(item) {
  const upload = Math.min(5200, Math.max(1400, item.filesize / 1600))
  const megapixels = (item.width * item.height) / 1e6
  const processing =
    item.kind === 'image' ? Math.min(4200, 1600 + megapixels * 200) : 700
  return { upload, processing }
}

export async function startUpload(fileList) {
  const files = [...fileList]
  if (files.length === 0) return
  if (!guardMutation('Uploads')) return
  const folder = inFolder() ? state.folder : 0
  const destination = folderLabel(inFolder() ? state.folder : 'all')
  const batch = ++batchCount
  const now = new Date().toISOString()
  const accepted = []
  for (const file of files) {
    const error = validate(file)
    if (error) {
      const id = nextTempId--
      uploads.set(id, {
        id,
        name: file.name,
        size: file.size,
        phase: 'error',
        error,
        retryable: false,
        destination,
        batch,
      })
    } else {
      accepted.push(file)
    }
  }
  const created = await Promise.all(
    accepted.map((file) => itemFor(file, folder, now)),
  )
  // Keep the picked order at the top of the grid (same upload time, and the
  // sort is stable).
  library.items.unshift(...created.map(({ item }) => item))
  for (const { item, preview } of created) {
    if (preview) previews.set(item.id, preview)
    library.byId.set(item.id, item)
    adjustFolderCount(folder, 1)
    uploads.set(item.id, {
      id: item.id,
      name: item.filename,
      size: item.filesize,
      item,
      phase: 'queued',
      progress: 0,
      elapsed: 0,
      destination,
      batch,
      ...durations(item),
    })
  }
  // The demo shows one transient failure: the third file of the first batch
  // of three or more drops its connection once, and Retry succeeds.
  if (!failedOnce && created.length >= 3) {
    uploads.get(created[2].item.id).failAt = 0.62
    failedOnce = true
  }
  announce(
    `Uploading ${plural(created.length, 'file')} to ${destination}${
      created.length < files.length
        ? `, ${files.length - created.length} not allowed`
        : ''
    }`,
  )
  if (created.length) {
    libraryChanged()
    update({}, ['folders', 'selection'])
  }
  showTray()
  startTicker()
}

// --- Simulation clock -----------------------------------------------------------------

function startTicker() {
  if (ticker || frozen) return
  ticker = setInterval(() => advance(TICK_MS), TICK_MS)
}

function stopTicker() {
  clearInterval(ticker)
  ticker = 0
}

function advance(ms) {
  const active = [...uploads.values()].filter(
    (entry) => entry.phase === 'uploading',
  )
  // Fill free slots from the queue, oldest first.
  const queued = [...uploads.values()].filter(
    (entry) => entry.phase === 'queued',
  )
  for (const entry of queued.slice(0, CONCURRENCY - active.length)) {
    entry.phase = 'uploading'
  }
  for (const entry of uploads.values()) {
    if (entry.phase === 'uploading') advanceUpload(entry, ms)
    else if (entry.phase === 'processing') advanceProcessing(entry, ms)
  }
  renderProgress()
  const busy = [...uploads.values()].some((entry) =>
    ['queued', 'uploading', 'processing'].includes(entry.phase),
  )
  if (!busy) {
    stopTicker()
    scheduleAutoHide()
  }
}

function advanceUpload(entry, ms) {
  entry.progress = Math.min(1, entry.progress + ms / entry.upload)
  if (entry.failAt && entry.progress >= entry.failAt) {
    entry.phase = 'error'
    entry.error = 'Connection lost at 62%'
    entry.retryable = true
    entry.failAt = 0
    announce(`${entry.name} failed to upload`)
    return
  }
  if (entry.progress >= 1) {
    entry.phase = 'processing'
    entry.elapsed = 0
  }
}

function advanceProcessing(entry, ms) {
  entry.elapsed += ms
  if (entry.elapsed < entry.processing) return
  entry.phase = 'done'
  const tile = tileElement(entry.id)
  if (tile) {
    decorateTile(tile)
    // Same accent ring that marks the tile you return to from detail mode.
    tile.classList.add('is-returning')
    setTimeout(() => tile.classList.remove('is-returning'), 1000)
  }
}

function retry(id) {
  const entry = uploads.get(id)
  if (!entry?.retryable) return
  if (!guardMutation('Uploads')) return
  Object.assign(entry, { phase: 'queued', progress: 0, error: null })
  renderTray()
  startTicker()
}

// Drops an upload that will never finish (rejected or failed), including the
// placeholder tile it left in the grid.
function dismiss(id) {
  const entry = uploads.get(id)
  uploads.delete(id)
  if (previews.has(id)) {
    URL.revokeObjectURL(previews.get(id))
    previews.delete(id)
  }
  if (entry?.item) {
    library.items = library.items.filter((item) => item.id !== id)
    library.byId.delete(id)
    adjustFolderCount(entry.item.folder, -1)
    libraryChanged()
    update({}, ['folders', 'selection'])
  }
  renderTray()
}

// --- Tiles ---------------------------------------------------------------------------

function ringHtml(entry) {
  if (entry.phase === 'processing') {
    return html`<div class="tile__progress"><div class="progress-ring mm-ring--processing" role="img" aria-label="Processing"></div></div>`
  }
  if (entry.phase === 'error') {
    return html`<div class="tile__progress"><button class="btn btn--sm mm-tile-retry" data-upload-retry="${entry.id}">${icon('refresh', 'icon--sm')}Retry</button></div>`
  }
  const percent = Math.round(entry.progress * 100)
  return html`<div class="tile__progress"><div class="progress-ring" style="--progress:${entry.progress.toFixed(3)}" role="img" aria-label="Uploading ${percent}%">${percent}%</div></div>`
}

function badgeHtml(entry) {
  if (entry.phase === 'processing') {
    return html`<span class="badge mm-badge-processing">Processing</span>`
  }
  if (entry.phase === 'error') {
    return html`<span class="badge badge--danger">${icon('alert-circle', 'icon--sm')}Failed</span>`
  }
  return ''
}

// Gives a core tile its local picture and, while in flight, the ring.
// Idempotent, so mutation observers can call it freely without looping.
function decorateTile(tile) {
  const id = Number(tile.dataset.id)
  const preview = previews.get(id)
  const doc = tile.querySelector('.tile__doc')
  const entry = uploads.get(id)
  const phase = entry?.phase ?? 'done'
  if (tile.dataset.phase === phase && !(preview && doc)) return
  if (preview && doc) {
    doc.outerHTML = `<div class="tile__media"><img class="is-loaded" src="${preview}" alt="" /></div>`
  }
  const inFlight = phase !== 'done'
  tile.classList.toggle('is-uploading', Boolean(inFlight))
  tile.classList.toggle('is-processing', entry?.phase === 'processing')
  tile.classList.toggle('is-error', entry?.phase === 'error')
  tile.dataset.phase = phase
  tile.querySelector('.tile__progress')?.remove()
  tile.querySelector('.mm-upload-badge')?.remove()
  if (!inFlight) return
  tile.insertAdjacentHTML('beforeend', String(ringHtml(entry)))
  const badge = badgeHtml(entry)
  if (badge) {
    tile
      .querySelector('.tile__badges')
      ?.insertAdjacentHTML(
        'afterbegin',
        `<span class="mm-upload-badge">${badge}</span>`,
      )
  }
}

function decorateAll(root) {
  for (const tile of root.querySelectorAll('.tile[data-id^="-"]')) {
    decorateTile(tile)
  }
}

// Detail stage, filmstrip and inspector preview for an uploaded picture.
function decorateDetail() {
  const detail = document.getElementById('detail')
  decorateAll(detail)
  const preview = previews.get(state.focus)
  const img = detail.querySelector('img.stage__media')
  if (preview && img && img.getAttribute('src') !== preview) {
    img.removeAttribute('data-full')
    img.src = preview
  }
}

function decorateInspector() {
  const body = document.querySelector('#inspector .inspector__body[data-item]')
  const preview = body && previews.get(Number(body.dataset.item))
  if (preview && !body.querySelector('.inspector__preview')) {
    body.insertAdjacentHTML(
      'afterbegin',
      `<div class="inspector__preview"><img src="${preview}" alt="" /></div>`,
    )
  }
}

// Updates rings and bars in place; a full re-render would steal focus from
// a Retry button and restart CSS transitions.
function renderProgress() {
  for (const entry of uploads.values()) {
    const tile = tileElement(entry.id)
    if (tile) {
      const ring = tile.querySelector(
        '.progress-ring:not(.mm-ring--processing)',
      )
      if (tile.dataset.phase !== entry.phase) {
        decorateTile(tile)
      } else if (ring && entry.phase === 'uploading') {
        const percent = Math.round(entry.progress * 100)
        ring.style.setProperty('--progress', entry.progress.toFixed(3))
        ring.textContent = `${percent}%`
        ring.setAttribute('aria-label', `Uploading ${percent}%`)
      }
    }
  }
  renderTray()
}

// --- Tray ------------------------------------------------------------------------------

let trayEl = null
let collapsed = false

function trayCounts() {
  const entries = [...uploads.values()]
  const count = (phase) =>
    entries.filter((entry) => entry.phase === phase).length
  return {
    total: entries.length,
    done: count('done'),
    failed: count('error'),
    processing: count('processing'),
    pending: count('queued') + count('uploading'),
    entries,
  }
}

function trayHeading({ entries, done, failed, processing, pending }) {
  const files = entries.filter((entry) => entry.item).length
  if (pending) {
    // "Uploading 3 of 5": the next file whose bytes are still on the way.
    const sent =
      files -
      pending -
      entries.filter((e) => e.item && e.phase === 'error').length
    return {
      iconName: 'cloud-upload',
      title: `Uploading ${Math.min(files, sent + 1)} of ${files}`,
    }
  }
  if (processing) {
    return {
      iconName: 'cloud-upload',
      title: `Processing ${processing} of ${files}`,
    }
  }
  if (failed) {
    return {
      iconName: 'alert-triangle',
      title: done
        ? `${done} uploaded · ${failed} failed`
        : `${plural(failed, 'upload')} failed`,
      tone: 'error',
    }
  }
  return {
    iconName: 'circle-check',
    title: `Done · ${done} uploaded`,
    tone: 'ok',
  }
}

function overallProgress(entries) {
  const weights = entries.filter((entry) => entry.item)
  if (weights.length === 0) return 1
  const sum = weights.reduce((total, entry) => {
    if (entry.phase === 'done' || entry.phase === 'error') return total + 1
    if (entry.phase === 'processing')
      return total + 0.9 + 0.1 * Math.min(1, entry.elapsed / entry.processing)
    return total + 0.9 * entry.progress
  }, 0)
  return sum / weights.length
}

function rowStatus(entry) {
  switch (entry.phase) {
    case 'queued':
      return {
        meta: 'Waiting…',
        side: html`<span class="mm-tray__pct">—</span>`,
      }
    case 'uploading': {
      const percent = Math.round(entry.progress * 100)
      return {
        bar: entry.progress,
        side: html`<span class="mm-tray__pct num">${percent}%</span>`,
      }
    }
    case 'processing':
      return {
        meta:
          entry.elapsed > 8000
            ? 'Still processing — busy sites can take a few minutes'
            : 'Processing · generating thumbnail sizes',
        processing: true,
        side: html`<span class="mm-tray__spin" aria-hidden="true"></span>`,
      }
    case 'error':
      return {
        meta: entry.error,
        error: true,
        side: entry.retryable
          ? html`<button class="btn btn--sm" data-upload-retry="${entry.id}">${icon('refresh', 'icon--sm')}Retry</button>`
          : html`<button class="icon-btn mm-tray__remove" data-upload-dismiss="${entry.id}" title="Remove from list" aria-label="Remove ${entry.name} from list">${icon('x', 'icon--sm')}</button>`,
      }
    default:
      return {
        meta: formatBytes(entry.size),
        side: html`<span class="mm-tray__ok" title="Uploaded">${icon('circle-check')}</span>`,
        done: true,
      }
  }
}

function thumbHtml(entry) {
  const preview = previews.get(entry.id)
  if (preview) return html`<img class="tray__thumb" src="${preview}" alt="" />`
  const iconName = entry.item ? 'file' : 'alert-circle'
  return html`<span class="tray__thumb mm-tray__icon">${icon(iconName, 'icon--sm')}</span>`
}

function rowHtml(entry) {
  const status = rowStatus(entry)
  const name = truncateMiddle(entry.name, 34)
  return html`<li class="tray__item ${status.error ? 'is-error' : ''}" data-upload-id="${entry.id}" data-phase="${entry.phase}">
    ${thumbHtml(entry)}
    <div class="mm-tray__main">
      ${
        status.done
          ? html`<button class="tray__name mm-tray__link" data-upload-show="${entry.id}" title="Show in grid">${name}</button>`
          : html`<div class="tray__name" title="${entry.name}">${name}</div>`
      }
      ${
        status.bar !== undefined
          ? html`<div class="tray__bar" style="--progress:${status.bar.toFixed(3)}"><span></span></div>`
          : ''
      }
      ${status.processing ? html`<div class="tray__bar mm-bar--indeterminate"><span></span></div>` : ''}
      ${status.meta ? html`<div class="mm-tray__meta">${status.meta}</div>` : ''}
    </div>
    ${status.side}
  </li>`
}

function ensureTray() {
  if (trayEl) return trayEl
  trayEl =
    elementFromHtml(html`<section class="tray mm-tray" aria-label="Uploads" hidden>
    <div class="tray__header">
      <span class="mm-tray__status"></span>
      <div class="mm-tray__heading">
        <span class="mm-tray__title" aria-live="polite"></span>
        <span class="mm-tray__sub"></span>
      </div>
      <span class="toolbar__spacer"></span>
      <button class="icon-btn" data-tray="toggle" aria-expanded="true" title="Collapse">${icon('chevron-down')}</button>
      <button class="icon-btn" data-tray="close" title="Close" hidden>${icon('x')}</button>
    </div>
    <div class="mm-tray__total"><span></span></div>
    <ul class="tray__list"></ul>
  </section>`)
  trayEl.addEventListener('click', onTrayClick)
  // Never auto-hide under the pointer or keyboard focus.
  trayEl.addEventListener('pointerenter', () => clearTimeout(hideTimer))
  trayEl.addEventListener('pointerleave', scheduleAutoHide)
  trayEl.addEventListener('focusout', scheduleAutoHide)
  trayEl.addEventListener('focusin', () => clearTimeout(hideTimer))
  document.body.append(trayEl)
  return trayEl
}

function renderTray() {
  if (!trayEl || trayEl.hidden) return
  const counts = trayCounts()
  if (counts.total === 0) {
    hideTray()
    return
  }
  const heading = trayHeading(counts)
  const destinations = new Set(counts.entries.map((entry) => entry.destination))
  const bytes = counts.entries.reduce(
    (sum, entry) => sum + (entry.item ? entry.size : 0),
    0,
  )
  trayEl.dataset.tone = heading.tone ?? ''
  trayEl.querySelector('.mm-tray__status').innerHTML = String(
    icon(heading.iconName),
  )
  trayEl.querySelector('.mm-tray__title').textContent = heading.title
  trayEl.querySelector('.mm-tray__sub').textContent =
    `to ${[...destinations].map((name) => `“${name}”`).join(', ')} · ${formatBytes(bytes)}`
  const progress = overallProgress(counts.entries)
  trayEl
    .querySelector('.mm-tray__total')
    .style.setProperty('--progress', progress.toFixed(3))
  trayEl.querySelector('.mm-tray__total').hidden = progress >= 1
  const finished = counts.pending + counts.processing === 0
  trayEl.querySelector('[data-tray="close"]').hidden = !finished
  syncRows(counts.entries)
}

// Tray order: rejected and failed files first (they need action), then the
// newest batch, each batch in the order it was picked (as in the grid).
function trayOrder(entries) {
  const sequence = new Map(entries.map((entry, index) => [entry, index]))
  return entries.slice().sort((a, b) => {
    const errors = (b.phase === 'error') - (a.phase === 'error')
    return errors || b.batch - a.batch || sequence.get(a) - sequence.get(b)
  })
}

// Rebuilds a row only when its phase changes; otherwise patches the numbers.
function syncRows(entries) {
  const list = trayEl.querySelector('.tray__list')
  const wanted = new Set(entries.map((entry) => String(entry.id)))
  for (const row of [...list.children]) {
    if (!wanted.has(row.dataset.uploadId)) row.remove()
  }
  trayOrder(entries).forEach((entry, index) => {
    let row = list.querySelector(`[data-upload-id="${entry.id}"]`)
    if (!row || row.dataset.phase !== entry.phase) {
      const fresh = elementFromHtml(rowHtml(entry))
      if (row) row.replaceWith(fresh)
      row = fresh
    } else if (entry.phase === 'uploading') {
      row
        .querySelector('.tray__bar')
        ?.style.setProperty('--progress', entry.progress.toFixed(3))
      row.querySelector('.mm-tray__pct').textContent =
        `${Math.round(entry.progress * 100)}%`
    } else if (entry.phase === 'processing') {
      const meta = row.querySelector('.mm-tray__meta')
      const text = rowStatus(entry).meta
      if (meta.textContent !== text) meta.textContent = text
    }
    // Move only when out of place: moving a focused Retry button blurs it.
    if (list.children[index] !== row) {
      list.insertBefore(row, list.children[index] ?? null)
    }
  })
}

function showTray() {
  const tray = ensureTray()
  clearTimeout(hideTimer)
  tray.hidden = false
  tray.classList.remove('is-hiding')
  // Phones have little room: start collapsed there.
  setCollapsed(matches(PHONE) ? true : collapsed)
  renderTray()
}

function hideTray() {
  if (!trayEl) return
  trayEl.hidden = true
  // Finished uploads leave the list; failures stay until dismissed.
  for (const [id, entry] of uploads) {
    if (entry.phase === 'done') uploads.delete(id)
  }
}

function scheduleAutoHide() {
  clearTimeout(hideTimer)
  const counts = trayCounts()
  const finished = counts.pending + counts.processing === 0
  if (!finished || counts.failed || !trayEl || trayEl.hidden) return
  if (trayEl.matches(':hover, :focus-within')) return
  hideTimer = setTimeout(() => {
    trayEl.classList.add('is-hiding')
    setTimeout(hideTray, 220)
  }, AUTO_HIDE_MS)
}

function setCollapsed(value) {
  collapsed = value
  trayEl.classList.toggle('is-collapsed', value)
  const toggle = trayEl.querySelector('[data-tray="toggle"]')
  toggle.setAttribute('aria-expanded', String(!value))
  toggle.title = value ? 'Expand' : 'Collapse'
  toggle.innerHTML = String(icon(value ? 'chevron-up' : 'chevron-down'))
}

function onTrayClick(event) {
  const target = event.target.closest('button')
  if (!target) return
  if (target.dataset.tray === 'toggle') setCollapsed(!collapsed)
  else if (target.dataset.tray === 'close') {
    for (const [id, entry] of uploads) {
      if (entry.phase === 'error') dismiss(id)
    }
    hideTray()
  } else if (target.dataset.uploadRetry)
    retry(Number(target.dataset.uploadRetry))
  else if (target.dataset.uploadDismiss)
    dismiss(Number(target.dataset.uploadDismiss))
  else if (target.dataset.uploadShow)
    showInGrid(Number(target.dataset.uploadShow))
}

function showInGrid(id) {
  if (!library.byId.has(id)) return
  if (state.view === 'detail') return
  selectOnly(id)
  focusTile(id)
}

// --- Drop overlay ---------------------------------------------------------------------

let overlayEl = null
let dragDepth = 0

function hasFiles(event) {
  return [...(event.dataTransfer?.types ?? [])].includes('Files')
}

function overlayText() {
  if (isOffline()) {
    return {
      iconName: 'wifi-off',
      title: 'Uploads are paused while WordPress is unreachable',
      hint: 'Try again when the connection is back.',
      blocked: true,
    }
  }
  const destination = inFolder() ? folderLabel() : 'All files'
  return {
    iconName: 'cloud-upload',
    title: `Drop to upload to “${destination}”`,
    hint: `Images, video, audio, PDFs and office files · up to ${formatBytes(MAX_BYTES)} each`,
  }
}

function showOverlay() {
  if (!overlayEl) {
    overlayEl = document.createElement('div')
    overlayEl.className = 'drop-overlay mm-drop'
    overlayEl.setAttribute('aria-hidden', 'true')
    document.body.append(overlayEl)
  }
  const text = overlayText()
  const wasVisible = !overlayEl.hidden
  overlayEl.classList.toggle('is-blocked', Boolean(text.blocked))
  overlayEl.innerHTML = String(html`<div class="drop-overlay__target">
    ${icon(text.iconName)}
    <span>${text.title}</span>
    <span class="mm-drop__hint">${text.hint}</span>
  </div>`)
  if (!wasVisible) announce(text.title)
  overlayEl.hidden = false
}

function hideOverlay() {
  dragDepth = 0
  if (overlayEl) overlayEl.hidden = true
}

function installDropTarget() {
  // Window-level, so files can land anywhere. Internal drags (tiles to
  // folders) carry no "Files" type and are left alone.
  // Local drop zones (e.g. the editor's Replace file) handle their own drops.
  const overLocalZone = (event) => event.target.closest?.('[data-drop-zone]')
  window.addEventListener('dragenter', (event) => {
    if (!hasFiles(event) || isPluginMissing()) return
    if (overLocalZone(event)) {
      hideOverlay()
      return
    }
    event.preventDefault()
    dragDepth++
    showOverlay()
  })
  window.addEventListener('dragover', (event) => {
    if (!hasFiles(event) || overLocalZone(event)) return
    // Always claim file drags so the browser never navigates to the file.
    event.preventDefault()
    if (isPluginMissing()) return
    event.dataTransfer.dropEffect = isOffline() ? 'none' : 'copy'
    if (!overlayEl || overlayEl.hidden) showOverlay()
  })
  window.addEventListener('dragleave', (event) => {
    if (!hasFiles(event)) return
    dragDepth = Math.max(0, dragDepth - 1)
    // relatedTarget is null when the pointer leaves the window.
    if (dragDepth === 0 || event.relatedTarget === null) hideOverlay()
  })
  window.addEventListener('drop', (event) => {
    if (!hasFiles(event) || overLocalZone(event)) return
    event.preventDefault()
    hideOverlay()
    if (isPluginMissing()) return
    document.dispatchEvent(new CustomEvent('mm:upload-dropped'))
    startUpload(event.dataTransfer.files)
  })
}

// --- Picker and wiring ------------------------------------------------------------------

let pickerEl = null

function openPicker() {
  if (isPluginMissing()) return
  if (!guardMutation('Uploads')) return
  if (!pickerEl) {
    pickerEl = document.createElement('input')
    pickerEl.type = 'file'
    pickerEl.multiple = true
    pickerEl.accept = ACCEPT
    pickerEl.hidden = true
    pickerEl.addEventListener('change', () => {
      startUpload(pickerEl.files)
      pickerEl.value = ''
    })
    document.body.append(pickerEl)
  }
  pickerEl.click()
}

export function initUpload() {
  installDropTarget()
  on('upload', openPicker)
  registerAction('upload', openPicker)
  registerBindings([
    {
      key: 'u',
      mode: 'any',
      action: 'upload',
      group: 'Files',
      label: 'Upload files',
    },
  ])
  keepInjected(document.getElementById('grid'), () =>
    decorateAll(document.getElementById('grid')),
  )
  const detail = document.getElementById('detail')
  new MutationObserver(decorateDetail).observe(detail, {
    childList: true,
    subtree: true,
  })
  keepInjected(document.getElementById('inspector'), decorateInspector)
  document.addEventListener(
    'click',
    (event) => {
      const retryButton = event.target.closest('#grid [data-upload-retry]')
      if (retryButton) {
        event.stopPropagation()
        retry(Number(retryButton.dataset.uploadRetry))
      }
    },
    true,
  )

  // Test hook: freeze the clock and step it, for repeatable screenshots.
  window.__mmUpload = {
    freeze() {
      frozen = true
      stopTicker()
    },
    step(ms) {
      for (let done = 0; done < ms; done += TICK_MS) advance(TICK_MS)
    },
    resume() {
      frozen = false
      startTicker()
    },
  }
}
