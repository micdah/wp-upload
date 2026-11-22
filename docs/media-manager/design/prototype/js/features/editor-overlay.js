// The image editor's canvas: an overlay on the centre region (above the
// grid and detail mode) showing the picture with a crop box — draggable
// and resizable handles, rule-of-thirds lines, a dimmed outside — plus a
// top bar with Cancel, Undo/Redo and Save.
//
// While it is open the editor is a mode: the toolbar, folder column and the
// grid/detail underneath are inert, and stray shortcuts are swallowed so
// they can't act on items hidden behind it. The inspector (Edit panel)
// stays live, because that's where the tools are.

import { pictureUrl } from '../data.js'
import { state } from '../store.js'
import { announce, html, icon, truncateMiddle } from '../util.js'
import {
  canRedo,
  canUndo,
  clamp,
  commitCrop,
  cropSize,
  isDirty,
  MIN_CROP,
  onSessionChange,
  oriented,
  output,
  ratioValue,
  redo,
  session,
  sessionItem,
  setCrop,
  undo,
} from './editor-session.js'

const STAGE_PADDING = 48
const INERT_IDS = ['toolbar', 'folders', 'filterbar', 'grid-scroll', 'detail']

let overlay = null
let handlers = {}
let scale = 1 // screen px per image px
let drag = null
let commitTimer = 0
let resizeObserver = null

// --- Mount / unmount -----------------------------------------------------------

function handle(name) {
  return html`<span class="crop__handle crop__handle--${name}" data-handle="${name}"></span>`
}

function markup(item) {
  return html`
    <div class="editor__bar">
      <button class="btn btn--ghost" data-ed="cancel" title="Cancel (Esc)">${icon('x')}Cancel</button>
      <div class="editor__title">
        <span class="editor__name" title="${item.filename}">${truncateMiddle(item.filename, 40)}</span>
        <span class="editor__dims num" aria-live="polite"></span>
      </div>
      <span class="toolbar__spacer"></span>
      <button class="icon-btn" data-ed="undo" title="Undo (Ctrl/Cmd+Z)" aria-label="Undo">${icon('arrow-back-up')}</button>
      <button class="icon-btn editor__redo" data-ed="redo" title="Redo (Ctrl/Cmd+Shift+Z)" aria-label="Redo">${icon('arrow-forward-up')}</button>
      <span class="toolbar__divider"></span>
      <button class="btn btn--primary" data-ed="save" title="Save (Enter)">${icon('check')}Save</button>
    </div>
    <div class="editor__stage">
      <div class="editor__frame">
        <img class="editor__image" src="${pictureUrl(item, 1536)}" alt="${item.alt || item.title}" draggable="false" />
        <div class="editor__shade" aria-hidden="true"><div class="editor__hole"></div></div>
        <div class="crop" tabindex="0" role="group" aria-roledescription="crop area"
          aria-label="Crop area" aria-describedby="editor-help">
          <div class="crop__grid" aria-hidden="true"></div>
          ${['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map(handle)}
          <span class="crop__size num" aria-hidden="true"></span>
        </div>
      </div>
      <div class="editor__status" role="status" hidden></div>
    </div>
    <p class="editor__help" id="editor-help">
      Drag the corners to crop, drag inside to move. <kbd>Shift</kbd> keeps the shape.
      Arrow keys nudge (<kbd>Shift</kbd> ×10, <kbd>Ctrl</kbd> resizes). <kbd>Enter</kbd> saves, <kbd>Esc</kbd> cancels.
    </p>`
}

