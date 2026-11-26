import type { Locator, Page, TestInfo } from '@playwright/test'
import { COLOR_SCHEMES, expectNoAxeViolations } from '../support/axe.ts'
import { expect, test } from '../support/fixtures.ts'
import { logIn } from '../support/session.ts'

// Track A4 (inspector, wave A) against the production image under
// /wp-upload/, logged in, on the stack's WordPress (the `small` seed):
// Save & next and batch editing persist across a reload, Undo puts the
// old values back, attach and detach go through the post picker (published
// posts only, D21), and the Usage panel answers from the plugin's index.
//
// Each test snapshots the items it is about to change (through the app's
// own API), and afterEach writes the snapshot back, so a failing test
// doesn't leave the seed changed.

const LIBRARY = './?view=library'

type Snapshot = {
  id: number
  title: string
  alt: string
  caption: string
  description: string
  post: number | null
}

function tiles(page: Page): Locator {
  return page.getByRole('gridcell')
}

/**
 * A toast with this text. The live region repeats what toasts say, so
 * page-wide text queries match twice; this looks in notifications only.
 */
function toastWith(page: Page, text: string | RegExp): Locator {
  return page.locator('.mantine-Notification-root').filter({ hasText: text })
}

function panel(page: Page): Locator {
  return page.getByTestId('inspector-panel')
}

async function openLibrary(page: Page): Promise<void> {
  await page.goto(LIBRARY)
  await expect(tiles(page).first()).toBeVisible({ timeout: 20_000 })
}

async function tileId(tile: Locator): Promise<number> {
  return Number(await tile.getAttribute('data-mm-tile'))
}

async function selectOnly(page: Page, id: number): Promise<void> {
  await page.locator(`[data-mm-tile="${id}"]`).click()
  await expect(page.locator(`[data-mm-tile="${id}"]`)).toHaveAttribute(
    'aria-selected',
    'true',
  )
}

async function axe(
  page: Page,
  testInfo: TestInfo,
  colorScheme: (typeof COLOR_SCHEMES)[number],
): Promise<void> {
  await page.waitForTimeout(400)
  await expectNoAxeViolations(page, testInfo, { colorScheme })
}

/** The items' current metadata, read through `items?view=full`. */
async function snapshot(page: Page, ids: number[]): Promise<Snapshot[]> {
  const response = await page.request.get(
    `api/library/items?ids=${ids.join(',')}&view=full`,
  )
  expect(response.status()).toBe(200)
  const body = (await response.json()) as {
    items: (Omit<Snapshot, 'post'> & {
      attachedTo: { postId: number } | null
    })[]
  }
  return body.items.map((item) => ({
    id: item.id,
    title: item.title,
    alt: item.alt,
    caption: item.caption,
    description: item.description,
    post: item.attachedTo?.postId ?? null,
  }))
}

/** Writes snapshots back with `PATCH items/:id`. */
async function restore(page: Page, snapshots: Snapshot[]): Promise<void> {
  for (const { id, ...fields } of snapshots) {
    const response = await page.request.patch(`api/library/items/${id}`, {
      data: fields,
    })
    expect(response.status(), `restore item ${id}`).toBe(200)
  }
}

