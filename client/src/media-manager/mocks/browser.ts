// Starts the mock backend in the browser (the `VITE_MOCK` build and
// `vite --config vite.mock.config.ts`): picks the scenario from the URL,
// builds the fake library, and registers the mock's service worker
// (serviceWorker.js, served as `mock-sw.js` next to index.html, never from
// client/public), which runs MSW's worker. Then the watchdog keeps an eye on
// the worker (watchdog.ts).

import { HttpResponse, http } from 'msw'
import { setupWorker } from 'msw/browser'
import sampleAudio from '../../../../dev/fixtures/sample.mp3?url'
import sampleVideo from '../../../../dev/fixtures/sample.mp4?url'
import samplePdf from '../../../../dev/fixtures/sample.pdf?url'
import { createMockContext, type MockContext, setMockContext } from './context'
import { installDevtools } from './devtools'
import { handlers } from './handlers'
import { browserSettings } from './scenarios'
import { ALIVE_HEADER, PING_PATH, WORKER_SCRIPT } from './watchdog'
import { installWorkerWatchdog } from './workerRecovery'

function absolute(url: string): string {
  return new URL(url, document.baseURI).href
}

/** Only the mock answers this, so an answer without the header bypassed it. */
const pingHandler = http.get(
  `*/${PING_PATH}`,
  () =>
    new HttpResponse(null, {
      status: 204,
      headers: { [ALIVE_HEADER]: 'alive', 'Cache-Control': 'no-store' },
    }),
)

export async function startMockWorker(): Promise<MockContext> {
  const settings = browserSettings(window.location, window.sessionStorage)
  const context = createMockContext(settings, {
    mediaBase: absolute('mock-media/'),
    samples: {
      video: absolute(sampleVideo),
      audio: absolute(sampleAudio),
      pdf: absolute(samplePdf),
    },
  })
  setMockContext(context)
  const worker = setupWorker(pingHandler, ...handlers)
  await worker.start({
    // Relative to the page, so the mock works under any mount path.
    serviceWorker: { url: new URL(WORKER_SCRIPT, document.baseURI).pathname },
    onUnhandledFrame: 'bypass',
    quiet: true,
  })
  installWorkerWatchdog()
  installDevtools(context, worker)
  return context
}
