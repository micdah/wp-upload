import { describe, expect, it } from 'vitest'
import { coreStore } from './index'
import { onSessionReset, resetSession } from './sessionReset'

// A logout drops session-scoped state (review finding 5).

describe('resetSession', () => {
  it('clears the core selection, focus and overlay', () => {
    coreStore.getState().selectOnly(7)
    coreStore.getState().openOverlay('peek')
    resetSession()
    const state = coreStore.getState()
    expect(state.selection.size).toBe(0)
    expect(state.focus).toBeNull()
    expect(state.overlay).toBeNull()
  })

  it('runs every registered reset, even after one fails, until unregistered', () => {
    const calls: string[] = []
    const offA = onSessionReset(() => {
      calls.push('a')
      throw new Error('boom')
    })
    const offB = onSessionReset(() => calls.push('b'))
    const logError = console.error
    console.error = () => {}
    try {
      resetSession()
    } finally {
      console.error = logError
    }
    expect(calls).toEqual(['a', 'b'])
    offA()
    offB()
    resetSession()
    expect(calls).toEqual(['a', 'b'])
  })
})
