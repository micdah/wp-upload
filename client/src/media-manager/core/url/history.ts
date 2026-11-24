// The URL store and its history policy (interaction-spec §1, D16).
//
// - Entering detail mode (no `item` -> an `item`) pushes a history entry.
// - Everything else replaces the current entry: stepping between items,
//   filter and sort changes, and folder changes (D16).
// - Leaving detail calls `history.back()` when we pushed the detail entry, so
//   Back never lands on a detail entry the user already left. (The prototype
//   replaced instead, which left a duplicate grid entry behind.) If the grid
//   state changed while in detail, the entry we land on is then replaced with
//   the new state.
//
// The store is environment-agnostic (history, location and popstate are
// injected), so the policy is unit-tested without a browser.

import {
  normaliseQuery,
  parseUrlState,
  serializeUrlState,
  type UrlState,
} from './codec'

export interface HistoryLike {
  readonly state: unknown
  pushState(data: unknown, unused: string, url: string): void
  replaceState(data: unknown, unused: string, url: string): void
  back(): void
}

export interface LocationLike {
  readonly pathname: string
  readonly search: string
  readonly hash: string
}

export interface UrlEnvironment {
  history: HistoryLike
  location: LocationLike
  /** Subscribes to popstate; returns an unsubscribe function. */
  onPopState(listener: () => void): () => void
}

export type UrlPatch = Partial<Omit<UrlState, 'view'>>

export interface NavigateOptions {
  /** Replace even when entering detail (e.g. a deep link being normalised). */
  replace?: boolean
}

export interface UrlStore {
  get(): UrlState
  subscribe(listener: () => void): () => void
  navigate(
    patch: UrlPatch | ((current: UrlState) => UrlPatch),
    options?: NavigateOptions,
  ): void
  /** Enters detail mode on `id` (pushes), or steps to it (replaces). */
  openItem(id: number): void
  /** Leaves detail mode (history.back() when we pushed the entry). */
  closeItem(): void
  /** The current entry is a detail entry this app pushed. */
  isPushedDetail(): boolean
}

/** Our marker inside `history.state`; other keys there are preserved. */
const MARKER_KEY = 'wpuMediaManager'

/**
 * Identifies this page load. `history.state` survives a reload, but the
 * grid entry beneath a detail entry pushed before the reload belongs to
 * another document: going back to it would be a full page load. So the
 * marker records the document that pushed it, and only that document goes
 * back (any other replaces, like a deep link).
 */
const DOCUMENT_ID = Math.random().toString(36).slice(2)

interface DetailMarker {
  /** The search string of the grid entry beneath the pushed detail entry. */
  base: string
  /** The page load that pushed the detail entry (DOCUMENT_ID). */
  doc: string
}

/** Our marker, if `state` holds one this document pushed. */
function readMarker(state: unknown, documentId: string): DetailMarker | null {
  if (typeof state !== 'object' || state === null) {
    return null
  }
  const marker = (state as Record<string, unknown>)[MARKER_KEY]
  if (typeof marker !== 'object' || marker === null) {
    return null
  }
  const { base, doc } = marker as Record<string, unknown>
  if (typeof base !== 'string' || doc !== documentId) {
    return null
  }
  return { base, doc }
}

function withMarker(state: unknown, marker: DetailMarker | null): unknown {
  const rest =
    typeof state === 'object' && state !== null
      ? { ...(state as Record<string, unknown>) }
      : {}
  delete rest[MARKER_KEY]
  if (marker === null) {
    return Object.keys(rest).length === 0 ? null : rest
  }
  return { ...rest, [MARKER_KEY]: marker }
}

export interface UrlStoreOptions {
  /** Tests only: the page load's id (a different one simulates a reload). */
  documentId?: string
}

export function createUrlStore(
  env: UrlEnvironment,
  options: UrlStoreOptions = {},
): UrlStore {
  const documentId = options.documentId ?? DOCUMENT_ID
  const listeners = new Set<() => void>()
  let cachedSearch: string | null = null
  let cachedState: UrlState | null = null

  // While a history.back() we started is in flight: the state the UI should
  // already show, the search to put on the entry we land on (if it differs
  // from that entry's), and navigations that arrived in the meantime.
  let pending: {
    state: UrlState
    replaceWith: string | null
    queue: (() => void)[]
  } | null = null

  function emit(): void {
    for (const listener of listeners) {
      listener()
    }
  }

  function readLocation(): UrlState {
    const search = env.location.search
    if (search !== cachedSearch || cachedState === null) {
      cachedSearch = search
      cachedState = parseUrlState(search)
    }
    return cachedState
  }

  function get(): UrlState {
    return pending ? pending.state : readLocation()
  }

  function urlFor(search: string): string {
    return `${env.location.pathname}${search}${env.location.hash}`
  }

  function write(mode: 'push' | 'replace', search: string, data: unknown) {
    if (mode === 'push') {
      env.history.pushState(data, '', urlFor(search))
    } else {
      env.history.replaceState(data, '', urlFor(search))
    }
  }

  function leaveDetail(next: UrlState): void {
    const target = serializeUrlState(next, env.location.search)
    const marker = readMarker(env.history.state, documentId)
    if (marker === null) {
      // Deep link, an entry we didn't push, or one pushed before a reload:
      // nothing in this document to go back to.
      write('replace', target, withMarker(env.history.state, null))
      emit()
      return
    }
    pending = {
      state: parseUrlState(target),
      replaceWith: target === marker.base ? null : target,
      queue: [],
    }
    env.history.back()
    emit()
  }

  function finishPending(): void {
    if (pending === null) {
      return
    }
    const { replaceWith, queue } = pending
    pending = null
    if (replaceWith !== null && env.location.search !== replaceWith) {
      write('replace', replaceWith, withMarker(env.history.state, null))
    }
    for (const run of queue) {
      run()
    }
  }

  function navigate(
    patch: UrlPatch | ((current: UrlState) => UrlPatch),
    options: NavigateOptions = {},
  ): void {
    if (pending !== null) {
      // Show the result at once; it is written once Back has landed. The
      // patch is resolved now, so a function patch applies exactly once.
      const resolved =
        typeof patch === 'function' ? patch(pending.state) : patch
      pending.queue.push(() => navigate(resolved, options))
      pending.state = { ...pending.state, ...resolved }
      emit()
      return
    }
    const current = readLocation()
    const resolved = typeof patch === 'function' ? patch(current) : patch
    const next: UrlState = { ...current, ...resolved }
    if ('q' in resolved) {
      next.q = normaliseQuery(next.q)
    }
    const search = serializeUrlState(next, env.location.search)
    if (search === env.location.search) {
      return
    }
    const entering = current.item === null && next.item !== null
    const leaving = current.item !== null && next.item === null
    if (entering && !options.replace) {
      write(
        'push',
        search,
        withMarker(null, { base: env.location.search, doc: documentId }),
      )
    } else if (leaving) {
      leaveDetail(next)
      return
    } else {
      write('replace', search, env.history.state)
    }
    emit()
  }

  env.onPopState(() => {
    finishPending()
    emit()
  })

  return {
    get,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    navigate,
    openItem(id) {
      navigate({ item: id })
    },
    closeItem() {
      navigate({ item: null })
    },
    isPushedDetail() {
      return readMarker(env.history.state, documentId) !== null
    },
  }
}

/** The browser environment: `window.history`, `window.location`, popstate. */
export function browserUrlEnvironment(): UrlEnvironment {
  return {
    history: window.history,
    location: window.location,
    onPopState(listener) {
      window.addEventListener('popstate', listener)
      return () => window.removeEventListener('popstate', listener)
    },
  }
}
