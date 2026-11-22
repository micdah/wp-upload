// System states driven by ?scenario=: companion plugin missing (onboarding),
// WordPress unreachable (banner, cached browsing, mutations paused), Author
// role (limited permissions), slow loading (hairline + skeletons) and an
// empty library (folder counts reset; the empty state itself is core).

import { library } from '../data.js'
import { targetItems } from '../selection.js'
import { state, update } from '../store.js'
import { brandMark } from '../toolbar.js'
import { showToast } from '../ui.js'
import { announce, html, icon } from '../util.js'
import { canEdit, elementFromHtml, keepInjected } from './system-shared.js'

const center = () => document.getElementById('center')

// --- Banners above the filter bar ----------------------------------------------------

function mountBanner(markup) {
  const banner = elementFromHtml(markup)
  center().prepend(banner)
  return banner
}

// --- Offline ------------------------------------------------------------------------

const RETRY_STEPS = [15, 30, 60]
let retryStep = 0
let retryIn = RETRY_STEPS[0]
let retryTimer = 0

function offlineBanner() {
  const banner =
    mountBanner(html`<div class="mm-banner mm-banner--warn" role="status">
    ${icon('wifi-off')}
    <p class="mm-banner__text"><strong>Can’t reach WordPress.</strong> You’re browsing the copy loaded earlier; uploads and edits are paused until the connection is back.</p>
    <span class="mm-banner__meta num" data-retry-label></span>
    <button class="btn btn--sm" data-retry>${icon('refresh', 'icon--sm')}Retry now</button>
  </div>`)
  const label = banner.querySelector('[data-retry-label]')
  const button = banner.querySelector('[data-retry]')
  const tick = () => {
    retryIn--
    if (retryIn <= 0) attempt()
    else label.textContent = `Retrying in ${retryIn} s`
  }
  // A real check calls the proxy's health endpoint; here it always fails,
  // and the wait backs off 15 → 30 → 60 s.
  const attempt = () => {
    clearInterval(retryTimer)
    button.disabled = true
    label.textContent = 'Reconnecting…'
    setTimeout(() => {
      button.disabled = false
      retryStep = Math.min(retryStep + 1, RETRY_STEPS.length - 1)
      retryIn = RETRY_STEPS[retryStep]
      label.textContent = `Still offline · retrying in ${retryIn} s`
      announce('Still offline')
      retryTimer = setInterval(tick, 1000)
    }, 1200)
  }
  button.addEventListener('click', attempt)
  label.textContent = `Retrying in ${retryIn} s`
  retryTimer = setInterval(tick, 1000)
}

// Mutating controls rendered by core views get disabled (with a reason) each
// time those views re-render.
const MUTATING = [
  '[data-mm-action="upload"]',
  '[data-mm-action="move-to-folder"]',
  '[data-mm-action="edit-details"]',
  '[data-mm-action="delete"]',
  '[data-mm-action="new-folder"]',
  '[data-mm-action="remove-from-folder"]',
].join(',')

function lockMutations(root, reason) {
  for (const control of root.querySelectorAll(MUTATING)) {
    control.disabled = true
    control.title = reason
  }
}

function lockFields(root, reason) {
  for (const field of root.querySelectorAll('.inspector__body .input')) {
    field.readOnly = true
    field.title = reason
  }
}

function initOffline() {
  offlineBanner()
  const reason = 'Paused while WordPress is unreachable'
  for (const id of ['toolbar', 'inspector', 'grid', 'folders']) {
    const root = document.getElementById(id)
    keepInjected(root, () => {
      lockMutations(root, reason)
      if (id === 'inspector') lockFields(root, reason)
    })
  }
}

// --- Author -------------------------------------------------------------------------------

const AUTHOR_DISMISSED = 'mm-proto-author-banner'

