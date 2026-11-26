import { act, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { coreStore } from '../../core/state'
import { failOnReactWarnings } from '../../test/consoleErrors'
import { renderLibrary } from '../../test/renderLibrary'
import { folderUiStore } from './store'
import { cleanupFolders } from './test/cleanup'

// The folder column over the whole app and the mock library (folders.md
// §2–§3, §8): rows and counts, opening folders, the tree's keys, expand and
// collapse, search, and the count mode. The mock's tree (the prototype's
// 16 folders): Brand (1) › Logos (2), Icons (3); Blog (4) › 2025 (5),
// 2026 (6) › Spring campaign (7); Events (8) › …; Products (11) › …; Team
// (14); Press kit (15); Archive (16). 93 items, 13 uncategorized.

failOnReactWarnings()
afterEach(cleanupFolders)

function tree(): HTMLElement {
  return screen.getByRole('tree', { name: 'Folders' })
}

function row(name: string | RegExp): HTMLElement {
  return within(tree()).getByRole('treeitem', { name })
}

function rowNames(): string[] {
  return within(tree())
    .getAllByRole('treeitem')
    .map((item) => item.querySelector('[class*="name"]')?.textContent ?? '')
}

function countOf(item: HTMLElement): string {
  return (
    item
      .querySelector('[class*="count"]')
      ?.textContent?.replace(/[^0-9]/g, '') ?? ''
  )
}

async function renderColumn(search = '?view=library', scenario = 'normal') {
  const library = await renderLibrary({ search, scenario })
  await screen.findByRole('tree', { name: 'Folders' })
  return library
}

describe('the folder column', () => {
  it('shows All files, Uncategorized and the top-level folders with counts', async () => {
    await renderColumn()
    expect(rowNames()).toEqual([
      'All files',
      'Uncategorized',
      'Brand',
      'Blog',
      'Events',
      'Products',
      'Team',
      'Press kit',
      'Archive',
    ])
    expect(countOf(row(/^All files/))).toBe('93')
    expect(countOf(row(/^Uncategorized/))).toBe('13')
    expect(countOf(row(/^Blog/))).toBe('1')
    // The current folder (All files) is the Tab stop and aria-current.
    const all = row(/^All files/)
    expect(all.getAttribute('aria-current')).toBe('true')
    expect(all.tabIndex).toBe(0)
    expect(row(/^Blog/).tabIndex).toBe(-1)
    expect(row(/^Blog/).getAttribute('aria-expanded')).toBe('false')
    expect(row(/^Team/).hasAttribute('aria-expanded')).toBe(false)
  })

  it('opens a folder on click: replaces ?folder= and clears the selection', async () => {
    const library = await renderColumn()
    const user = userEvent.setup()
    const [first] = screen.getAllByRole('gridcell')
    await user.click(first as HTMLElement)
    expect(coreStore.getState().selection.size).toBe(1)
    const entriesBefore = library.history.entries().searches.length
    await user.click(row(/^Press kit/))
    await waitFor(() => expect(library.search()).toContain('folder=15'))
    expect(library.history.entries().searches.length).toBe(entriesBefore)
    expect(coreStore.getState().selection.size).toBe(0)
    expect(row(/^Press kit/).getAttribute('aria-current')).toBe('true')
    await waitFor(() => expect(screen.getAllByRole('gridcell')).toHaveLength(6))
  })

  it('walks the tree with the arrow keys, Home and End, and opens with Enter', async () => {
    const library = await renderColumn()
    const user = userEvent.setup()
    act(() => row(/^All files/).focus())
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}')
    expect(document.activeElement).toBe(row(/^Blog/))
    // → opens Blog, → again goes to its first child.
    await user.keyboard('{ArrowRight}')
    expect(row(/^Blog/).getAttribute('aria-expanded')).toBe('true')
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(row(/^2025/))
    expect(row(/^2025/).getAttribute('aria-level')).toBe('2')
    // ← on a child goes to the parent, ← again collapses it.
    await user.keyboard('{ArrowLeft}')
    expect(document.activeElement).toBe(row(/^Blog/))
    await user.keyboard('{ArrowLeft}')
    expect(row(/^Blog/).getAttribute('aria-expanded')).toBe('false')
    await user.keyboard('{End}')
    expect(document.activeElement).toBe(row(/^Archive/))
    await user.keyboard('{Home}')
    expect(document.activeElement).toBe(row(/^All files/))
    await user.keyboard('{ArrowDown}{Enter}')
    await waitFor(() => expect(library.search()).toContain('folder=0'))
    // Space opens too.
    await user.keyboard('{ArrowDown}{ }')
    await waitFor(() => expect(library.search()).toContain('folder=1'))
    // The tree's keys don't reach the grid (Enter didn't open detail).
    expect(library.search()).not.toContain('item=')
  })

  it('expands and collapses on the twisty, and with Expand all / Collapse all', async () => {
    await renderColumn()
    const user = userEvent.setup()
    const twisty = row(/^Events/).querySelector('[data-twisty]') as HTMLElement
    await user.click(twisty)
    expect(row(/^Events/).getAttribute('aria-expanded')).toBe('true')
    expect(row(/^Summer party/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Folder options' }))
    await user.click(
      await screen.findByRole('menuitem', { name: 'Expand all' }),
    )
    await waitFor(() => expect(row(/^Spring campaign/)).toBeTruthy())
    expect(rowNames()).toHaveLength(18)
    await user.click(screen.getByRole('button', { name: 'Folder options' }))
    await user.click(
      await screen.findByRole('menuitem', { name: 'Collapse all' }),
    )
    await waitFor(() => expect(rowNames()).toHaveLength(9))
  })

  it('counts files in subfolders too, remembered per user', async () => {
    await renderColumn()
    const user = userEvent.setup()
    expect(countOf(row(/^Blog/))).toBe('1')
    await user.click(screen.getByRole('button', { name: 'Folder options' }))
    const nested = await screen.findByRole('menuitemradio', {
      name: 'Count files in subfolders too',
    })
    expect(nested.getAttribute('aria-checked')).toBe('false')
    await user.click(nested)
    // Blog 1 + 2025 6 + 2026 8 + Spring campaign 10.
    await waitFor(() => expect(countOf(row(/^Blog/))).toBe('25'))
    // All files and Uncategorized always count directly.
    expect(countOf(row(/^Uncategorized/))).toBe('13')
    const stored = Object.entries(window.localStorage).find(([key]) =>
      key.startsWith('wpu-media-manager:folders:'),
    )
    expect(stored?.[1]).toContain('"countMode":"nested"')
  })

  it('searches folders, keeps ancestors visible and marks the match', async () => {
    const library = await renderColumn()
    const user = userEvent.setup()
    const search = screen.getByRole('searchbox', { name: 'Find folder' })
    await user.type(search, 'spring')
    await waitFor(() =>
      expect(rowNames()).toEqual(['Blog', '2026', 'Spring campaign']),
    )
    expect(row(/^Spring campaign/).querySelector('mark')?.textContent).toBe(
      'Spring',
    )
    // The saved expansion is untouched.
    expect(folderUiStore.getState().expanded.size).toBe(0)
    // Enter opens the first match.
    await user.keyboard('{Enter}')
    await waitFor(() => expect(library.search()).toContain('folder=7'))
    // ↓ enters the tree.
    act(() => search.focus())
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(row(/^Blog/))
    // No match: a message and Clear search. The tree stays in the DOM,
    // hidden (the search box's aria-controls target), and an old focus
    // request (↓ above) never pulls focus out of the search box.
    act(() => search.focus())
    await user.clear(search)
    await user.type(search, 'zzz')
    expect(await screen.findByText('No folders match “zzz”.')).toBeTruthy()
    expect(screen.queryByRole('tree')).toBeNull()
    const hiddenTree = document.getElementById(
      search.getAttribute('aria-controls') ?? '',
    )
    expect(hiddenTree?.hidden).toBe(true)
    expect(document.activeElement).toBe(search)
    // Backspacing back to a match keeps typing in the box.
    await user.keyboard('{Backspace}{Backspace}{Backspace}spr')
    await waitFor(() => expect(rowNames()).toContain('Spring campaign'))
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(document.activeElement).toBe(search)
    await user.keyboard('n')
    expect((search as HTMLInputElement).value).toBe('sprn')
    expect(
      screen.queryByRole('textbox', { name: 'New folder name' }),
    ).toBeNull()
    await user.clear(search)
    await user.type(search, 'zzz')
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(await screen.findByRole('tree', { name: 'Folders' })).toBeTruthy()
    expect((search as HTMLInputElement).value).toBe('')
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(document.activeElement).toBe(search)
  })

  it('clears the search with the first Esc and leaves the field with the second', async () => {
    await renderColumn()
    const user = userEvent.setup()
    const search = screen.getByRole('searchbox', { name: 'Find folder' })
    await user.type(search, 'blog')
    await user.keyboard('{Escape}')
    expect((search as HTMLInputElement).value).toBe('')
    expect(document.activeElement).toBe(search)
    await user.keyboard('{Escape}')
    expect(document.activeElement).not.toBe(search)
  })

  it('reveals the folder of a deep link', async () => {
    await renderColumn('?view=library&folder=7')
    await waitFor(() =>
      expect(row(/^Spring campaign/).getAttribute('aria-current')).toBe('true'),
    )
    expect(row(/^Spring campaign/).tabIndex).toBe(0)
  })

  it('hides with its header button', async () => {
    await renderColumn()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Hide folders' }))
    await waitFor(() =>
      expect(
        document.querySelector('[data-mm-app]')?.getAttribute('data-folders'),
      ).toBe('closed'),
    )
    coreStore.getState().setFoldersOpen(true)
  })
})

describe('scenarios', () => {
  it('shows no column at all without FileBird, and M explains', async () => {
    await renderLibrary({ scenario: 'no-filebird' })
    expect(screen.queryByRole('tree', { name: 'Folders' })).toBeNull()
    const user = userEvent.setup()
    const [first] = screen.getAllByRole('gridcell')
    await user.click(first as HTMLElement)
    await user.keyboard('m')
    expect(
      await screen.findAllByText(
        'Folders need the FileBird plugin on your WordPress site.',
      ),
    ).not.toHaveLength(0)
  })

  it('per-user mode: a notice, browsing works, changes explain why', async () => {
    const library = await renderColumn('?view=library', 'per-user')
    expect(screen.getByRole('note')).toBeTruthy()
    expect(screen.getByText('Per-user folders aren’t supported')).toBeTruthy()
    const user = userEvent.setup()
    await user.click(row(/^Blog/))
    await waitFor(() => expect(library.search()).toContain('folder=4'))
    await user.click(screen.getByRole('button', { name: 'New folder' }))
    expect(
      await screen.findAllByText(
        'Folder changes are off: FileBird’s per-user folders aren’t supported.',
      ),
    ).not.toHaveLength(0)
    expect(
      screen.queryByRole('textbox', { name: 'New folder name' }),
    ).toBeNull()
  })

  it('Pro: colours tint the icons and the options offer folder sort', async () => {
    await renderColumn('?view=library', 'pro')
    const brandIcon = row(/^Brand/).querySelector('[class*="icon"] svg')
    expect(brandIcon?.getAttribute('style') ?? '').toContain('--folder-color')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Folder options' }))
    await user.click(
      await screen.findByRole('menuitemradio', {
        name: 'Sort folders: name A–Z',
      }),
    )
    await waitFor(() =>
      expect(rowNames().slice(2)).toEqual([
        'Archive',
        'Blog',
        'Brand',
        'Events',
        'Press kit',
        'Products',
        'Team',
      ]),
    )
  })

  it('Lite hides colours even when they are stored', async () => {
    await renderColumn()
    const brandIcon = row(/^Brand/).querySelector('[class*="icon"] svg')
    expect(brandIcon?.getAttribute('style') ?? '').not.toContain(
      '--folder-color',
    )
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Folder options' }))
    await screen.findByRole('menuitem', { name: 'Expand all' })
    expect(
      screen.queryByRole('menuitemradio', { name: /Sort folders/ }),
    ).toBeNull()
  })

  it('shows the Trash row when the Trash is on', async () => {
    const library = await renderColumn('?view=library', 'trash')
    const user = userEvent.setup()
    await user.click(row(/^Trash/))
    await waitFor(() => expect(library.search()).toContain('folder=trash'))
  })
})

describe('details', () => {
  it('scrolls a deep-linked folder far down the tree into view', async () => {
    // Everything expanded (stored preferences), so the tree is taller than
    // the column: 300 folders in the large mock.
    for (let user = 1; user <= 10; user++) {
      window.localStorage.setItem(
        `wpu-media-manager:folders:${user}`,
        JSON.stringify({
          countMode: 'direct',
          sort: 'manual',
          expanded: Array.from({ length: 400 }, (_, index) => index + 1),
        }),
      )
    }
    const library = await renderLibrary({ scenario: 'large' })
    const folders = library.mock.library.folderTree().folders
    const lastTop = [...folders]
      .filter((folder) => folder.parent === 0)
      .sort((a, b) => b.ord - a.ord)[0]
    const deepest =
      folders.filter((folder) => folder.parent === lastTop?.id).at(-1) ??
      lastTop
    cleanupFolders()
    for (let user = 1; user <= 10; user++) {
      window.localStorage.setItem(
        `wpu-media-manager:folders:${user}`,
        JSON.stringify({
          countMode: 'direct',
          sort: 'manual',
          expanded: Array.from({ length: 400 }, (_, index) => index + 1),
        }),
      )
    }
    await renderLibrary({
      scenario: 'large',
      search: `?view=library&folder=${deepest?.id}`,
    })
    const treeElement = await screen.findByRole('tree', { name: 'Folders' })
    expect(treeElement.scrollHeight).toBeGreaterThan(treeElement.clientHeight)
    await waitFor(() => {
      const current = treeElement.querySelector<HTMLElement>(
        '[aria-current="true"]',
      )
      expect(current).toBeTruthy()
      const box = current?.getBoundingClientRect()
      const view = treeElement.getBoundingClientRect()
      expect(box?.top).toBeGreaterThanOrEqual(view.top - 1)
      expect(box?.bottom).toBeLessThanOrEqual(view.bottom + 1)
    })
  })

  it('shows a truncated name in full on hover, without a native title', async () => {
    await renderColumn()
    const long = 'A very long folder name that cannot fit in the column at all'
    const user = userEvent.setup()
    act(() => row(/^Team/).focus())
    await user.keyboard('r')
    const input = await screen.findByRole('textbox', {
      name: 'Rename folder Team',
    })
    await user.clear(input)
    await user.type(input, `${long}{Enter}`)
    const item = await within(tree()).findByRole('treeitem', {
      name: new RegExp(`^${long}`),
    })
    expect(item.hasAttribute('title')).toBe(false)
    const name = item.querySelector<HTMLElement>('[data-name]') as HTMLElement
    expect(name.scrollWidth).toBeGreaterThan(name.clientWidth)
    await user.hover(name)
    const tip = await waitFor(() => {
      const element = document.querySelector('[data-mm-name-tip]')
      expect(element).toBeTruthy()
      return element as HTMLElement
    })
    expect(tip.textContent).toBe(long)
    expect(tip.getAttribute('aria-hidden')).toBe('true')
    await user.unhover(name)
    await waitFor(() =>
      expect(document.querySelector('[data-mm-name-tip]')).toBeNull(),
    )
  })

  it('keeps the twisty and icons selectable as far as CSS goes (iPad)', async () => {
    await renderColumn()
    const item = row(/^Blog/)
    for (const part of [
      item.querySelector('[data-twisty]'),
      item.querySelector('[class*="icon"]'),
    ]) {
      const style = getComputedStyle(part as Element)
      expect(style.getPropertyValue('-webkit-user-select')).not.toBe('none')
      expect(style.userSelect).not.toBe('none')
    }
  })

  it('plays the "just changed" flash once, not again when the row remounts', async () => {
    await renderColumn()
    const user = userEvent.setup()
    act(() => row(/^Team/).focus())
    await user.keyboard('r')
    await screen.findByRole('textbox', { name: 'Rename folder Team' })
    await user.keyboard('Crew{Enter}')
    await waitFor(() =>
      expect(row(/^Crew/).hasAttribute('data-flash')).toBe(true),
    )
    await waitFor(
      () => expect(row(/^Crew/).hasAttribute('data-flash')).toBe(false),
      { timeout: 2000 },
    )
    // Unmount the rows (a search with no match), then show them again.
    act(() => folderUiStore.setState({ search: 'zzz' }))
    await screen.findByText('No folders match “zzz”.')
    act(() => folderUiStore.setState({ search: '' }))
    await within(tree()).findByRole('treeitem', { name: /^Crew/ })
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(row(/^Crew/).hasAttribute('data-flash')).toBe(false)
  })
})
