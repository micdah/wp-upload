// Quick peek (Space): a Quick Look-style preview of the focused item over the
// grid, without leaving grid mode. Arrow keys keep moving the grid focus and
// the peek follows; Space or Esc closes; Enter opens detail mode.

import { aspectRatio, KIND_ICONS, KIND_LABELS, pictureUrl } from './data.js'
import { registerFeature } from './features.js'
import { registerAction } from './keymap.js'
import { collection, state } from './store.js'
import { announce, formatBytes, html, icon, truncateMiddle } from './util.js'

let peekEl = null

function focusedItem() {
  return collection().find((item) => item.id === state.focus)
}

// Fits the item into 86 % of the centre area, keeping its aspect ratio.
function peekSize(item) {
  const center = document.getElementById('center').getBoundingClientRect()
  const maxWidth = center.width * 0.86
  const maxHeight = center.height * 0.8
  const ratio = aspectRatio(item)
  let width = Math.min(maxWidth, item.width > 1 ? item.width : maxWidth)
  let height = width / ratio
  if (height > maxHeight) {
    height = maxHeight
    width = height * ratio
  }
  return { width: Math.round(width), height: Math.round(height) }
}

function render() {
  const item = focusedItem()
  if (!peekEl || !item) return
  const { width, height } = peekSize(item)
  const src = pictureUrl(item, Math.max(width, height) * devicePixelRatio)
  const picture =
    src && item.kind !== 'document'
      ? html`<img class="peek__media" src="${src}" alt="${item.alt}" style="width:${width}px;height:${height}px" />`
      : html`<div class="peek__media peek__media--doc">${icon(KIND_ICONS[item.kind])}<span>${KIND_LABELS[item.kind]}</span></div>`
  peekEl.innerHTML = String(html`
    <figure class="peek__figure">
      ${picture}
      <figcaption class="peek__caption">
        <strong>${truncateMiddle(item.filename, 48)}</strong>
        <span class="num">${item.width > 1 ? `${item.width} × ${item.height} · ` : ''}${formatBytes(item.filesize)}</span>
        <span class="peek__hint"><kbd>Space</kbd> close · <kbd>Enter</kbd> open · <kbd>←</kbd><kbd>→</kbd> browse</span>
      </figcaption>
    </figure>
  `)
}

function open() {
  if (!focusedItem()) return
  peekEl = document.createElement('div')
  peekEl.className = 'peek'
  peekEl.setAttribute('role', 'dialog')
  peekEl.setAttribute('aria-label', 'Quick peek')
  peekEl.addEventListener('click', (event) => {
    if (!event.target.closest('.peek__media')) close()
  })
  document.getElementById('center').append(peekEl)
  render()
  announce('Quick peek')
}

function close() {
  peekEl?.remove()
  peekEl = null
}

// Esc closes the peek before the grid's own Esc (clear selection) runs.
function onKeyDownCapture(event) {
  if (!peekEl) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close()
  } else if (event.key === 'Enter') {
    close()
  }
}

registerFeature({
  init() {
    registerAction('peek-toggle', () => (peekEl ? close() : open()))
    document.addEventListener('keydown', onKeyDownCapture, true)
  },
  onChange(changes) {
    if (!peekEl) return
    if (state.view !== 'grid') close()
    else if (changes.has('focus') || changes.has('selection')) render()
  },
})