for (const colorScheme of COLOR_SCHEMES) {
  test.describe(`inspector, wave A (${colorScheme})`, () => {
    test.use({ colorScheme })

    let changed: Snapshot[] = []

    test.beforeEach(async ({ page }) => {
      changed = []
      await logIn(page)
    })

    test.afterEach(async ({ page }) => {
      await restore(page, changed)
    })

    test('Save & next saves the title and moves on; it survives a reload', async ({
      page,
    }) => {
      await openLibrary(page)
      const first = await tileId(tiles(page).nth(0))
      const second = await tileId(tiles(page).nth(1))
      changed = await snapshot(page, [first, second])
      await selectOnly(page, first)
      const title = panel(page).getByLabel('Title', { exact: true })
      const original = await title.inputValue()
      const text = `${original} (A4 ${colorScheme})`
      await title.fill(text)
      await page.keyboard.press('Enter')
      await expect(page.locator(`[data-mm-tile="${second}"]`)).toHaveAttribute(
        'aria-selected',
        'true',
      )
      await expect(title).toBeFocused()

      await page.reload()
      await expect(tiles(page).first()).toBeVisible({ timeout: 20_000 })
      await selectOnly(page, first)
      await expect(title).toHaveValue(text)
    })

    test('batch caption on two items, then Undo restores both', async ({
      page,
    }, testInfo) => {
      await openLibrary(page)
      const first = await tileId(tiles(page).nth(0))
      const second = await tileId(tiles(page).nth(1))
      changed = await snapshot(page, [first, second])
      await selectOnly(page, second)
      await page
        .locator(`[data-mm-tile="${first}"]`)
        .click({ modifiers: ['ControlOrMeta'] })
      await expect(panel(page).getByText('Editing 2 items')).toBeVisible()
      await axe(page, testInfo, colorScheme)
      const caption = panel(page).getByLabel('Caption', { exact: true })
      const text = `A4 batch ${colorScheme} ${Date.now()}`
      await caption.fill(text)
      await page.keyboard.press('Control+Enter')
      await expect(toastWith(page, 'Updated caption on 2 items')).toBeVisible()

      await page.reload()
      await expect(tiles(page).first()).toBeVisible({ timeout: 20_000 })
      await selectOnly(page, first)
      await expect(caption).toHaveValue(text)

      // Undo is gone after a reload; batch again, then Undo that one.
      await page
        .locator(`[data-mm-tile="${second}"]`)
        .click({ modifiers: ['ControlOrMeta'] })
      await expect(panel(page).getByText('Editing 2 items')).toBeVisible()
      await caption.fill(`${text} again`)
      await page.keyboard.press('Control+Enter')
      await expect(toastWith(page, 'Updated caption on 2 items')).toBeVisible()
      await toastWith(page, 'Updated caption on 2 items')
        .getByRole('button', { name: 'Undo' })
        .click()
      await expect(toastWith(page, 'Restored caption on 2 items')).toBeVisible()
      await expect(caption).toHaveValue(text)
    })

    test('attach and detach through the post picker (published posts, D21)', async ({
      page,
    }, testInfo) => {
      await openLibrary(page)
      const id = await tileId(tiles(page).nth(2))
      changed = await snapshot(page, [id])
      await selectOnly(page, id)
      await page
        .getByRole('navigation', { name: 'Inspector panels' })
        .getByRole('button', { name: /^Usage/ })
        .click()
      const attachedTo = panel(page).getByTestId('attached-to')
      // Start detached, whatever the seed says.
      const detach = panel(page).getByRole('button', { name: 'Detach' })
      if (await detach.isVisible()) {
        await detach.click()
        await expect(toastWith(page, /Detached from/)).toBeVisible()
      }
      await expect(attachedTo).toHaveText('Not attached')

      await panel(page).getByRole('button', { name: 'Attach to…' }).click()
      const picker = page.getByRole('dialog', {
        name: 'Attach to a post or page',
      })
      const options = picker.getByRole('option')
      await expect(options.first()).toBeVisible()
      // Core search lists published posts only.
      for (const meta of await options.allTextContents()) {
        expect(meta).toMatch(/Published/)
      }
      await axe(page, testInfo, colorScheme)
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Enter')
      await expect(toastWith(page, /Attached to “/)).toBeVisible()
      await expect(picker).toBeHidden()

      // WordPress kept it.
      await page.reload()
      await expect(tiles(page).first()).toBeVisible({ timeout: 20_000 })
      await selectOnly(page, id)
      await expect(attachedTo).not.toHaveText('Not attached')
      const [after] = await snapshot(page, [id])
      expect(after?.post).not.toBeNull()

      await panel(page).getByRole('button', { name: 'Detach' }).click()
      await expect(attachedTo).toHaveText('Not attached')
      await toastWith(page, /Detached from/)
        .getByRole('button', { name: 'Undo' })
        .click()
      await expect(attachedTo).not.toHaveText('Not attached')
    })

    test('the Usage panel answers from the index', async ({
      page,
    }, testInfo) => {
      await openLibrary(page)
      await tiles(page).first().click()
      await page
        .getByRole('navigation', { name: 'Inspector panels' })
        .getByRole('button', { name: /^Usage/ })
        .click()
      await expect(panel(page).getByText(/aren’t detected/)).toBeVisible()
      await axe(page, testInfo, colorScheme)
    })
  })
}
