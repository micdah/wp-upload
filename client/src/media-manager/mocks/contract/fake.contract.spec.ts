// The contract suite (checks.ts) against the fake, in several scenarios.
// server-live runs the same suite against the real server.

import { afterAll, beforeAll, describe } from 'vitest'
import { mockFetch, startFakeBackend, stopFakeBackend } from '../node'
import { defineLibraryContract } from './checks'

const fetchMock = mockFetch()

function fakeTarget(name: string) {
  return {
    name,
    fetch: (path: string, init?: RequestInit) =>
      fetchMock(`api/library/${path}`, init),
    mutations: true,
  }
}

for (const scenario of [
  'normal',
  'pro',
  'no-filebird',
  'per-user',
  'author,trash',
  'large',
]) {
  describe(`fake: ${scenario}`, () => {
    beforeAll(() => {
      startFakeBackend(
        scenario,
        scenario === 'large' ? { settings: { largeCount: 5000 } } : {},
      )
    })
    afterAll(() => {
      stopFakeBackend()
    })
    defineLibraryContract(fakeTarget(scenario))
  })
}
