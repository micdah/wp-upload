// The entry of the mock build (vite.mock.config.ts swaps it in for
// src/main.tsx): start the mock backend first, then the real app unchanged.
// Nothing in the production build imports this file.
//
// If the mock can't start, the app doesn't start either: without the mock
// its requests would go to the network, where mock mode has no server. One
// retry covers a first-visit hiccup (the dev server re-optimising its
// dependencies while the worker registers); after that, the watchdog's
// restart (unregister, reload once) gets a go.

import { startMockWorker } from './browser'
import { recoverMockWorker, showRestartNoticeIfDue } from './workerRecovery'

const RETRY_DELAY_MS = 1000

async function startWithRetry(): Promise<void> {
  try {
    await startMockWorker()
  } catch (error) {
    console.warn('[mock] The mock backend failed to start; retrying', error)
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
    await startMockWorker()
  }
}

startWithRetry().then(
  () => {
    showRestartNoticeIfDue()
    return import('../../main')
  },
  (error: unknown) => {
    console.error('The mock backend failed to start', error)
    void recoverMockWorker(`it failed to start: ${String(error)}`)
  },
)
