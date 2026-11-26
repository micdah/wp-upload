// The login screen shown instead of the shell. A lazy chunk (AuthGate.tsx):
// a logged-in user never needs the login form (PasswordInput, Alert), and
// the initial chunk has a budget (D31).

import type { Session } from '../../../lib/api'
import { StateScreen } from '../screens/StateScreen'
import { LoginForm } from './LoginForm'

export default function LoginScreen({
  onLoggedIn,
}: {
  onLoggedIn: (session: Session) => void
}) {
  return (
    <StateScreen title='Log in'>
      <LoginForm onLoggedIn={onLoggedIn} />
    </StateScreen>
  )
}
