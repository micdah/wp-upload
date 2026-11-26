import type { CDPSession, Locator, Page, TestInfo } from '@playwright/test'
import { COLOR_SCHEMES, expectNoAxeViolations } from './axe.ts'
import { expect, test } from './fixtures.ts'

// Track A2 (detail mode) end to end, shared by the mock and live projects:
// the filmstrip, zoom and pan, the stage per media type with the player,
// the More menu, and swipe to step on a touch screen. Every flow runs in
// both colour schemes, with axe on each screen.
//
// - mock: the VITE_MOCK build under /wp-upload-mock/ (the fake library,
//   with the dev fixtures as its video, audio and PDF files);
// - live: the production image under /wp-upload/ against the stack's
//   WordPress with the `small` seed.

export type DetailOptions = {
  // Runs before each test, e.g. logging in for the live project.
  prepare?: (page: Page) => Promise<void>
  // Elements axe should skip (the mock's dev scenario switcher).
  axeExclude?: string[]
  // An archive to deep-link to (the mock has one; the live seed has none).
  archiveId: number | null
  // Videos have a poster (the mock draws one; WordPress makes none itself).
  videoPosters: boolean
}

const LIBRARY = './?view=library'

function tiles(page: Page): Locator {
  return page.locator('[data-mm-tile]')
}

function detailOf(page: Page): Locator {
  return page.getByRole('region', { name: 'Detail' })
}

function strip(page: Page): Locator {
  return page.getByRole('grid', { name: 'Filmstrip' })
}

function itemInUrl(page: Page): string | null {
  return new URL(page.url()).searchParams.get('item')
}

/** Opens the library (optionally filtered) and detail on its nth item. */
async function openDetail(page: Page, query = '', index = 0): Promise<Locator> {
  await page.goto(`${LIBRARY}${query}`)
  const tile = tiles(page).nth(index)
  await expect(tile).toBeVisible({ timeout: 20_000 })
  await tile.dblclick()
  const detail = detailOf(page)
  await expect(detail).toBeVisible()
  await expect(detail.locator('[data-mm-stage-media]')).toBeVisible()
  return detail
}

async function axe(
  page: Page,
  testInfo: TestInfo,
  options: DetailOptions,
  colorScheme: (typeof COLOR_SCHEMES)[number],
): Promise<void> {
  // Let fades and transitions settle, so axe measures final colours.
  await page.waitForTimeout(400)
  await expectNoAxeViolations(page, testInfo, {
    colorScheme,
    exclude: options.axeExclude,
  })
}

/** A real one-finger swipe through the DevTools protocol. */
async function swipe(
  cdp: CDPSession,
  from: { x: number; y: number },
  dx: number,
): Promise<void> {
  const steps = 8
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: from.x, y: from.y }],
  })
  for (let step = 1; step <= steps; step += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: from.x + (dx * step) / steps, y: from.y }],
    })
  }
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
  })
}

