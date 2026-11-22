import {
  Alert,
  Button,
  Center,
  Container,
  Loader,
  Modal,
  Paper,
  Stack,
} from '@mantine/core'
import { useCallback, useEffect, useState } from 'react'
import { AppHeader } from '../components/AppHeader'
import { LoginForm } from '../components/LoginForm'
import { Uploader } from '../components/Uploader'
import {
  fetchSession,
  logout,
  type Session,
  setUnauthorizedListener,
} from '../lib/api'

type AuthState =
  | { status: 'checking' }
  | { status: 'unreachable' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; session: Session }

// Decides between the login page and the app. The page shell is public; the
// server only guards the API, answering 401 (never a browser auth prompt)
// when the session cookie is missing or no longer valid.
export default function UploaderApp() {
  const [auth, setAuth] = useState<AuthState>({ status: 'checking' })
  // The session ran out while the app was open: log in again in a dialog,
  // keeping the upload queue mounted underneath rather than losing it.
  const [sessionLost, setSessionLost] = useState(false)
  const [logoutFailed, setLogoutFailed] = useState(false)

  const checkSession = useCallback(() => {
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
    checkSession()
  }, [checkSession])

  const isAuthenticated = auth.status === 'authenticated'
  useEffect(() => {
    if (!isAuthenticated) return
    setUnauthorizedListener(() => setSessionLost(true))
    return () => setUnauthorizedListener(null)
  }, [isAuthenticated])

  // Tablets often bring a tab back from memory without reloading it, so the
  // load-time check alone wouldn't renew the session of a device that keeps
  // the app open. Checking whenever the tab becomes visible renews it (the
  // server re-issues the cookie at most once a day) and spots a session that
  // ran out in the meantime.
  useEffect(() => {
    if (!isAuthenticated) return
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return
      fetchSession()
        .then((session) => {
          if (!session) setSessionLost(true)
        })
        .catch(() => {
          // Offline for now - the next API call or visit tries again.
        })
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () =>
      document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [isAuthenticated])

  const handleLoggedIn = (session: Session) => {
    setSessionLost(false)
    setAuth({ status: 'authenticated', session })
  }

  const handleLogout = () => {
    setLogoutFailed(false)
    logout()
      .then(() => {
        setSessionLost(false)
        setAuth({ status: 'anonymous' })
      })
      .catch(() => setLogoutFailed(true))
  }

  if (auth.status === 'authenticated') {
    return (
      <>
        <Uploader onLogout={handleLogout} />
        <Modal
          opened={sessionLost}
          onClose={() => {}}
          withCloseButton={false}
          closeOnClickOutside={false}
          closeOnEscape={false}
          title='Your session has expired. Log in again to continue.'
          centered
        >
          <LoginForm onLoggedIn={handleLoggedIn} />
        </Modal>
        <Modal
          opened={logoutFailed}
          onClose={() => setLogoutFailed(false)}
          title='Logging out failed'
          centered
        >
          The server did not confirm the logout, so you are still logged in. Try
          again once the connection is back.
        </Modal>
      </>
    )
  }

  return (
    <Container size='xs' pt='xl' pb='xl'>
      <Stack gap='lg'>
        <AppHeader />
        {auth.status === 'checking' && (
          <Center>
            <Loader />
          </Center>
        )}
        {auth.status === 'unreachable' && (
          <Alert color='red' variant='light' className='cyber-alert'>
            <Stack gap='sm' align='flex-start'>
              Could not reach the server. Is it running?
              <Button size='compact-sm' variant='light' onClick={checkSession}>
                Try again
              </Button>
            </Stack>
          </Alert>
        )}
        {auth.status === 'anonymous' && (
          <Paper withBorder p='lg' className='cyber-card'>
            <LoginForm onLoggedIn={handleLoggedIn} />
          </Paper>
        )}
      </Stack>
    </Container>
  )
}
