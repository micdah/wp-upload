import type { Page } from '@playwright/test'
import { expect, openQuietly, test } from './fixtures.ts'

// The smoke tests both projects run (track D, M1): the app loads under its
// sub-path without console errors, every request stays under that sub-path,
// and `?view=library` pulls in the media manager's lazy chunk.

type SmokeOptions = {
  // Runs before each test, e.g. logging in for the live project.
  prepare?: (page: Page) => Promise<void>
}

// The project's baseURL, which must be a sub-path such as /wp-upload/: the
// smoke test is only meaningful when the app isn't at the root.
function subPathBase(baseURL: string | undefined): URL {
  expect(
    baseURL,
    'baseURL (WPU_MOCK_URL or WPU_APP_URL) must be set; run through dev/run',
  ).toBeTruthy()
  const base = new URL(baseURL as string)
  expect(base.pathname, 'the app must be served under a sub-path').not.toBe('/')
  expect(base.pathname.endsWith('/'), 'baseURL must end with a slash').toBe(
    true,
  )
  return base
}

// Same-origin requests outside the sub-path mean a root-relative URL slipped
// in (CLAUDE.md: "The app must be deployable under any path").
function trackRequestsOutside(page: Page, base: URL): string[] {
  const outside: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.origin === base.origin && !url.pathname.startsWith(base.pathname)) {
      outside.push(url.href)
    }
  })
  return outside
}

export function defineSubPathSmokeTests(options: SmokeOptions = {}): void {
  test.describe('smoke: the app under its sub-path', () => {
    test.beforeEach(async ({ page }) => {
      await options.prepare?.(page)
    })

    test('the page loads without console errors', async ({ page, baseURL }) => {
      const base = subPathBase(baseURL)
      const outside = trackRequestsOutside(page, base)

      await openQuietly(page, './')

      expect(page.url()).toBe(base.href)
      await expect(page.locator('#root')).not.toBeEmpty()
      expect(outside, 'requests outside the sub-path').toEqual([])
    })

    test('?view=library loads the library chunk', async ({
      page,
      baseURL,
      scriptUrls,
    }) => {
      const base = subPathBase(baseURL)
      const outside = trackRequestsOutside(page, base)

      await openQuietly(page, './')
      const defaultViewScripts = new Set(scriptUrls)
      scriptUrls.clear()

      await openQuietly(page, './?view=library')
      const libraryOnlyScripts = [...scriptUrls].filter(
        (url) => !defaultViewScripts.has(url),
      )

      expect(new URL(page.url()).searchParams.get('view')).toBe('library')
      expect(
        libraryOnlyScripts,
        'JavaScript the library view loads and the default view does not',
      ).not.toEqual([])
      for (const url of libraryOnlyScripts) {
        expect(new URL(url).pathname.startsWith(base.pathname)).toBe(true)
      }
      await expect(page.locator('#root')).not.toBeEmpty()
      expect(outside, 'requests outside the sub-path').toEqual([])
    })
  })
}