// handlers: { save(), cancel(), leave(key) } — owned by inspector-edit.js.
export function mountOverlay(item, nextHandlers) {
  unmountOverlay()
  handlers = nextHandlers
  overlay = document.createElement('div')
  overlay.className = 'editor'
  overlay.id = 'image-editor'
  overlay.setAttribute('role', 'region')
  overlay.setAttribute('aria-label', `Editing ${item.title}`)
  overlay.innerHTML = String(markup(item))
  document.getElementById('center').append(overlay)
  document.getElementById('app').classList.add('is-editing')
  applyInert()
  overlay.addEventListener('click', onClick)
  const crop = overlay.querySelector('.crop')
  crop.addEventListener('pointerdown', onPointerDown)
  crop.addEventListener('pointermove', onPointerMove)
  crop.addEventListener('pointerup', onPointerUp)
  crop.addEventListener('pointercancel', onPointerUp)
  document.addEventListener('keydown', onKeyCapture, true)
  resizeObserver = new ResizeObserver(() => layout())
  resizeObserver.observe(overlay.querySelector('.editor__stage'))
  layout()
  // No animation on the first paint, only on later changes.
  requestAnimationFrame(() => overlay?.classList.add('is-ready'))
  crop.focus({ preventScroll: true })
  announce(`Editing ${item.title}. Drag the corners to crop.`)
}

export function unmountOverlay() {
  if (!overlay) return
  resizeObserver?.disconnect()
  document.removeEventListener('keydown', onKeyCapture, true)
  overlay.remove()
  overlay = null
  document.getElementById('app').classList.remove('is-editing')
  releaseInert()
}

export function isOverlayOpen() {
  return overlay !== null
}

// Inert everything the editor covers or that could change the target.
// detail.js re-sets the grid's inert flag on every state change, so
// inspector-edit.js calls this again after each update.
export function applyInert() {
  if (!overlay) return
  for (const id of INERT_IDS) {
    const element = document.getElementById(id)
    if (element) element.inert = true
  }
}

function releaseInert() {
  const inDetail = state.view === 'detail'
  for (const id of INERT_IDS) {
    const element = document.getElementById(id)
    if (!element) continue
    element.inert = inDetail && (id === 'grid-scroll' || id === 'filterbar')
  }
}

// --- Painting -------------------------------------------------------------------

// Fits the oriented image into the stage and positions the picture so
// its CSS rotation/flip lands exactly inside the frame.
function layout() {
  if (!overlay || !session) return
  const stage = overlay.querySelector('.editor__stage')
  const { w, h } = oriented()
  scale = Math.min(
    (stage.clientWidth - STAGE_PADDING * 2) / w,
    (stage.clientHeight - STAGE_PADDING * 2) / h,
  )
  const frame = overlay.querySelector('.editor__frame')
  frame.style.width = `${w * scale}px`
  frame.style.height = `${h * scale}px`
  const image = overlay.querySelector('.editor__image')
  image.style.width = `${session.width * scale}px`
  image.style.height = `${session.height * scale}px`
  image.style.transform = `translate(-50%, -50%) scale(${session.flipH ? -1 : 1}, ${session.flipV ? -1 : 1}) rotate(${session.turns}deg)`
  paintCrop()
  paintBar()
  paintStatus()
}

function paintCrop() {
  const { x, y, w, h } = session.crop
  const box = {
    left: `${x * scale}px`,
    top: `${y * scale}px`,
    width: `${w * scale}px`,
    height: `${h * scale}px`,
  }
  Object.assign(overlay.querySelector('.crop').style, box)
  Object.assign(overlay.querySelector('.editor__hole').style, box)
  const size = cropSize()
  overlay.querySelector('.crop__size').textContent = `${size.w} × ${size.h}`
  overlay
    .querySelector('.crop')
    .setAttribute('aria-valuetext', `${size.w} by ${size.h} pixels`)
}

function paintBar() {
  const out = output()
  const dims = overlay.querySelector('.editor__dims')
  dims.textContent = isDirty()
    ? `${session.width} × ${session.height} → ${out.w} × ${out.h}`
    : `${session.width} × ${session.height}`
  overlay.querySelector('[data-ed="undo"]').disabled = !canUndo()
  overlay.querySelector('[data-ed="redo"]').disabled = !canRedo()
  overlay.querySelector('[data-ed="save"]').disabled =
    !isDirty() || session.status === 'saving'
}

