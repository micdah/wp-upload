// Login, session-expired and logout UI in the media manager's theme (plan
// §4: F1 owns these; logout must not depend on the old Uploader).

import { Modal, Text } from '@mantine/core'
import { useQueryClient } from '@tanstack/react-query'
import { createContext, type ReactNode, useContext, useEffect } from 'react'
import type { Session } from '../../../lib/api'
import { implementCommand } from '../../core/commands/registry'
import { clearLibraryData } from '../../core/data/client'
import { resetSession } from '../../core/state'
import { LoadingHairline } from '../screens/StateScreen'
import { LoginScreen, ServerUnreachableScreen } from '../screens/screens'
import { LoginForm } from './LoginForm'
import { useAuthSession } from './useAuthSession'

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
    return <LoginScreen onLoggedIn={auth.loggedIn} />
  }

  return (
    <AuthContext.Provider value={{ session: auth.auth.session, logout }}>
      {children}
      {/* The session ran out while the app was open: log in again here,
          keeping the app (and anything half-done) mounted underneath. */}
      <Modal
        opened={auth.sessionLost}
        onClose={() => {}}
        withCloseButton={false}
        closeOnClickOutside={false}
        closeOnEscape={false}
        title='Your session has expired'
        centered
        data-mm-session-expired=''
      >
        <Text size='sm' mb='md'>
          Log in again to continue where you left off.
        </Text>
        <LoginForm onLoggedIn={auth.loggedIn} />
      </Modal>
      <Modal
        opened={auth.logoutFailed}
        onClose={auth.dismissLogoutFailed}
        title='Logging out failed'
        centered
      >
        <Text size='sm'>
          The server did not confirm the logout, so you are still logged in. Try
          again once the connection is back.
        </Text>
      </Modal>
    </AuthContext.Provider>
  )
}
