// A key log for checking the keyboard on a real device (mock build only):
// open the mock with `?mock-keylog` and a small panel in the bottom-right
// corner lists the last keydowns the page received, where they went, and
// whether the app handled them.
//
// It tells two iPad problems apart (mm/m2-keys): a key that never shows up
// here never reached the page (Safari kept it, because the web view wasn't
// the keyboard's first responder), while a key that shows up as "ignored"
// reached the page and the app's dispatcher passed on it.
//
// Plain DOM, outside React, like the rest of the mock's dev UI.

const PARAM = 'mock-keylog'
const PANEL_ID = 'wpu-mock-key-log'
const MAX_LINES = 8

/** A short name for where a key event went: tag, then role, label or id. */
function describeTarget(target: EventTarget | null): string {
  if (!(target instanceof Element)) {
    return String(target)
  }
  const tag = target.tagName.toLowerCase()
  const tile = target.getAttribute('data-mm-tile')
  if (tile !== null) {
    return `${tag} tile ${tile}`
  }
  const label = target.getAttribute('aria-label') ?? target.id
  return label ? `${tag} "${label}"` : tag
}

function createPanel(): HTMLElement {
  const panel = document.createElement('div')
  panel.id = PANEL_ID
  // The slice's axe checks skip the mock's own dev UI.
  panel.dataset.mockDevtools = ''
  panel.setAttribute('aria-hidden', 'true')
  Object.assign(panel.style, {
    position: 'fixed',
    right: '8px',
    bottom: '8px',
    zIndex: '2147483646',
    maxWidth: 'min(420px, calc(100vw - 16px))',
    padding: '6px 8px',
    borderRadius: '6px',
    font: '11px/1.4 ui-monospace, monospace',
    color: '#ffffff',
    background: 'rgba(17, 24, 39, 0.85)',
    pointerEvents: 'none',
    whiteSpace: 'pre',
  })
  panel.textContent = 'key log: no keys yet'
  document.body.append(panel)
  return panel
}

/** Installs the key log when the page was opened with `?mock-keylog`. */
export function installKeyLogIfRequested(): void {
  if (!new URLSearchParams(window.location.search).has(PARAM)) {
    return
  }
  const panel = createPanel()
  const lines: string[] = []
  window.addEventListener(
    'keydown',
    (event) => {
      const target = describeTarget(event.target)
      // Read the outcome once every listener (the app's dispatcher runs in
      // the window's bubble phase) has seen the event.
      window.setTimeout(() => {
        const outcome = event.defaultPrevented ? 'handled' : 'ignored'
        const focused = describeTarget(document.activeElement)
        lines.unshift(`${event.key} → ${target}: ${outcome} (focus ${focused})`)
        lines.length = Math.min(lines.length, MAX_LINES)
        panel.textContent = lines.join('\n')
      }, 0)
    },
    { capture: true },
  )
}