function paintStatus() {
  const status = overlay.querySelector('.editor__status')
  overlay.classList.toggle('is-saving', session.status === 'saving')
  if (session.status === 'idle') {
    status.hidden = true
    status.innerHTML = ''
    return
  }
  status.hidden = false
  if (status.dataset.state === session.status) return
  status.dataset.state = session.status
  status.innerHTML =
    session.status === 'saving'
      ? String(html`<div class="editor__card">
          <strong>Saving edits…</strong>
          <span>Writing ${sessionItem()?.filename} and regenerating its sizes. The URL stays the same.</span>
          <div class="meter meter--progress"><span class="meter__fill"></span></div>
        </div>`)
      : String(html`<div class="editor__card editor__card--error">
          <strong>${icon('alert-circle')}Couldn’t save your edits</strong>
          <span>WordPress didn’t respond. Your changes are still here.</span>
          <div class="actions">
            <button class="btn btn--primary btn--sm" data-ed="save">Retry</button>
            <button class="btn btn--sm" data-ed="dismiss-error">Keep editing</button>
          </div>
        </div>`)
  if (session.status === 'error') {
    status.querySelector('[data-ed="save"]').focus()
  }
}

onSessionChange((kind) => {
  if (!overlay || !session) return
  if (kind === 'geometry') {
    paintCrop()
    paintBar()
  } else {
    layout()
  }
})

// --- Pointer: move and resize the crop box ------------------------------------------

// Resizes `start` by (dx, dy) image pixels from `handleName`, keeping the
// opposite edge/corner fixed, the aspect ratio (if any) and the image bounds.
function resizedRect(handleName, start, dx, dy, keepShape) {
  const { w: width, h: height } = oriented()
  const ratio = ratioValue() ?? (keepShape ? start.w / start.h : null)
  if (handleName === 'move') {
    return {
      ...start,
      x: clamp(start.x + dx, 0, width - start.w),
      y: clamp(start.y + dy, 0, height - start.h),
    }
  }
  const west = handleName.includes('w')
  const east = handleName.includes('e')
  const north = handleName.includes('n')
  const south = handleName.includes('s')
  let left = start.x
  let top = start.y
  let right = start.x + start.w
  let bottom = start.y + start.h
  if (west) left = clamp(left + dx, 0, right - MIN_CROP)
  if (east) right = clamp(right + dx, left + MIN_CROP, width)
  if (north) top = clamp(top + dy, 0, bottom - MIN_CROP)
  if (south) bottom = clamp(bottom + dy, top + MIN_CROP, height)
  if (!ratio) return { x: left, y: top, w: right - left, h: bottom - top }

  const horizontal = west || east
  const vertical = north || south
  let w = right - left
  let h = bottom - top
  if (horizontal && vertical) {
    // Corner: follow whichever edge moved further, then fit the bounds.
    if (w / h > ratio) h = w / ratio
    else w = h * ratio
    const anchorX = west ? right : left
    const anchorY = north ? bottom : top
    const fit = Math.min(
      1,
      (west ? anchorX : width - anchorX) / w,
      (north ? anchorY : height - anchorY) / h,
    )
    w *= fit
    h *= fit
    return {
      x: west ? anchorX - w : anchorX,
      y: north ? anchorY - h : anchorY,
      w,
      h,
    }
  }
  if (horizontal) {
    // Side handle: the other axis grows around the centre.
    h = w / ratio
    const anchorX = west ? right : left
    const centreY = start.y + start.h / 2
    const fit = Math.min(
      1,
      (west ? anchorX : width - anchorX) / w,
      (2 * Math.min(centreY, height - centreY)) / h,
    )
    w *= fit
    h *= fit
    return { x: west ? anchorX - w : anchorX, y: centreY - h / 2, w, h }
  }
  w = h * ratio
  const anchorY = north ? bottom : top
  const centreX = start.x + start.w / 2
  const fit = Math.min(
    1,
    (north ? anchorY : height - anchorY) / h,
    (2 * Math.min(centreX, width - centreX)) / w,
  )
  w *= fit
  h *= fit
  return { x: centreX - w / 2, y: north ? anchorY - h : anchorY, w, h }
}

