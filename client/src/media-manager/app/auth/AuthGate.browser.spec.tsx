import { act, screen, waitFor } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { notifyUnauthorized } from '../../../lib/api'
import { sessionGate } from '../../core/data/session'
import { mockNetwork } from '../../test/msw'
import { renderWithProviders } from '../../test/renderWithProviders'
import { AuthGate } from './AuthGate'

// The login screen and the session dialogs are lazy chunks (the initial
// chunk's budget, D31): they still show when needed.

afterEach(() => {
  sessionGate.restore()
})

function answerSession(loggedIn: boolean): void {
  mockNetwork.use(
    http.get('*/session', () =>
      loggedIn
        ? HttpResponse.json({ username: 'editor' })
        : new HttpResponse(null, { status: 401 }),
    ),
  )
}

describe('AuthGate', () => {
  it('shows the login screen when nobody is logged in', async () => {
    answerSession(false)
    renderWithProviders(
      <AuthGate>
        <p>The app</p>
      </AuthGate>,
    )
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeTruthy()
    expect(screen.getByLabelText(/Password/)).toBeTruthy()
    expect(screen.queryByText('The app')).toBeNull()
  })

  it('shows the session-expired dialog over the app after a 401', async () => {
    answerSession(true)
    renderWithProviders(
      <AuthGate>
        <p>The app</p>
      </AuthGate>,
    )
    expect(await screen.findByText('The app')).toBeTruthy()
    expect(screen.queryByText('Your session has expired')).toBeNull()

    // A 401 (repeated: the gate listens from an effect after the render that
    // shows the app). The first load of a lazy chunk in Vitest transforms it
    // on demand, hence the longer timeout.
    const dialog = await waitFor(
      () => {
        act(() => notifyUnauthorized())
        return screen.getByRole('dialog', { name: 'Your session has expired' })
      },
      { timeout: 10_000 },
    )
    await waitFor(() =>
      expect(dialog.querySelector('input[type="password"]')).not.toBeNull(),
    )
    // The app stays mounted underneath.
    expect(screen.getByText('The app')).toBeTruthy()
  })
})
