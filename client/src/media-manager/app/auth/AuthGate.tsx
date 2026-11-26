// Login, session-expired and logout UI in the media manager's theme (plan
// §4: F1 owns these; logout must not depend on the old Uploader).

import { useQueryClient } from '@tanstack/react-query'
import {
  createContext,
  lazy,
  type ReactNode,
  Suspense,
  useContext,
  useEffect,
  useState,
} from 'react'
import type { Session } from '../../../lib/api'
import { implementCommand } from '../../core/commands/registry'
import { clearLibraryData } from '../../core/data/client'
import { resetSession } from '../../core/state'
import { LoadingHairline } from '../screens/StateScreen'
import { ServerUnreachableScreen } from '../screens/screens'
import { useAuthSession } from './useAuthSession'

// The login form and the session dialogs (Mantine's Modal, PasswordInput,
// Alert) are lazy chunks: a working session never needs them up front, and
// the initial chunk has a budget (D31).
const LoginScreen = lazy(() => import('./LoginScreen'))
const loadSessionDialogs = () => import('./SessionDialogs')
const SessionDialogs = lazy(loadSessionDialogs)

/**
 * Fetches the session dialogs' chunk when the browser has a moment, so the
 * session-expired dialog doesn't depend on the network when it is needed.
 */
function usePrefetchSessionDialogs(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) {
      return
    }
    const idle = window.requestIdleCallback ?? ((run) => setTimeout(run, 1000))
    const handle = idle(() => {
      void loadSessionDialogs()
    })
    return () => {
      if (window.cancelIdleCallback && typeof handle === 'number') {
        window.cancelIdleCallback(handle)
      }
    }
  }, [enabled])
}

export interface AuthContextValue {
  session: Session
  logout(): void
}

const AuthContext = createContext<AuthContextValue | null>(null)

/** The logged-in session and logout; null outside the gate (e.g. in tests). */
export function useAuth(): AuthContextValue | null {
  return useContext(AuthContext)
}

export function AuthGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  // A logout drops the library data and every session-scoped state
  // (selection, feature drafts), so the next login never sees the previous
  // user's (M2 glue 4).
  const auth = useAuthSession({
    onLoggedOut: () => {
      resetSession()
      clearLibraryData(queryClient)
    },
  })
  const authenticated = auth.auth.status === 'authenticated'
  const { logout } = auth
  // Mounted from the first time a dialog opens, so Mantine can animate it
  // closed again.
  const dialogsWanted = auth.sessionLost || auth.logoutFailed
  const [dialogsMounted, setDialogsMounted] = useState(false)
  if (dialogsWanted && !dialogsMounted) {
    setDialogsMounted(true)
  }
  usePrefetchSessionDialogs(authenticated)

  useEffect(() => {
    if (!authenticated) {
      return
    }
    return implementCommand('session.logout', { run: logout })
  }, [authenticated, logout])

  if (auth.auth.status === 'checking') {
    return <LoadingHairline label='Checking your session' />
  }
  if (auth.auth.status === 'unreachable') {
    return <ServerUnreachableScreen onRetry={auth.recheck} />
  }
  if (auth.auth.status === 'anonymous') {
    return (
      <Suspense fallback={<LoadingHairline label='Loading' />}>
        <LoginScreen onLoggedIn={auth.loggedIn} />
      </Suspense>
    )
  }

  return (
    <AuthContext.Provider value={{ session: auth.auth.session, logout }}>
      {children}
      {dialogsMounted && (
        <Suspense fallback={null}>
          <SessionDialogs
            sessionLost={auth.sessionLost}
            logoutFailed={auth.logoutFailed}
            onLoggedIn={auth.loggedIn}
            onDismissLogoutFailed={auth.dismissLogoutFailed}
          />
        </Suspense>
      )}
    </AuthContext.Provider>
  )
}
