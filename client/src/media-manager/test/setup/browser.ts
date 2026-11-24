import { cleanup } from '@testing-library/react'
import { setupWorker } from 'msw/browser'
import { afterAll, afterEach, beforeAll, expect } from 'vitest'
import {
  installMockNetwork,
  onUnhandledFrame,
  takeUnhandledApiRequests,
} from '../msw'

// Setup of the `browser` project (Chromium): MSW's service worker, served by
// the msw/vite plugin in vitest.config.ts, with no default handlers. React
// Testing Library is cleaned up after each test (Vitest globals are off, so
// it can't register that itself). See test/msw.ts.

const worker = setupWorker()
installMockNetwork(worker)

beforeAll(async () => {
  await worker.start({ quiet: true, onUnhandledFrame })
})

afterEach(() => {
  cleanup()
  localStorage.clear()
  worker.resetHandlers()
  expect(
    takeUnhandledApiRequests(),
    'API requests without an MSW handler',
  ).toEqual([])
})

afterAll(() => {
  worker.stop()
})
