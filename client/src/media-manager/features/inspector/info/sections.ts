// Which of the Info panel's collapsible sections are open (inspector.md §2:
// "state remembered for the session; Sizes starts collapsed"). One state for
// every item, kept in sessionStorage so a reload keeps it. When storage is
// unavailable (private mode, blocked, quota), the in-memory copy still holds
// it for this page.

import { useCallback, useSyncExternalStore } from 'react'

export const SECTION_IDS = ['file', 'camera', 'sizes'] as const
export type SectionId = (typeof SECTION_IDS)[number]
export type SectionState = Readonly<Record<SectionId, boolean>>

export const SECTION_DEFAULTS: SectionState = Object.freeze({
  file: true,
  camera: true,
  sizes: false,
})

export const SECTIONS_STORAGE_KEY = 'wpu-mm-inspector-sections'

/** The part of the Web Storage API the store uses. */
export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** A stored value over the defaults; anything malformed is ignored. */
export function parseSections(raw: string | null): SectionState {
  if (!raw) {
    return SECTION_DEFAULTS
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return SECTION_DEFAULTS
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return SECTION_DEFAULTS
  }
  const record = parsed as Record<string, unknown>
  const state = { ...SECTION_DEFAULTS }
  for (const id of SECTION_IDS) {
    if (typeof record[id] === 'boolean') {
      state[id] = record[id]
    }
  }
  return state
}

export interface SectionStore {
  get(): SectionState
  setOpen(id: SectionId, open: boolean): void
  subscribe(listener: () => void): () => void
  /** Tests: back to the defaults, storage included. */
  reset(): void
}

/**
 * The store over a storage that may be missing or throw on any call. The
 * in-memory state is authoritative once read; storage only carries it
 * across reloads.
 */
export function createSectionStore(
  getStorage: () => KeyValueStorage | null,
): SectionStore {
  let state: SectionState | null = null
  const listeners = new Set<() => void>()

  function storage(): KeyValueStorage | null {
    try {
      return getStorage()
    } catch {
      return null
    }
  }

  function load(): SectionState {
    try {
      return parseSections(storage()?.getItem(SECTIONS_STORAGE_KEY) ?? null)
    } catch {
      return SECTION_DEFAULTS
    }
  }

  function get(): SectionState {
    if (state === null) {
      state = load()
    }
    return state
  }

  function notify(): void {
    for (const listener of listeners) {
      listener()
    }
  }

  return {
    get,
    setOpen(id, open) {
      const current = get()
      if (current[id] === open) {
        return
      }
      state = { ...current, [id]: open }
      try {
        storage()?.setItem(SECTIONS_STORAGE_KEY, JSON.stringify(state))
      } catch {
        // Kept in memory for this page.
      }
      notify()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    reset() {
      state = null
      try {
        storage()?.removeItem(SECTIONS_STORAGE_KEY)
      } catch {
        // Nothing stored.
      }
      notify()
    },
  }
}

function browserSessionStorage(): KeyValueStorage | null {
  // Reading `window.sessionStorage` itself throws when storage is blocked.
  return typeof window === 'undefined' ? null : window.sessionStorage
}

export const sectionStore = createSectionStore(browserSessionStorage)

/** One section's open state, and its setter. */
export function useSectionOpen(
  id: SectionId,
  store: SectionStore = sectionStore,
): [boolean, (open: boolean) => void] {
  const open = useSyncExternalStore(
    store.subscribe,
    () => store.get()[id],
    () => store.get()[id],
  )
  const setOpen = useCallback(
    (next: boolean) => store.setOpen(id, next),
    [store, id],
  )
  return [open, setOpen]
}
