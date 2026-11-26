import { notifications } from '@mantine/notifications'
import { act, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { failOnReactWarnings } from '../../test/consoleErrors'
import {
  cleanupLibrary,
  type RenderedLibrary,
  renderLibrary,
} from '../../test/renderLibrary'
import { openMoveRequest, resetFolderUi } from './store'

// Move to… (folders.md §7) in Chromium, through the whole app over the fake
// library (the prototype's 93 items and 16 folders): select tiles, press M,
// search, choose, and check the fake's state, the toast and focus.
//
//   Brand (1)          Logos (2), Icons (3)
//   Blog (4)           2025 (5), 2026 (6) › Spring campaign (7)
//   Events (8)         Conference 2025 (9), Summer party (10)
//   Products (11)      Outdoor (12), Interior (13)
//   Team (14), Press kit (15), Archive (16)

failOnReactWarnings()
afterEach(() => {
  cleanupLibrary()
  resetFolderUi()
  // Mantine keeps notifications in a module-level store; left over, they
  // fill its limit and queue the next test's toasts.
  act(() => notifications.clean())
})

// As in detail.browser.spec.tsx: Vitest's iframe crashes on a keyboard-
// opened view transition; the update runs the same way without the API.
const startViewTransition: unknown = Reflect.get(
  document,
  'startViewTransition',
)
beforeAll(() => {
  Reflect.set(document, 'startViewTransition', undefined)
})
afterAll(() => {
  Reflect.set(document, 'startViewTransition', startViewTransition)
})

type User = ReturnType<typeof userEvent.setup>

function tiles(): HTMLElement[] {
  return screen.getAllByRole('gridcell')
}

function tileOf(id: number): HTMLElement {
  const tile = document.querySelector<HTMLElement>(`[data-mm-tile="${id}"]`)
  if (!tile) throw new Error(`tile ${id} isn't rendered`)
  return tile
}

function idOf(tile: HTMLElement): number {
  return Number(tile.dataset.mmTile)
}

function folderOf(library: RenderedLibrary, id: number): number | null {
  const item = library.mock.library.item(id)
  if (!item) throw new Error(`no item ${id}`)
  return item.folder
}

/** The first rendered tile whose item sits in `folder`. */
function tileIn(library: RenderedLibrary, folder: number): number {
  const id = tiles()
    .map(idOf)
    .find((tileId) => folderOf(library, tileId) === folder)
  if (id === undefined) throw new Error(`no rendered tile in folder ${folder}`)
  return id
}

function titleOf(library: RenderedLibrary, id: number): string {
  const item = library.mock.library.item(id)
  if (!item) throw new Error(`no item ${id}`)
  return item.title || item.filename
}

async function openWithM(user: User, name?: string | RegExp) {
  await user.keyboard('m')
  return screen.findByRole('dialog', name ? { name } : {}, { timeout: 5000 })
}

function combobox(): HTMLInputElement {
  return screen.getByRole('combobox', {
    name: 'Find or create a folder',
  }) as HTMLInputElement
}

function optionNamed(dialog: HTMLElement, name: string | RegExp): HTMLElement {
  return within(dialog).getByRole('option', { name })
}

/** The option the combobox points at (aria-activedescendant). */
function activeOption(): HTMLElement | null {
  const id = combobox().getAttribute('aria-activedescendant')
  return id ? document.getElementById(id) : null
}

function optionLabels(dialog: HTMLElement): string[] {
  return within(dialog)
    .getAllByRole('option')
    .map((option) => option.textContent ?? '')
}

async function expectDialogClosed(): Promise<void> {
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
}

/** The toast with this text, and that it offers Undo. */
async function expectUndoToast(text: string): Promise<void> {
  const message = await screen.findByText(text, {}, { timeout: 5000 })
  const notification = message.closest('.mantine-Notification-root')
  expect(notification).not.toBeNull()
  expect(
    within(notification as HTMLElement).getByRole('button', { name: 'Undo' }),
  ).toBeTruthy()
}

describe('Move to… for media', () => {
  it('opens with M on one item: title, subtitle, focused search, Current', async () => {
    const user = userEvent.setup()
    const library = await renderLibrary()
    const id = tileIn(library, 12)
    await user.click(tileOf(id))
    const dialog = await openWithM(user, `Move “${titleOf(library, id)}”`)

    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const description = document.getElementById(
      dialog.getAttribute('aria-describedby') ?? '',
    )
    expect(description?.textContent).toBe(
      'From “Outdoor”. A file lives in one folder, so this replaces its current folder.',
    )
    await waitFor(() => expect(document.activeElement).toBe(combobox()))
    const input = combobox()
    expect(input.getAttribute('placeholder')).toBe('Find or create a folder')
    expect(input.getAttribute('aria-autocomplete')).toBe('list')
    expect(input.getAttribute('aria-expanded')).toBe('true')
    const listbox = within(dialog).getByRole('listbox')
    expect(input.getAttribute('aria-controls')).toBe(listbox.id)

    // Uncategorized first, then the whole tree (no Recent yet).
    const labels = optionLabels(dialog)
    expect(labels.slice(0, 4)).toEqual([
      'Uncategorized',
      'Brand',
      'Logos',
      'Icons',
    ])
    expect(within(dialog).queryByText('Recent')).toBeNull()
    // The item's folder is Current and can't be chosen.
    const current = optionNamed(dialog, /^Outdoor\s*Current$/)
    expect(current.getAttribute('aria-disabled')).toBe('true')
    // The first option is active; options are at least 32 px tall.
    expect(activeOption()?.textContent).toBe('Uncategorized')
    expect(activeOption()?.getAttribute('aria-selected')).toBe('true')
    expect(current.getBoundingClientRect().height).toBeGreaterThanOrEqual(32)
    expect(within(dialog).getByText(/choose ·/)).toBeTruthy()
  })

  it('searches, moves with Enter and shows the toast with Undo', async () => {
    const user = userEvent.setup()
    const library = await renderLibrary()
    const id = tileIn(library, 12)
    await user.click(tileOf(id))
    const dialog = await openWithM(user)

    await user.type(combobox(), 'spr')
    // A flat list of matches with their paths; the match is marked.
    const spring = optionNamed(dialog, /Spring campaign/)
    expect(spring.textContent).toContain('Blog · 2026')
    expect(spring.querySelector('mark')?.textContent).toBe('Spr')
    expect(activeOption()).toBe(spring)

    await user.keyboard('{Enter}')
    await expectDialogClosed()
    await waitFor(() => expect(folderOf(library, id)).toBe(7))
    await expectUndoToast('Moved 1 item to “Spring campaign”')
    // In All files the item stays, and focus goes back to its tile.
    await waitFor(() => expect(document.activeElement).toBe(tileOf(id)))
  })

  it('walks the options with ↑/↓, skipping Current', async () => {
    const user = userEvent.setup()
    const library = await renderLibrary()
    const id = tileIn(library, 0)
    await user.click(tileOf(id))
    const dialog = await openWithM(user)
    expect(
      optionNamed(dialog, /^Uncategorized\s*Current$/).getAttribute(
        'aria-disabled',
      ),
    ).toBe('true')
    expect(
      document
        .getElementById(dialog.getAttribute('aria-describedby') ?? '')
        ?.textContent?.startsWith('From Uncategorized.'),
    ).toBe(true)
    // Uncategorized is Current, so Brand starts active and ↑ stays there.
    expect(activeOption()?.textContent).toBe('Brand')
    await user.keyboard('{ArrowUp}')
    expect(activeOption()?.textContent).toBe('Brand')
    await user.keyboard('{ArrowDown}{ArrowDown}')
    expect(activeOption()?.textContent).toBe('Icons')
    await user.keyboard('{ArrowUp}')
    expect(activeOption()?.textContent).toBe('Logos')

    await user.keyboard('{Enter}')
    await waitFor(() => expect(folderOf(library, id)).toBe(2))
    await expectUndoToast('Moved 1 item to “Logos”')
  })

  it('moves several items with the Move here button, then offers Recent', async () => {
    const user = userEvent.setup()
    const library = await renderLibrary()
    const [first, second, third] = tiles().map(idOf) as [number, number, number]
    await user.click(tileOf(first))
    await user.keyboard('{Shift>}')
    await user.click(tileOf(third))
    await user.keyboard('{/Shift}')
    const dialog = await openWithM(user, 'Move 3 items')
    expect(
      document.getElementById(dialog.getAttribute('aria-describedby') ?? '')
        ?.textContent,
    ).toMatch(/A file lives in one folder/)

    await user.type(combobox(), 'press')
    await user.click(within(dialog).getByRole('button', { name: 'Move here' }))
    await expectDialogClosed()
    await waitFor(() => {
      for (const id of [first, second, third]) {
        expect(folderOf(library, id)).toBe(15)
      }
    })
    await expectUndoToast('Moved 3 items to “Press kit”')

    // Next time, Press kit is under Recent, and Current for these items.
    const again = await openWithM(user, 'Move 3 items')
    const recent = within(again).getByRole('group', { name: 'Recent' })
    const recentPress = within(recent).getByRole('option', {
      name: /Press kit/,
    })
    expect(recentPress.getAttribute('aria-disabled')).toBe('true')
    expect(
      within(again).getByRole('group', { name: 'All folders' }),
    ).toBeTruthy()
  })

  it('moves on a double-click', async () => {
    const user = userEvent.setup()
    const library = await renderLibrary()
    const id = tileIn(library, 12)
    await user.click(tileOf(id))
    const dialog = await openWithM(user)
    await user.dblClick(optionNamed(dialog, 'Archive'))
    await expectDialogClosed()
    await waitFor(() => expect(folderOf(library, id)).toBe(16))
  })

  it('ignores a click on Current, and a click chooses without moving', async () => {
    const user = userEvent.setup()
    const library = await renderLibrary()
    const id = tileIn(library, 12)
    await user.click(tileOf(id))
    const dialog = await openWithM(user)
    await user.click(optionNamed(dialog, /^Outdoor\s*Current$/))
    expect(activeOption()?.textContent).toBe('Uncategorized')
    await user.click(optionNamed(dialog, 'Team'))
    expect(activeOption()?.textContent).toBe('Team')
    // Focus stays in the search field.
    expect(document.activeElement).toBe(combobox())
    expect(screen.getByRole('dialog')).toBe(dialog)
    expect(folderOf(library, id)).toBe(12)
  })

  it('closes with Esc and returns focus to the tile', async () => {
    const user = userEvent.setup()
    const library = await renderLibrary()
    const id = tileIn(library, 12)
    await user.click(tileOf(id))
    await openWithM(user)
    await user.keyboard('{Escape}')
    await expectDialogClosed()
    await waitFor(() => expect(document.activeElement).toBe(tileOf(id)))
    expect(folderOf(library, id)).toBe(12)
    // Esc only closed the dialog: the selection is still there.
    expect(tileOf(id).getAttribute('aria-selected')).toBe('true')
  })

  it('closes with Cancel and with a click on the scrim', async () => {
    const user = userEvent.setup()
    const library = await renderLibrary()
    const id = tileIn(library, 12)
    await user.click(tileOf(id))
    const dialog = await openWithM(user)
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await expectDialogClosed()
    await waitFor(() => expect(document.activeElement).toBe(tileOf(id)))

    await openWithM(user)
    // The scrim around the dialog (the inner wrapper takes the click).
    const scrim = document.querySelector<HTMLElement>('.mantine-Modal-overlay')
    if (!scrim) throw new Error('no scrim')
    await user.click(scrim)
    await expectDialogClosed()
    await waitFor(() => expect(document.activeElement).toBe(tileOf(id)))
  })

  it('creates a top-level folder from the search and moves into it', async () => {
    const user = userEvent.setup()
    const library = await renderLibrary()
    const id = tileIn(library, 12)
    await user.click(tileOf(id))
    const dialog = await openWithM(user)

    // An existing name (any case) offers no Create.
    await user.type(combobox(), 'press KIT')
    expect(optionLabels(dialog)).toEqual(['Press kit'])

    await user.clear(combobox())
    await user.type(combobox(), '  Mood   boards ')
    expect(
      within(dialog)
        .queryAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Create folder “Mood boards”'])
    expect(activeOption()?.textContent).toBe('Create folder “Mood boards”')
    await user.keyboard('{Enter}')
    await expectDialogClosed()

    await waitFor(() => {
      const created = library.mock.library
        .folderTree()
        .folders.find((folder) => folder.name === 'Mood boards')
      expect(created?.parent).toBe(0)
      expect(folderOf(library, id)).toBe(created?.id)
    })
    await expectUndoToast('Moved 1 item to “Mood boards”')
  })

  it('ignores a whitespace-only query', async () => {
    const user = userEvent.setup()
    await renderLibrary()
    await user.click(tiles()[0] as HTMLElement)
    const dialog = await openWithM(user)
    await user.type(combobox(), '   ')
    // Uncategorized and all 16 folders; no Create.
    expect(within(dialog).getAllByRole('option').length).toBe(17)
  })

  it('triage: in a folder, the moved item leaves and focus goes to the next tile', async () => {
    const user = userEvent.setup()
    const library = await renderLibrary({ search: '?view=library&folder=7' })
    const [first, second] = tiles().map(idOf) as [number, number]
    await user.click(tileOf(first))
    await openWithM(user, `Move “${titleOf(library, first)}”`)
    await user.type(combobox(), 'events')
    await user.keyboard('{Enter}')
    await expectDialogClosed()

    await waitFor(() => {
      expect(document.querySelector(`[data-mm-tile="${first}"]`)).toBeNull()
      expect(document.activeElement).toBe(tileOf(second))
    })
    // The tile leaves optimistically; the server may still be answering.
    await waitFor(() => expect(folderOf(library, first)).toBe(8))
    await expectUndoToast('Moved 1 item to “Events”')

    // M again moves the next one: Events is now a recent target.
    const dialog = await openWithM(user, `Move “${titleOf(library, second)}”`)
    const recent = within(dialog).getByRole('group', { name: 'Recent' })
    const events = within(recent).getByRole('option', { name: 'Events' })
    await user.keyboard('{ArrowDown}')
    expect(activeOption()).toBe(events)
    await user.keyboard('{Enter}')
    // A full parallel run (the bundle budget builds the client meanwhile)
    // can take over a second for the move's round trip.
    await waitFor(() => expect(folderOf(library, second)).toBe(8), {
      timeout: 5000,
    })
  })

  it('works in detail mode, and Esc leaves detail open', async () => {
    const user = userEvent.setup()
    const library = await renderLibrary()
    const id = tileIn(library, 12)
    await user.click(tileOf(id))
    await user.keyboard('{Enter}')
    await screen.findByRole('region', { name: 'Detail' })

    await openWithM(user, `Move “${titleOf(library, id)}”`)
    await user.keyboard('{Escape}')
    await expectDialogClosed()
    expect(screen.getByRole('region', { name: 'Detail' })).toBeTruthy()

    await openWithM(user)
    await user.type(combobox(), 'team')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(folderOf(library, id)).toBe(14))
    await expectUndoToast('Moved 1 item to “Team”')
  })

  it('works with the folder column hidden', async () => {
    const user = userEvent.setup()
    const library = await renderLibrary()
    const id = tileIn(library, 12)
    await user.click(tileOf(id))
    await user.keyboard('f')
    await waitFor(() =>
      expect(document.querySelector('[inert]')?.textContent ?? '').toMatch(
        /Folders/i,
      ),
    )
    await openWithM(user)
    await waitFor(() => expect(document.activeElement).toBe(combobox()))
    await user.type(combobox(), 'interior')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(folderOf(library, id)).toBe(13))
  })
})

