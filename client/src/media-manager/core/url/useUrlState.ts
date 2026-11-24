// React binding of the URL store: `useUrlState()` re-renders on every URL
// change (navigate, Back/Forward), via useSyncExternalStore.

import { useCallback, useRef, useSyncExternalStore } from 'react'
import type { UrlState } from './codec'
import { browserUrlEnvironment, createUrlStore, type UrlStore } from './history'

let store: UrlStore | null = null

/** The app's one URL store, created on first use. */
export function urlStore(): UrlStore {
  if (store === null) {
    store = createUrlStore(browserUrlEnvironment())
  }
  return store
}

/** Tests and spikes only: swap in a store over a fake environment. */
export function setUrlStoreForTesting(next: UrlStore | null): void {
  store = next
}

/** The whole URL state. */
export function useUrlState(): UrlState
/** A slice of the URL state; re-renders only when the slice changes (`Object.is`). */
export function useUrlState<T>(selector: (state: UrlState) => T): T
export function useUrlState<T>(
  selector?: (state: UrlState) => T,
): T | UrlState {
  const current = urlStore()
  const selectorRef = useRef(selector)
  selectorRef.current = selector
  const getSnapshot = useCallback(() => {
    const state = current.get()
    return selectorRef.current ? selectorRef.current(state) : state
  }, [current])
  return useSyncExternalStore(current.subscribe, getSnapshot, getSnapshot)
}
