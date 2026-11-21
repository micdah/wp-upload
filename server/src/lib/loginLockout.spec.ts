import { describe, expect, it, vi } from 'vitest'
import {
  clearFailures,
  failures,
  isLockedOut,
  MAX_FAILURES,
  recordFailure,
  sweepExpired,
  WINDOW_MS,
} from './loginLockout.ts'

// Each test uses its own IPs, so no two tests share a `failures` entry.
describe('loginLockout', () => {
  it('does not lock out an IP below MAX_FAILURES', () => {
    const ip = '10.1.0.1'
    for (let i = 0; i < MAX_FAILURES - 1; i++) recordFailure(ip)

    expect(isLockedOut(ip)).toBe(false)
  })

  it('locks out an IP after MAX_FAILURES failures within the window', () => {
    const ip = '10.1.0.2'
    for (let i = 0; i < MAX_FAILURES; i++) recordFailure(ip)

    expect(isLockedOut(ip)).toBe(true)
  })

  it('unlocks the IP again once the window has passed', () => {
    const ip = '10.1.0.3'
    vi.useFakeTimers()
    try {
      for (let i = 0; i < MAX_FAILURES; i++) recordFailure(ip)
      vi.advanceTimersByTime(WINDOW_MS + 1)

      expect(isLockedOut(ip)).toBe(false)
      expect(failures.has(ip)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('starts a new window for a failure after the old one expired', () => {
    const ip = '10.1.0.4'
    vi.useFakeTimers()
    try {
      for (let i = 0; i < MAX_FAILURES - 1; i++) recordFailure(ip)
      vi.advanceTimersByTime(WINDOW_MS + 1)
      recordFailure(ip)

      expect(failures.get(ip)?.count).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears an IP on clearFailures()', () => {
    const ip = '10.1.0.5'
    for (let i = 0; i < MAX_FAILURES; i++) recordFailure(ip)
    clearFailures(ip)

    expect(isLockedOut(ip)).toBe(false)
  })

  it("sweeps every IP's stale entries, not just the caller's", () => {
    const ipA = '10.1.0.6'
    const ipB = '10.1.0.7'
    vi.useFakeTimers()
    try {
      recordFailure(ipA)
      recordFailure(ipB)
      vi.advanceTimersByTime(WINDOW_MS + 1)

      // An IP that never comes back must not linger in the map (issue #3).
      sweepExpired()

      expect(failures.has(ipA)).toBe(false)
      expect(failures.has(ipB)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
