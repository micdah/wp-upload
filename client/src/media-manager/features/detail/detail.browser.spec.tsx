import { act, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { userEvent as browserUserEvent } from 'vitest/browser'
import { getCurrentCollection } from '../../core/collection/hooks'
import { coreStore, isInspectorOpen } from '../../core/state'
import { failOnReactWarnings } from '../../test/consoleErrors'
import {
  cleanupLibrary,
  pollRevNow,
  renderLibrary,
} from '../../test/renderLibrary'

// Detail mode of the M2 slice in Chromium, over the mock library: opening
// pushes `?item=`, stepping replaces it and stops at both ends (D34), leaving
// goes back to the grid entry and to the tile, with the return ring.

// The grid follows the item while detail is open; that must not flush
// React synchronously from inside a lifecycle (iPad feel review).
// Registered first, so it checks after the cleanup below has run.
failOnReactWarnings()
afterEach(cleanupLibrary)

// Without the View Transitions API here: in Vitest's iframe, Chromium's
// renderer crashed when a keyboard-opened detail started a view transition
// (not reproducible in a top-level page, where the e2e slice checks the
// morph). core/ui/morph.spec.ts covers the morph itself, and the update runs
// the same way without the API.
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

// The inspector has its own specs; keep these about detail mode.
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

function liveRegion(): string {
  return document.querySelector('[data-mm-live-region]')?.textContent ?? ''
}

async function stage(): Promise<HTMLElement> {
  return screen.findByRole('region', { name: 'Detail' })
}

describe('detail mode', () => {
  it('Enter opens the focused item, pushing one history entry', async () => {
    const user = userEvent.setup()
    const { search, history } = await renderLibrary()
    const second = tiles()[1] as HTMLElement
    await user.click(second)
    await user.keyboard('{Enter}')
    const detail = await stage()
    expect(search()).toBe(`?view=library&item=${idOf(second)}`)
    expect(history.entries().searches).toHaveLength(2)
    // The grid underneath is inert; keyboard focus moved into detail.
    expect(
      document.querySelector('[data-mm-grid-scroll]')?.closest('[inert]'),
    ).not.toBeNull()
    expect(detail.contains(document.activeElement)).toBe(true)
    // The stage shows the picture, sized to its fitted box.
    const image = await waitFor(() => {
      const found = detail.querySelector('img')
      if (!found) throw new Error('no stage image yet')
      return found
    })
    expect(image.style.width).not.toBe('')
    expect(within2(detail, `2 / 93`)).toBe(true)
  })

  it('←/→ step through the collection, replacing the entry', async () => {
    const user = userEvent.setup()
    const { search, history } = await renderLibrary()
    const [first, second, third] = tiles() as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ]
    await user.click(second)
    await user.keyboard('{Enter}')
    await stage()
    await user.keyboard('{ArrowRight}')
    expect(search()).toContain(`item=${idOf(third)}`)
    await user.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(search()).toContain(`item=${idOf(first)}`)
    expect(history.entries().searches).toHaveLength(2)
    // The grid follows the current item, so focus is on it.
    expect(coreStore.getState().focus).toBe(idOf(first))
  })

  it('stops at both ends with a nudge and an announcement (D34)', async () => {
    const user = userEvent.setup()
    const { search } = await renderLibrary()
    const first = tiles()[0] as HTMLElement
    await user.dblClick(first)
    const detail = await stage()
    await user.keyboard('{ArrowLeft}')
    expect(search()).toContain(`item=${idOf(first)}`)
    await waitFor(() => expect(liveRegion()).toBe('First item in this view'))
    expect(
      detail.querySelector('[data-nudge]')?.getAttribute('data-nudge'),
    ).toBe('-1')
    // The stage's own Previous button is hidden at the start.
    expect(
      detail
        .querySelector('[aria-label="Previous item"]')
        ?.getAttribute('aria-disabled'),
    ).toBe('true')
  })

  it('Esc goes back to the grid entry, focuses the tile and rings it', async () => {
    const user = userEvent.setup()
    const { search, history } = await renderLibrary()
    const third = tiles()[2] as HTMLElement
    const id = idOf(third)
    await user.click(third)
    await user.keyboard('{Enter}')
    await stage()
    await user.keyboard('{ArrowRight}')
    await user.keyboard('{Escape}')
    act(() => history.flush())
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Detail' })).toBeNull(),
    )
    expect(search()).toBe('?view=library')
    expect(history.entries().index).toBe(0)
    const next = coreStore.getState().focus as number
    expect(next).not.toBe(id)
    const tile = document.querySelector<HTMLElement>(`[data-mm-tile="${next}"]`)
    await waitFor(() => expect(document.activeElement).toBe(tile))
    expect(tile?.hasAttribute('data-returning')).toBe(true)
  })

  it('opens from a ?item= deep link, with the grid behind it', async () => {
    const { mock } = await renderLibrary({ waitForGrid: false })
    const id = mock.library.collection({
      folder: 'all',
      q: null,
      type: null,
      alt: null,
      size: null,
      orient: null,
      month: null,
      sort: 'date-desc',
    }).rows[4 * 10] as number
    cleanupLibrary()
    await renderLibrary({
      search: `?view=library&item=${id}`,
      waitForGrid: false,
    })
    const detail = await stage()
    expect(
      await screen.findByText(`11 / 93`, {}, { timeout: 3000 }),
    ).toBeTruthy()
    expect(detail).toBeTruthy()
    expect(coreStore.getState().focus).toBe(id)
  })
})

