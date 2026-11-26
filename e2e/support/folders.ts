import type { Locator, Page, TestInfo } from '@playwright/test'
import { COLOR_SCHEMES, expectNoAxeViolations } from './axe.ts'
import { expect, test } from './fixtures.ts'

// The folder column end to end (track A3, folders.md), shared by the mock and
// live projects: opening folders and the tree's keys, create / rename (with
// Undo) / delete, the context menu, Move to… (M), drag and drop of a tile
// onto a folder (with Undo), and Delete inside a folder (remove from folder).
// Every flow runs in both colour schemes with axe on the screens it opens.
//
// - mock: the VITE_MOCK build under /wp-upload-mock/ (the fake library; it
//   starts fresh on every page load).
// - live: the production image under /wp-upload/ against the stack's
//   WordPress (`small` seed). The tests only touch folders they create
//   (`e2e-…`) and put every item they moved back where it was.
//
// Folder names used from both libraries: Team, Products and Blog exist in
// the mock's tree (the prototype's) and in the `small` seed.

export type FolderOptions = {
  // Runs before each test, e.g. logging in for the live project.
  prepare?: (page: Page) => Promise<void>
  // The backend keeps changes across page loads (live): restore what moved.
  persists: boolean
  // Elements axe should skip (the mock's dev scenario switcher).
  axeExclude?: string[]
}

const LIBRARY = './?view=library'

function tree(page: Page): Locator {
  return page.getByRole('tree', { name: 'Folders' })
}

function row(page: Page, name: string): Locator {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return tree(page).getByRole('treeitem', {
    name: new RegExp(`^${escaped}\\s*(,|$)`),
  })
}

function tiles(page: Page): Locator {
  return page.getByRole('gridcell')
}

/** A toast (Mantine notification), not the live region's copy of it. */
function toast(page: Page, text: string | RegExp): Locator {
  return page.locator('.mantine-Notification-root').filter({ hasText: text })
}

async function openLibrary(page: Page, query = ''): Promise<void> {
  await page.goto(`${LIBRARY}${query}`)
  await expect(tiles(page).first()).toBeVisible({ timeout: 20_000 })
  await expect(tree(page)).toBeVisible()
}

async function axe(
  page: Page,
  testInfo: TestInfo,
  options: FolderOptions,
  colorScheme: (typeof COLOR_SCHEMES)[number],
): Promise<void> {
  // Let fades and transitions settle, so axe measures final colours.
  await page.waitForTimeout(400)
  await expectNoAxeViolations(page, testInfo, {
    colorScheme,
    exclude: options.axeExclude,
  })
}

function uniqueName(): string {
  return `e2e-${Math.random().toString(36).slice(2, 8)}`
}

function folderInUrl(page: Page): string | null {
  return new URL(page.url()).searchParams.get('folder')
}

/** Creates a top-level folder through the column (header button). */
async function createFolder(page: Page, name: string): Promise<Locator> {
  await page.getByRole('button', { name: 'New folder' }).click()
  const input = page.getByRole('textbox', { name: 'New folder name' })
  await expect(input).toBeFocused()
  await input.fill(name)
  await input.press('Enter')
  const created = row(page, name)
  await expect(created).toBeVisible()
  return created
}

/**
 * Live only: deletes every folder this test created (its name, or a rename
 * of it) through the API, whatever state a failure left the UI in.
 */
async function removeTestFolders(page: Page, name: string): Promise<void> {
  const response = await page.request.get('api/library/folders')
  if (!response.ok()) return
  const body = (await response.json()) as {
    folders: { id: number; name: string; parent: number }[]
  }
  const ours = body.folders.filter((folder) => folder.name.startsWith(name))
  // A parent's delete takes its subtree, so a later child's delete may
  // answer 404; that's fine.
  for (const folder of ours) {
    await page.request.delete(`api/library/folders/${folder.id}`)
  }
}

type ItemFolder = { id: number; folder: number | null }

/** Live only: an item's folder, straight from the API (for restoring it). */
async function itemFolder(page: Page, id: number): Promise<ItemFolder> {
  const response = await page.request.get(
    `api/library/items?ids=${id}&view=tile`,
  )
  expect(response.ok()).toBe(true)
  const body = (await response.json()) as {
    items: { id: number; folder: number | null }[]
  }
  const item = body.items.find((entry) => entry.id === id)
  return { id, folder: item?.folder ?? null }
}

/** Live only: puts an item back into the folder it had. */
async function restoreItem(page: Page, before: ItemFolder): Promise<void> {
  if (before.folder === null) return
  const response = await page.request.post('api/library/folders/assign', {
    data: { folder: before.folder, ids: [before.id] },
  })
  expect(response.ok()).toBe(true)
}

