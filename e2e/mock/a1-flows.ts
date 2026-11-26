import type { Locator, Page, TestInfo } from '@playwright/test'
import { COLOR_SCHEMES, expectNoAxeViolations } from '../support/axe.ts'
import { expect, test } from '../support/fixtures.ts'

// Track A1's end-to-end flows (grid, filters and peek; M3 wave A), shared by
// e2e/mock/a1.spec.ts (the mock build under /wp-upload-mock/) and
// e2e/live/a1.spec.ts (the production image under /wp-upload/ against the
// stack's WordPress, `small` seed). They run in both colour schemes, with
// axe on every new screen, and never assume a mount path: every URL is
// relative and no request may leave the sub-path.
//
// The flows only assume what both libraries have: landscape images, some
// without alt text, at least one video and one PDF.
//
// This module isn't a spec itself (no tests at the top level), so both
// projects can import it.

export type A1Options = {
  // Runs before each test, e.g. logging in for the live project.
  prepare?: (page: Page) => Promise<void>
  // Elements axe should skip (the mock's dev scenario switcher).
  axeExclude?: string[]
}

const LIBRARY = './?view=library'

function base(baseURL: string | undefined): URL {
  expect(baseURL, 'baseURL must be set; run through dev/run').toBeTruthy()
  const url = new URL(baseURL as string)
  expect(url.pathname, 'the app must be under a sub-path').not.toBe('/')
  return url
}

// Same-origin requests outside the sub-path mean a root-relative URL.
function trackRequestsOutside(page: Page, root: URL): string[] {
  const outside: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.origin === root.origin && !url.pathname.startsWith(root.pathname)) {
      outside.push(url.href)
    }
  })
  return outside
}

function tiles(page: Page): Locator {
  return page.getByRole('gridcell')
}

function filterBar(page: Page): Locator {
  return page.getByRole('group', { name: 'Filters' })
}

function param(page: Page, name: string): string | null {
  return new URL(page.url()).searchParams.get(name)
}

async function openLibrary(page: Page, query = ''): Promise<void> {
  await page.goto(`${LIBRARY}${query}`)
  await expect(tiles(page).first()).toBeVisible({ timeout: 20_000 })
  // The chips show once the folder's counts are in.
  await expect(
    filterBar(page).getByRole('button', { name: /^All/ }),
  ).toBeVisible({ timeout: 20_000 })
}

async function axe(
  page: Page,
  testInfo: TestInfo,
  options: A1Options,
  colorScheme: (typeof COLOR_SCHEMES)[number],
): Promise<void> {
  // Let fades and transitions settle, so axe measures final colours.
  await page.waitForTimeout(400)
  await expectNoAxeViolations(page, testInfo, {
    colorScheme,
    exclude: options.axeExclude,
  })
}

