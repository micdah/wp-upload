// Helpers shared by the system feature modules (upload, delete, states,
// commands, phone): scenario facts, a modal with a focus trap, and a way to
// keep injected elements alive across core re-renders.

import { library } from '../data.js'
import { state } from '../store.js'
import { showToast } from '../ui.js'

// --- Scenario facts ----------------------------------------------------------------

// The signed-in user. In the `author` scenario the user is an Author, who
// may only edit and delete their own uploads (D9).
export function currentUser() {
  return state.scenario === 'author' ? 'Anna Berg' : 'Site Admin'
}

export function isAuthor() {
  return state.scenario === 'author'
}

export function canEdit(item) {
  return !isAuthor() || item.author === currentUser()
}

// Media trash only exists when the site defines MEDIA_TRASH (D8).
export function hasTrash() {
  return state.scenario === 'trash'
}

export function isOffline() {
  return state.scenario === 'offline'
}

// Without the companion plugin the media manager isn't usable at all (D1b).
export function isPluginMissing() {
  return state.scenario === 'no-plugin'
}

// Mutations are refused while WordPress is unreachable. Returns true when
// the caller may go ahead; otherwise explains why in a toast.
export function guardMutation(verb = 'Changes') {
  if (isOffline()) {
    showToast({
      text: `${verb} are paused while WordPress is unreachable`,
      iconName: 'wifi-off',
    })
    return false
  }
  return !isPluginMissing()
}

// --- Folders -----------------------------------------------------------------------

export function inFolder() {
  return typeof state.folder === 'number' && state.folder > 0
}

export function folderLabel(id = state.folder) {
  if (id === 'all') return 'All files'
  if (!id) return 'Uncategorized'
  return library.folderById.get(id)?.name ?? 'folder'
}

// FileBird keeps per-folder counts; adjust them when items come and go.
export function adjustFolderCount(folderId, delta) {
  const folder = library.folderById.get(folderId)
  if (folder) folder.count = Math.max(0, folder.count + delta)
}

// --- Layout --------------------------------------------------------------------------

export const PHONE = '(max-width: 599px)'
export const NARROW = '(max-width: 899px)'

export function matches(query) {
  return window.matchMedia(query).matches
}

export const isMac = /Mac|iPhone|iPad/.test(
  navigator.platform || navigator.userAgent,
)

export function plural(count, word, many = `${word}s`) {
  return `${count} ${count === 1 ? word : many}`
}

// --- Keeping injected UI alive ---------------------------------------------------------

// Core views rebuild their containers with innerHTML. `ensure` runs now and
// after every rebuild of `container`'s direct children, so a feature can
// (re)insert its own elements without core changes.
export function keepInjected(container, ensure) {
  if (!container) return
  ensure()
  new MutationObserver(ensure).observe(container, { childList: true })
}

// --- Modal with focus trap ---------------------------------------------------------------

let openModalClose = null

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Shows `element` above a scrim. Keeps Tab inside, closes on Esc or a click on
// the scrim, makes the app inert and returns focus when it closes. Keys
// pressed inside never reach the global keymap, so `F` typed in the palette
// doesn't toggle the folder column.
export function openModal({
  element,
  variant = '',
  initialFocus,
  onKeyDown,
  onClose,
}) {
  openModalClose?.()
  const previousFocus = document.activeElement
  const app = document.getElementById('app')
  const wasInert = app.inert
  const scrim = document.createElement('div')
  scrim.className = `scrim mm-scrim ${variant}`
  scrim.append(element)

  const close = () => {
    if (!scrim.isConnected) return
    scrim.classList.add('is-leaving')
    app.inert = wasInert
    openModalClose = null
    const finish = () => scrim.remove()
    // Let the exit fade play; reduced motion makes it effectively instant.
    setTimeout(finish, 120)
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    onClose?.()
  }

  scrim.addEventListener('keydown', (event) => {
    event.stopPropagation()
    if (onKeyDown?.(event)) return
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    } else if (event.key === 'Tab') {
      trapTab(event, element)
    }
  })
  scrim.addEventListener('pointerdown', (event) => {
    if (event.target === scrim) close()
  })

  document.body.append(scrim)
  app.inert = true
  openModalClose = close
  const target =
    (initialFocus && element.querySelector(initialFocus)) ??
    element.querySelector(FOCUSABLE) ??
    element
  target.focus()
  return close
}

export function closeOpenModal() {
  openModalClose?.()
}

export function isModalOpen() {
  return openModalClose !== null
}

function trapTab(event, root) {
  const focusable = [...root.querySelectorAll(FOCUSABLE)].filter(
    (node) => node.offsetParent !== null,
  )
  if (focusable.length === 0) {
    event.preventDefault()
    return
  }
  const first = focusable[0]
  const last = focusable.at(-1)
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

export function elementFromHtml(markup) {
  const template = document.createElement('template')
  template.innerHTML = String(markup).trim()
  return template.content.firstElementChild
}
