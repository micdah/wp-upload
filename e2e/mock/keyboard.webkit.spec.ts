import { devices, type Locator, type Page } from '@playwright/test'
import { expect, test } from '../support/fixtures.ts'

// The slice's keyboard flow in WebKit (mm/m2-keys), against the mock build:
// an iPad with a hardware keyboard (touch, `tap()`), and a WebKit desktop
// with a mouse. On the owner's iPad no shortcut worked after the feel-review
// fixes; this keeps the WebKit side of the flow covered: focus after a tap
// or click, keys that land on <body>, detail's ←/→ after a tap on Next, and
// focus returning to the right tile after Esc.
//
// Playwright's WebKit is the Linux port, so it can't show iPadOS's own part
// (whether Safari hands the keyboard to the page at all): see the selection
// guard in client/src/media-manager/core/ui/noSelect.ts for that.
//
// Part of the `mock` project, so `dev/run test e2e-mock` runs it. WebKit
// doesn't read the runner's NSS database, where the dev CA is trusted, so
// this file accepts the proxy's certificate instead. The mock needs nothing
// else from the stack.

test.use({ browserName: 'webkit', ignoreHTTPSErrors: true })

const LIBRARY = './?view=library'

function tiles(page: Page): Locator {
  return page.getByRole('gridcell')
}

function detail(page: Page): Locator {
  return page.getByRole('region', { name: 'Detail' })
}

function app(page: Page): Locator {
  return page.locator('[data-mm-app]')
}

function itemInUrl(page: Page): string | null {
  return new URL(page.url()).searchParams.get('item')
}

async function idOf(tile: Locator): Promise<string> {
  return (await tile.getAttribute('data-mm-tile')) ?? ''
}

async function openLibrary(page: Page): Promise<void> {
  await page.goto(LIBRARY)
  await expect(tiles(page).first()).toBeVisible({ timeout: 20_000 })
}

/** The tile with keyboard focus, or null. */
function focusedTile(page: Page): Promise<string | null> {
  return page.evaluate(
    () =>
      (document.activeElement as HTMLElement | null)?.dataset.mmTile ?? null,
  )
}

/** The ids of the selected tiles. */
function selectedTiles(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-mm-tile][aria-selected="true"]')].map(
      (tile) => (tile as HTMLElement).dataset.mmTile ?? '',
    ),
  )
}

/** F and I toggle the panels whatever has focus. */
async function expectPanelKeys(page: Page): Promise<void> {
  for (const [key, attribute] of [
    ['f', 'data-folders'],
    ['i', 'data-inspector'],
  ] as const) {
    const before = await app(page).getAttribute(attribute)
    await page.keyboard.press(key)
    await expect(app(page)).not.toHaveAttribute(attribute, before ?? '')
    await page.keyboard.press(key)
    await expect(app(page)).toHaveAttribute(attribute, before ?? '')
  }
}

type Press = (target: Locator) => Promise<void>