export function defineFolderTests(options: FolderOptions): void {
  for (const colorScheme of COLOR_SCHEMES) {
    test.describe(`folders (${colorScheme})`, () => {
      test.use({ colorScheme })

      test.beforeEach(async ({ page }) => {
        await options.prepare?.(page)
      })

      test('opens folders by click and with the tree’s keys', async ({
        page,
      }, testInfo) => {
        await openLibrary(page)
        await expect(row(page, 'All files')).toHaveAttribute(
          'aria-current',
          'true',
        )
        await axe(page, testInfo, options, colorScheme)

        // A click replaces the history entry (D16) and filters the grid.
        const historyLength = await page.evaluate(() => history.length)
        await row(page, 'Team').click()
        await expect.poll(() => folderInUrl(page)).not.toBeNull()
        await expect(row(page, 'Team')).toHaveAttribute('aria-current', 'true')
        expect(await page.evaluate(() => history.length)).toBe(historyLength)

        // Keys: → opens Products, ↓ goes to its first child, Enter opens it.
        await row(page, 'Products').focus()
        await page.keyboard.press('ArrowRight')
        await expect(row(page, 'Products')).toHaveAttribute(
          'aria-expanded',
          'true',
        )
        await page.keyboard.press('ArrowDown')
        const child = tree(page).locator('[role="treeitem"]:focus')
        await expect(child).toHaveAttribute('aria-level', '2')
        const before = folderInUrl(page)
        await page.keyboard.press('Enter')
        await expect.poll(() => folderInUrl(page)).not.toBe(before)
        await expect(child).toHaveAttribute('aria-current', 'true')
        // The tree's Enter never reaches the grid (no detail mode).
        expect(new URL(page.url()).searchParams.get('item')).toBeNull()

        // The column's search keeps ancestors and marks the match.
        const search = page.getByRole('searchbox', { name: 'Find folder' })
        await search.fill('Team')
        await expect(row(page, 'Team').locator('mark')).toHaveText('Team')
        await expect(row(page, 'All files')).toHaveCount(0)
        await axe(page, testInfo, options, colorScheme)
        await search.press('Escape')
        await expect(row(page, 'All files')).toBeVisible()
      })

      test('creates, renames with Undo and deletes a folder; the context menu', async ({
        page,
      }, testInfo) => {
        await openLibrary(page)
        const name = uniqueName()
        try {
          await createFolder(page, name)
          await expect(row(page, name)).toBeFocused()

          // R renames in place; the toast's Undo restores the name.
          await page.keyboard.press('r')
          const input = page.getByRole('textbox', {
            name: `Rename folder ${name}`,
          })
          await expect(input).toBeFocused()
          await input.fill(`${name}-renamed`)
          await input.press('Enter')
          await expect(
            toast(page, `Renamed to “${name}-renamed”`),
          ).toBeVisible()
          await expect(row(page, `${name}-renamed`)).toBeVisible()
          await toast(page, 'Renamed to')
            .getByRole('button', { name: 'Undo' })
            .click()
          await expect(row(page, name)).toBeVisible()

          // The context menu, by right-click; Esc returns focus to the row.
          await row(page, name).click({ button: 'right' })
          const menu = page.getByRole('menu', { name: `Folder ${name}` })
          await expect(menu).toBeVisible()
          await expect(menu.getByRole('menuitem')).toHaveCount(4)
          await axe(page, testInfo, options, colorScheme)
          await page.keyboard.press('Escape')
          await expect(menu).toBeHidden()
          await expect(row(page, name)).toBeFocused()

          // Delete: the confirm explains, then the folder goes.
          await page.keyboard.press('Delete')
          const dialog = page.getByRole('dialog')
          await expect(dialog.getByText(`Delete “${name}”?`)).toBeVisible()
          await axe(page, testInfo, options, colorScheme)
          await dialog.getByRole('button', { name: 'Delete folder' }).click()
          await expect(toast(page, `Deleted “${name}”`)).toBeVisible()
          await expect(row(page, name)).toHaveCount(0)
        } finally {
          if (options.persists) {
            await removeTestFolders(page, name)
          }
        }
      })

      test('moves media with Move to… (M), with Undo, and removes it from a folder with Delete', async ({
        page,
      }, testInfo) => {
        await openLibrary(page)
        const name = uniqueName()
        const tile = tiles(page).first()
        const id = Number(await tile.getAttribute('data-mm-tile'))
        const before = options.persists ? await itemFolder(page, id) : null
        try {
          await createFolder(page, name)
          await tile.click()
          await page.keyboard.press('m')
          const dialog = page.getByRole('dialog')
          await expect(dialog).toBeVisible()
          await dialog.getByRole('combobox').fill(name)
          await expect(
            dialog.getByRole('option', { name: new RegExp(`^${name}`) }),
          ).toHaveAttribute('aria-selected', 'true')
          await axe(page, testInfo, options, colorScheme)
          await page.keyboard.press('Enter')
          await expect(dialog).toBeHidden()
          const moved = toast(page, `Moved 1 item to “${name}”`)
          await expect(moved).toBeVisible()
          await expect(row(page, name)).toContainText('1')
          // Undo puts it back where it was.
          await moved.getByRole('button', { name: 'Undo' }).click()
          await expect(toast(page, 'Moved 1 item back')).toBeVisible()

          // Move it again, open the folder, and Delete removes it from there.
          await page.locator(`[data-mm-tile="${id}"]`).click()
          await page.keyboard.press('m')
          await expect(dialog).toBeVisible()
          await dialog.getByRole('combobox').fill(name)
          await page.keyboard.press('Enter')
          await expect(toast(page, `Moved 1 item to “${name}”`)).toBeVisible()
          await row(page, name).click()
          const inFolder = page.locator(`[data-mm-tile="${id}"]`)
          await expect(inFolder).toBeVisible()
          await inFolder.click()
          await page.keyboard.press('Delete')
          await expect(
            toast(page, `Removed 1 item from “${name}”`),
          ).toBeVisible()
          await expect(inFolder).toHaveCount(0)
          await axe(page, testInfo, options, colorScheme)
        } finally {
          if (before) {
            await restoreItem(page, before)
          }
          if (options.persists) {
            await removeTestFolders(page, name)
          }
        }
      })

      test('drags a tile onto a folder, with a live preview and Undo', async ({
        page,
      }) => {
        await openLibrary(page)
        const name = uniqueName()
        const tile = tiles(page).first()
        const id = Number(await tile.getAttribute('data-mm-tile'))
        const before = options.persists ? await itemFolder(page, id) : null
        try {
          await createFolder(page, name)
          await expect(tile).toHaveAttribute('draggable', 'true')
          const target = row(page, name)
          const from = await tile.boundingBox()
          const to = await target.boundingBox()
          if (!from || !to) throw new Error('tile or row has no box')
          await page.mouse.move(
            from.x + from.width / 2,
            from.y + from.height / 2,
          )
          await page.mouse.down()
          // Several steps: Chromium starts a native drag after a few pixels.
          for (let step = 1; step <= 10; step++) {
            await page.mouse.move(
              from.x +
                from.width / 2 +
                ((to.x + 40 - from.x - from.width / 2) * step) / 10,
              from.y +
                from.height / 2 +
                ((to.y + to.height / 2 - from.y - from.height / 2) * step) / 10,
            )
          }
          // Chromium only sends dragover while the mouse moves, and the row
          // may still shift (the new folder's focus scrolls the tree): keep
          // nudging over its current box until the preview names it.
          const preview = page.locator('[data-mm-drag-preview]')
          await expect(preview).toContainText('Move 1 item')
          await expect(async () => {
            const box = await target.boundingBox()
            if (!box) throw new Error('the folder row has no box')
            await page.mouse.move(box.x + 40, box.y + box.height / 2)
            await page.mouse.move(box.x + 44, box.y + box.height / 2)
            await expect(preview).toContainText(`to “${name}”`, {
              timeout: 300,
            })
          }).toPass({ timeout: 5000 })
          await expect(preview).toContainText(`to “${name}”`)
          await expect(target).toHaveAttribute('data-drop', 'combine')
          await page.mouse.up()
          const moved = toast(page, `Moved 1 item to “${name}”`)
          await expect(moved).toBeVisible()
          await expect(preview).toHaveCount(0)
          await moved.getByRole('button', { name: 'Undo' }).click()
          await expect(toast(page, 'Moved 1 item back')).toBeVisible()
        } finally {
          if (before) {
            await restoreItem(page, before)
          }
          if (options.persists) {
            await removeTestFolders(page, name)
          }
        }
      })
    })
  }
}

