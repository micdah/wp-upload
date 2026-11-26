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
import { coreStore } from '../../core/state'
import { urlStore } from '../../core/url/useUrlState'
import { failOnReactWarnings } from '../../test/consoleErrors'
import { cleanupLibrary, renderLibrary } from '../../test/renderLibrary'
import { peekAvailability } from '.'

// Quick peek (interaction-spec §4, A1 brief §6) in Chromium over the mock
// library: Space opens it on the focused tile, arrows keep moving the grid
// and the peek follows, Space or Esc closes, Enter opens detail. The URL
// doesn't change.

failOnReactWarnings()
afterEach(cleanupLibrary)

// Without the View Transitions API, as in the detail spec: in Vitest's
// iframe Chromium's renderer crashes when a keyboard-opened detail starts a
// view transition (Enter from the peek does). The e2e flow covers the morph.
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

vi.mock('../inspector', () => ({
  InspectorPanel: () => null,
  register: () => {},
}))

function tiles(): HTMLElement[] {
  return screen.getAllByRole('gridcell')
}

function peekAvailabilityCode(): string | null {
  const availability = peekAvailability()
  return availability.ok ? null : availability.code
}

function peek(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-mm-peek]')
}

async function peekFigure(): Promise<HTMLElement> {
  return screen.findByRole('figure', { name: /^Quick peek: / })
}

describe('quick peek', () => {
  it('opens on Space, follows the arrows, and closes on Space, without touching the URL', async () => {
    const user = userEvent.setup()
    const { search, history } = await renderLibrary()
    const [first, second] = tiles() as [HTMLElement, HTMLElement]
    await user.click(first)
    const url = search()
    const entries = history.entries().searches.length

    await user.keyboard(' ')
    const figure = await peekFigure()
    expect(figure.getAttribute('aria-label')).toBe(
      `Quick peek: ${first.getAttribute('aria-label')}`,
    )
    expect(coreStore.getState().overlay).toBe('peek')
    // Focus stays on the grid's tile.
    expect(document.activeElement).toBe(first)
    // The caption: name, facts and the key hints.
    expect(figure.textContent).toMatch(/\d+ × \d+ · [\d.]+ (kB|MB)/)
    expect(figure.textContent).toContain('Space')

    await user.keyboard('{ArrowRight}')
    await waitFor(async () =>
      expect((await peekFigure()).getAttribute('aria-label')).toBe(
        `Quick peek: ${second.getAttribute('aria-label')}`,
      ),
    )
    expect(document.activeElement).toBe(second)

    await user.keyboard(' ')
    await waitFor(() => expect(peek()).toBeNull())
    expect(search()).toBe(url)
    expect(history.entries().searches).toHaveLength(entries)
  })

  it('Esc closes the peek first and keeps the selection', async () => {
    const user = userEvent.setup()
    await renderLibrary()
    await user.click(tiles()[0] as HTMLElement)
    await user.keyboard(' ')
    await peekFigure()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(peek()).toBeNull())
    expect(coreStore.getState().selection.size).toBe(1)
    // The next Esc is the grid's own: it clears the selection.
    await user.keyboard('{Escape}')
    expect(coreStore.getState().selection.size).toBe(0)
  })

  it('Enter opens detail on the peeked item and closes the peek', async () => {
    const user = userEvent.setup()
    await renderLibrary()
    const tile = tiles()[2] as HTMLElement
    await user.click(tile)
    await user.keyboard(' ')
    await peekFigure()
    await user.keyboard('{Enter}')
    await waitFor(() =>
      expect(urlStore().get().item).toBe(Number(tile.dataset.mmTile)),
    )
    await waitFor(() => expect(peek()).toBeNull())
  })

  it('a click on the scrim closes it; a click on the picture does not', async () => {
    const user = userEvent.setup()
    await renderLibrary()
    await user.click(tiles()[0] as HTMLElement)
    await user.keyboard(' ')
    await peekFigure()
    const media = document.querySelector('[data-peek-media]') as HTMLElement
    await user.click(media)
    expect(peek()).not.toBeNull()
    await user.click(peek() as HTMLElement)
    await waitFor(() => expect(peek()).toBeNull())
  })

  it('shows a card for items without a picture', async () => {
    const user = userEvent.setup()
    await renderLibrary({ search: '?view=library&q=zip' })
    await user.click(tiles()[0] as HTMLElement)
    await user.keyboard(' ')
    const figure = await peekFigure()
    expect(figure.textContent).toContain('Archive')
    expect(figure.querySelector('img')).toBeNull()
  })

  it('closes when a filter hides the item, and won’t open on a hidden one', async () => {
    const user = userEvent.setup()
    await renderLibrary()
    // The newest items are images; the Video filter hides the focused one.
    await user.click(tiles()[0] as HTMLElement)
    await user.keyboard(' ')
    await peekFigure()
    act(() => urlStore().navigate({ type: 'video' }))
    await waitFor(() => expect(peek()).toBeNull())
    // Focus survives filters, but the item isn't in the view: no peek.
    await waitFor(() => expect(screen.getAllByRole('gridcell')).toHaveLength(2))
    act(() => (tiles()[0] as HTMLElement).blur())
    expect(peekAvailabilityCode()).toBe('not-in-view')
  })

  it('does nothing while another centre overlay is open (D36)', async () => {
    const user = userEvent.setup()
    await renderLibrary()
    await user.click(tiles()[0] as HTMLElement)
    act(() => coreStore.getState().openOverlay('editor'))
    await user.keyboard(' ')
    expect(coreStore.getState().overlay).toBe('editor')
    expect(peek()).toBeNull()
  })

  it('does nothing with nothing focused', async () => {
    const user = userEvent.setup()
    await renderLibrary()
    ;(tiles()[0] as HTMLElement).focus()
    // Focus without a store focus: the grid sets it on focus, so clear it.
    act(() => coreStore.getState().setFocus(null))
    await user.keyboard(' ')
    expect(peek()).toBeNull()
  })
})
