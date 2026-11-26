import type { Locator, Page, TestInfo } from '@playwright/test'
import { COLOR_SCHEMES, expectNoAxeViolations } from '../support/axe.ts'
import { expect, test } from '../support/fixtures.ts'

// Track A4 (inspector, wave A) against the mock build under /wp-upload-mock/
// (the fake library): the summary and the alt-text pass, Save & next,
// batch editing with Undo, the item's sections, and the Usage panel, in
// both colour schemes with axe on each screen.

const LIBRARY = './?view=library'

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

async function openLibrary(page: Page, query = ''): Promise<void> {
  await page.goto(`${LIBRARY}${query}`)
  await expect(tiles(page).first()).toBeVisible({ timeout: 20_000 })
}

async function axe(
  page: Page,
  testInfo: TestInfo,
  colorScheme: (typeof COLOR_SCHEMES)[number],
): Promise<void> {
  // Let fades and transitions settle, so axe measures final colours.
  await page.waitForTimeout(400)
  await expectNoAxeViolations(page, testInfo, {
    colorScheme,
    // The mock's own dev scenario switcher isn't part of the app.
    exclude: ['[data-mock-devtools]'],
  })
}

function selectedTile(page: Page): Locator {
  return page.locator('[role="gridcell"][aria-selected="true"]')
}

async function selectedId(page: Page): Promise<number> {
  await expect(selectedTile(page)).toHaveCount(1)
  return Number(await selectedTile(page).getAttribute('data-mm-tile'))
}

for (const colorScheme of COLOR_SCHEMES) {
  test.describe(`inspector, wave A (${colorScheme})`, () => {
    test.use({ colorScheme })

    test('summary, then the alt-text pass walks the missing images with Enter', async ({
      page,
    }, testInfo) => {
      await openLibrary(page)
      await expect(
        panel(page).getByText(/^Nothing selected · \d+ items in view$/),
      ).toBeVisible()
      await expect(panel(page).getByText('missing alt text')).toBeVisible()
      await axe(page, testInfo, colorScheme)

      await panel(page)
        .getByRole('button', { name: 'Start alt-text pass' })
        .click()
      await expect(page).toHaveURL(/[?&]alt=missing/)
      const alt = panel(page).getByLabel('Alt text', { exact: true })
      await expect(alt).toBeFocused()
      await expect(page.getByTestId('alt-pass-strip')).toBeVisible()
      const first = await selectedId(page)
      await axe(page, testInfo, colorScheme)

      await alt.fill(`Pass ${colorScheme} one`)
      await page.keyboard.press('Enter')
      await expect.poll(() => selectedId(page)).not.toBe(first)
      await expect(alt).toBeFocused()
      await expect(alt).toHaveValue('')
      // The saved image left the filtered view.
      await expect(page.locator(`[data-mm-tile="${first}"]`)).toHaveCount(0)
    })

    test('Save & next in the title; Shift+Enter goes back', async ({
      page,
    }) => {
      await openLibrary(page)
      await tiles(page).nth(1).click()
      const second = await selectedId(page)
      const title = panel(page).getByLabel('Title', { exact: true })
      await title.fill(`Second ${colorScheme}`)
      await page.keyboard.press('Enter')
      await expect.poll(() => selectedId(page)).not.toBe(second)
      await expect(title).toBeFocused()
      await page.keyboard.press('Shift+Enter')
      await expect.poll(() => selectedId(page)).toBe(second)
      await expect(title).toHaveValue(`Second ${colorScheme}`)
    })

    test('batch editing: Mixed, commit to all, Undo', async ({
      page,
    }, testInfo) => {
      await openLibrary(page)
      await tiles(page).nth(0).click()
      await tiles(page)
        .nth(1)
        .click({ modifiers: ['ControlOrMeta'] })
      await expect(panel(page).getByText('Editing 2 items')).toBeVisible()
      const caption = panel(page).getByLabel('Caption', { exact: true })
      await axe(page, testInfo, colorScheme)

      const before = await caption.getAttribute('placeholder')
      await caption.fill(`Batch caption ${colorScheme}`)
      await page.keyboard.press('Control+Enter')
      await expect(toastWith(page, 'Updated caption on 2 items')).toBeVisible()
      await expect(caption).toHaveValue(`Batch caption ${colorScheme}`)

      await toastWith(page, 'Updated caption on 2 items')
        .getByRole('button', { name: 'Undo' })
        .click()
      await expect(toastWith(page, 'Restored caption on 2 items')).toBeVisible()
      if (before) {
        await expect(caption).toHaveAttribute('placeholder', before)
      }
    })

    test('one item: sections, actions and the Usage panel', async ({
      page,
    }, testInfo) => {
      await openLibrary(page)
      await tiles(page).first().click()
      await expect(panel(page).getByText('File', { exact: true })).toBeVisible()
      await expect(
        panel(page).getByRole('button', { name: /^Copy/ }).first(),
      ).toBeVisible()
      await axe(page, testInfo, colorScheme)

      await page
        .getByRole('navigation', { name: 'Inspector panels' })
        .getByRole('button', { name: /^Usage/ })
        .click()
      await expect(panel(page).getByText(/aren’t detected/)).toBeVisible()
      await axe(page, testInfo, colorScheme)

      await page.keyboard.press('e')
      await expect(
        panel(page).getByRole('heading', { name: 'Edit image' }),
      ).toBeVisible()
    })

    test('attach and detach through the post picker, from the File section', async ({
      page,
    }, testInfo) => {
      // 1000 isn't attached in the fake library. A deep link shows it
      // (detail mode; the inspector follows the stage, D52).
      await openLibrary(page, '&item=1000')
      const row = panel(page).getByTestId('row-attached')
      await expect(row).toHaveText('Not attachedAttach…')
      await row.getByRole('button', { name: 'Attach…' }).click()
      const picker = page.getByRole('dialog', {
        name: 'Attach to a post or page',
      })
      const listbox = picker.getByRole('listbox')
      await expect(listbox.getByRole('option').first()).toBeVisible()
      // Not clipped by the row: the option takes a click.
      await axe(page, testInfo, colorScheme)
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Enter')
      await expect(toastWith(page, /Attached to “/)).toBeVisible()
      const detach = row.getByRole('button', { name: 'Detach' })
      await expect(detach).toBeFocused()

      await detach.click()
      await expect(row).toHaveText('Not attachedAttach…')
      // The detach toast's own Undo (the attach toast may still show).
      await toastWith(page, /Detached from/)
        .getByRole('button', { name: 'Undo' })
        .click()
      await expect(row.getByRole('button', { name: 'Detach' })).toBeVisible()
    })
  })
}
