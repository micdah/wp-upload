// Test helpers for the data layer (spec files only): a fresh fake backend,
// the transport pointed at it, a fresh QueryClient, and clean session and
// connectivity stores per test.

import type { QueryClient } from '@tanstack/react-query'
import type { MockContext } from '../../mocks/context'
import {
  type FakeBackendOptions,
  mockFetch,
  startFakeBackend,
  stopFakeBackend,
} from '../../mocks/node'
import { createLibraryQueryClient } from './client'
import { type ConnectivityStore, createConnectivityStore } from './connectivity'
import { setHttpDeps } from './http'
import { createSessionGate, type SessionGate } from './session'

export interface DataTestContext {
  mock: MockContext
  queryClient: QueryClient
  gate: SessionGate
  connectivity: ConnectivityStore
  /** every URL the data layer requested, in order */
  requests: string[]
  /** how often the transport told the app the session is gone */
  unauthorized: { count: number }
  /** call in afterEach */
  stop: () => void
}

export function startDataTest(
  scenario = 'normal',
  options: FakeBackendOptions = {},
): DataTestContext {
  const mock = startFakeBackend(scenario, options)
  const gate = createSessionGate()
  const connectivity = createConnectivityStore()
  const requests: string[] = []
  const unauthorized = { count: 0 }
  const fetchMock = mockFetch()
  const restore = setHttpDeps({
    gate,
    connectivity,
    fetch: (input, init) => {
      requests.push(`${init?.method ?? 'GET'} ${input}`)
      return fetchMock(input, init)
    },
    notifyUnauthorized: () => {
      unauthorized.count += 1
    },
  })
  const queryClient = createLibraryQueryClient()
  return {
    mock,
    queryClient,
    gate,
    connectivity,
    requests,
    unauthorized,
    stop: () => {
      queryClient.clear()
      restore()
      stopFakeBackend()
    },
  }
}
