import { act, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { commandAvailability, runCommand } from '../../core/commands/registry'
import { coreStore, isInspectorOpen } from '../../core/state'
import { failOnReactWarnings } from '../../test/consoleErrors'
import { cleanupLibrary, renderLibrary } from '../../test/renderLibrary'

// Edit details (inspector.edit-details), the selection bar's button
// (interaction-spec §2, inspector.md §1): opens the inspector on Info and
// focuses the first field; unavailable when nothing targeted is editable.
//
// In the `author` scenario the user uploaded 1079 and 1078, not 1085–1083.

failOnReactWarnings()
afterEach(() => {
  cleanupLibrary()
})

function tiles(): HTMLElement[] {
  return screen.getAllByRole('gridcell')
}

function tileOf(id: number): HTMLElement {
  const tile = document.querySelector<HTMLElement>(`[data-mm-tile="${id}"]`)
  if (!tile) throw new Error(`tile ${id} isn't rendered`)
  return tile
}

describe('Edit details', () => {
  it('opens the collapsed inspector on the batch panel with focus in Title', async () => {
    const user = userEvent.setup()
    await renderLibrary()
    act(() => coreStore.getState().setInspectorOpen(false))
    // Three tiles: a click, then Shift+→ twice.
    await user.click(tiles()[0] as HTMLElement)
    await user.keyboard('{Shift>}{ArrowRight}{ArrowRight}{/Shift}')
    const bar = await screen.findByRole('group', { name: 'Selection' })
    const button = within(bar).getByRole('button', { name: 'Edit details' })
    await waitFor(() =>
      expect(button.getAttribute('aria-disabled')).not.toBe('true'),
    )
    await user.click(button)

    expect(isInspectorOpen(coreStore.getState())).toBe(true)
    expect(coreStore.getState().panels.inspectorTab).toBe('info')
    const panel = await screen.findByTestId('inspector-panel')
    await waitFor(() => expect(panel.textContent).toContain('Editing 3 items'))
    const title = within(
      await screen.findByTestId('batch-field-title'),
    ).getByRole('textbox')
    await waitFor(() => expect(document.activeElement).toBe(title))
    // The selection is untouched.
    expect(coreStore.getState().selection.size).toBe(3)
  })

  it('focuses the item’s own Title when one item is targeted', async () => {
    await renderLibrary()
    const [first] = tiles() as [HTMLElement]
    const id = Number(first.dataset.mmTile)
    act(() => coreStore.getState().setSelection([id]))
    await waitFor(() =>
      expect(commandAvailability('inspector.edit-details').ok).toBe(true),
    )
    act(() => {
      coreStore.getState().setInspectorOpen(false)
    })
    act(() => {
      runCommand('inspector.edit-details')
    })
    const title = await screen.findByLabelText('Title', { exact: true })
    await waitFor(() => expect(document.activeElement).toBe(title))
  })

  it('is unavailable with nothing targeted, offline, and on others’ media only', async () => {
    const user = userEvent.setup()
    await renderLibrary({ scenario: 'author' })
    expect(commandAvailability('inspector.edit-details')).toMatchObject({
      ok: false,
      code: 'no-target',
    })

    // An Author selecting only media uploaded by others.
    await waitFor(() => tileOf(1085))
    await user.click(tileOf(1085))
    await user.keyboard('{Control>}')
    await user.click(tileOf(1084))
    await user.keyboard('{/Control}')
    await waitFor(() =>
      expect(commandAvailability('inspector.edit-details').ok).toBe(false),
    )
    const bar = await screen.findByRole('group', { name: 'Selection' })
    expect(
      within(bar)
        .getByRole('button', { name: 'Edit details' })
        .getAttribute('aria-disabled'),
    ).toBe('true')

    // One of their own in the selection makes it available again.
    await waitFor(() => tileOf(1079))
    await user.keyboard('{Control>}')
    await user.click(tileOf(1079))
    await user.keyboard('{/Control}')
    await waitFor(() =>
      expect(commandAvailability('inspector.edit-details').ok).toBe(true),
    )

    // Offline: nothing can be saved.
    act(() => coreStore.getState().setConnectivity('offline'))
    expect(commandAvailability('inspector.edit-details').ok).toBe(false)
  })
})
