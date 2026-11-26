import type { Locator, Page, TestInfo } from '@playwright/test'
import { COLOR_SCHEMES, expectNoAxeViolations } from './axe.ts'
import { expect, test } from './fixtures.ts'

// The M2 vertical slice end to end (plan §7, M2 gate), shared by the mock
// and live projects: boot → grid → detail → editing alt text, under the
// project's sub-path, in both colour schemes, with axe on every screen.
//
// - mock: the VITE_MOCK build under /wp-upload-mock/ (the fake library).
// - live: the production image under /wp-upload/ against the stack's
//   WordPress with the `small` seed; saved text is checked after a reload.

export type SliceOptions = {
  // Runs before each test, e.g. logging in for the live project.
  prepare?: (page: Page) => Promise<void>
  // The backend keeps saved text across a reload (live, not the mock).
  persists: boolean
  // Elements axe should skip (the mock's dev scenario switcher).
  axeExclude?: string[]
  // How the autosave test slows writes down, so "Saving…" is observable:
  // a query string for the mock (`&mock-latency=…`), or a delaying route
  // for the live app (the mock answers inside a service worker, which
  // Playwright's routes don't see).
  slowWrites: { query: string } | { route: true }
}

const WRITE_DELAY_MS = 600

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

async function openLibrary(page: Page, query = ''): Promise<void> {
  await page.goto(`${LIBRARY}${query}`)
  await expect(tiles(page).first()).toBeVisible({ timeout: 20_000 })
}

/** Holds every item PATCH for WRITE_DELAY_MS (live app; see slowWrites). */
async function delayItemPatches(page: Page): Promise<void> {
  await page.route('**/api/library/items/*', async (route) => {
    if (route.request().method() === 'PATCH') {
      await new Promise((resolve) => setTimeout(resolve, WRITE_DELAY_MS))
    }
    await route.continue()
  })
}

/** Commits the focused field with Ctrl+Enter and waits until it's saved. */
async function commitAndWait(field: Locator, page: Page): Promise<void> {
  await page.keyboard.press('Control+Enter')
  await expect(field.getByText('Saved')).toBeVisible()
}

async function itemOf(tile: Locator): Promise<number> {
  return Number(await tile.getAttribute('data-mm-tile'))
}

function itemInUrl(page: Page): string | null {
  return new URL(page.url()).searchParams.get('item')
}

/** The first tile whose item is an image (it has an Alt text field). */
async function firstImageTile(page: Page): Promise<Locator> {
  const count = await tiles(page).count()
  for (let index = 0; index < count; index++) {
    const tile = tiles(page).nth(index)
    await tile.click()
    const alt = page.getByLabel('Alt text', { exact: true })
    if (await alt.isVisible({ timeout: 2000 }).catch(() => false)) {
      return tile
    }
  }
  throw new Error('no image tile on the first screen')
}

async function axe(
  page: Page,
  testInfo: TestInfo,
  options: SliceOptions,
  colorScheme: (typeof COLOR_SCHEMES)[number],
): Promise<void> {
  // Let fades and transitions settle, so axe measures final colours.
  await page.waitForTimeout(400)
  await expectNoAxeViolations(page, testInfo, {
    colorScheme,
    exclude: options.axeExclude,
  })
}

