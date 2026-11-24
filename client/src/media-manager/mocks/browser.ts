// Starts the mock backend in the browser (the `VITE_MOCK` build and
// `vite --config vite.mock.config.ts`): picks the scenario from the URL,
// builds the fake library, and registers MSW's service worker, which the mock
// build serves next to index.html (never from client/public).

import { setupWorker } from 'msw/browser'
import sampleAudio from '../../../../dev/fixtures/sample.mp3?url'
import sampleVideo from '../../../../dev/fixtures/sample.mp4?url'
import samplePdf from '../../../../dev/fixtures/sample.pdf?url'
import { createMockContext, type MockContext, setMockContext } from './context'
import { installDevtools } from './devtools'
import { handlers } from './handlers'
import { browserSettings } from './scenarios'

/** Relative to the page, so the mock works under any mount path. */
const WORKER_FILE = 'mockServiceWorker.js'

function absolute(url: string): string {
  return new URL(url, document.baseURI).href
}

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
  const worker = setupWorker(...handlers)
  await worker.start({
    serviceWorker: { url: new URL(WORKER_FILE, document.baseURI).pathname },
    onUnhandledFrame: 'bypass',
    quiet: true,
  })
  installDevtools(context, worker)
  return context
}
