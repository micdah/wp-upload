import { act, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { http } from 'msw'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { coreStore } from '../../core/state'
import { failOnReactWarnings } from '../../test/consoleErrors'
import {
  cleanupLibrary,
  type RenderedLibrary,
  renderLibrary,
} from '../../test/renderLibrary'

// D52: in detail mode the inspector follows the item on stage. With 0 or 1
// selected, stepping moves the single selection along with the focus; with
// 2 or more the selection is kept, but the inspector shows the current item.
// The whole app over the mock library (93 items), at 1280 px, where the
// inspector is open beside the grid.

failOnReactWarnings()
afterEach(cleanupLibrary)

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

function sorted(ids: number[]): number[] {
  return [...ids].sort((a, b) => a - b)
}

function selectedIds(): number[] {
  return [...coreStore.getState().selection].sort((a, b) => a - b)
}

async function openDetailWithEnter(
  user: ReturnType<typeof userEvent.setup>,
): Promise<HTMLElement> {
  await user.keyboard('{Enter}')
  return screen.findByRole('region', { name: 'Detail' })
}

/** The inspector shows this item: its file name, Title and Alt text. */
async function expectInspectorShows(
  library: RenderedLibrary,
  id: number,
): Promise<void> {
  const item = library.mock.library.item(id)
  if (!item) throw new Error(`no item ${id}`)
  await waitFor(() => {
    const scope = within(panel())
    expect(scope.getByTestId('file-name').textContent).toBe(item.filename)
    expect((scope.getByLabelText('Title') as HTMLInputElement).value).toBe(
      item.title,
    )
    const alt = scope.queryByLabelText('Alt text') as HTMLTextAreaElement
    if (alt) {
      expect(alt.value).toBe(item.alt)
    }
  })
}

describe('the inspector in detail mode (D52)', () => {
  it('follows ←/→ with one item selected, and leaving keeps the selection', async () => {
    const user = userEvent.setup()
    const library = await renderLibrary()
    const ids = tileIds()
    const [, second, , fourth] = ids as [number, number, number, number]
    await user.click(tileOf(second))
    await openDetailWithEnter(user)
    await expectInspectorShows(library, second)

    await user.keyboard('{ArrowRight}')
    await user.keyboard('{ArrowRight}')
    expect(library.search()).toContain(`item=${fourth}`)
    await expectInspectorShows(library, fourth)
    // Lightroom-style: selection and focus moved along.
    expect(selectedIds()).toEqual([fourth])
    expect(coreStore.getState().focus).toBe(fourth)

    await user.keyboard('{Escape}')
    act(() => library.history.flush())
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Detail' })).toBeNull(),
    )
    expect(selectedIds()).toEqual([fourth])
    await expectInspectorShows(library, fourth)
  })

  it('follows the stage’s Prev/Next buttons from a deep link (nothing selected)', async () => {
    const user = userEvent.setup()
    await renderLibrary()
    const [, , third, fourth, fifth] = tileIds() as [
      number,
      number,
      number,
      number,
      number,
    ]
    cleanupLibrary()
    const library = await renderLibrary({
      search: `?view=library&item=${third}`,
    })
    const detail = await screen.findByRole('region', { name: 'Detail' })
    await expectInspectorShows(library, third)
    expect(selectedIds()).toEqual([third])

    const next = within(detail).getByRole('button', { name: 'Next item' })
    await user.click(next)
    await user.click(next)
    expect(library.search()).toContain(`item=${fifth}`)
    await expectInspectorShows(library, fifth)
    await user.click(
      within(detail).getByRole('button', { name: 'Previous item' }),
    )
    await expectInspectorShows(library, fourth)
    expect(selectedIds()).toEqual([fourth])
  })

  it('keeps a multi-selection, but shows the current item, not the batch', async () => {
    const user = userEvent.setup()
    const library = await renderLibrary()
    const [first, second, third, , fifth] = tileIds() as [
      number,
      number,
      number,
      number,
      number,
    ]
    await user.click(tileOf(first))
    await user.keyboard('{Shift>}')
    await user.click(tileOf(third))
    await user.keyboard('{/Shift}')
    expect(selectedIds()).toEqual(sorted([first, second, third]))
    expect(await within(panel()).findByText('Editing 3 items')).toBeTruthy()

    await openDetailWithEnter(user)
    await expectInspectorShows(library, third)
    await user.keyboard('{ArrowRight}{ArrowRight}')
    expect(library.search()).toContain(`item=${fifth}`)
    await expectInspectorShows(library, fifth)
    expect(within(panel()).queryByText('Editing 3 items')).toBeNull()
    // The selection is kept (the filmstrip shows its rings); focus moved.
    expect(selectedIds()).toEqual(sorted([first, second, third]))
    expect(coreStore.getState().focus).toBe(fifth)

    // `A` reaches the current item's alt field, not "Select a single image".
    await user.keyboard('a')
    const alt = within(panel()).getByLabelText(
      'Alt text',
    ) as HTMLTextAreaElement
    await waitFor(() => expect(document.activeElement).toBe(alt))
    alt.blur()

    // Leaving detail keeps the selection; the grid's inspector shows it again.
    await user.keyboard('{Escape}')
    act(() => library.history.flush())
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Detail' })).toBeNull(),
    )
    expect(await within(panel()).findByText('Editing 3 items')).toBeTruthy()
  })

  it('commits a draft to the item it was typed for when Next steps away', async () => {
    const user = userEvent.setup()
    const patched: number[] = []
    const library = await renderLibrary({
      handlers: [
        http.patch('*/api/library/items/:id', ({ params }) => {
          patched.push(Number(params.id))
          return undefined
        }),
      ],
    })
    const [first, second] = tileIds() as [number, number]
    await user.click(tileOf(first))
    const detail = await openDetailWithEnter(user)
    await expectInspectorShows(library, first)
    const secondAlt = library.mock.library.item(second)?.alt

    const alt = within(panel()).getByLabelText(
      'Alt text',
    ) as HTMLTextAreaElement
    await user.click(alt)
    await user.clear(alt)
    await user.type(alt, 'Typed for the first item')
    await user.click(within(detail).getByRole('button', { name: 'Next item' }))

    await waitFor(() =>
      expect(library.mock.library.item(first)?.alt).toBe(
        'Typed for the first item',
      ),
    )
    expect(patched).toEqual([first])
    await expectInspectorShows(library, second)
    expect(library.mock.library.item(second)?.alt).toBe(secondAlt)
  })
})