export function defineSliceTests(options: SliceOptions): void {
  for (const colorScheme of COLOR_SCHEMES) {
    test.describe(`slice (${colorScheme})`, () => {
      test.use({ colorScheme })

      test.beforeEach(async ({ page }) => {
        await options.prepare?.(page)
      })

      test('boots into the grid under the sub-path and selects by click and keys', async ({
        page,
        baseURL,
      }, testInfo) => {
        const outside = trackRequestsOutside(page, base(baseURL))
        await openLibrary(page)
        await expect(page.getByRole('grid', { name: 'Media' })).toBeVisible()
        // Pictures fade in over reserved boxes.
        await expect(
          page.locator('[data-mm-tile] img[data-loaded]').first(),
        ).toBeAttached({ timeout: 15_000 })
        await axe(page, testInfo, options, colorScheme)

        const second = tiles(page).nth(1)
        await second.click()
        await expect(second).toHaveAttribute('aria-selected', 'true')
        await page.keyboard.press('ArrowRight')
        const third = tiles(page).nth(2)
        await expect(third).toHaveAttribute('aria-selected', 'true')
        await expect(third).toBeFocused()
        await expect(second).toHaveAttribute('aria-selected', 'false')
        expect(outside, 'requests outside the sub-path').toEqual([])
      })

      test('opens detail with Enter, steps with ←/→, and Back returns to the grid', async ({
        page,
      }, testInfo) => {
        await openLibrary(page)
        const first = tiles(page).first()
        const second = tiles(page).nth(1)
        const firstId = await itemOf(first)
        const secondId = await itemOf(second)
        await first.click()
        await page.keyboard.press('Enter')
        const detail = page.getByRole('region', { name: 'Detail' })
        await expect(detail).toBeVisible()
        expect(itemInUrl(page)).toBe(String(firstId))
        await expect(
          detail.locator('img, video, audio, a').first(),
        ).toBeVisible()
        await axe(page, testInfo, options, colorScheme)

        // Stepping replaces the entry; the first item has no previous one.
        await page.keyboard.press('ArrowRight')
        await expect.poll(() => itemInUrl(page)).toBe(String(secondId))
        await page.keyboard.press('ArrowLeft')
        await page.keyboard.press('ArrowLeft')
        await expect.poll(() => itemInUrl(page)).toBe(String(firstId))
        await expect(page.getByText('First item in this view')).toBeAttached()

        // The browser's Back leaves detail (one pushed entry) to the grid.
        await page.goBack()
        await expect(detail).toBeHidden()
        expect(itemInUrl(page)).toBeNull()
        await expect(page.locator(`[data-mm-tile="${firstId}"]`)).toBeVisible()

        // Esc leaves too, and focus lands on the tile.
        await page.locator(`[data-mm-tile="${secondId}"]`).dblclick()
        await expect(detail).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(detail).toBeHidden()
        await expect(page.locator(`[data-mm-tile="${secondId}"]`)).toBeFocused()
      })

      test('a ?item= deep link opens detail over the grid', async ({
        page,
      }) => {
        await openLibrary(page)
        const id = await itemOf(tiles(page).nth(3))
        await page.goto(`./?view=library&item=${id}`)
        const detail = page.getByRole('region', { name: 'Detail' })
        await expect(detail).toBeVisible({ timeout: 20_000 })
        await expect(detail.getByText(/^4 \/ \d+$/)).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(detail).toBeHidden()
        await expect(page.locator(`[data-mm-tile="${id}"]`)).toBeVisible()
      })

      test('edits alt text with autosave: Unsaved → Saving… → Saved', async ({
        page,
      }, testInfo) => {
        const slow = options.slowWrites
        if ('route' in slow) {
          await delayItemPatches(page)
        }
        await openLibrary(page, 'query' in slow ? slow.query : '')
        const tile = await firstImageTile(page)
        const id = await itemOf(tile)
        const altField = page.getByTestId('field-alt')
        const titleField = page.getByTestId('field-title')
        const alt = page.getByLabel('Alt text', { exact: true })
        const title = page.getByLabel('Title', { exact: true })
        const original = await alt.inputValue()
        const originalTitle = await title.inputValue()
        const text = `Slice alt ${colorScheme} ${Date.now()}`

        await alt.fill(text)
        await expect(
          altField.getByText('Unsaved', { exact: true }),
        ).toBeVisible()
        await axe(page, testInfo, options, colorScheme)
        await page.keyboard.press('Control+Enter')
        await expect(altField.getByText('Saving…')).toBeVisible()
        await expect(altField.getByText('Saved')).toBeVisible()

        // Esc reverts unsaved text and keeps the field.
        await alt.fill('not kept')
        await page.keyboard.press('Escape')
        await expect(alt).toHaveValue(text)
        await expect(alt).toBeFocused()

        // The title field commits on blur.
        await title.fill(`${originalTitle} (edited)`)
        await tile.click()
        await expect(titleField.getByText('Saving…')).toBeVisible()
        await expect(titleField.getByText('Saved')).toBeVisible()

        if (options.persists) {
          await page.reload()
          await expect(tiles(page).first()).toBeVisible({ timeout: 20_000 })
          await page.locator(`[data-mm-tile="${id}"]`).click()
          await expect(alt).toHaveValue(text)
          await expect(title).toHaveValue(`${originalTitle} (edited)`)
          // Put the seed back as it was, waiting for each save (the next
          // suite resets the database anyway).
          await alt.fill(original)
          await commitAndWait(altField, page)
          await title.fill(originalTitle)
          await commitAndWait(titleField, page)
          await page.reload()
          await expect(tiles(page).first()).toBeVisible({ timeout: 20_000 })
          await page.locator(`[data-mm-tile="${id}"]`).click()
          await expect(alt).toHaveValue(original)
          await expect(title).toHaveValue(originalTitle)
        }
      })

      test('stops at the last item too (D34)', async ({ page }) => {
        await openLibrary(page)
        await tiles(page).first().click()
        await page.keyboard.press('End')
        const focusedTile = () =>
          page.evaluate(
            () =>
              (document.activeElement as HTMLElement | null)?.dataset.mmTile ??
              null,
          )
        await expect
          .poll(focusedTile)
          .not.toBe(await itemOf(tiles(page).first()).then(String))
        const lastId = await focusedTile()
        expect(lastId).not.toBeNull()
        await page.keyboard.press('Enter')
        const detail = page.getByRole('region', { name: 'Detail' })
        await expect(detail).toBeVisible()
        expect(itemInUrl(page)).toBe(lastId)
        await page.keyboard.press('ArrowRight')
        await expect(page.getByText('Last item in this view')).toBeAttached()
        expect(itemInUrl(page)).toBe(lastId)
        await expect(
          detail.getByRole('button', {
            name: 'Next item',
            includeHidden: true,
          }),
        ).toHaveAttribute('aria-disabled', 'true')
      })
    })
  }
}