function authorBanner() {
  try {
    if (sessionStorage.getItem(AUTHOR_DISMISSED)) return
  } catch {
    // Storage unavailable: the banner just shows again.
  }
  const banner = mountBanner(html`<div class="mm-banner" role="note">
    ${icon('lock')}
    <p class="mm-banner__text">You’re signed in as an <strong>Author</strong>. You can upload, and edit or delete media you uploaded. Other media is read-only — ask an Editor for more access.</p>
    <button class="icon-btn" data-dismiss title="Dismiss">${icon('x')}</button>
  </div>`)
  banner.querySelector('[data-dismiss]').addEventListener('click', () => {
    banner.remove()
    try {
      sessionStorage.setItem(AUTHOR_DISMISSED, '1')
    } catch {
      // Ignore unavailable storage.
    }
  })
}

// Items the Author can't edit get read-only fields and a short reason at
// the top of the inspector.
function lockForeignItems() {
  const inspector = document.getElementById('inspector')
  const body = inspector.querySelector('.inspector__body')
  if (!body || body.querySelector('.mm-readonly')) return
  const items = targetItems()
  const foreign = items.filter((item) => !canEdit(item))
  if (foreign.length === 0) return
  const text =
    items.length === 1
      ? `Read-only — uploaded by ${foreign[0].author}. Authors can only change their own media.`
      : `${foreign.length} of ${items.length} items were uploaded by others and won’t change.`
  body.prepend(
    elementFromHtml(
      html`<div class="notice mm-readonly">${icon('lock')}<span>${text}</span></div>`,
    ),
  )
  if (items.length === 1) {
    lockFields(inspector, 'Read-only: uploaded by someone else')
    for (const button of body.querySelectorAll('.btn--danger')) {
      button.disabled = true
    }
  }
}

function initAuthor() {
  authorBanner()
  keepInjected(document.getElementById('inspector'), lockForeignItems)
}

// --- Loading --------------------------------------------------------------------------

function skeletonLines(count, className) {
  return Array.from(
    { length: count },
    (_, index) =>
      `<div class="skeleton ${className}" style="--w:${[72, 54, 88, 46, 64, 80, 58][index % 7]}"></div>`,
  ).join('')
}

function initLoading() {
  center().prepend(
    elementFromHtml(
      html`<div class="mm-hairline" role="progressbar" aria-label="Loading media library"><span></span></div>`,
    ),
  )
  // The folder tree, filter row and inspector would show stale or zero
  // counts; skeletons in their shape replace them until data arrives.
  keepInjected(document.getElementById('folders'), () => {
    const inner = document.querySelector('#folders .folders__inner')
    if (inner && !inner.querySelector('.mm-skel-tree')) {
      inner.insertAdjacentHTML(
        'beforeend',
        `<div class="mm-skel-tree" aria-hidden="true">${skeletonLines(9, 'mm-skel-line')}</div>`,
      )
    }
  })
  keepInjected(document.getElementById('filterbar'), () => {
    const bar = document.getElementById('filterbar')
    if (!bar.querySelector('.mm-skel-chips')) {
      bar.insertAdjacentHTML(
        'beforeend',
        `<div class="mm-skel-chips" aria-hidden="true">${skeletonLines(5, 'mm-skel-chip')}</div>`,
      )
    }
  })
  keepInjected(document.getElementById('inspector'), () => {
    const panel = document.querySelector('#inspector .inspector__panel')
    if (panel && !panel.querySelector('.mm-skel-inspector')) {
      panel.insertAdjacentHTML(
        'beforeend',
        `<div class="mm-skel-inspector" aria-hidden="true">
          <div class="skeleton mm-skel-block"></div>
          ${skeletonLines(4, 'mm-skel-line')}
        </div>`,
      )
    }
  })
  announce('Loading media library')
}

// --- Plugin missing ------------------------------------------------------------------------

const PLUGIN_FEATURES = [
  ['folders', 'Folders', 'Reads and moves FileBird folders'],
  ['link', 'Where it’s used', 'Finds posts and pages that use each file'],
  ['trash', 'Trash and restore', 'Restores media from the WordPress trash'],
  [
    'refresh',
    'Regenerate and replace',
    'Rebuilds thumbnails, swaps files in place',
  ],
]

