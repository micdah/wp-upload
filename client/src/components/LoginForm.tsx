import { Alert, Button, PasswordInput, Stack, TextInput } from '@mantine/core'
import { type FormEvent, useState } from 'react'
import { type LoginResult, login, type Session } from '../lib/api'

interface LoginFormProps {
  onLoggedIn: (session: Session) => void
}

function errorMessage(result: Exclude<LoginResult, { ok: true }>): string {
  switch (result.reason) {
    case 'invalid_credentials':
      return 'Wrong username or password.'
    case 'too_many_attempts': {
      if (result.retryAfterSeconds === null) {
        return 'Too many failed attempts. Try again later.'
      }
      const minutes = Math.ceil(result.retryAfterSeconds / 60)
      return `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`
    }
    case 'error':
      return result.message
  }
}

// A real <form> with standard field names and autocomplete hints, so
// browsers and password managers (e.g. iCloud Keychain) offer to fill and
// save the login.
export function LoginForm({ onLoggedIn }: LoginFormProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    const result = await login(username, password)
    setSubmitting(false)

    if (result.ok) {
      setPassword('')
      onLoggedIn(result.session)
    } else {
      setError(errorMessage(result))
    }
  }

  return (
    <form onSubmit={handleSubmit} method='post'>
      <Stack gap='md'>
        {error && (
          <Alert color='red' variant='light' className='cyber-alert'>
            {error}
          </Alert>
        )}
        <TextInput
          label='Username'
          name='username'
          autoComplete='username'
          autoCapitalize='none'
          autoCorrect='off'
          spellCheck={false}
          required
          data-autofocus
          autoFocus
          value={username}
          onChange={(event) => setUsername(event.currentTarget.value)}
        />
        <PasswordInput
          label='Password'
          name='password'
          autoComplete='current-password'
          required
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
        />
        <Button type='submit' loading={submitting} fullWidth>
          Log in
        </Button>
      </Stack>
    </form>
  )
}
