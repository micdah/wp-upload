// The image-edit session: the pending crop / rotate / flip / scale for one
// image, with undo and redo. Pure state and geometry — the overlay
// (editor-overlay.js) and the Edit panel (editor-panel.js) draw it.
//
// Coordinates: the crop rectangle is in *oriented* image pixels, i.e. in
// the image as it looks on screen after rotation and flips. Rotate and flip
// therefore act in screen space ("flip horizontal" mirrors what you see),
// and the crop rectangle is rotated/mirrored along with the picture.
//
// Nothing here touches the file. Saving sends the whole recipe to the
// companion plugin, which applies it in place (same ID, same URL — D7).

import { library } from '../data.js'

export const RATIOS = [
  { key: 'free', label: 'Free' },
  { key: 'original', label: 'Original' },
  { key: '1:1', label: '1:1', value: 1 },
  { key: '4:3', label: '4:3', value: 4 / 3 },
  { key: '3:2', label: '3:2', value: 3 / 2 },
  { key: '16:9', label: '16:9', value: 16 / 9 },
]

export const APPLY_TO = [
  {
    value: 'all',
    label: 'All image sizes',
    hint: 'The full image and every thumbnail.',
  },
  {
    value: 'thumbnail',
    label: 'Thumbnail only',
    hint: 'Art-direct the small square crop used in lists and grids. The full image stays as it is.',
  },
  {
    value: 'except-thumbnail',
    label: 'All sizes except thumbnail',
    hint: 'Keeps the current thumbnail crop.',
  },
]

// Smallest crop, in image pixels. WordPress refuses crops smaller than the
// thumbnail; 50 px keeps the handles usable on small previews.
export const MIN_CROP = 50

export let session = null

const listeners = new Set()

// kind: 'geometry' (crop moved — cheap repaint) or 'all' (anything else).
export function onSessionChange(listener) {
  listeners.add(listener)
}

function changed(kind = 'all') {
  for (const listener of listeners) listener(kind)
}

// --- Lifecycle --------------------------------------------------------------------------

export function startSession(item) {
  session = {
    itemId: item.id,
    width: item.width,
    height: item.height,
    turns: 0, // display rotation in degrees, unbounded so CSS animates the short way
    flipH: false,
    flipV: false,
    crop: { x: 0, y: 0, w: item.width, h: item.height },
    ratio: 'free',
    portrait: item.height > item.width,
    scale: null, // null = output at crop size; otherwise a factor below 1
    applyTo: 'all',
    history: [],
    index: -1,
    status: 'idle', // 'idle' | 'saving' | 'error'
  }
  pushHistory()
  changed()
  return session
}

export function endSession() {
  session = null
  changed()
}

export function sessionItem() {
  return session ? library.byId.get(session.itemId) : null
}

// --- Derived values -----------------------------------------------------------------------

export function rotation() {
  return ((session.turns % 360) + 360) % 360
}

export function oriented() {
  return rotation() % 180
    ? { w: session.height, h: session.width }
    : { w: session.width, h: session.height }
}

export function ratioValue(key = session.ratio) {
  if (key === 'free') return null
  if (key === 'original') {
    const { w, h } = oriented()
    return w / h
  }
  const { value } = RATIOS.find((ratio) => ratio.key === key)
  return value === 1 ? 1 : session.portrait ? 1 / value : value
}

export function cropSize() {
  return { w: Math.round(session.crop.w), h: Math.round(session.crop.h) }
}

export function output() {
  const crop = cropSize()
  if (!session.scale) return crop
  return {
    w: Math.max(1, Math.round(crop.w * session.scale)),
    h: Math.max(1, Math.round(crop.h * session.scale)),
  }
}

function snapshot() {
  const { turns, flipH, flipV, crop, ratio, portrait, scale, applyTo } = session
  return structuredClone({
    turns,
    flipH,
    flipV,
    crop,
    ratio,
    portrait,
    scale,
    applyTo,
  })
}

// Dirty = the image would change on save. Apply-to alone changes nothing.
export function isDirty() {
  if (!session) return false
  const { w, h } = oriented()
  const crop = session.crop
  return (
    rotation() !== 0 ||
    session.flipH ||
    session.flipV ||
    Math.round(crop.x) !== 0 ||
    Math.round(crop.y) !== 0 ||
    Math.round(crop.w) !== w ||
    Math.round(crop.h) !== h ||
    session.scale !== null
  )
}

export function canUndo() {
  return session && session.index > 0
}

export function canRedo() {
  return session && session.index < session.history.length - 1
}

