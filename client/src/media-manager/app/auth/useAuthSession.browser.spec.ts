import { act, renderHook, waitFor } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { sessionGate } from '../../core/data/session'
import { mockNetwork } from '../../test/msw'
import { useAuthSession } from './useAuthSession'

// The auth flow keeps the data layer's session gate in step (C-2): a gate
// left `lost` by 401s around a logout must not hold the next session's
// requests forever.

afterEach(() => {
  sessionGate.restore()
})

function answerSession(loggedIn: () => boolean): void {
  mockNetwork.use(
    http.get('*/session', () =>
      loggedIn()
        ? HttpResponse.json({ username: 'editor' })
        : new HttpResponse(null, { status: 401 }),
    ),
    http.delete('*/session', () => new HttpResponse(null, { status: 204 })),
  )
}

describe('useAuthSession and the session gate', () => {
  it('restores a lost gate when auth becomes authenticated', async () => {
    answerSession(() => true)
    // E.g. 401s that arrived after the last logout marked it lost.
    sessionGate.markLost()
    const { result } = renderHook(() => useAuthSession())
    await waitFor(() =>
      expect(result.current.auth.status).toBe('authenticated'),
    )
    await waitFor(() => expect(sessionGate.state).toBe('active'))
  })

  it('restores the gate after a login on the login screen, and after a re-login', async () => {
    answerSession(() => false)
    const { result } = renderHook(() => useAuthSession())
    await waitFor(() => expect(result.current.auth.status).toBe('anonymous'))

    sessionGate.markLost()
    act(() => result.current.loggedIn({ username: 'editor' }))
    await waitFor(() => expect(sessionGate.state).toBe('active'))

    // The session-expired dialog's re-login: auth stays authenticated.
    sessionGate.markLost()
    const epoch = sessionGate.epoch
    act(() => result.current.loggedIn({ username: 'editor' }))
    await waitFor(() => expect(sessionGate.state).toBe('active'))
    expect(sessionGate.epoch).toBeGreaterThan(epoch)
  })

  it('a logout fails the requests still waiting for the session', async () => {
    answerSession(() => true)
    const { result } = renderHook(() => useAuthSession())
    await waitFor(() =>
      expect(result.current.auth.status).toBe('authenticated'),
    )

    sessionGate.markLost()
    const waiting = sessionGate
      .waitUntilRestored()
      .then(() => 'released')
      .catch((error: unknown) => (error as { code: string }).code)
    act(() => result.current.logout())
    await waitFor(() => expect(result.current.auth.status).toBe('anonymous'))
    expect(await waiting).toBe('session_lost')
    expect(sessionGate.state).toBe('active')
  })
})