/** Mock-only scenarios: per-user folders and no FileBird (folders.md §9). */
export function defineFolderScenarioTests(options: FolderOptions): void {
  for (const colorScheme of COLOR_SCHEMES) {
    test.describe(`folder scenarios (${colorScheme})`, () => {
      test.use({ colorScheme })

      test('per-user mode: a notice, browsing works, changes explain why', async ({
        page,
      }, testInfo) => {
        await openLibrary(page, '&mock-scenario=per-user')
        await expect(
          page.getByText('Per-user folders aren’t supported'),
        ).toBeVisible()
        await axe(page, testInfo, options, colorScheme)
        await row(page, 'Team').click()
        await expect.poll(() => folderInUrl(page)).not.toBeNull()
        await page.getByRole('button', { name: 'New folder' }).click()
        await expect(
          toast(
            page,
            'Folder changes are off: FileBird’s per-user folders aren’t supported.',
          ),
        ).toBeVisible()
        await expect(
          page.getByRole('textbox', { name: 'New folder name' }),
        ).toHaveCount(0)
      })

      test('no FileBird: no folder column, and M explains', async ({
        page,
      }, testInfo) => {
        await page.goto(`${LIBRARY}&mock-scenario=no-filebird`)
        await expect(tiles(page).first()).toBeVisible({ timeout: 20_000 })
        await expect(tree(page)).toHaveCount(0)
        await axe(page, testInfo, options, colorScheme)
        await tiles(page).first().click()
        await page.keyboard.press('m')
        await expect(
          toast(
            page,
            'Folders need the FileBird plugin on your WordPress site.',
          ),
        ).toBeVisible()
      })
    })
  }
}
