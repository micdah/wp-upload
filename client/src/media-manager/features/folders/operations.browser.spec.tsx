import { act, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { coreStore } from '../../core/state'
import { failOnReactWarnings } from '../../test/consoleErrors'
import { renderLibrary } from '../../test/renderLibrary'
import { cleanupFolders } from './test/cleanup'

// Folder operations through the real app and the mock library (folders.md
// §4–§5, system.md §2): create and rename in place, delete with its
// confirm, the context menu, and Delete inside a folder (remove from
// folder). The mock's tree: Brand (1) › Logos (2), Icons (3); Blog (4) ›
// 2025 (5), 2026 (6) › Spring campaign (7); …; Press kit (15, 6 items).

failOnReactWarnings()
afterEach(cleanupFolders)

function tree(): HTMLElement {
  return screen.getByRole('tree', { name: 'Folders' })
}

function row(name: string | RegExp): HTMLElement {
  return within(tree()).getByRole('treeitem', { name })
}

function findRow(name: string | RegExp): Promise<HTMLElement> {
  return within(tree()).findByRole('treeitem', { name })
}

async function renderColumn(search = '?view=library', scenario = 'normal') {
  const library = await renderLibrary({ search, scenario })
  await screen.findByRole('tree', { name: 'Folders' })
  return library
}

async function expectToast(text: string | RegExp): Promise<void> {
  expect(
    await screen.findAllByText(text, {}, { timeout: 3000 }),
  ).not.toHaveLength(0)
}

function focusRow(name: string | RegExp): HTMLElement {
  const element = row(name)
  act(() => element.focus())
  return element
}

describe('create (folders.md §4)', () => {
  it('N on a focused folder adds a subfolder; a taken name is suffixed and explained', async () => {
    const library = await renderColumn()
    const user = userEvent.setup()
    focusRow(/^Brand/)
    await user.keyboard('n')
    const input = await screen.findByRole('textbox', {
      name: 'New folder name',
    })
    expect(document.activeElement).toBe(input)
    // The parent opened to show the input as its last child.
    expect(row(/^Brand/).getAttribute('aria-expanded')).toBe('true')
    await user.keyboard('Logos{Enter}')
    await expectToast(
      'A folder named “Logos” is already there, so this one is “Logos (1)”.',
    )
    const created = await findRow(/^Logos \(1\)/)
    await waitFor(() => expect(document.activeElement).toBe(created))
    expect(created.getAttribute('aria-level')).toBe('2')
    const folder = library.mock.library
      .folderTree()
      .folders.find((entry) => entry.name === 'Logos (1)')
    expect(folder?.parent).toBe(1)
    // The view didn't switch to it.
    expect(library.search()).not.toContain('folder=')
  })

  it('N from the grid creates inside the folder you are viewing', async () => {
    const library = await renderColumn('?view=library&folder=4')
    const user = userEvent.setup()
    const [first] = screen.getAllByRole('gridcell')
    await user.click(first as HTMLElement)
    await user.keyboard('n')
    await screen.findByRole('textbox', { name: 'New folder name' })
    await user.keyboard('Drafts{Enter}')
    await findRow(/^Drafts/)
    // The row shows while the create is still pending: wait for the server.
    await waitFor(() => {
      const folder = library.mock.library
        .folderTree()
        .folders.find((entry) => entry.name === 'Drafts')
      expect(folder?.parent).toBe(4)
    })
  })

  it('Esc and an empty name cancel; focus returns to the parent row', async () => {
    const library = await renderColumn()
    const user = userEvent.setup()
    const before = library.mock.library.folderTree().folders.length
    focusRow(/^Team/)
    await user.keyboard('n')
    await screen.findByRole('textbox', { name: 'New folder name' })
    await user.keyboard('Something{Escape}')
    await waitFor(() =>
      expect(
        screen.queryByRole('textbox', { name: 'New folder name' }),
      ).toBeNull(),
    )
    await waitFor(() => expect(document.activeElement).toBe(row(/^Team/)))
    await user.keyboard('n')
    await screen.findByRole('textbox', { name: 'New folder name' })
    await user.keyboard('   {Enter}')
    await waitFor(() =>
      expect(
        screen.queryByRole('textbox', { name: 'New folder name' }),
      ).toBeNull(),
    )
    expect(library.mock.library.folderTree().folders.length).toBe(before)
  })

  it('the header button creates at the top level from All files', async () => {
    const library = await renderColumn()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'New folder' }))
    await screen.findByRole('textbox', { name: 'New folder name' })
    await user.keyboard('Campaigns{Enter}')
    await findRow(/^Campaigns/)
    const folder = library.mock.library
      .folderTree()
      .folders.find((entry) => entry.name === 'Campaigns')
    expect(folder?.parent).toBe(0)
  })
})

