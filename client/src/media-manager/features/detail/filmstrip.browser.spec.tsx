import { act, screen, waitFor, within } from '@testing-library/react'
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
import { setTileUploadState } from '../../core/uploads/tileState'
import { failOnReactWarnings } from '../../test/consoleErrors'
import { cleanupLibrary, renderLibrary } from '../../test/renderLibrary'
import { detailRegion, findStageMedia, probeLibrary, rowsOf } from './testing'

// The filmstrip (interaction-spec §5): the collection in a virtual strip,
// the current item outlined and centred, selection rings and Ctrl/Cmd+click,
// a click steps, keyboard focus follows ←/→, and the tile upload state.

failOnReactWarnings()
afterEach(cleanupLibrary)

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

function strip(): HTMLElement {
  return screen.getByRole('grid', { name: 'Filmstrip' })
}

function cells(): HTMLElement[] {
  return within(strip()).getAllByRole('gridcell')
}

function cellOf(id: number): HTMLElement {
  const cell = strip().querySelector<HTMLElement>(`[data-mm-film="${id}"]`)
  if (!cell) throw new Error(`no filmstrip cell for ${id}`)
  return cell
}

async function openAt(index: number) {
  const rows = rowsOf(probeLibrary())
  const id = (rows[index] as { id: number }).id
  const rendered = await renderLibrary({
    search: `?view=library&item=${id}`,
    waitForGrid: false,
  })
  await detailRegion()
  await findStageMedia()
  await waitFor(() => expect(cellOf(id)).toBeTruthy())
  return { ...rendered, rows, id }
}

describe('the filmstrip', () => {
  it('shows the collection virtually, the current item outlined and centred', async () => {
    const { id, rows } = await openAt(20)
    const current = cellOf(id)
    expect(current.getAttribute('aria-current')).toBe('true')
    expect(current.hasAttribute('data-current')).toBe(true)
    expect(strip().getAttribute('aria-colcount')).toBe(String(rows.length))
    expect(current.getAttribute('aria-colindex')).toBe('21')
    // Virtual: far fewer cells than items.
    expect(cells().length).toBeLessThan(rows.length)
    // Centred: the cell's middle is the strip's middle.
    await waitFor(() => {
      const box = strip().getBoundingClientRect()
      const cell = current.getBoundingClientRect()
      expect(
        Math.abs(cell.left + cell.width / 2 - (box.left + box.width / 2)),
      ).toBeLessThan(2)
    })
    // Dimmed except the current one.
    const other = cells().find((cell) => cell !== current) as HTMLElement
    const picture = (element: HTMLElement) =>
      Number(getComputedStyle(element.firstElementChild as Element).opacity)
    expect(picture(current)).toBe(1)
    expect(picture(other)).toBeLessThan(1)
  })

  it('cells drag onto folders and stay selectable as far as CSS goes (A3 CR-2)', async () => {
    const { id } = await openAt(20)
    const cell = cellOf(id)
    await waitFor(() => expect(cell.getAttribute('draggable')).toBe('true'))
    // iPad: draggables are user-select: none in the UA sheet.
    const style = getComputedStyle(cell)
    expect(style.userSelect).not.toBe('none')
    expect(style.getPropertyValue('-webkit-user-select')).not.toBe('none')
  })

  it('a click steps there, replacing the history entry', async () => {
    const user = userEvent.setup()
    const { rows, search, history } = await openAt(5)
    const entries = history.entries().searches.length
    const target = (rows[7] as { id: number }).id
    await user.click(cellOf(target))
    expect(search()).toContain(`item=${target}`)
    expect(history.entries().searches).toHaveLength(entries)
    await waitFor(() =>
      expect(cellOf(target).getAttribute('aria-current')).toBe('true'),
    )
  })

  it('Ctrl/Cmd+click and the check circle toggle the selection without stepping', async () => {
    const user = userEvent.setup()
    const { rows, search, id } = await openAt(5)
    const other = (rows[6] as { id: number }).id
    await user.keyboard('{Control>}')
    await user.click(cellOf(other))
    await user.keyboard('{/Control}')
    expect(search()).toContain(`item=${id}`)
    expect(coreStore.getState().selection.has(other)).toBe(true)
    // Selected cells keep the ring and check (aria-selected).
    await waitFor(() =>
      expect(cellOf(other).getAttribute('aria-selected')).toBe('true'),
    )
    const check = cellOf(other).querySelector(
      '[data-mm-film-check]',
    ) as HTMLElement
    await user.click(check)
    expect(coreStore.getState().selection.has(other)).toBe(false)
    expect(search()).toContain(`item=${id}`)
  })

  it('keyboard focus follows the current cell when stepping from the strip', async () => {
    const user = userEvent.setup()
    const { rows, id, search } = await openAt(3)
    act(() => cellOf(id).focus())
    await user.keyboard('{ArrowRight}')
    const next = (rows[4] as { id: number }).id
    expect(search()).toContain(`item=${next}`)
    await waitFor(() => expect(document.activeElement).toBe(cellOf(next)))
    expect(cellOf(next).tabIndex).toBe(0)
    // X toggles the current item's selection from there too.
    const selected = coreStore.getState().selection.has(next)
    await user.keyboard('x')
    expect(coreStore.getState().selection.has(next)).toBe(!selected)
  })

  it('follows a step made elsewhere (keys on the stage)', async () => {
    const user = userEvent.setup()
    const { rows } = await openAt(10)
    await user.keyboard('{ArrowLeft}')
    const previous = (rows[9] as { id: number }).id
    await waitFor(() =>
      expect(cellOf(previous).getAttribute('aria-current')).toBe('true'),
    )
  })

  it('shows an upload in progress on a cell', async () => {
    const { id } = await openAt(2)
    act(() =>
      setTileUploadState(id, {
        phase: 'uploading',
        progress: 0.4,
        error: null,
        previewUrl: null,
      }),
    )
    const indicator = await waitFor(() => {
      const found = cellOf(id).querySelector('[data-phase]')
      if (!found) throw new Error('no upload state')
      return found as HTMLElement
    })
    expect(indicator.getAttribute('data-phase')).toBe('uploading')
    expect((indicator.firstElementChild as HTMLElement).style.width).toBe('40%')
    act(() => setTileUploadState(id, null))
  })

  it('is chrome: no text selection, and no user-select: none (iPad lesson)', async () => {
    const { id } = await openAt(1)
    const cell = cellOf(id)
    expect(cell.closest('[data-mm-no-select]')).not.toBeNull()
    expect(getComputedStyle(cell).userSelect).not.toBe('none')
    expect(getComputedStyle(cell).touchAction).toBe('manipulation')
  })
})