// --- History ---------------------------------------------------------------------------------

export function pushHistory() {
  const next = snapshot()
  const current = session.history[session.index]
  if (current && JSON.stringify(current) === JSON.stringify(next)) return
  session.history = session.history.slice(0, session.index + 1)
  session.history.push(next)
  session.index = session.history.length - 1
}

function restore(index) {
  session.index = index
  Object.assign(session, structuredClone(session.history[index]))
  changed()
}

export function undo() {
  if (canUndo()) restore(session.index - 1)
}

export function redo() {
  if (canRedo()) restore(session.index + 1)
}

// --- Operations ------------------------------------------------------------------------------

// Rotates the picture 90° in screen space. With exactly one flip active,
// the inner rotation runs the other way (flip ∘ rotate = rotate⁻¹ ∘ flip).
export function rotate(direction) {
  const { w: width, h: height } = oriented()
  const { x, y, w, h } = session.crop
  const mirrored = session.flipH !== session.flipV
  session.turns += (mirrored ? -direction : direction) * 90
  session.crop =
    direction > 0
      ? { x: height - (y + h), y: x, w: h, h: w }
      : { x: y, y: width - (x + w), w: h, h: w }
  session.portrait = !session.portrait
  pushHistory()
  changed()
}

export function flip(axis) {
  const { w: width, h: height } = oriented()
  const crop = session.crop
  if (axis === 'h') {
    session.flipH = !session.flipH
    crop.x = width - (crop.x + crop.w)
  } else {
    session.flipV = !session.flipV
    crop.y = height - (crop.y + crop.h)
  }
  pushHistory()
  changed()
}

// Largest box of the ratio that fits the image, centred on the current
// crop's centre (and nudged back inside the image).
function fitRatio(ratio) {
  const { w: width, h: height } = oriented()
  const crop = session.crop
  const w = Math.min(width, height * ratio)
  const h = w / ratio
  const cx = crop.x + crop.w / 2
  const cy = crop.y + crop.h / 2
  session.crop = {
    x: clamp(cx - w / 2, 0, width - w),
    y: clamp(cy - h / 2, 0, height - h),
    w,
    h,
  }
}

export function setRatio(key) {
  session.ratio = key
  if (key === 'original') session.portrait = oriented().h > oriented().w
  const ratio = ratioValue()
  if (ratio) fitRatio(ratio)
  pushHistory()
  changed()
}

export function togglePortrait() {
  session.portrait = !session.portrait
  const ratio = ratioValue()
  if (ratio) fitRatio(ratio)
  pushHistory()
  changed()
}

// Numeric crop size; keeps the centre, respects the ratio and the image.
export function setCropSize(axis, value) {
  const { w: width, h: height } = oriented()
  const crop = session.crop
  const ratio = ratioValue()
  let w = axis === 'w' ? value : crop.w
  let h = axis === 'h' ? value : crop.h
  if (ratio) {
    if (axis === 'w') h = w / ratio
    else w = h * ratio
  }
  const shrink = Math.min(1, width / w, height / h)
  w = Math.max(MIN_CROP, w * shrink)
  h = Math.max(MIN_CROP, h * shrink)
  const cx = crop.x + crop.w / 2
  const cy = crop.y + crop.h / 2
  session.crop = {
    x: clamp(cx - w / 2, 0, width - w),
    y: clamp(cy - h / 2, 0, height - h),
    w,
    h,
  }
  pushHistory()
  changed()
}

// Live update while dragging; commitCrop() records it in the history.
export function setCrop(rect) {
  session.crop = rect
  changed('geometry')
}

export function commitCrop() {
  pushHistory()
  changed()
}

export function resetAll() {
  const { width, height } = session
  Object.assign(session, {
    turns: 0,
    flipH: false,
    flipV: false,
    crop: { x: 0, y: 0, w: width, h: height },
    ratio: 'free',
    portrait: height > width,
    scale: null,
  })
  pushHistory()
  changed()
}

// Scale is down-only (WordPress can't upscale) and always proportional, so
// it is stored as a factor of the crop and follows the crop when it changes.
export function setScale(axis, value) {
  const crop = cropSize()
  const factor = clamp(value / crop[axis], 1 / crop[axis], 1)
  session.scale = factor > 0.9995 ? null : factor
  pushHistory()
  changed()
}

export function setApplyTo(value) {
  session.applyTo = value
  pushHistory()
  changed()
}

export function setStatus(status) {
  session.status = status
  changed()
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max))
}
