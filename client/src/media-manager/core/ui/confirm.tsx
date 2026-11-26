// confirm(): one shared confirm dialog with rich content (system.md §9
// request 6). The body is any ReactNode (thumbnails, where-used lists), and
// `typeToConfirm` makes the user type a word or number before the confirm
// button enables (e.g. the item count when deleting 25 or more).
//
//     if (await confirm({ title: 'Delete 30 items?', body: <List/>,
//         confirmLabel: 'Delete', tone: 'danger', typeToConfirm: '30' })) { … }
//
// <ConfirmHost/> renders it; the app mounts it once. Requests made while one
// is open wait their turn. When the last one closes, focus goes back to the
// element that was focused when confirm() was called (spike C4: the host
// unmounts the Modal at once, so Mantine's own returnFocus never runs). For
// a chain of queued requests, that is the element focused when the first
// one was asked.

import { lazy, type ReactNode, Suspense, useSyncExternalStore } from 'react'

// The dialog (Mantine's Modal, which brings ScrollArea, focus trap and
// scroll lock) is a lazy chunk: most sessions never confirm anything, and the
// initial chunk has a budget (D31).
const ConfirmDialog = lazy(() => import('./ConfirmDialog'))

export interface ConfirmOptions {
  title: ReactNode
  body?: ReactNode
  /** Default "Confirm". */
  confirmLabel?: string
  /** Default "Cancel". */
  cancelLabel?: string
  /** `danger` paints the confirm button red and focuses Cancel first. */
  tone?: 'default' | 'danger'
  /** The exact text the user must type before confirming. */
  typeToConfirm?: string
  /** The prompt above the field. Default: `Type <text> to confirm`. */
  typeToConfirmLabel?: ReactNode
}

/** Something focus can go back to. */
interface Focusable {
  focus(): void
  readonly isConnected: boolean
}

/** The focus operations confirm() needs; tests pass a fake. */
export interface ConfirmFocusEnvironment {
  /** The focused element, or null when nothing (or the page body) is. */
  focused(): Focusable | null
  /** Runs after the dialog has unmounted (the next frame). */
  afterUnmount(run: () => void): void
}

const browserFocus: ConfirmFocusEnvironment = {
  focused() {
    const active = document.activeElement
    if (!(active instanceof HTMLElement) || active === document.body) {
      return null
    }
    return active
  },
  afterUnmount(run) {
    requestAnimationFrame(run)
  },
}

let focusEnvironment = browserFocus

export function setConfirmFocusEnvironmentForTesting(
  env: ConfirmFocusEnvironment | null,
): void {
  focusEnvironment = env ?? browserFocus
}

export interface ConfirmRequest {
  id: number
  options: ConfirmOptions
  resolve: (confirmed: boolean) => void
  /**
   * Where focus goes back to: what was focused when confirm() was called, or
   * for a request queued behind an open one, that chain's first opener (what
   * is focused then is usually inside the open dialog, gone by the end).
   */
  opener: Focusable | null
}

let queue: readonly ConfirmRequest[] = []
let nextId = 1
const listeners = new Set<() => void>()

function setQueue(next: readonly ConfirmRequest[]): void {
  queue = next
  for (const listener of listeners) {
    listener()
  }
}

export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const opener =
      queue.length === 0
        ? focusEnvironment.focused()
        : (queue[0]?.opener ?? null)
    setQueue([...queue, { id: nextId++, options, resolve, opener }])
  })
}

/** Answers a request (the dialog's buttons). */
export function settleConfirm(id: number, confirmed: boolean): void {
  const request = queue.find((entry) => entry.id === id)
  if (!request) {
    return
  }
  setQueue(queue.filter((entry) => entry.id !== id))
  request.resolve(confirmed)
  if (queue.length === 0) {
    restoreFocus(request.opener)
  }
}

// Back to the opener, unless something else took focus meanwhile (e.g.
// the confirmed action moved it on purpose).
function restoreFocus(opener: Focusable | null): void {
  if (opener === null) {
    return
  }
  const env = focusEnvironment
  env.afterUnmount(() => {
    if (env.focused() === null && opener.isConnected) {
      opener.focus()
    }
  })
}

/** Tests: answers the open request as if the user clicked a button. */
export function answerPendingConfirm(confirmed: boolean): void {
  const current = queue[0]
  if (current) {
    settleConfirm(current.id, confirmed)
  }
}

/** Tests: the open request's options, if any. */
export function pendingConfirm(): ConfirmOptions | null {
  return queue[0]?.options ?? null
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Renders the open confirm request. Mount once. */
export function ConfirmHost() {
  const current = useSyncExternalStore(
    subscribe,
    () => queue[0] ?? null,
    () => null,
  )
  if (!current) {
    return null
  }
  return (
    <Suspense fallback={null}>
      <ConfirmDialog key={current.id} request={current} />
    </Suspense>
  )
}
