import { act, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { coreStore } from '../../core/state'
import { subscribeAnnouncements } from '../../core/ui/announce'
import { setToastBackendForTesting } from '../../core/ui/toast'
import { failOnReactWarnings } from '../../test/consoleErrors'
import {
  cleanupLibrary,
  type RenderedLibrary,
  renderLibrary,
} from '../../test/renderLibrary'

// Save & next and the alt-text pass (inspector.md §4, D34, D52), and `E`
// through the real keymap: the whole app over the fake library at 1280 px,
// where the inspector is open beside the grid.
//
// From the seed, newest first: the folder Team (14) holds 1083, 1058, 1040,
// 1086 (a video), 1014 and 1004; Blog / 2025 (5) holds six items, of which
// 1024 and 1010 lack alt text.

failOnReactWarnings()

const startViewTransition: unknown = Reflect.get(
  document,
  'startViewTransition',
)
beforeAll(() => {
  // As in detail.browser.spec.tsx: Vitest's iframe crashes on a keyboard-
  // opened view transition; the update runs the same way without the API.
  Reflect.set(document, 'startViewTransition', undefined)
})
afterAll(() => {
  Reflect.set(document, 'startViewTransition', startViewTransition)
})

let toasts: string[] = []
let spoken: string[] = []
let stopListening = () => {}

afterEach(() => {
  stopListening()
  setToastBackendForTesting(null)
  cleanupLibrary()
})

/** Records toast messages and announcements from here on. */
function listen(): void {
  toasts = []
  spoken = []
  setToastBackendForTesting({
    show: (notification) => {
      toasts.push(
        typeof notification.message === 'string'
          ? notification.message
          : String(notification.id),
      )
    },
    hide: () => {},
  })
  stopListening = subscribeAnnouncements((message) => {
    spoken.push(message)
  })
}

function tileIds(): number[] {
  return screen
    .getAllByRole('gridcell')
    .map((tile) => Number(tile.dataset.mmTile))
}

function tileOf(id: number): HTMLElement {
  const tile = document.querySelector<HTMLElement>(`[data-mm-tile="${id}"]`)
  if (!tile) throw new Error(`tile ${id} isn't rendered`)
  return tile
}

function panel(): HTMLElement {
  return screen.getByTestId('inspector-panel')
}

/** The panel, once its lazy chunk has loaded. */
function openPanel(): Promise<HTMLElement> {
  return screen.findByTestId('inspector-panel', {}, { timeout: 5000 })
}

function selectedIds(): number[] {
  return [...coreStore.getState().selection]
}

function titleOf(library: RenderedLibrary, id: number): string {
  const title = library.mock.library.item(id)?.title
  if (title === undefined) throw new Error(`no item ${id}`)
  return title
}

/** The panel's field shows `id`'s value and has focus, caret at the end. */
async function expectFocusedField(
  label: 'Title' | 'Alt text',
  value: string,
): Promise<HTMLInputElement | HTMLTextAreaElement> {
  let input: HTMLInputElement | HTMLTextAreaElement | null = null
  await waitFor(() => {
    input = within(panel()).getByLabelText(label) as HTMLInputElement
    expect(input.value).toBe(value)
    expect(document.activeElement).toBe(input)
  })
  const field = input as unknown as HTMLInputElement
  expect(field.selectionStart).toBe(value.length)
  expect(field.selectionEnd).toBe(value.length)
  return field
}

async function waitForTiles(ids: number[]): Promise<void> {
  await waitFor(() => expect(tileIds()).toEqual(ids))
}

describe('Save & next in grid mode', () => {
  it('saves, then moves selection and focus to the next tile; Shift+Enter goes back', async () => {
    const user = userEvent.setup()
    const library = await renderLibrary()
    const [first, second] = tileIds() as [number, number]
    const firstTitle = titleOf(library, first)
    const secondTitle = titleOf(library, second)
    await user.click(tileOf(first))
    const title = await within(await openPanel()).findByLabelText('Title')
    await user.click(title)
    await user.keyboard('{End} one{Enter}')

    await waitFor(() =>
      expect(titleOf(library, first)).toBe(`${firstTitle} one`),
    )
    expect(selectedIds()).toEqual([second])
    await expectFocusedField('Title', titleOf(library, second))

    await user.keyboard('{Shift>}{Enter}{/Shift}')
    expect(selectedIds()).toEqual([first])
    await expectFocusedField('Title', `${firstTitle} one`)
    // Nothing was typed in the second item: it wasn't written.
    expect(titleOf(library, second)).toBe(secondTitle)
  })

  it('nudges and announces at either end of the view', async () => {
    const user = userEvent.setup()
    const library = await renderLibrary({ search: '?view=library&folder=14' })
    await waitForTiles([1083, 1058, 1040, 1086, 1014, 1004])
    listen()
    await user.click(tileOf(1004))
    const title = (await within(await openPanel()).findByLabelText(
      'Title',
    )) as HTMLInputElement
    await waitFor(() => expect(title.value).toBe(titleOf(library, 1004)))
    await user.click(title)
    await user.keyboard('{Enter}')
    expect(title.hasAttribute('data-nudge')).toBe(true)
    expect(spoken).toContain('Last item in this view')
    expect(selectedIds()).toEqual([1004])
    expect(document.activeElement).toBe(title)
    // The nudge is short.
    await waitFor(() => expect(title.hasAttribute('data-nudge')).toBe(false))

    await user.click(tileOf(1083))
    const first = (await within(await openPanel()).findByLabelText(
      'Alt text',
    )) as HTMLTextAreaElement
    await waitFor(() =>
      expect(first.value).toBe(library.mock.library.item(1083)?.alt),
    )
    await user.click(first)
    await user.keyboard('{Shift>}{Enter}{/Shift}')
    expect(first.hasAttribute('data-nudge')).toBe(true)
    expect(spoken).toContain('First image in this view')
    expect(selectedIds()).toEqual([1083])
  })

  it('skips items without alt text when Save & next moves from Alt text', async () => {
    const user = userEvent.setup()
    const library = await renderLibrary({ search: '?view=library&folder=14' })
    await waitForTiles([1083, 1058, 1040, 1086, 1014, 1004])
    // 1086 is a video: no alt field to land in.
    expect(library.mock.library.item(1086)?.kind).toBe('video')
    await user.click(tileOf(1040))
    const alt = (await within(await openPanel()).findByLabelText(
      'Alt text',
    )) as HTMLTextAreaElement
    await user.click(alt)
    await user.keyboard('{Enter}')
    expect(selectedIds()).toEqual([1014])
    await waitFor(() =>
      expect(
        (document.activeElement as HTMLElement | null)?.dataset.mmField,
      ).toBe('alt'),
    )
    // And back over the video again.
    await user.keyboard('{Shift>}{Enter}{/Shift}')
    expect(selectedIds()).toEqual([1040])
    await waitFor(() =>
      expect(
        (document.activeElement as HTMLElement | null)?.dataset.mmField,
      ).toBe('alt'),
    )
  })
})

describe('Save & next in detail mode', () => {
  it('saves the alt text and steps the stage, replacing `?item=`', async () => {
    const user = userEvent.setup()
    const library = await renderLibrary({ search: '?view=library&folder=14' })
    await waitForTiles([1083, 1058, 1040, 1086, 1014, 1004])
    await user.click(tileOf(1083))
    await user.keyboard('{Enter}')
    await screen.findByRole('region', { name: 'Detail' })
    expect(library.search()).toContain('item=1083')
    const entries = library.history.entries().searches.length

    const alt = (await within(await openPanel()).findByLabelText(
      'Alt text',
    )) as HTMLTextAreaElement
    await waitFor(() =>
      expect(alt.value).toBe(library.mock.library.item(1083)?.alt),
    )
    await user.click(alt)
    await user.keyboard('{Control>}a{/Control}Skyline at dusk{Enter}')

    await waitFor(() =>
      expect(library.mock.library.item(1083)?.alt).toBe('Skyline at dusk'),
    )
    await waitFor(() => expect(library.search()).toContain('item=1058'))
    expect(library.history.entries().searches).toHaveLength(entries)
    // D52: one selected, so the selection moved with the stage.
    expect(selectedIds()).toEqual([1058])
    await expectFocusedField('Alt text', '')
  })
})

describe('the alt-text pass', () => {
  it('walks the images without alt text, then turns the filter off and celebrates once', async () => {
    const user = userEvent.setup()
    const library = await renderLibrary({ search: '?view=library&folder=5' })
    await waitFor(() => expect(tileIds()).toHaveLength(6))
    listen()
    await user.click(
      await within(await openPanel()).findByRole('button', {
        name: 'Start alt-text pass',
      }),
    )
    await waitFor(() => expect(library.search()).toContain('alt=missing'))
    await waitForTiles([1024, 1010])
    expect(selectedIds()).toEqual([1024])
    await expectFocusedField('Alt text', '')
    expect(spoken).toContain(
      'Alt-text pass: 2 images without alt text. Enter saves and moves to the next.',
    )

    // With the filter on, Ctrl+Enter moves on as well.
    await user.keyboard('Harbour at noon{Control>}{Enter}{/Control}')
    await waitFor(() =>
      expect(library.mock.library.item(1024)?.alt).toBe('Harbour at noon'),
    )
    expect(selectedIds()).toEqual([1010])
    await expectFocusedField('Alt text', '')
    // The saved image leaves the filtered view.
    await waitForTiles([1010])
    expect(library.search()).toContain('alt=missing')
    expect(toasts).toEqual([])

    await user.keyboard('Market stall{Enter}')
    await waitFor(() =>
      expect(library.mock.library.item(1010)?.alt).toBe('Market stall'),
    )
    await waitFor(() => expect(library.search()).not.toContain('alt='))
    await waitFor(() => expect(tileIds()).toHaveLength(6))
    await waitFor(() =>
      expect(toasts).toEqual([
        'Every image in Blog / 2025 now has alt text — showing all files again',
      ]),
    )
    // The last item stays selected, its field focused.
    expect(selectedIds()).toEqual([1010])
    const alt = within(panel()).getByLabelText('Alt text')
    expect(document.activeElement).toBe(alt)
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(toasts).toHaveLength(1)
  })
})

describe('`E` through the keymap', () => {
  it('opens the Edit tab, and again collapses the inspector', async () => {
    const user = userEvent.setup()
    await renderLibrary()
    const [first] = tileIds() as [number]
    await user.click(tileOf(first))
    await within(await openPanel()).findByLabelText('Title')
    await user.keyboard('e')
    expect(
      await within(await openPanel()).findByRole('heading', {
        name: 'Edit image',
      }),
    ).toBeTruthy()
    expect(coreStore.getState().panels.inspectorTab).toBe('edit')
    await user.keyboard('e')
    await waitFor(() =>
      expect(screen.queryByTestId('inspector-panel')).toBeNull(),
    )
    act(() => {
      coreStore.getState().setPanels({ inspectorTab: 'info' })
    })
  })
})
