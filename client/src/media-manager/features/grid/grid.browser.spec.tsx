import { act, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { http } from 'msw'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { centerApi } from '../../core/collection/centerApi'
import { coreStore } from '../../core/state'
import { urlStore } from '../../core/url/useUrlState'
import {
  cleanupLibrary,
  pollRevNow,
  renderLibrary,
} from '../../test/renderLibrary'

// The grid of the M2 slice in Chromium, over the mock library (93 items,
// newest first): justified tiles as an ARIA grid, pointer and keyboard
// selection through the real keymap, URL-driven layout and density.

afterEach(cleanupLibrary)

// The inspector has its own specs; keep these about the grid.
vi.mock('../inspector', () => ({
  InspectorPanel: () => null,
  register: () => {},
}))

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

function selectedIds(): number[] {
  return [...coreStore.getState().selection].sort((a, b) => a - b)
}

describe('the grid', () => {
  it('renders a virtualised ARIA grid of justified tiles that fill the width', async () => {
    await renderLibrary()
    const grid = screen.getByRole('grid', { name: 'Media' })
    expect(grid.getAttribute('aria-multiselectable')).toBe('true')
    // Only the visible rows (plus overscan) are in the DOM.
    expect(tiles().length).toBeGreaterThan(5)
    expect(tiles().length).toBeLessThan(93)
    // A full row's tiles span the grid's width (justified).
    const row = screen.getAllByRole('row')[0] as HTMLElement
    const cells = [...row.querySelectorAll<HTMLElement>('[role="gridcell"]')]
    const last = cells[cells.length - 1] as HTMLElement
    const right = last.offsetLeft + last.offsetWidth
    expect(Math.abs(right - grid.clientWidth)).toBeLessThan(1)
    // Pictures load into a placeholder of the tile's own size.
    await waitFor(() =>
      expect(
        document.querySelector('[data-mm-tile] img[data-loaded]'),
      ).not.toBeNull(),
    )
  })

  it('selects by click, Ctrl/Cmd+click and Shift+click, in collection order', async () => {
    const user = userEvent.setup()
    await renderLibrary()
    const [first, second, third, fourth] = tiles() as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ]
    await user.click(second)
    expect(selectedIds()).toEqual([idOf(second)])
    expect(second.getAttribute('aria-selected')).toBe('true')
    expect(coreStore.getState().focus).toBe(idOf(second))

    await user.keyboard('{Control>}')
    await user.click(fourth)
    await user.keyboard('{/Control}')
    expect(selectedIds()).toEqual(
      [idOf(second), idOf(fourth)].sort((a, b) => a - b),
    )

    await user.click(first)
    await user.keyboard('{Shift>}')
    await user.click(third)
    await user.keyboard('{/Shift}')
    expect(selectedIds()).toEqual(
      [idOf(first), idOf(second), idOf(third)].sort((a, b) => a - b),
    )
  })

  it('moves focus and selection with the arrow keys, keeping DOM focus on the tile', async () => {
    const user = userEvent.setup()
    await renderLibrary()
    const first = tiles()[0] as HTMLElement
    await user.click(first)
    await user.keyboard('{ArrowRight}')
    const second = tiles()[1] as HTMLElement
    expect(coreStore.getState().focus).toBe(idOf(second))
    expect(selectedIds()).toEqual([idOf(second)])
    expect(document.activeElement).toBe(second)

    // ↓ picks the nearest tile in the next row; Shift+↑ extends back.
    await user.keyboard('{ArrowDown}')
    const below = coreStore.getState().focus as number
    expect(below).not.toBe(idOf(second))
    expect(document.activeElement).toBe(tileOf(below))
    await user.keyboard('{Shift>}{ArrowUp}{/Shift}')
    expect(coreStore.getState().selection.size).toBeGreaterThan(1)

    // Home/End jump to the ends, End scrolling the last tile into view.
    await user.keyboard('{End}')
    const lastId = coreStore.getState().focus as number
    await waitFor(() => expect(document.activeElement).toBe(tileOf(lastId)))
    await user.keyboard('{Home}')
    expect(coreStore.getState().focus).toBe(idOf(first))
  })

  it('Ctrl/Cmd+A selects everything, X toggles, Esc clears', async () => {
    const user = userEvent.setup()
    await renderLibrary()
    await user.click(tiles()[0] as HTMLElement)
    await user.keyboard('{Control>}a{/Control}')
    expect(coreStore.getState().selection.size).toBe(93)
    await user.keyboard('{Escape}')
    expect(coreStore.getState().selection.size).toBe(0)
    await user.keyboard('x')
    expect(coreStore.getState().selection.size).toBe(1)
  })

  it('follows ?layout and ?density from the URL (+, - and L replace the entry)', async () => {
    const user = userEvent.setup()
    const { search, history } = await renderLibrary()
    // Bigger thumbnails need more rows for the same items.
    const rowCount = () =>
      Number(screen.getByRole('grid').getAttribute('aria-rowcount'))
    const before = rowCount()
    await user.click(tiles()[0] as HTMLElement)
    await user.keyboard('+')
    await waitFor(() => expect(rowCount()).toBeGreaterThan(before))
    expect(search()).toContain('density=3')
    await user.keyboard('l')
    await waitFor(() =>
      expect(screen.getByRole('grid').getAttribute('data-layout')).toBe(
        'square',
      ),
    )
    const square = tiles()[0] as HTMLElement
    expect(Math.abs(square.offsetWidth - square.offsetHeight)).toBeLessThan(1)
    // Replaced, not pushed: still one history entry.
    expect(history.entries().searches).toHaveLength(1)
  })

  it('shows "No media matches" with Clear filters for an empty search', async () => {
    const user = userEvent.setup()
    await renderLibrary({
      search: '?view=library&q=nothing-matches-this',
      waitForGrid: false,
    })
    expect(await screen.findByText('No media matches.')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect((await screen.findAllByRole('gridcell')).length).toBeGreaterThan(0)
  })

  it('keeps the previous rows while another folder loads, then starts at the top', async () => {
    const { mock } = await renderLibrary()
    const scroller = document.querySelector<HTMLElement>(
      '[data-mm-grid-scroll]',
    ) as HTMLElement
    scroller.scrollTop = 600
    scroller.dispatchEvent(new Event('scroll'))
    const folder = mock.library.folderTree().folders[0]?.id ?? 0
    act(() => {
      coreStore.getState().selectOnly(idOf(tiles()[0] as HTMLElement))
    })
    act(() => urlStore().navigate({ folder }, { replace: true }))
    // Changing folder clears the selection (interaction-spec §1).
    expect(coreStore.getState().selection.size).toBe(0)
    await waitFor(() => expect(scroller.scrollTop).toBe(0))
  })
})

function scroller(): HTMLElement {
  return document.querySelector<HTMLElement>(
    '[data-mm-grid-scroll]',
  ) as HTMLElement
}

function scrollTo(top: number): void {
  act(() => {
    scroller().scrollTop = top
    scroller().dispatchEvent(new Event('scroll'))
  })
}

/** Whether the element is entirely inside the scroller's viewport. */
function inView(element: Element): boolean {
  const box = element.getBoundingClientRect()
  const view = scroller().getBoundingClientRect()
  return box.top >= view.top - 1 && box.bottom <= view.bottom + 1
}

/** Whether any part of the element is inside the scroller's viewport. */
function intersectsView(element: Element): boolean {
  const box = element.getBoundingClientRect()
  const view = scroller().getBoundingClientRect()
  return box.bottom > view.top && box.top < view.bottom
}

describe('the grid keeps its place (spike C1 rules)', () => {
  it('keeps the scroll position when the same query refetches for a new rev', async () => {
    let collectionRequests = 0
    const { mock } = await renderLibrary({
      handlers: [
        http.get('*/api/library/collection', () => {
          collectionRequests++
          return undefined
        }),
      ],
    })
    scrollTo(600)
    const before = collectionRequests
    mock.library.externalEdit(idOf(tiles()[0] as HTMLElement), {
      title: 'Changed elsewhere',
    })
    pollRevNow()
    await waitFor(() => expect(collectionRequests).toBeGreaterThan(before))
    await waitFor(() => expect(scroller().scrollTop).toBeCloseTo(600, -1))
  })

  it('gives DOM focus back to the focused tile after a re-layout (panel toggle)', async () => {
    const user = userEvent.setup()
    await renderLibrary()
    const tile = tiles()[5] as HTMLElement
    const id = idOf(tile)
    await user.click(tile)
    const widthBefore = scroller().clientWidth
    // I toggles the inspector, which changes the grid's width: a re-layout.
    await user.keyboard('i')
    await waitFor(() => expect(scroller().clientWidth).not.toBe(widthBefore))
    await waitFor(() =>
      expect(
        (document.activeElement as HTMLElement | null)?.dataset.mmTile,
      ).toBe(String(id)),
    )
  })

  it('keeps exactly one tab stop, in view, when nothing is focused', async () => {
    await renderLibrary()
    expect(coreStore.getState().focus).toBeNull()
    scrollTo(1500)
    await waitFor(() => {
      const stops = scroller().querySelectorAll(
        '[role="gridcell"][tabindex="0"]',
      )
      expect(stops).toHaveLength(1)
      expect(intersectsView(stops[0] as Element)).toBe(true)
    })
  })

  it('focusTile brings a pinned tile scrolled far away back into view', async () => {
    const user = userEvent.setup()
    await renderLibrary()
    const first = tiles()[0] as HTMLElement
    const id = idOf(first)
    await user.click(first)
    scrollTo(100_000)
    act(() => centerApi.focusTile(id))
    const tile = document.querySelector(`[data-mm-tile="${id}"]`) as Element
    expect(document.activeElement).toBe(tile)
    expect(inView(tile)).toBe(true)
  })

  it('a click on a half-visible tile selects it without scrolling first', async () => {
    await renderLibrary()
    // Find a tile cut off by the bottom edge.
    const view = scroller().getBoundingClientRect()
    const cut = tiles().find((tile) => {
      const box = tile.getBoundingClientRect()
      return box.top < view.bottom - 20 && box.bottom > view.bottom + 5
    }) as HTMLElement
    expect(cut).toBeTruthy()
    const top = scroller().scrollTop
    // A real mouse press, step by step: the browser focuses the tile on
    // mousedown without scrolling (user-event's focus() would scroll).
    act(() => {
      cut.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      cut.focus({ preventScroll: true })
    })
    // Had the grid revealed the row now, the click would land elsewhere.
    expect(scroller().scrollTop).toBe(top)
    act(() => {
      cut.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
      cut.click()
    })
    expect(cut.getAttribute('aria-selected')).toBe('true')
    expect(scroller().scrollTop).toBe(top)
  })

  it('keeps the picture on screen while a newer version loads', async () => {
    const { mock } = await renderLibrary()
    const tile = tiles()[0] as HTMLElement
    const image = await waitFor(() => {
      const found = tile.querySelector('img[data-loaded]')
      if (!found) throw new Error('not loaded yet')
      return found as HTMLImageElement
    })
    const before = image.src
    mock.library.externalEdit(idOf(tile), { title: 'Renamed elsewhere' })
    pollRevNow()
    await waitFor(() => expect(image.src).not.toBe(before))
    // The same element, never blanked: the new src was loaded first.
    expect(tile.querySelector('img')).toBe(image)
    expect(image.hasAttribute('data-loaded')).toBe(true)
  })
})