describe('rename (folders.md §4)', () => {
  it('R renames in place with Undo', async () => {
    const library = await renderColumn()
    const user = userEvent.setup()
    focusRow(/^Team/)
    await user.keyboard('r')
    const input = (await screen.findByRole('textbox', {
      name: 'Rename folder Team',
    })) as HTMLInputElement
    expect(input.value).toBe('Team')
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe(4)
    await user.keyboard('People{Enter}')
    await expectToast('Renamed to “People”')
    await findRow(/^People/)
    expect(
      library.mock.library.folderTree().folders.find((f) => f.id === 14)?.name,
    ).toBe('People')
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    await findRow(/^Team/)
    await waitFor(() =>
      expect(
        library.mock.library.folderTree().folders.find((f) => f.id === 14)
          ?.name,
      ).toBe('Team'),
    )
  })

  it('suffixes a taken name and says so; Esc restores; double-click renames', async () => {
    await renderColumn()
    const user = userEvent.setup()
    await user.dblClick(
      row(/^Archive/).querySelector('[class*="name"]') as HTMLElement,
    )
    await screen.findByRole('textbox', { name: 'Rename folder Archive' })
    await user.keyboard('Other{Escape}')
    await findRow(/^Archive/)
    await user.dblClick(
      row(/^Archive/).querySelector('[class*="name"]') as HTMLElement,
    )
    await screen.findByRole('textbox', { name: 'Rename folder Archive' })
    await user.keyboard('Team{Enter}')
    await expectToast('“Team” is taken here, so it’s now “Team (1)”')
  })

  it('R in the grid renames the folder you are viewing; on All files it explains', async () => {
    await renderColumn()
    const user = userEvent.setup()
    const [first] = screen.getAllByRole('gridcell')
    await user.click(first as HTMLElement)
    await user.keyboard('r')
    await expectToast('Open or focus a folder to rename it.')
  })
})

describe('delete (folders.md §5)', () => {
  it('explains the subtree, deletes it, and leaves a deleted folder you were in', async () => {
    const library = await renderColumn('?view=library&folder=7')
    const user = userEvent.setup()
    await findRow(/^Spring campaign/)
    focusRow(/^Blog/)
    await user.keyboard('{Delete}')
    const dialog = await screen.findByRole('dialog')
    expect(
      within(dialog).getByText('Delete “Blog” and 3 subfolders?'),
    ).toBeTruthy()
    expect(
      within(dialog).getByText(
        '“Blog” and its 3 subfolders will be deleted. The 25 files in them move to Uncategorized. No media is deleted.',
      ),
    ).toBeTruthy()
    expect(
      within(dialog).getByText('Deleted folders can’t be restored.'),
    ).toBeTruthy()
    await user.click(
      within(dialog).getByRole('button', { name: 'Delete 4 folders' }),
    )
    await expectToast('Deleted “Blog” · 25 files moved to Uncategorized')
    await waitFor(() => expect(library.search()).toContain('folder=0'))
    expect(within(tree()).queryByRole('treeitem', { name: /^Blog/ })).toBeNull()
    // No media was deleted: Blog's 25 files are in Uncategorized now.
    expect(library.mock.library.folderTree().counts.uncategorized).toBe(38)
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull()
  })

  it('cancels with Esc and returns focus to the row', async () => {
    await renderColumn()
    const user = userEvent.setup()
    focusRow(/^Team/)
    await user.keyboard('{Backspace}')
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Delete “Team”?')).toBeTruthy()
    expect(
      within(dialog).getByRole('button', { name: 'Delete folder' }),
    ).toBeTruthy()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(row(/^Team/)))
    expect(row(/^Team/)).toBeTruthy()
  })
})

