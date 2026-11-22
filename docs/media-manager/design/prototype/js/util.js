// Small helpers shared by the prototype modules.

const ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ESCAPES[char])
}

// A raw (already safe) HTML fragment, so nested html`` calls aren't escaped.
class SafeHtml {
  constructor(value) {
    this.value = value
  }
  toString() {
    return this.value
  }
}

export function raw(value) {
  return new SafeHtml(value)
}

function interpolate(value) {
  if (value instanceof SafeHtml) return value.value
  if (Array.isArray(value)) return value.map(interpolate).join('')
  if (value === false || value === null || value === undefined) return ''
  return escapeHtml(value)
}

// Tagged template that escapes interpolated values by default.
export function html(strings, ...values) {
  let out = strings[0]
  values.forEach((value, index) => {
    out += interpolate(value) + strings[index + 1]
  })
  return new SafeHtml(out)
}

export function icon(name, extraClass = '') {
  return raw(
    `<svg class="icon ${extraClass}" aria-hidden="true"><use href="icons.svg#i-${name}"></use></svg>`,
  )
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`
}

export function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function formatDuration(seconds) {
  const minutes = Math.floor(seconds / 60)
  const rest = String(seconds % 60).padStart(2, '0')
  if (minutes < 60) return `${minutes}:${rest}`
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${rest}`
}

// Keeps the extension visible: "very-long-file-na…me.jpg".
export function truncateMiddle(text, max = 32) {
  if (text.length <= max) return text
  const keepEnd = Math.min(12, Math.floor(max / 3))
  return `${text.slice(0, max - keepEnd - 1)}…${text.slice(-keepEnd)}`
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

export function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function announce(message) {
  const region = document.getElementById('live-region')
  region.textContent = ''
  requestAnimationFrame(() => {
    region.textContent = message
  })
}
