import { act, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { coreStore } from '../../core/state'
import {
  setTileUploadState,
  type TileUploadState,
} from '../../core/uploads/tileState'
import { urlStore } from '../../core/url/useUrlState'
import { failOnReactWarnings } from '../../test/consoleErrors'
import {
  cleanupLibrary,
  pollRevNow,
  renderLibrary,
} from '../../test/renderLibrary'
import { flashTiles, resetFlashes } from './flash'

// Tiles in wave A (A1 brief §1–2, interaction-spec §2, system.md §1), in
// Chromium over the mock library (93 items: JPEGs, 7 PNGs, an SVG, 2 PDFs
// with page counts, 2 videos, an MP3 and a ZIP; 19 images without alt).

failOnReactWarnings()
afterEach(() => {
  cleanupLibrary()
  resetFlashes()
  for (const id of touchedUploads) setTileUploadState(id, null)
  touchedUploads.clear()
})

vi.mock('../inspector', () => ({
  InspectorPanel: () => null,
  register: () => {},
}))

const touchedUploads = new Set<number>()

function setUpload(id: number, state: Partial<TileUploadState> | null): void {
  touchedUploads.add(id)
  act(() =>
    setTileUploadState(
      id,
      state === null
        ? null
        : {
            phase: 'uploading',
            progress: null,
            error: null,
            previewUrl: null,
            ...state,
          },
    ),
  )
}

function tiles(): HTMLElement[] {
  return screen.getAllByRole('gridcell')
}

function idOf(tile: HTMLElement): number {
  return Number(tile.dataset.mmTile)
}

function tileOf(id: number): HTMLElement {
  const tile = document.querySelector<HTMLElement>(`[data-mm-tile="${id}"]`)
  if (!tile) throw new Error(`tile ${id} isn't rendered`)
  return tile
}

function badgesOf(tile: HTMLElement): string[] {
  return [...tile.querySelectorAll<HTMLElement>('[data-badge]')].map(
    (badge) => badge.dataset.text ?? '',
  )
}

/** The tile's accessible description (aria-describedby). */
function descriptionOf(tile: HTMLElement): string {
  const id = tile.getAttribute('aria-describedby')
  return id ? (document.getElementById(id)?.textContent ?? '') : ''
}

/** Waits until every rendered tile has its item (badges need it). */
async function hydrated(): Promise<void> {
  await waitFor(() =>
    expect(
      tiles().every((tile) => tile.getAttribute('aria-label') !== 'Loading'),
    ).toBe(true),
  )
}

describe('tile badges', () => {
  it('marks every image without alt text, for eyes and screen readers', async () => {
    await renderLibrary({ search: '?view=library&alt=missing' })
    await hydrated()
    for (const tile of tiles()) {
      expect(badgesOf(tile)).toContain('Alt')
      expect(descriptionOf(tile)).toContain('Missing alt text')
    }
  })

  it('shows the duration of videos and audio, and the page count of PDFs', async () => {
    await renderLibrary({ search: '?view=library&type=video' })
    await hydrated()
    for (const tile of tiles()) {
      expect(badgesOf(tile).join()).toMatch(/^\d+:\d\d(:\d\d)?$/)
      expect(descriptionOf(tile)).toMatch(/^Duration /)
    }
    act(() => urlStore().navigate({ type: 'document' }))
    await waitFor(() =>
      expect(tiles().flatMap(badgesOf)).toEqual(
        expect.arrayContaining(['PDF · 3 p', 'PDF · 28 p']),
      ),
    )
  })

  it('shows non-images as cards with a type icon, and SVG and PNG on a checkerboard', async () => {
    await renderLibrary({ search: '?view=library&type=audio' })
    await hydrated()
    const audio = tiles()[0] as HTMLElement
    expect(audio.querySelector('svg.tabler-icon-music')).not.toBeNull()

    // File-name search: the PNGs, then the SVG.
    act(() => urlStore().navigate({ type: null, q: 'png' }))
    await waitFor(() =>
      expect(document.querySelector('[data-checker="cover"]')).not.toBeNull(),
    )
    act(() => urlStore().navigate({ q: 'svg' }))
    await waitFor(() =>
      expect(document.querySelector('[data-checker="contain"]')).not.toBeNull(),
    )
  })
})

describe('the click target', () => {
  // A tile's picture is swapped when it hydrates (placeholder → picture). A
  // press on the placeholder followed by a release on the picture was no
  // click for Chromium, so a click on a "Loading" tile selected nothing
  // (M3 integration). The tile itself must be what the pointer hits.
  it('is the tile itself, over its picture or card', async () => {
    await renderLibrary({ search: '?view=library' })
    await hydrated()
    const inView = tiles().filter((tile) => {
      const box = tile.getBoundingClientRect()
      return box.top >= 0 && box.bottom <= window.innerHeight
    })
    expect(inView.length).toBeGreaterThan(3)
    for (const tile of inView) {
      const box = tile.getBoundingClientRect()
      const hit = document.elementFromPoint(
        box.left + box.width / 2,
        box.top + box.height / 2,
      )
      expect(hit, tile.getAttribute('aria-label') ?? '').toBe(tile)
    }
  })
})

describe('the check circle', () => {
  it('toggles its tile without touching the rest of the selection', async () => {
    const user = userEvent.setup()
    await renderLibrary()
    const [first, second] = tiles() as [HTMLElement, HTMLElement]
    await user.click(first)
    const check = second.querySelector('[data-mm-check]') as HTMLElement
    await user.click(check)
    expect([...coreStore.getState().selection].sort()).toEqual(
      [idOf(first), idOf(second)].sort(),
    )
    // A quick second click toggles back; it doesn't open detail.
    await user.dblClick(check)
    expect(urlStore().get().item).toBeNull()
    expect(coreStore.getState().selection.has(idOf(second))).toBe(true)
    await user.click(check)
    expect([...coreStore.getState().selection]).toEqual([idOf(first)])
  })
})

describe('the check circle on an uploading tile', () => {
  it('still toggles while the tile is processing or failed', async () => {
    const user = userEvent.setup()
    await renderLibrary()
    await hydrated()
    const [first, second, third] = tiles() as [
      HTMLElement,
      HTMLElement,
      HTMLElement,
    ]
    await user.click(first)
    setUpload(idOf(second), { phase: 'processing' })
    setUpload(idOf(third), { phase: 'error', error: 'Timed out' })
    await user.click(second.querySelector('[data-mm-check]') as HTMLElement)
    await user.click(third.querySelector('[data-mm-check]') as HTMLElement)
    expect([...coreStore.getState().selection].sort()).toEqual(
      [idOf(first), idOf(second), idOf(third)].sort(),
    )
  })

  it('Shift+click on the circle selects the range', async () => {
    const user = userEvent.setup()
    await renderLibrary()
    const [first, , third] = tiles() as [HTMLElement, HTMLElement, HTMLElement]
    await user.click(first)
    await user.keyboard('{Shift>}')
    await user.click(third.querySelector('[data-mm-check]') as HTMLElement)
    await user.keyboard('{/Shift}')
    expect(coreStore.getState().selection.size).toBe(3)
  })
})

describe('the upload state on tiles', () => {
  it('renders each phase from the tile upload store, then flashes once done', async () => {
    await renderLibrary()
    await hydrated()
    const tile = tiles()[1] as HTMLElement
    const id = idOf(tile)

    setUpload(id, { phase: 'queued' })
    expect(tile.dataset.upload).toBe('queued')
    expect(descriptionOf(tile)).toContain('Waiting to upload')

    setUpload(id, { phase: 'uploading', progress: 0.42 })
    expect(tile.dataset.upload).toBe('uploading')
    expect(tile.querySelector('[data-text="42 %"]')).not.toBeNull()
    expect(descriptionOf(tile)).toContain('Uploading, 42 %')

    setUpload(id, { phase: 'processing' })
    expect(badgesOf(tile)[0]).toBe('Processing')
    expect(tile.querySelector('[data-spinning]')).not.toBeNull()

    setUpload(id, { phase: 'error', error: 'Timed out' })
    expect(badgesOf(tile)[0]).toBe('Failed')
    const retry = screen.getByRole('button', { name: 'Retry upload' })
    // B2 implements upload.retry; until then it says so.
    expect(retry.getAttribute('aria-disabled')).toBe('true')
    expect(retry.title).toContain('Not available yet')
    // Retry doesn't select the tile.
    const before = [...coreStore.getState().selection]
    await userEvent.setup().click(retry)
    expect([...coreStore.getState().selection]).toEqual(before)

    setUpload(id, { phase: 'processing' })
    setUpload(id, null)
    expect(tile.dataset.upload).toBeUndefined()
    expect(tileOf(id).querySelector('[data-mm-flash]')).not.toBeNull()
  })

  it('shows the local preview until the upload is done', async () => {
    await renderLibrary()
    await hydrated()
    const tile = tiles()[0] as HTMLElement
    const preview = 'data:image/gif;base64,R0lGODlhAQABAAAAACw='
    setUpload(idOf(tile), { phase: 'uploading', previewUrl: preview })
    await waitFor(() =>
      expect(tile.querySelector('img')?.getAttribute('src')).toBe(preview),
    )
    setUpload(idOf(tile), null)
    await waitFor(() =>
      expect(tile.querySelector('img')?.getAttribute('src')).not.toBe(preview),
    )
  })

  it('a failed upload going away does not flash', async () => {
    await renderLibrary()
    await hydrated()
    const id = idOf(tiles()[0] as HTMLElement)
    setUpload(id, { phase: 'error', error: 'Rejected' })
    setUpload(id, null)
    expect(tileOf(id).querySelector('[data-mm-flash]')).toBeNull()
  })
})

describe('the "just changed" flash', () => {
  it('flashes a tile whose item changed elsewhere, once the rev poll brings it', async () => {
    const { mock } = await renderLibrary()
    await hydrated()
    const id = idOf(tiles()[2] as HTMLElement)
    expect(tileOf(id).querySelector('[data-mm-flash]')).toBeNull()
    mock.library.externalEdit(id, { alt: 'Changed elsewhere' })
    pollRevNow()
    await waitFor(() =>
      expect(tileOf(id).querySelector('[data-mm-flash]')).not.toBeNull(),
    )
    // Only that tile.
    expect(document.querySelectorAll('[data-mm-flash]')).toHaveLength(1)
  })

  it('flashes on request, and again when asked again', async () => {
    await renderLibrary()
    const id = idOf(tiles()[0] as HTMLElement)
    act(() => flashTiles([id]))
    const first = tileOf(id).querySelector('[data-mm-flash]')
    expect(first).not.toBeNull()
    act(() => flashTiles([id]))
    const second = tileOf(id).querySelector('[data-mm-flash]')
    // A new element restarts the animation.
    expect(second).not.toBe(first)
  })
})
