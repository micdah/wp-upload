import { act, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { coreStore } from '../../core/state'
import { urlStore } from '../../core/url/useUrlState'
import { failOnReactWarnings } from '../../test/consoleErrors'
import { cleanupLibrary, renderLibrary } from '../../test/renderLibrary'

// The grid's toolbar parts (A1 brief §2 and §4): the selection bar at 2 or
// more selected, with D33's hidden count, and the layout and density
// controls, which keep the focused tile anchored (spike C1). Also the empty
// states (§5).

failOnReactWarnings()
afterEach(cleanupLibrary)

vi.mock('../inspector', () => ({
  InspectorPanel: () => null,
  register: () => {},
}))

function tiles(): HTMLElement[] {
  return screen.getAllByRole('gridcell')
}

function idOf(tile: HTMLElement): number {
  return Number(tile.dataset.mmTile)
}

function selectionBar(): HTMLElement | null {
  return screen.queryByRole('group', { name: 'Selection' })
}

function scroller(): HTMLElement {
  return document.querySelector<HTMLElement>(
    '[data-mm-grid-scroll]',
  ) as HTMLElement
}

describe('the selection bar', () => {
  it('replaces the toolbar from 2 selected, with the actions not built yet disabled', async () => {
    const user = userEvent.setup()
    await renderLibrary()
    const [first, second] = tiles() as [HTMLElement, HTMLElement]
    await user.click(first)
    expect(selectionBar()).toBeNull()
    expect(screen.getByRole('searchbox', { name: 'Search media' })).toBeTruthy()

    await user.keyboard('{Control>}')
    await user.click(second)
    await user.keyboard('{/Control}')
    // The bar's content is a lazy chunk: wait for it.
    const bar = await screen.findByRole('group', { name: 'Selection' })
    expect(within(bar).getByText('2 selected')).toBeTruthy()
    // The toolbar's own controls are hidden underneath (and out of reach).
    expect(screen.queryByRole('searchbox', { name: 'Search media' })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Sort/ })).toBeNull()

    // Move to folder is A3's (folders.move-to). Edit details is the
    // inspector's, mocked out in this file; B3 downloads and deletes.
    expect(
      within(bar)
        .getByRole('button', { name: 'Move to folder' })
        .getAttribute('aria-disabled'),
    ).not.toBe('true')
    for (const name of ['Edit details', 'Download', 'Delete']) {
      const button = within(bar).getByRole('button', { name })
      expect(button.getAttribute('aria-disabled')).toBe('true')
    }
  })

  it('says how many selected items the filters hide (D33)', async () => {
    const user = userEvent.setup()
    await renderLibrary()
    await user.click(tiles()[0] as HTMLElement)
    await user.keyboard('{Shift>}{ArrowRight}{ArrowRight}{/Shift}')
    await screen.findByRole('group', { name: 'Selection' })
    expect(within(selectionBar() as HTMLElement).getByText('3 selected'))
    act(() => urlStore().navigate({ type: 'video' }))
    await waitFor(() =>
      expect(
        within(selectionBar() as HTMLElement).getByText(/3 hidden by filters/),
      ).toBeTruthy(),
    )
    // Filters keep the selection (interaction-spec §1).
    expect(coreStore.getState().selection.size).toBe(3)
  })

  it('Ctrl/Cmd+A selects the whole collection; ✕ clears and gives the grid its focus back', async () => {
    const user = userEvent.setup()
    await renderLibrary()
    const first = tiles()[0] as HTMLElement
    await user.click(first)
    await user.keyboard('{Control>}a{/Control}')
    const bar = await screen.findByRole('group', { name: 'Selection' })
    expect(within(bar).getByText('93 selected')).toBeTruthy()
    await user.click(
      within(bar).getByRole('button', { name: 'Clear selection' }),
    )
    expect(selectionBar()).toBeNull()
    expect(coreStore.getState().selection.size).toBe(0)
    expect(document.activeElement).toBe(
      document.querySelector(`[data-mm-tile="${idOf(first)}"]`),
    )
  })
})

describe('the selection bar and focus', () => {
  it('gives the grid its focus back when Esc clears the selection from a bar button', async () => {
    const user = userEvent.setup()
    await renderLibrary()
    const [first, second] = tiles() as [HTMLElement, HTMLElement]
    await user.click(first)
    await user.keyboard('{Control>}')
    await user.click(second)
    await user.keyboard('{/Control}')
    const bar = await screen.findByRole('group', { name: 'Selection' })
    within(bar).getByRole('button', { name: 'Download' }).focus()
    // The first Esc closes the button's tooltip (the innermost layer), the
    // next clears the selection.
    await user.keyboard('{Escape}')
    if (selectionBar()) await user.keyboard('{Escape}')
    await waitFor(() => expect(selectionBar()).toBeNull())
    await waitFor(() =>
      expect(document.activeElement).toBe(
        document.querySelector(`[data-mm-tile="${idOf(second)}"]`),
      ),
    )
  })
})

