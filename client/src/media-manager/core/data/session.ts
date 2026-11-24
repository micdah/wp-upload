// Pause and resume of library requests around a lost session.
//
// When any `api/library/*` call answers 401, the session cookie is gone.
// `apiFetch` already tells the app (its single unauthorized listener shows the
// session-expired dialog); this gate additionally holds every library
// request, the failed one included, until the user has logged in again.
// Then they all continue as if nothing happened: autosaves, polls and chunk
// loads replay instead of failing. A 401 comes from `requireSession`, before
// any route runs, so replaying a mutation is safe.
//
// Wiring (the auth flow in app/auth/useAuthSession.ts):
// - after every successful login, and whenever auth becomes authenticated:
//   `sessionGate.restore()`;
// - on logout, or when the user gives up: `sessionGate.abandon()`, which
//   fails the waiting requests with `session_lost`.
//
// Epochs: `restore()` and `abandon()` each start a new session epoch. A
// request records the epoch it was sent in; a 401 from an older epoch was
// answered for a session that has since been replaced, so it is retried
// without marking the new session lost (http.ts).

import { useSyncExternalStore } from 'react'
import { CLIENT_ERROR_CODES, LibraryError } from './errors'

export type SessionGateState = 'active' | 'lost'

interface Waiter {
  resolve: () => void
  reject: (reason: unknown) => void
}

export interface SessionGate {
  readonly state: SessionGateState
  /** Bumped by every restore() and abandon(): one per session attempt. */
  readonly epoch: number
  /** Called by http.ts on a 401. Idempotent. */
  markLost(): void
  /** The user logged in again: release every waiting request. */
  restore(): void
  /** The user logged out: fail every waiting request with `session_lost`. */
  abandon(): void
  /** Resolves at once while active; otherwise when restored. */
  waitUntilRestored(signal?: AbortSignal): Promise<void>
  /** For useSyncExternalStore. */
  subscribe(listener: () => void): () => void
  getSnapshot(): SessionGateState
}

export function createSessionGate(): SessionGate {
  let state: SessionGateState = 'active'
  let epoch = 0
  const waiters = new Set<Waiter>()
  const listeners = new Set<() => void>()

  function setState(next: SessionGateState): void {
    if (state === next) {
      return
    }
    state = next
    for (const listener of listeners) {
      listener()
    }
  }

  function settleWaiters(settle: (waiter: Waiter) => void): void {
    const pending = [...waiters]
    waiters.clear()
    for (const waiter of pending) {
      settle(waiter)
    }
  }

  return {
    get state() {
      return state
    },
    get epoch() {
      return epoch
    },
    markLost() {
      setState('lost')
    },
    restore() {
      epoch += 1
      setState('active')
      settleWaiters((waiter) => waiter.resolve())
    },
    abandon() {
      epoch += 1
      setState('active')
      const error = new LibraryError(401, {
        code: CLIENT_ERROR_CODES.sessionLost,
        message: 'You were logged out.',
      })
      settleWaiters((waiter) => waiter.reject(error))
    },
    waitUntilRestored(signal) {
      if (state === 'active') {
        return Promise.resolve()
      }
      return new Promise<void>((resolve, reject) => {
        const waiter: Waiter = {
          resolve: () => {
            signal?.removeEventListener('abort', onAbort)
            resolve()
          },
          reject: (reason) => {
            signal?.removeEventListener('abort', onAbort)
            reject(reason)
          },
        }
        function onAbort(): void {
          waiters.delete(waiter)
          reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'))
        }
        if (signal?.aborted) {
          onAbort()
          return
        }
        signal?.addEventListener('abort', onAbort, { once: true })
        waiters.add(waiter)
      })
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot() {
      return state
    },
  }
}

/** The app-wide gate every library request goes through. */
export const sessionGate: SessionGate = createSessionGate()

/** `lost` while library requests wait for a re-login. */
export function useSessionGate(
  gate: SessionGate = sessionGate,
): SessionGateState {
  return useSyncExternalStore(gate.subscribe, gate.getSnapshot)
}
