import { act, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { delay, http } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { coreStore } from '../../core/state'
import { urlStore } from '../../core/url/useUrlState'
import { failOnReactWarnings } from '../../test/consoleErrors'
import { cleanupLibrary, renderLibrary } from '../../test/renderLibrary'

// The filter bar, search and sort (interaction-spec §3, A1 brief §3) in
// Chromium over the mock library (93 items; 19 images without alt). Every
// filter is URL state written with replace (D16), and keeps the selection.

failOnReactWarnings()
afterEach(cleanupLibrary)

vi.mock('../inspector', () => ({
  InspectorPanel: () => null,
  register: () => {},
}))

function bar(): HTMLElement {
  return screen.getByRole('group', { name: 'Filters' })
}

function chip(name: RegExp | string): HTMLElement {
  return within(bar()).getByRole('button', { name })
}

/** The count shown in a chip ("Images 81" → 81). */
function countOf(element: HTMLElement): number {
  const text = element.textContent ?? ''
  return Number(text.replace(/\D+/g, ''))
}

describe('the filter bar', () => {
  it('shows type chips and Missing alt with the folder’s counts, and the summary', async () => {
    const { mock } = await renderLibrary()
    const facets = mock.library.facets({
      folder: 'all',
      q: null,
      type: null,
      alt: null,
      size: null,
      orient: null,
      month: null,
      sort: 'date-desc',
    })
    await waitFor(() => expect(chip(/^All/)).toBeTruthy())
    expect(countOf(chip(/^All/))).toBe(facets.folder.total)
    expect(countOf(chip(/^Images/))).toBe(facets.folder.types.image)
    expect(countOf(chip(/^Video/))).toBe(facets.folder.types.video)
    expect(countOf(chip(/^Missing alt/))).toBe(facets.folder.missingAlt)
    expect(chip(/^All/).getAttribute('aria-pressed')).toBe('true')
    const summary = document.querySelector('[data-mm-summary]') as HTMLElement
    await waitFor(() =>
      expect(summary.textContent).toMatch(/^93 items · [\d.]+ (MB|GB)$/),
    )
  })

  it('hides a type with no items in the folder', async () => {
    const { mock } = await renderLibrary()
    // A folder with images only.
    const folder = mock.library.createFolder({ name: 'Only images', parent: 0 })
    const [image] = mock.library
      .collection({
        folder: 'all',
        q: null,
        type: 'image',
        alt: null,
        size: null,
        orient: null,
        month: null,
        sort: 'date-desc',
      })
      .rows.slice(0, 1)
    mock.library.assign(folder.folder.id, [image as number])
    act(() => urlStore().navigate({ folder: folder.folder.id }))
    await waitFor(() => expect(countOf(chip(/^All/))).toBe(1))
    expect(within(bar()).queryByRole('button', { name: /^Video/ })).toBeNull()
    expect(countOf(chip(/^Images/))).toBe(1)
  })

  it('filters by type and Missing alt in the URL, replacing the entry and keeping the selection', async () => {
    const user = userEvent.setup()
    const { history, search } = await renderLibrary()
    await user.click(screen.getAllByRole('gridcell')[0] as HTMLElement)
    const selected = [...coreStore.getState().selection]
    const entries = history.entries().searches.length

    await user.click(chip(/^Video/))
    expect(search()).toContain('type=video')
    expect(chip(/^Video/).getAttribute('aria-pressed')).toBe('true')
    await waitFor(() => expect(screen.getAllByRole('gridcell')).toHaveLength(2))
    // Clicking the active type again turns it off.
    await user.click(chip(/^Video/))
    expect(search()).not.toContain('type=')

    await user.click(chip(/^Missing alt/))
    expect(search()).toContain('alt=missing')
    await waitFor(() =>
      expect(screen.getAllByRole('gridcell')).toHaveLength(19),
    )
    expect(history.entries().searches).toHaveLength(entries)
    expect([...coreStore.getState().selection]).toEqual(selected)
  })

  it('adds size, orientation and month filters from the menu, as removable chips', async () => {
    const user = userEvent.setup()
    const { search } = await renderLibrary()
    await user.click(chip(/^Filter$/))
    const menu = await screen.findByRole('menu')
    await user.click(within(menu).getByRole('menuitem', { name: '> 1 MB' }))
    expect(search()).toContain('size=gt1')
    const sizeChip = chip('Remove filter: > 1 MB')

    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    await user.click(chip(/^Filter$/))
    const again = await screen.findByRole('menu')
    expect(
      within(again)
        .getByRole('menuitem', { name: '> 1 MB' })
        .getAttribute('aria-current'),
    ).toBe('true')
    await user.click(within(again).getByRole('menuitem', { name: 'Portrait' }))
    expect(search()).toContain('orient=portrait')

    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    await user.click(chip(/^Filter$/))
    const months = await screen.findByRole('menu')
    const month = within(months).getAllByRole('menuitem')[5] as HTMLElement
    await user.click(month)
    expect(search()).toMatch(/month=\d{4}-\d{2}/)
    expect(chip(/^Remove filter: \w+ \d{4}$/)).toBeTruthy()

    await user.click(sizeChip)
    expect(search()).not.toContain('size=')
    expect(
      within(bar()).queryByRole('button', { name: 'Remove filter: > 1 MB' }),
    ).toBeNull()
  })

  it('shows skeletons, not stale counts, while another folder’s counts load', async () => {
    const { mock } = await renderLibrary({
      handlers: [
        http.get('*/api/library/facets', async ({ request }) => {
          if (new URL(request.url).searchParams.get('folder')) {
            await delay(400)
          }
          return undefined
        }),
      ],
    })
    await waitFor(() => expect(chip(/^All/)).toBeTruthy())
    const folder = mock.library.folderTree().folders[0]?.id as number
    act(() => urlStore().navigate({ folder }))
    await waitFor(() =>
      expect(within(bar()).queryByRole('button', { name: /^All/ })).toBeNull(),
    )
    await waitFor(() => expect(chip(/^All/)).toBeTruthy(), { timeout: 2000 })
  })
})

describe('search', () => {
  it('writes q 150 ms after the last keystroke, replacing the entry; Esc clears', async () => {
    const user = userEvent.setup()
    const { history, search } = await renderLibrary()
    const entries = history.entries().searches.length
    const box = screen.getByRole('searchbox', { name: 'Search media' })
    await user.click(box)
    await user.type(box, 'drone')
    // Not yet: the debounce is still running.
    expect(search()).not.toContain('q=')
    await waitFor(() => expect(search()).toContain('q=drone'))
    expect(history.entries().searches).toHaveLength(entries)

    await user.keyboard('{Escape}')
    expect(box).toHaveProperty('value', '')
    expect(search()).not.toContain('q=')
    // A second Esc leaves the field (the keymap blurs it).
    await user.keyboard('{Escape}')
    expect(document.activeElement).not.toBe(box)
  })

  it('writes at once on Enter, and follows q when it changes elsewhere', async () => {
    const user = userEvent.setup()
    const { search } = await renderLibrary()
    const box = screen.getByRole('searchbox', { name: 'Search media' })
    await user.type(box, '  beach   house {Enter}')
    expect(search()).toContain('q=beach+house')
    act(() => urlStore().navigate({ q: null }))
    expect(box).toHaveProperty('value', '')
    act(() => urlStore().navigate({ q: 'forest' }))
    expect(box).toHaveProperty('value', 'forest')
  })
})

describe('sort', () => {
  it('works from the keyboard: open, arrow to an order, Enter, focus back on the button', async () => {
    const user = userEvent.setup()
    const { search } = await renderLibrary()
    const button = screen.getByRole('button', { name: 'Sort: Newest' })
    button.focus()
    await user.keyboard('{Enter}')
    const menu = await screen.findByRole('menu')
    // The first order has focus once it opens.
    await waitFor(() =>
      expect(document.activeElement?.textContent).toBe('Newest'),
    )
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement?.textContent).toBe('Oldest')
    expect(menu.contains(document.activeElement)).toBe(true)
    await user.keyboard('{Enter}')
    expect(search()).toContain('sort=date-asc')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(document.activeElement).toBe(
      screen.getByRole('button', { name: 'Sort: Oldest' }),
    )
  })

  it('shows the current sort and changes it from the menu, replacing the entry', async () => {
    const user = userEvent.setup()
    const { history, search } = await renderLibrary()
    const entries = history.entries().searches.length
    const button = screen.getByRole('button', { name: 'Sort: Newest' })
    await user.click(button)
    const menu = await screen.findByRole('menu')
    expect(
      within(menu)
        .getByRole('menuitem', { name: 'Newest' })
        .getAttribute('aria-current'),
    ).toBe('true')
    await user.click(within(menu).getByRole('menuitem', { name: 'Oldest' }))
    expect(search()).toContain('sort=date-asc')
    expect(history.entries().searches).toHaveLength(entries)
    expect(screen.getByRole('button', { name: 'Sort: Oldest' })).toBeTruthy()
  })
})
