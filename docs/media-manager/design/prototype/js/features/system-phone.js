// Tablet (600–899 px) and phone (< 600 px) fallbacks. The brief is
// desktop-first; this keeps the app usable on small screens:
//   - the toolbar condenses: search becomes an icon that expands, and on
//     phones sort/layout/theme move into a "More" menu;
//   - folders (core drawer) and the inspector get a tap-to-close scrim;
//   - on phones the inspector is a bottom sheet and detail is full-screen
//     with swipe left/right between items and an Info button.
// Layout lives in css/features/system.css; this module adds the controls.

import { collection, DENSITIES, SORT_LABELS, state, update } from '../store.js'
import { openMenu } from '../ui.js'
import { writeUrl } from '../url.js'
import { html, icon, prefersReducedMotion } from '../util.js'
import {
  elementFromHtml,
  keepInjected,
  matches,
  NARROW,
} from './system-shared.js'

const toolbar = () => document.getElementById('toolbar')

// --- Condensed toolbar -----------------------------------------------------------------

function injectToolbarControls() {
  const bar = toolbar()
  const search = bar.querySelector('.search')
  if (search && !bar.querySelector('.mm-search-toggle')) {
    search.before(
      elementFromHtml(
        html`<button class="icon-btn mm-search-toggle" title="Search" aria-label="Search" aria-expanded="false">${icon('search')}</button>`,
      ),
    )
    search.append(
      elementFromHtml(
        html`<button class="icon-btn mm-search-close" title="Close search" aria-label="Close search">${icon('x')}</button>`,
      ),
    )
  }
  const group = bar.querySelector('.toolbar__group')
  if (group && !bar.querySelector('.mm-more')) {
    group.append(
      elementFromHtml(
        html`<button class="icon-btn mm-more" title="More" aria-haspopup="menu">${icon('dots')}</button>`,
      ),
    )
  }
  // Keep the expanded search open across re-renders while it has a query.
  const open = bar.classList.contains('mm-search-open')
  bar
    .querySelector('.mm-search-toggle')
    ?.setAttribute('aria-expanded', String(open))
}

function setSearchOpen(open) {
  const bar = toolbar()
  bar.classList.toggle('mm-search-open', open)
  bar
    .querySelector('.mm-search-toggle')
    ?.setAttribute('aria-expanded', String(open))
  if (open) bar.querySelector('[name="search"]')?.focus()
}

function moreMenu(button) {
  const rect = button.getBoundingClientRect()
  openMenu({
    x: rect.right - 220,
    y: rect.bottom + 4,
    label: 'Sort',
    items: [
      ...Object.entries(SORT_LABELS).map(([sort, label]) => ({
        label,
        icon: state.sort === sort ? 'circle-check' : 'circle',
        onSelect: () => {
          update({ sort }, ['collection'])
          writeUrl()
        },
      })),
      'separator',
      {
        label:
          state.layout === 'justified' ? 'Square layout' : 'Justified layout',
        icon: state.layout === 'justified' ? 'layout-grid' : 'layout-board',
        onSelect: () =>
          update(
            { layout: state.layout === 'justified' ? 'square' : 'justified' },
            ['layout'],
          ),
      },
      {
        label: 'Larger thumbnails',
        icon: 'zoom-in',
        onSelect: () =>
          update(
            { density: Math.min(DENSITIES.length - 1, state.density + 1) },
            ['density'],
          ),
      },
      {
        label: 'Smaller thumbnails',
        icon: 'zoom-out',
        onSelect: () =>
          update({ density: Math.max(0, state.density - 1) }, ['density']),
      },
      'separator',
      {
        label: state.panels.inspector ? 'Hide info' : 'Show info',
        icon: 'info-circle',
        onSelect: togglePanel('inspector'),
      },
      {
        label: `${state.theme === 'dark' ? 'Light' : 'Dark'} theme`,
        icon: state.theme === 'dark' ? 'sun' : 'moon',
        onSelect: () =>
          update({ theme: state.theme === 'dark' ? 'light' : 'dark' }, [
            'theme',
          ]),
      },
    ],
  })
}

function togglePanel(name, value) {
  return () =>
    update(
      { panels: { ...state.panels, [name]: value ?? !state.panels[name] } },
      ['panels'],
    )
}

function onToolbarClick(event) {
  if (event.target.closest('.mm-search-toggle')) setSearchOpen(true)
  else if (event.target.closest('.mm-search-close')) {
    event.preventDefault()
    setSearchOpen(false)
  } else if (event.target.closest('.mm-more')) {
    moreMenu(event.target.closest('.mm-more'))
  }
}

// --- Drawers and sheets -------------------------------------------------------------------

// The scrim is the app's own ::after (CSS); a tap on it targets #app.
function onAppClick(event) {
  if (event.target !== event.currentTarget || !matches(NARROW)) return
  update({ panels: { ...state.panels, folders: false, inspector: false } }, [
    'panels',
  ])
}

