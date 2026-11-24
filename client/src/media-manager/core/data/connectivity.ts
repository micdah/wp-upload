// What the data layer knows about reaching WordPress, for the offline banner
// (system.md "offline") and the "WordPress rejected the app password" state.
//
// Every library request reports its outcome here (http.ts). A connectivity
// error turns the state `offline` at once. Only a *probe* (rev, bootstrap) or
// a mutation that went through turns it `online` again, because a read may
// have been answered from the server's cache while WordPress is still down.
// The rev poller backs off 15 → 30 → 60 s while offline (rev.ts).
//
// The core store (F1) may mirror this into its own `connectivity` slice;
// this module stays the source the data layer itself reads.

import { useSyncExternalStore } from 'react'
import type { LibraryError } from './errors'

export type ConnectivityState = 'online' | 'offline' | 'wp-auth-failed'

export interface ConnectivitySnapshot {
  state: ConnectivityState
  /** consecutive failed probes; 0 while online */
  failures: number
  /** the error that made us leave `online`, if any */
  lastError: LibraryError | null
  /** when the rev poller tries next while not online (ms since epoch) */
  nextRetryAt: number | null
}

/** Back-off of the rev poll while offline (system.md: 15 → 30 → 60 s). */
export const OFFLINE_BACKOFF_MS = [15_000, 30_000, 60_000] as const
/** Rev poll interval while online (server-api.md §7.2). */
export const REV_POLL_MS = 15_000

export function backoffDelay(failures: number): number {
  if (failures <= 0) {
    return REV_POLL_MS
  }
  const step = Math.min(failures, OFFLINE_BACKOFF_MS.length) - 1
  return OFFLINE_BACKOFF_MS[step] ?? REV_POLL_MS
}

const ONLINE: ConnectivitySnapshot = {
  state: 'online',
  failures: 0,
  lastError: null,
  nextRetryAt: null,
}

export interface ConnectivityStore {
  getSnapshot(): ConnectivitySnapshot
  subscribe(listener: () => void): () => void
  /** A request reached WordPress. `probe`: it proves WordPress is back. */
  reportSuccess(probe: boolean): void
  /** A request failed with a connectivity or wp-auth error. */
  reportFailure(error: LibraryError, probe: boolean, now?: number): void
  reset(): void
}

export function createConnectivityStore(): ConnectivityStore {
  let snapshot = ONLINE
  const listeners = new Set<() => void>()

  function set(next: ConnectivitySnapshot): void {
    if (next === snapshot) {
      return
    }
    snapshot = next
    for (const listener of listeners) {
      listener()
    }
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    reportSuccess(probe) {
      if (snapshot.state !== 'online' && probe) {
        set(ONLINE)
      }
    },
    reportFailure(error, probe, now = Date.now()) {
      const state: ConnectivityState =
        error.kind === 'wp-auth' ? 'wp-auth-failed' : 'offline'
      // Only probes count towards the back-off, so a burst of failing reads
      // doesn't jump straight to 60 s.
      const failures = probe ? snapshot.failures + 1 : snapshot.failures || 1
      set({
        state,
        failures,
        lastError: error,
        nextRetryAt: now + backoffDelay(failures),
      })
    },
    reset() {
      set(ONLINE)
    },
  }
}

export const connectivityStore: ConnectivityStore = createConnectivityStore()

/** The current connectivity, re-rendering on change. */
export function useConnectivity(
  store: ConnectivityStore = connectivityStore,
): ConnectivitySnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
