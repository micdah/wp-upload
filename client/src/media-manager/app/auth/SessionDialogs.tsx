// The session dialogs over the running app: log in again after the session
// ran out, and "Logging out failed". A lazy chunk (AuthGate.tsx): Mantine's
// Modal brings ScrollArea, a focus trap and scroll lock, and the login form
// PasswordInput and Alert, none of which a working session needs up front
// (the initial chunk's budget, D31).

import { Modal, Text } from '@mantine/core'
import type { Session } from '../../../lib/api'
import { LoginForm } from './LoginForm'

export interface SessionDialogsProps {
  sessionLost: boolean
  logoutFailed: boolean
  onLoggedIn(session: Session): void
  onDismissLogoutFailed(): void
}

export default function SessionDialogs({
  sessionLost,
  logoutFailed,
  onLoggedIn,
  onDismissLogoutFailed,
}: SessionDialogsProps) {
  return (
    <>
      {/* The session ran out while the app was open: log in again here,
          keeping the app (and anything half-done) mounted underneath. */}
      <Modal
        opened={sessionLost}
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
        <LoginForm onLoggedIn={onLoggedIn} />
      </Modal>
      <Modal
        opened={logoutFailed}
        onClose={onDismissLogoutFailed}
        title='Logging out failed'
        centered
      >
        <Text size='sm'>
          The server did not confirm the logout, so you are still logged in. Try
          again once the connection is back.
        </Text>
      </Modal>
    </>
  )
}