describe('keys with nothing focused (mm/m2-keys)', () => {
  // A fresh tab, or a click on something that takes no focus (Safari
  // doesn't focus buttons on click): keydown goes to <body>, and the
  // window-level dispatcher must still run grid and detail keys.
  function blurToBody(): void {
    const active = document.activeElement
    if (active instanceof HTMLElement) {
      active.blur()
    }
    expect(document.activeElement).toBe(document.body)
  }

  it('drives the grid, the panels and detail from <body>', async () => {
    const user = userEvent.setup()
    const { search } = await renderLibrary()
    const [first, second] = tiles() as [HTMLElement, HTMLElement]
    blurToBody()

    // The first arrow starts at the first item and focuses its tile.
    await user.keyboard('{ArrowRight}')
    await waitFor(() => expect(document.activeElement).toBe(first))
    expect(first.getAttribute('aria-selected')).toBe('true')

    blurToBody()
    await user.keyboard('{ArrowRight}')
    await waitFor(() => expect(document.activeElement).toBe(second))

    // Panels (mode `any`) from the body.
    blurToBody()
    const inspectorOpen = isInspectorOpen(coreStore.getState())
    await user.keyboard('i')
    expect(isInspectorOpen(coreStore.getState())).toBe(!inspectorOpen)
    await user.keyboard('i')
    expect(isInspectorOpen(coreStore.getState())).toBe(inspectorOpen)

    // Enter opens the focused item; detail focuses itself.
    blurToBody()
    await user.keyboard('{Enter}')
    const detail = await stage()
    expect(search()).toContain(`item=${idOf(second)}`)
    await waitFor(() =>
      expect(detail.contains(document.activeElement)).toBe(true),
    )

    // ←/→ in detail from the body.
    blurToBody()
    await user.keyboard('{ArrowLeft}')
    expect(search()).toContain(`item=${idOf(first)}`)

    // Esc from the body leaves detail and focuses the tile.
    blurToBody()
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Detail' })).toBeNull(),
    )
    await waitFor(() => expect(document.activeElement).toBe(first))
  })

  it('a press on Next keeps the keys working in detail', async () => {
    const user = userEvent.setup()
    const { search } = await renderLibrary()
    const ids = tiles().map(idOf)
    await user.click(tiles()[0] as HTMLElement)
    await user.keyboard('{Enter}')
    const detail = await stage()
    await user.click(screen.getByRole('button', { name: 'Next item' }))
    expect(search()).toContain(`item=${ids[1]}`)
    // Chromium focuses the button, Safari the detail region around it.
    expect(detail.contains(document.activeElement)).toBe(true)
    await user.keyboard('{ArrowRight}')
    expect(search()).toContain(`item=${ids[2]}`)
    await user.keyboard('{ArrowLeft}')
    expect(search()).toContain(`item=${ids[1]}`)
  })
})