describe('the context menu', () => {
  it('opens on right-click with the folder’s actions', async () => {
    await renderColumn()
    const user = userEvent.setup()
    await user.pointer({ keys: '[MouseRight]', target: row(/^Brand/) })
    const menu = await screen.findByRole('menu', { name: 'Folder Brand' })
    const items = within(menu)
      .getAllByRole('menuitem')
      .map((item) => item.textContent?.replace(/[A-Z]$|Del$/, '').trim())
    expect(items).toEqual([
      'New subfolder',
      'Rename',
      'Move to…',
      'Delete folder',
    ])
    await user.click(within(menu).getByRole('menuitem', { name: /Rename/ }))
    await screen.findByRole('textbox', { name: 'Rename folder Brand' })
  })

  it('opens with the ContextMenu key and returns focus on Esc', async () => {
    await renderColumn()
    const user = userEvent.setup()
    focusRow(/^Archive/)
    await user.keyboard('{ContextMenu}')
    await screen.findByRole('menu', { name: 'Folder Archive' })
    expect(row(/^Archive/).hasAttribute('data-menu-open')).toBe(true)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(row(/^Archive/)))
  })

  it('offers only New folder on All files', async () => {
    await renderColumn()
    const user = userEvent.setup()
    await user.pointer({ keys: '[MouseRight]', target: row(/^All files/) })
    const menu = await screen.findByRole('menu', { name: 'Folders' })
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(1)
  })
})

describe('Delete inside a folder (system.md §2)', () => {
  it('removes the targets from the folder, with Undo, and focus moves on', async () => {
    const library = await renderColumn('?view=library&folder=15')
    const user = userEvent.setup()
    await waitFor(() => expect(screen.getAllByRole('gridcell')).toHaveLength(6))
    const [first, second] = screen.getAllByRole('gridcell')
    const firstId = Number(first?.dataset.mmTile)
    const secondId = Number(second?.dataset.mmTile)
    await user.click(first as HTMLElement)
    await user.keyboard('{Delete}')
    await expectToast('Removed 1 item from “Press kit”')
    await waitFor(() => expect(screen.getAllByRole('gridcell')).toHaveLength(5))
    expect(library.mock.library.item(firstId)?.folder).toBe(0)
    expect(coreStore.getState().focus).toBe(secondId)
    await waitFor(() =>
      expect(document.activeElement?.getAttribute('data-mm-tile')).toBe(
        String(secondId),
      ),
    )
    // Ctrl/Cmd+Z presses the toast's Undo.
    await user.keyboard('{Control>}z{/Control}')
    await waitFor(() =>
      expect(library.mock.library.item(firstId)?.folder).toBe(15),
    )
    await waitFor(() => expect(screen.getAllByRole('gridcell')).toHaveLength(6))
  })

  it('is not a folder action in All files', async () => {
    const library = await renderColumn()
    const user = userEvent.setup()
    const [first] = screen.getAllByRole('gridcell')
    const id = Number(first?.dataset.mmTile)
    const folder = library.mock.library.item(id)?.folder
    await user.click(first as HTMLElement)
    await user.keyboard('{Delete}')
    expect(library.mock.library.item(id)?.folder).toBe(folder)
  })
})

describe('an Author (D41)', () => {
  it('moves only their own items; the rest are skipped and the toast says so', async () => {
    const library = await renderColumn('?view=library', 'author')
    const user = userEvent.setup()
    const ids = screen
      .getAllByRole('gridcell')
      .map((tile) => Number(tile.dataset.mmTile))
    const { items } = library.mock.library.items(ids, 'tile')
    const own = items.find((item) => item.perms.edit)
    const others = items.find((item) => !item.perms.edit)
    if (!own || !others) throw new Error('the author scenario needs both kinds')
    const tileOf = (id: number) =>
      document.querySelector<HTMLElement>(
        `[data-mm-tile="${id}"]`,
      ) as HTMLElement
    const othersFolder = library.mock.library.item(others.id)?.folder
    await user.click(tileOf(own.id))
    await user.keyboard('{Control>}')
    await user.click(tileOf(others.id))
    await user.keyboard('{/Control}')
    await user.keyboard('m')
    await screen.findByRole('dialog')
    await user.keyboard('Archive')
    await user.keyboard('{Enter}')
    await expectToast(/skipped: you can only change your own media/)
    await waitFor(() =>
      expect(library.mock.library.item(own.id)?.folder).toBe(16),
    )
    expect(library.mock.library.item(others.id)?.folder).toBe(othersFolder)
    // Counts are the server's (D41): Archive's row shows the fake's count.
    const archive = library.mock.library
      .folderTree()
      .folders.find((folder) => folder.id === 16)
    await waitFor(() =>
      expect(row(/^Archive/).textContent).toContain(String(archive?.count)),
    )
  })
})