// --- Detail: Info button and swipe -------------------------------------------------------------

function injectDetailInfo() {
  const bar = document.querySelector('#detail .detail__bar')
  if (!bar || bar.querySelector('.mm-detail-info')) return
  const more = bar.lastElementChild
  more.before(
    elementFromHtml(
      html`<button class="icon-btn mm-detail-info" title="Info" aria-label="Info">${icon('info-circle')}</button>`,
    ),
  )
}

function step(direction) {
  const items = collection()
  const index = items.findIndex((item) => item.id === state.focus)
  const next = items[index + direction]
  if (!next) return false
  update({ focus: next.id, anchor: next.id }, ['focus'])
  writeUrl()
  return true
}

function hasNeighbour(direction) {
  const items = collection()
  const index = items.findIndex((item) => item.id === state.focus)
  return Boolean(items[index + direction])
}

// Horizontal swipe on the stage: the picture follows the finger, then
// either slides out (→ next/previous) or snaps back.
function initSwipe() {
  const detail = document.getElementById('detail')
  let gesture = null

  detail.addEventListener('pointerdown', (event) => {
    const stage = event.target.closest('.stage')
    // A zoomed image pans instead (core detail.js).
    if (
      !stage ||
      !matches(NARROW) ||
      stage.classList.contains('is-zoomed') ||
      event.target.closest('button')
    ) {
      return
    }
    gesture = {
      x: event.clientX,
      y: event.clientY,
      time: performance.now(),
      dx: 0,
      slot: stage.querySelector('.stage__slot'),
      horizontal: null,
    }
    stage.setPointerCapture(event.pointerId)
  })

  detail.addEventListener('pointermove', (event) => {
    if (!gesture) return
    const dx = event.clientX - gesture.x
    const dy = event.clientY - gesture.y
    if (gesture.horizontal === null && Math.hypot(dx, dy) > 8) {
      gesture.horizontal = Math.abs(dx) > Math.abs(dy)
    }
    if (!gesture.horizontal) return
    // Resistance at the ends of the collection.
    const blocked = !hasNeighbour(dx < 0 ? 1 : -1)
    gesture.dx = blocked ? dx * 0.25 : dx
    gesture.slot.style.transition = 'none'
    gesture.slot.style.transform = `translateX(${gesture.dx}px)`
  })

  const finish = () => {
    if (!gesture) return
    const { slot, dx, time } = gesture
    gesture = null
    const velocity = Math.abs(dx) / Math.max(1, performance.now() - time)
    const direction = dx < 0 ? 1 : -1
    const commit =
      (Math.abs(dx) > 64 || velocity > 0.5) && hasNeighbour(direction)
    const animate = !prefersReducedMotion()
    slot.style.transition = animate
      ? 'transform var(--dur-3) var(--ease-out)'
      : 'none'
    if (!commit) {
      slot.style.transform = ''
      return
    }
    const width = slot.parentElement.clientWidth
    slot.style.transform = animate ? `translateX(${-direction * width}px)` : ''
    setTimeout(
      () => {
        step(direction)
        // The new item enters from the side the finger came from.
        slot.style.transition = 'none'
        slot.style.transform = animate
          ? `translateX(${direction * width * 0.35}px)`
          : ''
        requestAnimationFrame(() => {
          slot.style.transition = animate
            ? 'transform var(--dur-3) var(--ease-out)'
            : 'none'
          slot.style.transform = ''
        })
      },
      animate ? 160 : 0,
    )
  }
  detail.addEventListener('pointerup', finish)
  detail.addEventListener('pointercancel', finish)
}

// --- Wiring ------------------------------------------------------------------------------------

export function initPhone() {
  keepInjected(toolbar(), injectToolbarControls)
  toolbar().addEventListener('click', onToolbarClick)
  toolbar().addEventListener('focusout', (event) => {
    // Collapse an empty expanded search when focus leaves it.
    const search = toolbar().querySelector('[name="search"]')
    if (
      event.target === search &&
      !search.value &&
      !toolbar().contains(event.relatedTarget)
    ) {
      setSearchOpen(false)
    }
  })
  document.getElementById('app').addEventListener('click', onAppClick)
  document.getElementById('folders').addEventListener('click', (event) => {
    // Picking a folder in the drawer closes it, so the result is visible.
    if (
      event.target.closest('[data-folder], [data-mm-trash]') &&
      matches(NARROW)
    ) {
      togglePanel('folders', false)()
    }
  })
  keepInjected(document.getElementById('detail'), injectDetailInfo)
  document.getElementById('detail').addEventListener('click', (event) => {
    if (event.target.closest('.mm-detail-info')) togglePanel('inspector')()
  })
  initSwipe()
}