describe('Move to… for a folder', () => {
  it('leaves out the folder and its subtree, marks its parent, and moves it', async () => {
    const user = userEvent.setup()
    const library = await renderLibrary()
    act(() => {
      openMoveRequest({ kind: 'folder', folderId: 6 })
    })
    const dialog = await screen.findByRole('dialog', { name: 'Move “2026”' })
    expect(
      document.getElementById(dialog.getAttribute('aria-describedby') ?? '')
        ?.textContent,
    ).toBe(
      'Choose its new parent folder. Its subfolders and files move with it.',
    )
    const labels = optionLabels(dialog)
    expect(labels[0]).toBe('Top level')
    expect(labels).not.toContain('2026')
    expect(labels).not.toContain('Spring campaign')
    expect(
      optionNamed(dialog, /^Blog\s*Current$/).getAttribute('aria-disabled'),
    ).toBe('true')

    await user.type(combobox(), 'brand')
    await user.click(
      within(dialog).getByRole('button', { name: 'Move folder' }),
    )
    await expectDialogClosed()
    await waitFor(() => {
      const moved = library.mock.library
        .folderTree()
        .folders.find((folder) => folder.id === 6)
      expect(moved?.parent).toBe(1)
    })
    await expectUndoToast('Moved “2026” into “Brand”')
  })
})

