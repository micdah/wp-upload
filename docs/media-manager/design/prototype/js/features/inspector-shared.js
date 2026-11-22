// Shared state and helpers for the inspector panels (Info, Edit, Usage) and
// the image editor. Kept in one small module so the panel modules don't
// import each other (or inspector.js) and create cycles.

import { folderPath, library } from '../data.js'
import { isImageLike, state } from '../store.js'

// --- Panel UI state that must survive re-renders ------------------------------
// The inspector re-renders its whole panel on every selection change, so
// anything the user set up (collapsed sections, the description mode) lives
// here rather than in the DOM.
export const ui = {
  collapsed: new Set(['sizes']),
  descriptionMode: 'replace', // batch edit: 'replace' | 'append'
  pendingFocus: null, // field name to focus after the next render
  previousTab: 'info', // where Save/Cancel in the editor returns to
}

// --- Re-render hook ------------------------------------------------------------
// inspector.js registers its renderer; feature modules call requestRender()
// after changing data the panel shows.

let renderer = () => {}

export function setRenderer(render) {
  renderer = render
}

export function requestRender() {
  renderer()
}

// --- Delegated actions -----------------------------------------------------------
// Buttons inside the inspector carry data-insp="name"; modules register a
// handler here and inspector.js dispatches clicks to it.

const actions = new Map()

export function registerInspectorAction(name, handler) {
  actions.set(name, handler)
}

export function runInspectorAction(name, element, event) {
  const handler = actions.get(name)
  if (!handler) return false
  handler(element, event)
  return true
}

// --- Permissions (D9) -------------------------------------------------------------
// In the "Author" scenario the WordPress user may only edit media they
// uploaded themselves. Production reads this from the item's
// `_links.self.targetHints.allow` (PUT/DELETE) instead of the author name.

export const CURRENT_USER = 'Site Admin'

export function isAuthorRole() {
  return state.scenario === 'author'
}

export function canEdit(item) {
  return !isAuthorRole() || item.author === CURRENT_USER
}

export const READ_ONLY_NOTICE =
  'You can view but not edit media uploaded by others (Author role).'

// --- Item helpers -------------------------------------------------------------------

// WordPress's image editor handles raster images only: SVG has no pixels to
// crop, and video/audio/documents aren't images at all.
export function isEditableImage(item) {
  return item.kind === 'image'
}

export function needsAlt(item) {
  return isImageLike(item) && !item.alt
}

export function folderName(id) {
  if (!id) return 'Uncategorized'
  return folderPath(id)
    .map((folder) => folder.name)
    .join(' / ')
}

export function subtype(item) {
  return item.mime.split('/')[1].replace('svg+xml', 'SVG').toUpperCase()
}

// Upload URL as WordPress builds it (uploads/YYYY/MM/). The host is a
// placeholder — the prototype never names a real deployment.
export function fileUrl(item, filename = item.filename) {
  const date = new Date(item.uploaded)
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `https://example.com/wp-content/uploads/${date.getUTCFullYear()}/${month}/${filename}`
}

// WordPress scales uploads above 2560 px down to "name-scaled.ext" and
// keeps the original next to it (`original_image`).
export function isScaled(item) {
  return item.filename.includes('-scaled.')
}

export function originalFilename(item) {
  return item.filename.replace('-scaled.', '.')
}

// WordPress's default registered sizes. A size is only generated when the
// image is larger than it; `crop` sizes are cut to exact dimensions.
const WP_SIZES = [
  {
    name: 'thumbnail',
    label: 'Thumbnail',
    width: 150,
    height: 150,
    crop: true,
  },
  { name: 'medium', label: 'Medium', width: 300, height: 300 },
  { name: 'medium_large', label: 'Medium large', width: 768, height: 0 },
  { name: 'large', label: 'Large', width: 1024, height: 1024 },
  { name: '1536x1536', label: '1536 × 1536', width: 1536, height: 1536 },
  { name: '2048x2048', label: '2048 × 2048', width: 2048, height: 2048 },
]

function fit(width, height, maxWidth, maxHeight) {
  const scale = Math.min(
    maxWidth ? maxWidth / width : Number.POSITIVE_INFINITY,
    maxHeight ? maxHeight / height : Number.POSITIVE_INFINITY,
  )
  if (scale >= 1) return null
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  }
}

export function subSizes(item) {
  if (!isEditableImage(item)) return []
  const base = item.filename.replace(/(-scaled)?\.(\w+)$/, '')
  const extension = item.filename.split('.').pop()
  const sizes = []
  for (const size of WP_SIZES) {
    const box = size.crop
      ? item.width > size.width && item.height > size.height
        ? { width: size.width, height: size.height }
        : null
      : fit(item.width, item.height, size.width, size.height)
    if (!box) continue
    sizes.push({
      ...size,
      ...box,
      filename: `${base}-${box.width}x${box.height}.${extension}`,
    })
  }
  return sizes
}

// Every post or page the sample data knows about, for the attach picker.
export function knownPosts() {
  const byId = new Map()
  for (const item of library.items) {
    for (const post of [...item.usedIn, item.attachedTo]) {
      if (post) byId.set(post.id, post)
    }
  }
  return [...byId.values()].sort((a, b) => a.title.localeCompare(b.title))
}

// How an item is used in a post. The companion plugin's index reports this
// (featured image, block type…); the prototype derives a stable fake.
export function usageContext(item, post) {
  const seed = (item.id * 7 + post.id) % 5
  if (seed === 0 && isImageLike(item)) return 'Featured image'
  if (item.kind === 'video') return 'Video block'
  if (item.kind === 'audio') return 'Audio block'
  if (item.kind === 'document' || item.kind === 'archive') return 'File block'
  return seed === 1 ? 'Gallery block' : 'Image block'
}

export function postUrl(post) {
  return `https://example.com/?p=${post.id}`
}

export function postEditUrl(post) {
  return `https://example.com/wp-admin/post.php?post=${post.id}&action=edit`
}

// --- Simulated network ------------------------------------------------------------------
// Every write goes through here so the UI can show real pending/failed
// states. ?scenario=offline makes every request fail; window.mmInspector
// .failNextSave() fails just the next one (used by screenshots and checks).

let failNext = false

export const devHooks = {
  failNextSave() {
    failNext = true
  },
}

export function fakeRequest(ms = 450) {
  const fail = failNext || state.scenario === 'offline'
  failNext = false
  return new Promise((resolve, reject) => {
    setTimeout(
      () => (fail ? reject(new Error('WordPress unreachable')) : resolve()),
      ms,
    )
  })
}

// Pluralised count: plural(3, 'item') → "3 items".
export function plural(count, word, many = `${word}s`) {
  return `${count} ${count === 1 ? word : many}`
}

// Clipboard writes fail without a secure context or permission; the UI
// still confirms, because the prototype has nothing to paste into.
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // Ignored in the prototype.
  }
}
