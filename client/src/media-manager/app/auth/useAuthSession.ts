// The auth state machine, extracted from legacy/UploaderApp.tsx (copied, not
// moved: the old page keeps its own until it is removed in M5, D1c).
//
// checking → anonymous | authenticated | unreachable. While authenticated, a
// 401 from any API call (apiFetch's listener) or a failed re-check when the
// tab becomes visible marks the session as lost: the app stays mounted and a
// dialog asks to log in again, so nothing in progress is lost.
//
// The data layer's session gate (core/data/session.ts) holds library requests
// while the session is lost. It is restored on every successful login and
// whenever auth becomes authenticated, so a gate left `lost` by 401s that
// arrived around a logout can't make the next session's requests wait
// forever. A successful logout abandons it (waiting requests fail) and calls
// `onLoggedOut`, where AuthGate drops the library data (clearLibraryData), so
// the next user never sees the previous one's cache.

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchSession,
  logout as logoutRequest,
  type Session,
  setUnauthorizedListener,
} from '../../../lib/api'
import { sessionGate } from '../../core/data/session'

export type AuthState =
  | { status: 'checking' }
  | { status: 'unreachable' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; session: Session }

export interface AuthSession {
  auth: AuthState
  /** The session ran out while the app was open. */
  sessionLost: boolean
  /** The last logout wasn't confirmed by the server (still logged in). */
  logoutFailed: boolean
  /** Checks the session again (the "Try again" of the unreachable state). */
  recheck(): void
  /** After a successful login (screen or session-expired dialog). */
  loggedIn(session: Session): void
  logout(): void
  dismissLogoutFailed(): void
}

export interface AuthSessionOptions {
  /** After a confirmed logout, e.g. to drop the library data. */
  onLoggedOut?: () => void
}

export function useAuthSession(options: AuthSessionOptions = {}): AuthSession {
  const onLoggedOutRef = useRef(options.onLoggedOut)
  onLoggedOutRef.current = options.onLoggedOut
  const [auth, setAuth] = useState<AuthState>({ status: 'checking' })
  const [sessionLost, setSessionLost] = useState(false)
  const [logoutFailed, setLogoutFailed] = useState(false)

  const recheck = useCallback(() => {
    setAuth({ status: 'checking' })
    fetchSession()
      .then((session) =>
        setAuth(
          session
            ? { status: 'authenticated', session }
            : { status: 'anonymous' },
        ),
      )
      .catch(() => setAuth({ status: 'unreachable' }))
  }, [])

  useEffect(() => {
    recheck()
  }, [recheck])

  const isAuthenticated = auth.status === 'authenticated'

  useEffect(() => {
    if (!isAuthenticated) {
      return
    }
    // Also covers a session found by a re-check, not only a typed login.
    sessionGate.restore()
    setUnauthorizedListener(() => setSessionLost(true))
    return () => setUnauthorizedListener(null)
  }, [isAuthenticated])

  // Tablets often bring a tab back from memory without reloading it. Checking
  // when the tab becomes visible renews the session (the server re-issues
  // the cookie at most once a day) and spots one that ran out meanwhile.
  useEffect(() => {
    if (!isAuthenticated) {
      return
    }
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        return
      }
      fetchSession()
        .then((session) => {
          if (!session) {
            setSessionLost(true)
          }
        })
        .catch(() => {
          // Offline for now; the next API call or visit tries again.
        })
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () =>
      document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [isAuthenticated])

  const loggedIn = useCallback((session: Session) => {
    // Release the requests held while the session was lost (re-login in the
    // session-expired dialog keeps auth authenticated, so the effect above
    // doesn't run again).
    sessionGate.restore()
    setSessionLost(false)
    setAuth({ status: 'authenticated', session })
  }, [])

  const logout = useCallback(() => {
    setLogoutFailed(false)
    logoutRequest()
      .then(() => {
        sessionGate.abandon()
        onLoggedOutRef.current?.()
        setSessionLost(false)
        setAuth({ status: 'anonymous' })
      })
      .catch(() => setLogoutFailed(true))
  }, [])

  const dismissLogoutFailed = useCallback(() => setLogoutFailed(false), [])

  return {
    auth,
    sessionLost,
    logoutFailed,
    recheck,
    loggedIn,
    logout,
    dismissLogoutFailed,
  }
}
