// Spike C4 instrumentation: a timestamped log the Playwright runner reads
// (window.__log), plus helpers that name elements and the listener an event
// is currently being handled by.

import type { FocusContext, KeyDecision } from '../../../core/keymap'

export interface LogEntry {
  /** performance.now() */
  t: number
  /** key | cap | decide | close | cmd | dom | confirm | layer */
  src: string
  msg: string
}

declare global {
  interface Window {
    __log: LogEntry[]
  }
}

window.__log = []

export function log(src: string, msg: string): void {
  window.__log.push({ t: Math.round(performance.now() * 10) / 10, src, msg })
}

/** `button#menu-btn`, `[menu-item-1]`, `body`, … */
export function describeNode(node: EventTarget | null | undefined): string {
  if (!node) {
    return 'null'
  }
  if (node === window) {
    return 'window'
  }
  if (node === document) {
    return 'document'
  }
  if (!(node instanceof Element)) {
    return String(node)
  }
  // data-c4 first: Mantine's Menu/Popover targets replace the child's id.
  const tag = node.tagName.toLowerCase()
  const marker = node.getAttribute('data-c4')
  if (marker) {
    return `${tag}#${marker}`
  }
  if (node.id) {
    return `${tag}#${node.id}`
  }
  const role = node.getAttribute('role')
  return role ? `${tag}[role=${role}]` : tag
}

const PHASES = ['none', 'capture', 'target', 'bubble']

/**
 * Which listener is running right now: `capture@window`, `bubble@div#root`
 * (React's root listener), … Read from window.event, which all three engines
 * still set while a listener runs.
 */
export function currentListener(): string {
  const event = window.event
  if (!event) {
    return 'no-event'
  }
  return `${event.type}:${PHASES[event.eventPhase]}@${describeNode(event.currentTarget)}`
}

export function describeContext(context: FocusContext): string {
  const flags = Object.entries(context)
    .filter(([, on]) => on)
    .map(([flag]) => flag)
  return flags.length > 0 ? flags.join('+') : '-'
}

export function describeDecision(decision: KeyDecision): string {
  switch (decision.kind) {
    case 'ignore':
      return `ignore(${decision.why})`
    case 'blur':
      return 'blur'
    case 'layer':
      return `layer(${decision.layer.name})`
    case 'run':
      return `run(${decision.binding.command})`
    case 'unavailable':
      return `unavailable(${decision.binding.command})`
  }
}

/** Returns a callback that logs who closed what, and from which listener. */
export function traceClose(name: string): () => void {
  return () => log('close', `${name} via ${currentListener()}`)
}

function countShown(selector: string): number {
  let count = 0
  for (const element of document.querySelectorAll(selector)) {
    if (element.getClientRects().length > 0) {
      count += 1
    }
  }
  return count
}

export const OVERLAY_SELECTORS = {
  menu: '[role="menu"]',
  listbox: '[role="listbox"]',
  modal: '[aria-modal="true"]',
  popover: '[data-c4-popover]',
} as const

export type OverlayCounts = Record<keyof typeof OVERLAY_SELECTORS, number>

export function overlayCounts(): OverlayCounts {
  return {
    menu: countShown(OVERLAY_SELECTORS.menu),
    listbox: countShown(OVERLAY_SELECTORS.listbox),
    modal: countShown(OVERLAY_SELECTORS.modal),
    popover: countShown(OVERLAY_SELECTORS.popover),
  }
}

/**
 * Logs when menus, listboxes, modals and popovers appear or leave the DOM
 * (end of the exit transition), so the runner can time them.
 */
export function watchOverlays(): void {
  let previous = JSON.stringify(overlayCounts())
  const observer = new MutationObserver(() => {
    const next = JSON.stringify(overlayCounts())
    if (next !== previous) {
      previous = next
      log('dom', next)
    }
  })
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['style', 'aria-expanded', 'data-expanded'],
  })
}
