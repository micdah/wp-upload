// The browser side of the watchdog (watchdog.ts): wraps `fetch`, listens for
// a new service worker and for the page becoming visible, and restarts the
// mock's service worker by unregistering it and reloading the page once.
// Messages are plain DOM, outside React, so they work even when the app
// never started.

import {
  createWatchdog,
  decideRecovery,
  isRestartNoticeDue,
  MSW_SCRIPT,
  parseRecoveryRecord,
  RECOVERY_KEY,
  type RecoveryRecord,
  WORKER_SCRIPT,
} from './watchdog'

const NOTICE_ID = 'wpu-mock-worker-notice'
const RESTART_NOTICE_MS = 10_000

function readRecord(): RecoveryRecord | null {
  try {
    return parseRecoveryRecord(window.sessionStorage.getItem(RECOVERY_KEY))
  } catch {
    return null
  }
}

function writeRecord(record: RecoveryRecord): void {
  try {
    window.sessionStorage.setItem(RECOVERY_KEY, JSON.stringify(record))
  } catch {
    // Without storage the reload guard can't work; the cooldown in
    // decideRecovery then never applies, which is still better than nothing.
  }
}

interface NoticeOptions {
  text: string
  /** an error (role="alert") rather than a status message */
  error?: boolean
  /** offers a Reload button */
  reload?: boolean
}

/** Shows one message at the top of the page, replacing any earlier one. */
function showNotice(options: NoticeOptions): HTMLElement {
  document.getElementById(NOTICE_ID)?.remove()
  const notice = document.createElement('div')
  notice.id = NOTICE_ID
  // The slice's axe checks skip the mock's own dev UI.
  notice.dataset.mockDevtools = ''
  notice.dataset.mockWorkerNotice = options.error ? 'error' : 'info'
  notice.setAttribute('role', options.error ? 'alert' : 'status')
  Object.assign(notice.style, {
    position: 'fixed',
    top: '12px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: '2147483647',
    maxWidth: 'min(640px, calc(100vw - 24px))',
    padding: '10px 14px',
    borderRadius: '8px',
    font: '14px/1.4 system-ui, sans-serif',
    color: '#ffffff',
    background: options.error ? '#8b1a1a' : '#1f2937',
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.35)',
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
  })
  const text = document.createElement('span')
  text.textContent = options.text
  notice.append(text)
  if (options.reload) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = 'Reload'
    button.addEventListener('click', () => window.location.reload())
    notice.append(button)
  }
  document.body.append(notice)
  return notice
}

/** Unregisters the mock's service worker (and an older MSW-only one). */
async function unregisterMockWorkers(): Promise<void> {
  if (!('serviceWorker' in navigator)) {
    return
  }
  const scripts = new Set(
    [WORKER_SCRIPT, MSW_SCRIPT].map(
      (file) => new URL(file, document.baseURI).href,
    ),
  )
  const registrations = await navigator.serviceWorker.getRegistrations()
  await Promise.all(
    registrations
      .filter((registration) => {
        const worker =
          registration.active ?? registration.waiting ?? registration.installing
        return worker !== null && scripts.has(worker.scriptURL)
      })
      .map((registration) => registration.unregister()),
  )
}

let recovering = false

/**
 * Restarts the mock's service worker: unregisters it and reloads the page,
 * where MSW registers a fresh one. Unregistering matters: WebKit keeps
 * bypassing a worker it gave up on across reloads, but not a new one.
 */
export async function recoverMockWorker(reason: string): Promise<void> {
  if (recovering) {
    return
  }
  recovering = true
  const now = Date.now()
  if (decideRecovery(readRecord(), now) === 'give-up') {
    console.warn(`[mock] The mock service worker stopped answering (${reason})`)
    showNotice({
      text: `The mock service worker stopped answering again (${reason}). Reload the page to restart it.`,
      error: true,
      reload: true,
    })
    return
  }
  writeRecord({ at: now, reason })
  console.warn(`[mock] Restarting the mock service worker (${reason})`)
  showNotice({
    text: `The mock service worker stopped answering (${reason}). Restarting it…`,
  })
  try {
    await unregisterMockWorkers()
  } catch (error) {
    console.warn('[mock] Could not unregister the service worker', error)
  }
  window.location.reload()
}

/** After an automatic reload, says once that the worker was restarted. */
export function showRestartNoticeIfDue(): void {
  const record = readRecord()
  if (!isRestartNoticeDue(record, Date.now()) || record === null) {
    return
  }
  writeRecord({ ...record, noticed: true })
  const notice = showNotice({
    text: `The mock service worker was restarted: it had stopped answering (${record.reason}).`,
  })
  window.setTimeout(() => notice.remove(), RESTART_NOTICE_MS)
}

/** Starts watching; call once MSW's worker is up. */
export function installWorkerWatchdog(): void {
  if (!('serviceWorker' in navigator)) {
    // No service workers (an insecure context): MSW intercepts in the page
    // instead, and there is no worker to lose.
    return
  }
  const nativeFetch = window.fetch.bind(window)
  const watchdog = createWatchdog({
    fetch: nativeFetch,
    baseUrl: document.baseURI,
    now: () => Date.now(),
    onBypassed: (reason) => {
      void recoverMockWorker(reason)
    },
  })
  // The app's HTTP layer resolves `fetch` per call (core/data/http.ts).
  window.fetch = watchdog.fetch
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    void watchdog.check('noticed after the page got a new service worker')
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void watchdog.check('noticed when the page became visible again')
    }
  })
}