function defineKeyboardFlow(press: Press): void {
  test('keys work on a fresh page, before anything is tapped', async ({
    page,
  }) => {
    await openLibrary(page)
    expect(await page.evaluate(() => document.activeElement?.tagName)).toBe(
      'BODY',
    )
    const first = await idOf(tiles(page).first())
    const second = await idOf(tiles(page).nth(1))
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => focusedTile(page)).toBe(first)
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => focusedTile(page)).toBe(second)
    expect(await selectedTiles(page)).toEqual([second])
    await expectPanelKeys(page)
  })

  test('tap a tile, then arrows, Enter, ←/→ in detail, Esc, F and I', async ({
    page,
  }) => {
    await openLibrary(page)
    const ids = await Promise.all(
      [1, 2, 3].map((index) => idOf(tiles(page).nth(index))),
    )
    await press(tiles(page).nth(1))
    await expect.poll(() => focusedTile(page)).toBe(ids[0])
    await expect(tiles(page).nth(1)).toHaveAttribute('aria-selected', 'true')

    await page.keyboard.press('ArrowRight')
    await expect.poll(() => focusedTile(page)).toBe(ids[1])
    expect(await selectedTiles(page)).toEqual([ids[1]])
    await expectPanelKeys(page)

    await page.keyboard.press('Enter')
    await expect(detail(page)).toBeVisible()
    expect(itemInUrl(page)).toBe(ids[1])
    // Detail focuses itself, so ←/→ work at once.
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.activeElement?.closest('[data-mm-detail]') !== null &&
            document.activeElement !== document.body,
        ),
      )
      .toBe(true)
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => itemInUrl(page)).toBe(ids[2])
    await page.keyboard.press('ArrowLeft')
    await expect.poll(() => itemInUrl(page)).toBe(ids[1])
    await expectPanelKeys(page)

    await page.keyboard.press('Escape')
    await expect(detail(page)).toBeHidden()
    await expect.poll(() => focusedTile(page)).toBe(ids[1])
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => focusedTile(page)).toBe(ids[2])
    expect(await selectedTiles(page)).toEqual([ids[2]])
  })

  test('a tap on Next leaves ←/→ and Esc working', async ({ page }) => {
    await openLibrary(page)
    const ids = await Promise.all(
      [0, 1, 2, 3].map((index) => idOf(tiles(page).nth(index))),
    )
    await press(tiles(page).first())
    await page.keyboard.press('Enter')
    await expect(detail(page)).toBeVisible()
    await press(detail(page).getByRole('button', { name: 'Next item' }))
    await expect.poll(() => itemInUrl(page)).toBe(ids[1])
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => itemInUrl(page)).toBe(ids[2])
    await page.keyboard.press('ArrowLeft')
    await expect.poll(() => itemInUrl(page)).toBe(ids[1])
    await page.keyboard.press('Escape')
    await expect(detail(page)).toBeHidden()
    await expect.poll(() => focusedTile(page)).toBe(ids[1])
  })

  test('an arrow right after Esc moves on from the returned tile', async ({
    page,
  }) => {
    await openLibrary(page)
    const ids = await Promise.all(
      [0, 1, 2].map((index) => idOf(tiles(page).nth(index))),
    )
    await press(tiles(page).first())
    await page.keyboard.press('Enter')
    await expect(detail(page)).toBeVisible()
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => itemInUrl(page)).toBe(ids[1])
    // No waiting for the morph back: focus and selection must agree.
    await page.keyboard.press('Escape')
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => selectedTiles(page)).toEqual([ids[2]])
    await expect.poll(() => focusedTile(page)).toBe(ids[2])
    // Give a late focus change (the morph finishing) the chance to happen.
    await page.waitForTimeout(800)
    expect(await focusedTile(page)).toBe(ids[2])
    expect(await selectedTiles(page)).toEqual([ids[2]])
  })
}

test.describe('iPad (touch, hardware keyboard)', () => {
  const { defaultBrowserType: _ignored, ...iPad } =
    devices['iPad Pro 11 landscape']
  test.use(iPad)
  defineKeyboardFlow((target) => target.tap())
})

test.describe('desktop (mouse)', () => {
  defineKeyboardFlow((target) => target.click())

  test('double- and triple-clicks on the chrome select no text', async ({
    page,
  }) => {
    await openLibrary(page)
    const ids = await Promise.all(
      [0, 1, 2, 3, 4, 5].map((index) => idOf(tiles(page).nth(index))),
    )
    await tiles(page).first().click()
    await page.keyboard.press('Enter')
    await expect(detail(page)).toBeVisible()
    // WebKit selects the word under a double-click unless the selection
    // guard cancels it (no user-select: none any more, mm/m2-keys).
    await detail(page).getByRole('heading').dblclick()
    expect(await page.evaluate(() => getSelection()?.toString() ?? '')).toBe('')
    const next = detail(page).getByRole('button', { name: 'Next item' })
    await next.dblclick()
    await next.click({ clickCount: 3 })
    await expect.poll(() => itemInUrl(page)).toBe(ids[5])
    expect(await page.evaluate(() => getSelection()?.toString() ?? '')).toBe('')
    // And the keys still work afterwards.
    await page.keyboard.press('ArrowLeft')
    await expect.poll(() => itemInUrl(page)).toBe(ids[4])
  })
})
