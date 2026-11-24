import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, expect } from 'vitest'
import {
  installMockNetwork,
  onUnhandledFrame,
  takeUnhandledApiRequests,
} from '../msw'

// Setup of the `unit` project (Node): MSW intercepts fetch through
// msw/node, with no default handlers. See test/msw.ts.

const server = setupServer()
installMockNetwork(server)

beforeAll(() => {
  server.listen({ onUnhandledFrame })
})

afterEach(() => {
  server.resetHandlers()
  expect(
    takeUnhandledApiRequests(),
    'API requests without an MSW handler',
  ).toEqual([])
})

afterAll(() => {
  server.close()
})