function onboarding() {
  const screen =
    elementFromHtml(html`<main class="mm-onboarding" aria-labelledby="mm-onboarding-title">
    <div class="mm-onboarding__card">
      <div class="mm-onboarding__brand">
        <span class="mm-onboarding__plug">${icon('plug-connected-x', 'icon--lg')}</span>
        <span class="brand">${brandMark()}<span class="brand__wordmark">wp-upload</span></span>
      </div>
      <h1 class="mm-onboarding__title" id="mm-onboarding-title" tabindex="-1">Install the companion plugin to use the media manager</h1>
      <p class="mm-onboarding__lead">
        The media manager needs a small WordPress plugin for things the REST API doesn’t offer on its own.
        It wasn’t found on <span class="mm-code">example.com</span>.
      </p>
      <ul class="mm-onboarding__features">
        ${PLUGIN_FEATURES.map(
          ([iconName, title, text]) =>
            html`<li>${icon(iconName)}<div><strong>${title}</strong><span>${text}</span></div></li>`,
        )}
      </ul>
      <ol class="mm-onboarding__steps">
        <li>
          <div><strong>Download the plugin</strong><span>A single PHP file, <span class="mm-code">wp-upload-companion.php</span>.</span></div>
          <a class="btn" href="#download" data-onboarding="download">${icon('download')}Download</a>
        </li>
        <li>
          <div><strong>Add it to WordPress</strong><span>Upload it to <span class="mm-code">wp-content/mu-plugins/</span> so it’s always on, or install it as a normal plugin under Plugins → Add New. This needs an Administrator.</span></div>
        </li>
        <li>
          <div><strong>Check again</strong><span>No settings needed. The media manager opens as soon as the plugin answers.</span></div>
        </li>
      </ol>
      <div class="mm-onboarding__actions">
        <button class="btn btn--primary" data-onboarding="check">${icon('refresh')}Check again</button>
        <a class="btn btn--ghost" href="#basic-uploader" data-onboarding="basic">${icon('upload')}Use the basic uploader instead</a>
        <span class="mm-onboarding__status" role="status" data-onboarding-status>Last checked just now · plugin not found</span>
      </div>
    </div>
  </main>`)
  screen.addEventListener('click', (event) => {
    const action = event.target.closest('[data-onboarding]')?.dataset.onboarding
    if (!action) return
    event.preventDefault()
    if (action === 'check') checkAgain(screen)
    else if (action === 'basic') {
      showToast({
        text: 'In the app this opens the existing upload page, which works without the plugin.',
        iconName: 'upload',
      })
    } else if (action === 'download') {
      showToast({
        text: 'In the app this downloads wp-upload-companion.php.',
        iconName: 'download',
      })
    }
  })
  return screen
}

// The real check asks the server whether the plugin's REST namespace exists
// (GET /wp-json/ and look for wp-upload/v1).
function checkAgain(screen) {
  const button = screen.querySelector('[data-onboarding="check"]')
  const status = screen.querySelector('[data-onboarding-status]')
  button.disabled = true
  button.lastChild.textContent = 'Checking…'
  status.textContent = 'Checking example.com…'
  setTimeout(() => {
    button.disabled = false
    button.lastChild.textContent = 'Check again'
    const time = new Date().toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
    })
    status.textContent = `Checked at ${time} · still not found. Is it in mu-plugins, or activated?`
  }, 1100)
}

function initNoPlugin() {
  const app = document.getElementById('app')
  app.inert = true
  app.setAttribute('aria-hidden', 'true')
  const screen = onboarding()
  document.body.append(screen)
  screen.querySelector('#mm-onboarding-title').focus()
}

// --- Empty library -------------------------------------------------------------------------

function initEmpty() {
  // A brand-new site: folders may exist, but none hold anything yet.
  for (const folder of library.folders) folder.count = 0
  update({}, ['folders'])
}

// --- Wiring ------------------------------------------------------------------------------

export function initStates() {
  switch (state.scenario) {
    case 'offline':
      initOffline()
      break
    case 'author':
      initAuthor()
      break
    case 'loading':
      initLoading()
      break
    case 'no-plugin':
      initNoPlugin()
      break
    case 'empty':
      initEmpty()
      break
  }
}