describe('layout and density', () => {
  it('switches layout and density from the toolbar, replacing the URL entry', async () => {
    const user = userEvent.setup()
    const { history, search } = await renderLibrary()
    const entries = history.entries().searches.length
    const square = screen.getByRole('button', { name: 'Square layout' })
    await user.click(square)
    expect(search()).toContain('layout=square')
    expect(square.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('grid', { name: 'Media' }).dataset.layout).toBe(
      'square',
    )

    const slider = screen.getByRole('slider', { name: 'Thumbnail size' })
    expect(slider.getAttribute('aria-valuetext')).toBe('200 px')
    act(() => {
      // A native range input: set its value as a drag would.
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )?.set
      setter?.call(slider, '4')
      slider.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(search()).toContain('density=4')
    expect(slider.getAttribute('aria-valuetext')).toBe('340 px')
    expect(history.entries().searches).toHaveLength(entries)

    // Arrow keys on the slider are the slider's (the browser's own range
    // behaviour), never the grid's: they don't move its focus.
    await user.click(tiles()[0] as HTMLElement)
    const focusBefore = coreStore.getState().focus
    slider.focus()
    await user.keyboard('{ArrowRight}{ArrowDown}')
    expect(coreStore.getState().focus).toBe(focusBefore)
  })

  it('keeps the focused tile where it is when the density changes', async () => {
    const user = userEvent.setup()
    await renderLibrary()
    act(() => {
      scroller().scrollTop = 500
      scroller().dispatchEvent(new Event('scroll'))
    })
    await waitFor(() => expect(scroller().scrollTop).toBe(500))
    // A tile well inside the viewport.
    const view = scroller().getBoundingClientRect()
    const target = tiles().find((tile) => {
      const box = tile.getBoundingClientRect()
      return box.top > view.top + 150 && box.bottom < view.bottom - 50
    }) as HTMLElement
    const id = idOf(target)
    await user.click(target)
    const before = target.getBoundingClientRect().top - view.top

    await user.keyboard('+')
    await waitFor(() => expect(urlStore().get().density).toBe(3))
    const offsetNow = () =>
      (
        document.querySelector(`[data-mm-tile="${id}"]`) as HTMLElement
      ).getBoundingClientRect().top - view.top
    await waitFor(() => expect(Math.abs(offsetNow() - before)).toBeLessThan(2))
    expect(document.activeElement?.getAttribute('data-mm-tile')).toBe(
      String(id),
    )

    // The layout switch (L) keeps it in place too.
    await user.keyboard('l')
    await waitFor(() => expect(urlStore().get().layout).toBe('square'))
    await waitFor(() => expect(Math.abs(offsetNow() - before)).toBeLessThan(2))
  })
})

describe('empty states', () => {
  it('offers Upload on an empty library, as a drop zone', async () => {
    await renderLibrary({ scenario: 'empty', waitForGrid: false })
    expect(
      await screen.findByRole('heading', {
        name: 'Your media library is empty',
      }),
    ).toBeTruthy()
    const upload = screen.getByRole('button', { name: 'Upload files' })
    // B2 implements upload.pick.
    expect(upload.getAttribute('aria-disabled')).toBe('true')
    expect(document.querySelector('[data-drop]')).not.toBeNull()
  })

  it('says a folder is empty, with Upload', async () => {
    const { mock } = await renderLibrary()
    const created = mock.library.createFolder({
      name: 'Nothing here',
      parent: 0,
    })
    act(() => urlStore().navigate({ folder: created.folder.id }))
    expect(
      await screen.findByRole('heading', { name: 'This folder is empty' }),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Upload' })).toBeTruthy()
  })

  it('shows skeleton rows while the first collection loads, never a spinner', async () => {
    await renderLibrary({
      settings: { latency: { read: 600, write: 0 } },
      waitForGrid: false,
    })
    const skeleton = await screen.findByRole('status', {
      name: 'Loading media',
    })
    expect(skeleton.children.length).toBeGreaterThan(2)
    expect(document.querySelector('.mantine-Loader-root')).toBeNull()
    await screen.findAllByRole('gridcell', {}, { timeout: 5000 })
  })
})