function onPointerDown(event) {
  if (!session || session.status === 'saving' || event.button !== 0) return
  event.preventDefault()
  const crop = event.currentTarget
  crop.setPointerCapture(event.pointerId)
  crop.focus({ preventScroll: true })
  const handleName =
    event.target.closest('[data-handle]')?.dataset.handle ?? 'move'
  drag = {
    handle: handleName,
    x: event.clientX,
    y: event.clientY,
    start: { ...session.crop },
  }
  overlay.classList.add('is-dragging')
  overlay.dataset.drag = handleName === 'move' ? 'move' : 'resize'
}

function onPointerMove(event) {
  if (!drag) return
  const dx = (event.clientX - drag.x) / scale
  const dy = (event.clientY - drag.y) / scale
  setCrop(resizedRect(drag.handle, drag.start, dx, dy, event.shiftKey))
}

function onPointerUp() {
  if (!drag) return
  drag = null
  overlay.classList.remove('is-dragging')
  delete overlay.dataset.drag
  commitCrop()
  const size = cropSize()
  announce(`Crop ${size.w} by ${size.h}`)
}

// --- Keyboard ---------------------------------------------------------------------------

function isTextField(element) {
  if (!element) return false
  if (element.tagName === 'TEXTAREA' || element.isContentEditable) return true
  if (element.tagName !== 'INPUT') return false
  return !['checkbox', 'radio', 'range', 'button'].includes(element.type)
}

const ARROWS = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

// Arrow keys on the crop box: move it; with Ctrl/Cmd, resize it from the
// bottom-right corner. Steps are screen pixels so they feel the same at
// any zoom; history is recorded once the keys go quiet.
function nudge(event) {
  const [dx, dy] = ARROWS[event.key]
  const step = (event.shiftKey ? 10 : 1) / scale
  const mod = event.ctrlKey || event.metaKey
  setCrop(
    resizedRect(
      mod ? 'se' : 'move',
      { ...session.crop },
      dx * step,
      dy * step,
      false,
    ),
  )
  clearTimeout(commitTimer)
  commitTimer = setTimeout(commitCrop, 400)
}

function swallow(event) {
  event.preventDefault()
  event.stopPropagation()
}

const PASS_THROUGH = new Set(['Tab', 'f', '?'])

function onKeyCapture(event) {
  if (!session) return
  // A confirm dialog on top handles its own keys.
  if (document.querySelector('.scrim')) return
  const target = event.target
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
  const mod = event.ctrlKey || event.metaKey
  if (isTextField(target)) return
  if (mod && (key === 'z' || key === 'y')) {
    swallow(event)
    if (key === 'y' || event.shiftKey) redo()
    else undo()
    return
  }
  if (key === 'Escape') {
    swallow(event)
    handlers.cancel?.()
    return
  }
  if (key === 'Enter' && !target.closest?.('button, a, input, select')) {
    swallow(event)
    handlers.save?.()
    return
  }
  if (ARROWS[key] && target.closest?.('.crop')) {
    swallow(event)
    nudge(event)
    return
  }
  if ((key === 'i' || key === 'e') && !mod && !event.altKey) {
    swallow(event)
    handlers.leave?.(key)
    return
  }
  if (PASS_THROUGH.has(key) || mod) return
  // Anything else would act on the grid or detail view behind the editor.
  // Default actions (Space/Enter on a focused button, arrows in a radio
  // group) still happen; only the app shortcuts are stopped.
  event.stopPropagation()
}

function onClick(event) {
  const action = event.target.closest('[data-ed]')?.dataset.ed
  if (action === 'cancel') handlers.cancel?.()
  else if (action === 'save') handlers.save?.()
  else if (action === 'undo') undo()
  else if (action === 'redo') redo()
  else if (action === 'dismiss-error') handlers.dismissError?.()
}