export function defineDetailTests(options: DetailOptions): void {
  for (const colorScheme of COLOR_SCHEMES) {
    test.describe(`detail mode (${colorScheme})`, () => {
      test.use({ colorScheme })

      test.beforeEach(async ({ page }) => {
        await options.prepare?.(page)
      })

      test('the filmstrip: current item centred, a click steps, Ctrl+click selects', async ({
        page,
      }, testInfo) => {
        const detail = await openDetail(page, '', 2)
        const current = itemInUrl(page)
        const cell = strip(page).locator(`[data-mm-film="${current}"]`)
        await expect(cell).toHaveAttribute('aria-current', 'true')
        // Centred in the strip.
        await expect
          .poll(async () => {
            const box = await strip(page).boundingBox()
            const own = await cell.boundingBox()
            if (!box || !own) return Number.POSITIVE_INFINITY
            return Math.abs(own.x + own.width / 2 - (box.x + box.width / 2))
          })
          .toBeLessThan(2)
        await axe(page, testInfo, options, colorScheme)

        // A click steps there and replaces the history entry.
        const length = await page.evaluate(() => history.length)
        const target = cell.locator('xpath=following-sibling::*[1]')
        const targetId = await target.getAttribute('data-mm-film')
        await target.click()
        expect(itemInUrl(page)).toBe(targetId)
        expect(await page.evaluate(() => history.length)).toBe(length)
        await expect(target).toHaveAttribute('aria-current', 'true')

        // Ctrl+click toggles the selection without stepping.
        const other = target.locator('xpath=following-sibling::*[1]')
        await other.click({ modifiers: ['ControlOrMeta'] })
        await expect(other).toHaveAttribute('aria-selected', 'true')
        expect(itemInUrl(page)).toBe(targetId)

        // Keyboard: ←/→ step and focus follows inside the strip.
        await target.focus()
        await page.keyboard.press('ArrowRight')
        await expect(other).toHaveAttribute('aria-current', 'true')
        await expect(other).toBeFocused()
        await expect(detail).toBeVisible()
      })

      test('zoom: Z, + and −, drag to pan, reset when stepping', async ({
        page,
      }) => {
        const detail = await openDetail(page, '&type=image')
        const zoom = detail.getByRole('button', { name: /^Zoom/ })
        await expect(zoom).toContainText('Fit')
        await page.keyboard.press('z')
        await expect(zoom).toContainText('100 %')
        await page.keyboard.press('+')
        await expect(zoom).toContainText('200 %')
        const stage = page.locator('[data-mm-stage]')
        await expect(stage).toHaveAttribute('data-zoomed', '')
        await expect
          .poll(() =>
            stage.evaluate(
              (element) => element.scrollWidth > element.clientWidth,
            ),
          )
          .toBe(true)
        const before = await stage.evaluate((element) => element.scrollLeft)
        const box = await stage.boundingBox()
        if (!box) throw new Error('no stage box')
        const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
        await page.mouse.move(centre.x, centre.y)
        await page.mouse.down()
        await page.mouse.move(centre.x - 120, centre.y, { steps: 6 })
        await expect(stage).toHaveAttribute('data-panning', '')
        await page.mouse.up()
        await expect
          .poll(() => stage.evaluate((element) => element.scrollLeft))
          .toBeGreaterThan(before + 60)
        await page.keyboard.press('ArrowRight')
        await expect(zoom).toContainText('Fit')
        await expect(stage).not.toHaveAttribute('data-zoomed', '')
      })

      test('video: poster, play, time, scrubber and duration', async ({
        page,
      }, testInfo) => {
        const detail = await openDetail(page, '&type=video')
        const video = detail.locator('video')
        await expect(video).toBeAttached()
        if (options.videoPosters) {
          await expect(video).toHaveAttribute('poster', /.+/)
        }
        const player = detail.getByRole('group', { name: /^Player/ })
        await expect(player.getByRole('button', { name: 'Play' })).toBeVisible()
        await expect(player.getByText(/^\d+:\d\d$/).first()).toBeVisible()
        await expect(
          detail.getByRole('button', { name: /^Zoom/ }),
        ).toHaveAttribute('aria-disabled', 'true')
        await axe(page, testInfo, options, colorScheme)
      })

      test('audio: a card that plays, pauses with Space and seeks', async ({
        page,
      }, testInfo) => {
        const detail = await openDetail(page, '&type=audio')
        const audio = detail.locator('audio')
        await expect(
          detail.getByRole('group', { name: /^Player/ }),
        ).toBeVisible()
        await axe(page, testInfo, options, colorScheme)
        await detail.getByRole('button', { name: 'Play' }).click()
        await expect
          .poll(() =>
            audio.evaluate((element: HTMLAudioElement) => element.paused),
          )
          .toBe(false)
        await expect(
          detail.getByRole('button', { name: 'Pause' }),
        ).toBeVisible()
        // Space anywhere in detail mode (the region) pauses.
        await detail.focus()
        await page.keyboard.press(' ')
        await expect
          .poll(() =>
            audio.evaluate((element: HTMLAudioElement) => element.paused),
          )
          .toBe(true)
        // The scrubber's arrows seek; they don't step to another item.
        const item = itemInUrl(page)
        const seek = detail.getByRole('slider', { name: 'Seek' })
        await seek.focus()
        await page.keyboard.press('ArrowRight')
        expect(itemInUrl(page)).toBe(item)
        await expect
          .poll(() =>
            audio.evaluate((element: HTMLAudioElement) => element.currentTime),
          )
          .toBeGreaterThan(0)
      })

      test('PDF: a paper sheet with Open PDF and Download', async ({
        page,
      }, testInfo) => {
        const detail = await openDetail(page, '&type=document')
        const stage = page.locator('[data-mm-stage]')
        await expect(stage.locator('[data-mm-stage-media]')).toBeVisible()
        await expect(stage.getByText(/^PDF( · |$)/)).toBeVisible()
        const open = stage.getByRole('link', { name: 'Open PDF' })
        await expect(open).toHaveAttribute('target', '_blank')
        await expect(
          stage.getByRole('link', { name: 'Download' }),
        ).toHaveAttribute('href', /^api\/library\/items\/\d+\/download/)
        await expect(detail).toBeVisible()
        await axe(page, testInfo, options, colorScheme)
      })

      test('an archive: a card with Download', async ({ page }) => {
        test.skip(options.archiveId === null, 'the live seed has no archive')
        await page.goto(`${LIBRARY}&item=${options.archiveId}`)
        const card = detailOf(page).locator('[data-mm-stage-media]')
        await expect(card).toContainText('ZIP archive', { timeout: 20_000 })
        await expect(card.getByRole('link', { name: 'Download' })).toBeVisible()
      })

      test('the More menu: Copy URL, Open in wp-admin, Esc layering', async ({
        page,
        context,
      }, testInfo) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write'])
        const detail = await openDetail(page)
        await detail.getByRole('button', { name: 'More actions' }).click()
        const menu = page.getByRole('menu')
        await expect(menu).toBeVisible()
        await expect(
          menu.getByRole('menuitem', { name: 'Open in wp-admin' }),
        ).toHaveAttribute('href', /post\.php\?post=\d+&action=edit/)
        await axe(page, testInfo, options, colorScheme)
        await menu.getByRole('menuitem', { name: 'Copy URL' }).click()
        await expect(page.getByText('URL copied').first()).toBeAttached()
        const copied = await page.evaluate(() => navigator.clipboard.readText())
        expect(copied).toMatch(/^https?:\/\//)
        // Esc closes the menu first, then detail.
        await detail.getByRole('button', { name: 'More actions' }).click()
        await expect(menu).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(menu).toBeHidden()
        await expect(detail).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(detail).toBeHidden()
      })

      test('touch: a swipe steps to the next item', async ({ browser }) => {
        const context = await browser.newContext({
          hasTouch: true,
          colorScheme,
          viewport: { width: 1024, height: 768 },
        })
        const page = await context.newPage()
        await options.prepare?.(page)
        await openDetail(page, '', 1)
        const before = itemInUrl(page)
        const stage = page.locator('[data-mm-stage]')
        const box = await stage.boundingBox()
        if (!box) throw new Error('no stage box')
        const cdp = await context.newCDPSession(page)
        await swipe(
          cdp,
          { x: box.x + box.width / 2, y: box.y + box.height / 2 },
          -180,
        )
        await expect.poll(() => itemInUrl(page)).not.toBe(before)
        const after = itemInUrl(page)
        // Back the other way returns.
        await swipe(
          cdp,
          { x: box.x + box.width / 2, y: box.y + box.height / 2 },
          180,
        )
        await expect.poll(() => itemInUrl(page)).toBe(before)
        expect(after).not.toBeNull()
        await context.close()
      })
    })
  }
}
