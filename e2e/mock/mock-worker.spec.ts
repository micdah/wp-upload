import type { Page } from '@playwright/test'
import { expect, test } from '../support/fixtures.ts'

// The mock's service worker under /wp-upload-mock/ (client/src/media-manager/
// mocks/serviceWorker.js, watchdog.ts): the mock keeps answering when the
// browser stops or replaces its worker, and when the worker stops answering
// it is restarted (unregister, reload once) instead of letting `api/` and
// `session` requests reach the network. Chromium only (playwright.config.ts);
// the WebKit case behind it is in the M2 feel handoff.

const LIBRARY = './?view=library'

type BackendResponse = { url: string; status: number; fromWorker: boolean }

/** Every `api/` and `session` response, and whether the worker answered it. */
function trackBackendResponses(page: Page): BackendResponse[] {
  const responses: BackendResponse[] = []
  page.on('response', (response) => {
    const path = new URL(response.url()).pathname
    if (/\/api\//.test(path) || /\/session$/.test(path)) {
      responses.push({
        url: response.url(),
        status: response.status(),
        fromWorker: response.fromServiceWorker(),
      })
    }
  })
  return responses
}

async function openLibrary(page: Page, query = ''): Promise<void> {
  await page.goto(`${LIBRARY}${query}`)
  await expect(page.getByRole('gridcell').first()).toBeVisible({
    timeout: 20_000,
  })
}

/** Fetches `api/library/rev` from the page; the mock answers with JSON. */
async function fetchRev(page: Page): Promise<{ status: number; rev: unknown }> {
  return page.evaluate(async () => {
    const response = await fetch('api/library/rev', { cache: 'no-store' })
    const body = (await response.json()) as { rev?: unknown }
    return { status: response.status, rev: body.rev }
  })
}

/**
 * Makes the worker forget the page, as MSW's worker does when a page says
 * goodbye (`pagehide`): it unregisters itself and stops answering, while the
 * page keeps its controller - the state the watchdog must notice.
 */
async function makeWorkerStopAnswering(page: Page): Promise<void> {
  await page.evaluate(() =>
    navigator.serviceWorker.controller?.postMessage('CLIENT_CLOSE'),
  )
}

/** A request that the stopped worker passes to the network (nginx's SPA fallback). */
async function nudgeBackend(page: Page): Promise<void> {
  // The page may reload while this runs; only the side effect matters.
  await page
    .evaluate(() => fetch('api/library/rev', { cache: 'no-store' }))
    .catch(() => undefined)
}

test.describe('the mock service worker', () => {
  test('keeps answering after the browser stops the worker', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'stops the worker through CDP')
    const responses = trackBackendResponses(page)
    // A large library, so scrolling has more items to load.
    await openLibrary(page, '&mock-items=5000')

    const cdp = await page.context().newCDPSession(page)
    await cdp.send('ServiceWorker.enable')
    await cdp.send('ServiceWorker.stopAllWorkers')

    // The restarted worker restores its client from Cache Storage (MSW).
    const { status, rev } = await fetchRev(page)
    expect(status).toBe(200)
    expect(typeof rev).toBe('string')
    // Scrolling far down loads more of the library through the worker.
    const before = responses.length
    await page.getByRole('grid', { name: 'Media' }).hover()
    await page.mouse.wheel(0, 20_000)
    await expect.poll(() => responses.length).toBeGreaterThan(before)

    expect(responses.length).toBeGreaterThan(0)
    expect(
      responses.filter((response) => !response.fromWorker),
      'api/ or session responses that did not come from the worker',
    ).toEqual([])
    await expect(page.locator('[data-mock-worker-notice]')).toHaveCount(0)
  })

  test('a new page registers the worker again after it was unregistered', async ({
    page,
  }) => {
    const responses = trackBackendResponses(page)
    await openLibrary(page)
    await page.evaluate(async () => {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.map((r) => r.unregister()))
    })

    // Unregistered, it still serves the page that has it...
    expect((await fetchRev(page)).status).toBe(200)
    // ...and the next page load registers a fresh one.
    await openLibrary(page)
    expect(
      await page.evaluate(
        async () => (await navigator.serviceWorker.getRegistrations()).length,
      ),
    ).toBe(1)
    expect((await fetchRev(page)).status).toBe(200)
    expect(
      responses.filter((response) => !response.fromWorker),
      'api/ or session responses that did not come from the worker',
    ).toEqual([])
  })
})

test.describe('the mock service worker, when it stops answering', () => {
  // The requests that slipped past the worker may fail at the network: the
  // test proxy answers them with its SPA fallback, other servers with an error.
  test.use({
    allowedConsoleErrors: [
      /Failed to load resource: the server responded with a status of 5\d\d/,
    ],
  })

  test('is restarted once, and then not again in a loop', async ({ page }) => {
    await openLibrary(page)
    const responses = trackBackendResponses(page)

    await makeWorkerStopAnswering(page)
    const reloaded = page.waitForEvent('load')
    await nudgeBackend(page)
    await reloaded

    const restarted = page.locator('[data-mock-worker-notice]')
    await expect(restarted).toHaveAttribute('role', 'status')
    await expect(restarted).toContainText('was restarted')
    await expect(page.getByRole('gridcell').first()).toBeVisible({
      timeout: 20_000,
    })
    responses.length = 0
    expect((await fetchRev(page)).status).toBe(200)
    expect(responses.every((response) => response.fromWorker)).toBe(true)

    // Again within the cooldown: a message instead of a reload loop.
    await page.evaluate(() => {
      ;(window as { stillThisPage?: boolean }).stillThisPage = true
    })
    await makeWorkerStopAnswering(page)
    await nudgeBackend(page)
    const alert = page.getByRole('alert').filter({
      hasText: 'stopped answering again',
    })
    await expect(alert).toBeVisible()
    await expect(alert.getByRole('button', { name: 'Reload' })).toBeVisible()
    expect(
      await page.evaluate(
        () => (window as { stillThisPage?: boolean }).stillThisPage,
      ),
    ).toBe(true)
  })
})
