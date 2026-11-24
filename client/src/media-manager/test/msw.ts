import type {
  RequestHandler,
  UnhandledFrameHandle,
  WebSocketHandler,
} from 'msw'

// One MSW facade for both test projects. The `unit` project backs it with
// msw/node's setupServer, the `browser` project with msw/browser's
// setupWorker (test/setup/*.ts install them), so a test reads the same
// either way:
//
//   import { http, HttpResponse } from 'msw'
//   import { mockNetwork } from '../test/msw'
//
//   mockNetwork.use(
//     http.get('*/api/library/bootstrap', () => HttpResponse.json(fixture)),
//   )
//
// Use `*/api/...` patterns: the app calls relative URLs, so the origin and
// any mount path in front of `api/` vary. Handlers added with `use()` are
// dropped after each test. A request to the app's own API (`api/` or
// `session`) that no handler answers fails the test; anything else (Vite
// modules, fonts, images) passes through.

type Handler = RequestHandler | WebSocketHandler

/** The parts of setupServer / setupWorker a test needs. */
export interface MockNetwork {
  /** Adds handlers for the current test, in front of the defaults. */
  use(...handlers: Handler[]): void
  /** Drops handlers added with use(); with arguments, replaces the defaults. */
  resetHandlers(...handlers: Handler[]): void
  /** The handlers in effect, newest first. */
  listHandlers(): ReadonlyArray<Handler>
}

let activeNetwork: MockNetwork | null = null
const unhandledApiRequests: string[] = []

function requireNetwork(): MockNetwork {
  if (!activeNetwork) {
    throw new Error(
      'No mock network is installed. Run the test through client/vitest.config.ts.',
    )
  }
  return activeNetwork
}

/** The MSW instance of the running test project. */
export const mockNetwork: MockNetwork = {
  use: (...handlers) => requireNetwork().use(...handlers),
  resetHandlers: (...handlers) => requireNetwork().resetHandlers(...handlers),
  listHandlers: () => requireNetwork().listHandlers(),
}

/** Called once by a setup file. */
export function installMockNetwork(network: MockNetwork): void {
  activeNetwork = network
}

// Vite and Vitest serve source modules and assets; never API calls.
const MODULE_PATH =
  /^\/(?:src|node_modules|@fs|@id|@vite|__vitest\w*__)\/|\.(?:[cm]?[jt]sx?|css|map|woff2?|svg|png|jpe?g|webp)$/

/** True for requests to the app's own server: `api/…` and `session`. */
export function isAppApiRequest(url: URL): boolean {
  if (MODULE_PATH.test(url.pathname)) {
    return false
  }
  return /\/api\//.test(url.pathname) || /\/session$/.test(url.pathname)
}

/**
 * Remembers an unanswered request if it is an API request; the setup file
 * fails the test with the list after each test.
 */
export function recordUnhandledRequest(request: Request): void {
  const url = new URL(request.url)
  if (isAppApiRequest(url)) {
    unhandledApiRequests.push(`${request.method} ${url.pathname}${url.search}`)
  }
}

/**
 * MSW's `onUnhandledFrame` for both projects: records unanswered API requests
 * and lets everything else (modules, fonts, images) through quietly.
 */
export const onUnhandledFrame: UnhandledFrameHandle = ({ frame }) => {
  if (frame.protocol !== 'http') {
    return
  }
  const { request } = frame.data as { request: Request }
  recordUnhandledRequest(request)
}

/** Returns and clears the unanswered API requests since the last call. */
export function takeUnhandledApiRequests(): string[] {
  return unhandledApiRequests.splice(0, unhandledApiRequests.length)
}