export function defineA1Tests(options: A1Options): void {
  for (const colorScheme of COLOR_SCHEMES) {
    test.describe(`A1 grid, filters and peek (${colorScheme})`, () => {
      test.use({ colorScheme })

      test.beforeEach(async ({ page }) => {
        await options.prepare?.(page)
      })

      test('filters by type, missing alt, the + Filter menu, sort and search, all in the URL', async ({
        page,
        baseURL,
      }, testInfo) => {
        const outside = trackRequestsOutside(page, base(baseURL))
        await openLibrary(page)
        const bar = filterBar(page)
        await expect(page.locator('[data-mm-summary]')).toHaveText(
          /^[\d,]+ items? · [\d.]+ (B|kB|MB|GB)$/,
        )
        await axe(page, testInfo, options, colorScheme)

        // Type chips: Video narrows the grid to videos (duration badges).
        await bar.getByRole('button', { name: /^Video/ }).click()
        await expect.poll(() => param(page, 'type')).toBe('video')
        await expect(
          tiles(page).first().locator('[data-badge="duration"]'),
        ).toBeVisible()
        await bar.getByRole('button', { name: /^Video/ }).click()
        await expect.poll(() => param(page, 'type')).toBeNull()

        // Documents: the PDF shows its page count.
        await bar.getByRole('button', { name: /^Documents/ }).click()
        await expect(page.locator('[data-badge="pages"]').first()).toBeVisible()
        await bar.getByRole('button', { name: /^All/ }).click()
        await expect.poll(() => param(page, 'type')).toBeNull()

        // Missing alt: every tile then has the Alt badge.
        const missing = bar.getByRole('button', { name: /^Missing alt/ })
        await missing.click()
        await expect.poll(() => param(page, 'alt')).toBe('missing')
        await expect(
          tiles(page).first().locator('[data-badge="alt"]'),
        ).toBeVisible()
        await missing.click()
        await expect.poll(() => param(page, 'alt')).toBeNull()

        // + Filter: size, as a removable chip.
        await bar.getByRole('button', { name: /^Filter$/ }).click()
        const menu = page.getByRole('menu')
        await expect(menu).toBeVisible()
        await axe(page, testInfo, options, colorScheme)
        await menu.getByRole('menuitem', { name: 'Landscape' }).click()
        await expect.poll(() => param(page, 'orient')).toBe('landscape')
        const chip = bar.getByRole('button', {
          name: 'Remove filter: Landscape',
        })
        await expect(chip).toBeVisible()
        await chip.click()
        await expect.poll(() => param(page, 'orient')).toBeNull()

        // Sort.
        await page.getByRole('button', { name: 'Sort: Newest' }).click()
        await page.getByRole('menuitem', { name: 'Oldest' }).click()
        await expect.poll(() => param(page, 'sort')).toBe('date-asc')
        await expect(
          page.getByRole('button', { name: 'Sort: Oldest' }),
        ).toBeVisible()

        // Search, debounced; nothing matches → Clear filters.
        const search = page.getByRole('searchbox', { name: 'Search media' })
        await search.fill('zz-nothing-matches-this-zz')
        await expect
          .poll(() => param(page, 'q'))
          .toBe('zz-nothing-matches-this-zz')
        await expect(
          page.getByRole('heading', { name: 'No media matches' }),
        ).toBeVisible()
        await axe(page, testInfo, options, colorScheme)
        await page.getByRole('button', { name: 'Clear filters' }).click()
        await expect.poll(() => param(page, 'q')).toBeNull()
        await expect(search).toHaveValue('')
        await expect(tiles(page).first()).toBeVisible()
        // Sort isn't a filter: it stays.
        expect(param(page, 'sort')).toBe('date-asc')
        expect(outside, 'requests outside the sub-path').toEqual([])
      })

      test('selection bar, quick peek and the layout controls', async ({
        page,
      }, testInfo) => {
        await openLibrary(page)
        const first = tiles(page).first()
        const second = tiles(page).nth(1)
        const third = tiles(page).nth(2)
        await first.click()
        await second.click({ modifiers: ['ControlOrMeta'] })

        // At 2 selected the selection bar replaces the toolbar.
        const bar = page.getByRole('group', { name: 'Selection' })
        await expect(bar).toBeVisible()
        await expect(bar.getByText('2 selected')).toBeVisible()
        await expect(
          page.getByRole('searchbox', { name: 'Search media' }),
        ).toBeHidden()
        await axe(page, testInfo, options, colorScheme)
        // Esc clears; the toolbar comes back.
        await page.keyboard.press('Escape')
        await expect(bar).toBeHidden()
        await expect(
          page.getByRole('searchbox', { name: 'Search media' }),
        ).toBeVisible()

        // Quick peek follows the arrows and doesn't touch the URL.
        await first.click()
        const url = page.url()
        await page.keyboard.press('Space')
        const firstName = (await first.getAttribute('aria-label')) ?? ''
        await expect(
          page.getByRole('figure', { name: `Quick peek: ${firstName}` }),
        ).toBeVisible()
        await axe(page, testInfo, options, colorScheme)
        await page.keyboard.press('ArrowRight')
        const secondName = (await second.getAttribute('aria-label')) ?? ''
        await expect(
          page.getByRole('figure', { name: `Quick peek: ${secondName}` }),
        ).toBeVisible()
        await expect(second).toBeFocused()
        await page.keyboard.press('Escape')
        await expect(page.locator('[data-mm-peek]')).toBeHidden()
        expect(page.url()).toBe(url)
        // Enter from the peek opens detail.
        await page.keyboard.press('Space')
        await expect(page.locator('[data-mm-peek]')).toBeVisible()
        await page.keyboard.press('Enter')
        await expect(page.getByRole('region', { name: 'Detail' })).toBeVisible()
        await expect(page.locator('[data-mm-peek]')).toBeHidden()
        await page.keyboard.press('Escape')
        await expect(page.getByRole('region', { name: 'Detail' })).toBeHidden()

        // Layout and density from the toolbar and the keys.
        await page.getByRole('button', { name: 'Square layout' }).click()
        await expect.poll(() => param(page, 'layout')).toBe('square')
        await expect(page.getByRole('grid', { name: 'Media' })).toHaveAttribute(
          'data-layout',
          'square',
        )
        await third.click()
        await page.keyboard.press('+')
        await expect.poll(() => param(page, 'density')).toBe('3')
        await expect(third).toBeFocused()
        await page.keyboard.press('l')
        await expect.poll(() => param(page, 'layout')).toBeNull()
        await axe(page, testInfo, options, colorScheme)
      })
    })
  }
}