describe('Move to… with nothing to offer', () => {
  it('says so when nothing matches and nothing can be created', async () => {
    const user = userEvent.setup()
    await renderLibrary()
    act(() => {
      openMoveRequest({ kind: 'folder', folderId: 4 })
    })
    const dialog = await screen.findByRole('dialog', { name: 'Move “Blog”' })
    // 2026 exists, but inside the folder being moved.
    await user.type(combobox(), '2026')
    expect(within(dialog).getByText('No folders match.')).toBeTruthy()
    expect(within(dialog).queryByRole('listbox')).toBeNull()
    expect(combobox().getAttribute('aria-expanded')).toBe('false')
    expect(combobox().hasAttribute('aria-activedescendant')).toBe(false)
    expect(
      within(dialog).getByRole('button', { name: 'Move folder' }),
    ).toHaveProperty('disabled', true)
    // Enter does nothing then.
    await user.keyboard('{Enter}')
    expect(screen.getByRole('dialog')).toBe(dialog)
  })
})

describe('Pro colours', () => {
  it('tints folder icons with their colour only with Pro', async () => {
    const user = userEvent.setup()
    await renderLibrary({ scenario: 'pro' })
    await user.click(tiles()[0] as HTMLElement)
    const dialog = await openWithM(user)
    const brandIcon = optionNamed(dialog, 'Brand').querySelector('svg')
    expect(brandIcon?.style.getPropertyValue('--folder-color')).toBe('#7c5cff')
    const logosIcon = optionNamed(dialog, 'Logos').querySelector('svg')
    expect(logosIcon?.style.getPropertyValue('--folder-color')).toBe('')
    cleanupLibrary()
    resetFolderUi()

    await renderLibrary({ scenario: 'normal' })
    await user.click(tiles()[0] as HTMLElement)
    const lite = await openWithM(user)
    expect(
      optionNamed(lite, 'Brand')
        .querySelector('svg')
        ?.style.getPropertyValue('--folder-color'),
    ).toBe('')
  })
})