describe('fast taps on the chrome (iPad feel review)', () => {
  function style(element: Element | null): CSSStyleDeclaration {
    if (!element) throw new Error('element not rendered')
    return getComputedStyle(element)
  }

  it('select no text: toolbar, grid tiles, detail bar, stage and buttons', async () => {
    const user = userEvent.setup()
    await renderLibrary()
    const tile = tiles()[1] as HTMLElement
    await user.click(tile)
    await user.keyboard('{Enter}')
    const detail = await stage()
    const bar = detail.querySelector('header')
    const next = screen.getByRole('button', { name: 'Next item' })
    const stageBox = next.parentElement
    const chrome = {
      toolbar: document.querySelector('header'),
      tile,
      bar,
      title: detail.querySelector('h2'),
      stage: stageBox,
    }
    // The selection guard covers them (core/ui/noSelect.ts), and none is
    // `user-select: none`: on iPadOS that keeps the keyboard from the page
    // (mm/m2-keys).
    for (const [name, element] of Object.entries(chrome)) {
      expect(element?.closest('[data-mm-no-select]'), name).not.toBeNull()
      expect(style(element).userSelect, name).not.toBe('none')
      expect(
        style(element).getPropertyValue('-webkit-user-select'),
        name,
      ).not.toBe('none')
    }
    // A real double-click on the title selects no word.
    await browserUserEvent.dblClick(chrome.title as HTMLElement)
    expect(window.getSelection()?.toString() ?? '').toBe('')
    // No long-press callout on tiles and the stage's buttons (WebKit only;
    // Chromium has no such property, so only check where it exists).
    for (const element of [tile, next]) {
      const callout = style(element).getPropertyValue('-webkit-touch-callout')
      expect(['', 'none']).toContain(callout)
    }
    // Quick taps are taps, not a double-tap zoom or a selection.
    for (const element of [tile, next, screen.getByLabelText('Back to grid')]) {
      expect(style(element).touchAction).toBe('manipulation')
    }
  })

  it('steps once per click on Next, however fast, and leaves no selection', async () => {
    const user = userEvent.setup({ delay: null })
    const { search } = await renderLibrary()
    const ids = tiles().map(idOf)
    await user.click(tiles()[0] as HTMLElement)
    await user.keyboard('{Enter}')
    await stage()
    const next = screen.getByRole('button', { name: 'Next item' })
    await user.tripleClick(next)
    await user.dblClick(next)
    expect(search()).toContain(`item=${ids[5]}`)
    expect(window.getSelection()?.toString() ?? '').toBe('')
  })
})

describe('detail mode at the edges of the view', () => {
  it('stops at the last item too, with its announcement (D34)', async () => {
    const user = userEvent.setup()
    const { search } = await renderLibrary()
    await user.click(tiles()[0] as HTMLElement)
    await user.keyboard('{End}')
    const last = coreStore.getState().focus as number
    await user.keyboard('{Enter}')
    const detail = await stage()
    await user.keyboard('{ArrowRight}')
    expect(search()).toContain(`item=${last}`)
    await waitFor(() => expect(liveRegion()).toBe('Last item in this view'))
    expect(
      detail.querySelector('[data-nudge]')?.getAttribute('data-nudge'),
    ).toBe('1')
    expect(
      detail
        .querySelector('[aria-label="Next item"]')
        ?.getAttribute('aria-disabled'),
    ).toBe('true')
  })

  it('steps on from the place of an item that left the view (Missing alt, alt saved)', async () => {
    const user = userEvent.setup()
    const { mock, search } = await renderLibrary({
      search: '?view=library&alt=missing',
    })
    const [, second, third] = tiles() as [HTMLElement, HTMLElement, HTMLElement]
    const id = idOf(second)
    const after = idOf(third)
    await user.click(second)
    await user.keyboard('{Enter}')
    await stage()
    // Saved elsewhere (as the inspector would): it leaves the Missing-alt view.
    mock.library.externalEdit(id, { alt: 'Now described' })
    pollRevNow()
    await waitFor(() =>
      expect(getCurrentCollection()?.rows.has(id)).toBe(false),
    )
    expect(search()).toContain(`item=${id}`)
    await user.keyboard('{ArrowRight}')
    expect(search()).toContain(`item=${after}`)
  })
})

/** Whether the element's text contains `text` (ignoring whitespace runs). */
function within2(element: HTMLElement, text: string): boolean {
  return (element.textContent ?? '').replace(/\s+/g, ' ').includes(text)
}
