// The mock backend in Node, for Vitest: no service worker, no network.
//
//   const mock = startFakeBackend('author,trash')   // any ?mock-scenario= value
//   const restore = setHttpDeps({ fetch: mockFetch() })  // the data layer talks to it
//   …
//   restore(); stopFakeBackend()
//
// `mockFetch` resolves relative URLs (`api/library/...`) against a fake
// origin and answers through the same MSW handlers the browser uses. Latency
// is 0 and jobs finish on the next request unless the settings say
// otherwise; pass a manual `clock` to step time.

import { getResponse, type RequestHandler } from 'msw'
import { createMockContext, type MockContext, setMockContext } from './context'
import { handlers as allHandlers } from './handlers'
import { type MockSettings, resolveSettings } from './scenarios'

export const MOCK_ORIGIN = 'http://mock.test/'

export interface FakeBackendOptions {
  /** overrides after the scenario is applied */
  settings?: Partial<MockSettings>
  clock?: () => number
}

/** Creates and installs a fresh fake for a `?mock-scenario=`-style value. */
export function startFakeBackend(
  scenario = 'normal',
  options: FakeBackendOptions = {},
): MockContext {
  const settings: MockSettings = {
    ...resolveSettings(`mock-scenario=${encodeURIComponent(scenario)}`),
    latency: { read: 0, write: 0 },
    jobSpeed: 0,
    ...options.settings,
  }
  const context = createMockContext(settings, {
    mediaBase: `${MOCK_ORIGIN}mock-media/`,
    clock: options.clock,
  })
  setMockContext(context)
  return context
}

export function stopFakeBackend(): void {
  setMockContext(null)
}

/**
 * A `fetch` that answers from the mock handlers. Unhandled requests reject,
 * so a test can't silently reach a real network.
 */
export function mockFetch(
  handlers: readonly RequestHandler[] = allHandlers as RequestHandler[],
  origin: string = MOCK_ORIGIN,
): (input: string | URL | Request, init?: RequestInit) => Promise<Response> {
  return async (input, init) => {
    const request =
      input instanceof Request
        ? input
        : new Request(new URL(String(input), origin), init)
    const response = await getResponse([...handlers], request)
    if (!response) {
      throw new TypeError(
        `No mock handler for ${request.method} ${request.url}`,
      )
    }
    return response
  }
}

/** A clock you move by hand: `clock.advance(1500)`. */
export function manualClock(start = Date.parse('2026-11-22T12:00:00Z')) {
  let now = start
  const clock = () => now
  clock.advance = (ms: number) => {
    now += ms
  }
  clock.set = (ms: number) => {
    now = ms
  }
  return clock
}
