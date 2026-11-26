// The mock's watchdog: notices when MSW's service worker stops answering and
// restarts it, so the mock never quietly talks to a real network.
//
// A service worker can stop answering while the page lives on: WebKit stops
// sending requests to a worker after it was too slow to answer a navigation
// (see serviceWorker.js), a worker script update leaves the new worker
// without MSW's client, and MSW's worker unregisters itself when its last
// client says goodbye. The page then still has a `controller`, and MSW's
// messages may still work, but requests go to the network: the Vite dev
// server answers them with a 503 (vite.mock.config.ts), the static mock
// build with its SPA fallback.
//
// The watchdog wraps `fetch`. When an `api/` or `session` response looks like
// it didn't come from the mock, or the page gets a new service worker, or it
// becomes visible again, it pings the worker (PING_PATH, answered only by the
// mock). If the ping comes back from anywhere else, it unregisters the worker
// and reloads the page once; MSW then registers a fresh worker. A second
// failure within RELOAD_COOLDOWN_MS shows a message instead of reloading
// again, so a broken setup can't loop.
//
// Mock-only: mocks/browser.ts installs it, and nothing outside mocks/ imports
// this file (vite.mock.config.ts reads its constants).

/** The mock's service worker (mocks/serviceWorker.js), next to index.html. */
export const WORKER_SCRIPT = 'mock-sw.js'
/** MSW's own worker script, which WORKER_SCRIPT imports. */
export const MSW_SCRIPT = 'mockServiceWorker.js'
/** Answered only by the mock's handler in mocks/browser.ts. */
export const PING_PATH = 'mock-worker-ping'
export const ALIVE_HEADER = 'X-WPU-Mock-Worker'
/** Set by vite.mock.config.ts on the `api/` and `session` requests it gets. */
export const UNHANDLED_HEADER = 'X-WPU-Mock-Unhandled'

export const RECOVERY_KEY = 'wpu-mock-worker-recovery'
/** No second automatic reload within this time of the last one. */
export const RELOAD_COOLDOWN_MS = 60_000
/** A ping result is reused this long, so a burst of errors sends one ping. */
export const PING_REUSE_MS = 5_000
const PING_TIMEOUT_MS = 10_000

/**
 * A path the real server owns: `api/...`, or the app-root `session`, under
 * any mount path.
 */
export function isBackendPath(pathname: string): boolean {
  return /(^|\/)api\//.test(pathname) || /(^|\/)session$/.test(pathname)
}

/**
 * A backend response that may not come from the mock: the dev server's 503,
 * an HTML page (a static server's SPA fallback), or any 5xx. The mock answers
 * some 5xx itself (WordPress offline), so this only means "ask the worker".
 */
export function isSuspicious(response: Response): boolean {
  if (response.headers.has(UNHANDLED_HEADER)) {
    return true
  }
  if (response.status >= 500) {
    return true
  }
  const type = response.headers.get('content-type') ?? ''
  return type.includes('text/html')
}

export type PingResult = 'alive' | 'bypassed' | 'unknown'

/** A ping answered without the mock's header came from the network. */
export function classifyPing(response: Response | null): PingResult {
  if (!response) {
    return 'unknown'
  }
  return response.headers.get(ALIVE_HEADER) === 'alive' ? 'alive' : 'bypassed'
}

export interface RecoveryRecord {
  /** when the last automatic reload started (ms since the epoch) */
  at: number
  reason: string
  /** the "restarted" notice has been shown after that reload */
  noticed?: boolean
}

export function parseRecoveryRecord(raw: string | null): RecoveryRecord | null {
  if (!raw) {
    return null
  }
  try {
    const value = JSON.parse(raw) as Partial<RecoveryRecord>
    if (typeof value.at !== 'number' || typeof value.reason !== 'string') {
      return null
    }
    return { at: value.at, reason: value.reason, noticed: value.noticed }
  } catch {
    return null
  }
}

export type RecoveryDecision = 'reload' | 'give-up'

/** Reload, unless the last automatic reload was moments ago (a loop). */
export function decideRecovery(
  previous: RecoveryRecord | null,
  now: number,
): RecoveryDecision {
  if (previous && now - previous.at < RELOAD_COOLDOWN_MS) {
    return 'give-up'
  }
  return 'reload'
}

/** The "restarted" notice is due right after an automatic reload. */
export function isRestartNoticeDue(
  record: RecoveryRecord | null,
  now: number,
): boolean {
  return (
    record !== null && !record.noticed && now - record.at < RELOAD_COOLDOWN_MS
  )
}

type Fetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export interface WatchdogDeps {
  /** the browser's own fetch */
  fetch: Fetch
  /** the page's base URL; the ping and backend paths are relative to it */
  baseUrl: string
  now: () => number
  /** called once, with why, when the worker turned out to be bypassed */
  onBypassed: (reason: string) => void
}

export interface Watchdog {
  /** `fetch`, plus a look at every backend response */
  fetch: Fetch
  /** pings the worker (or reuses a recent result) */
  check: (reason: string) => Promise<PingResult>
}

function urlOf(input: RequestInfo | URL, base: string): URL {
  if (input instanceof URL) {
    return input
  }
  return new URL(typeof input === 'string' ? input : input.url, base)
}

export function createWatchdog(deps: WatchdogDeps): Watchdog {
  const origin = new URL(deps.baseUrl).origin
  let tripped = false
  let inFlight: Promise<PingResult> | null = null
  let last: { at: number; result: PingResult } | null = null

  async function ping(): Promise<PingResult> {
    const url = new URL(`${PING_PATH}?t=${deps.now()}`, deps.baseUrl)
    try {
      const response = await deps.fetch(url, {
        cache: 'no-store',
        signal: AbortSignal.timeout(PING_TIMEOUT_MS),
      })
      return classifyPing(response)
    } catch {
      // A timeout or network error says nothing about who would answer.
      return 'unknown'
    }
  }

  async function check(reason: string): Promise<PingResult> {
    if (tripped) {
      return 'bypassed'
    }
    if (inFlight) {
      return inFlight
    }
    if (last && deps.now() - last.at < PING_REUSE_MS) {
      return last.result
    }
    inFlight = ping().then((result) => {
      inFlight = null
      last = { at: deps.now(), result }
      if (result === 'bypassed' && !tripped) {
        tripped = true
        deps.onBypassed(reason)
      }
      return result
    })
    return inFlight
  }

  const guardedFetch: Fetch = async (input, init) => {
    const url = urlOf(input, deps.baseUrl)
    const watched = url.origin === origin && isBackendPath(url.pathname)
    let response: Response
    try {
      response = await deps.fetch(input, init)
    } catch (error) {
      if (watched) {
        void check(`${url.pathname} failed: ${String(error)}`)
      }
      throw error
    }
    if (watched && isSuspicious(response)) {
      void check(`${url.pathname} answered ${response.status}`)
    }
    return response
  }

  return { fetch: guardedFetch, check }
}
