import { act, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { coreStore } from '../../core/state'
import { failOnReactWarnings } from '../../test/consoleErrors'
import { cleanupLibrary, renderLibrary } from '../../test/renderLibrary'

// Ctrl/Cmd+click toggles (interaction-spec §2), with real clicks: Vitest's
// browser userEvent drives Chromium's own mouse through Playwright, so the
// browser hit-tests each click like a user's pointer.
//
// M3 integration: three quick Ctrl+clicks selected only two tiles in a
// test right after the inspector collapsed. That was the test, not the app:
// testing-library's user-event dispatches events to the element it is
// given, and the collapse re-laid the grid out, so the third tile had been
// remounted (a tile that changes rows is a new element) and the events went
// to a detached node. A real pointer clicks what is under it; this spec
// checks that, also right after such a re-layout.

failOnReactWarnings()
afterEach(() => {
  cleanupLibrary()
})

function tile(id: number): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-mm-tile="${id}"]`)
  if (!element) throw new Error(`tile ${id} isn't rendered`)
  return element
}

/** The first three tiles' ids, once hydrated (stable accessible names). */
async function firstThree(): Promise<number[]> {
  await waitFor(() =>
    expect(
      screen
        .getAllByRole('gridcell')
        .slice(0, 3)
        .every((cell) => cell.getAttribute('aria-label') !== 'Loading'),
    ).toBe(true),
  )
  return screen
    .getAllByRole('gridcell')
    .slice(0, 3)
    .map((cell) => Number(cell.dataset.mmTile))
}

describe('Ctrl/Cmd+click with real clicks', () => {
  for (const modifier of ['Control', 'Meta'] as const) {
    for (const relayout of [false, true]) {
      it(`${modifier}: three quick clicks select three tiles${relayout ? ', right after a re-layout' : ''}`, async () => {
        await renderLibrary()
        if (relayout) {
          // Collapsing the inspector widens the grid: tiles change rows.
          act(() => coreStore.getState().setInspectorOpen(false))
        }
        const [a, b, c] = (await firstThree()) as [number, number, number]
        await userEvent.click(tile(a))
        await userEvent.click(tile(b), { modifiers: [modifier] })
        await userEvent.click(tile(c), { modifiers: [modifier] })
        expect([...coreStore.getState().selection].sort()).toEqual(
          [a, b, c].sort(),
        )
      })
    }
  }
})
