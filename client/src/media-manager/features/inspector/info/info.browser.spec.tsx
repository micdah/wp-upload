import { act, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  bootstrapAuthor,
  bootstrapOk,
} from '../../../../../../shared/fixtures/bootstrap'
import { folderTree } from '../../../../../../shared/fixtures/folders'
import { fullItems } from '../../../../../../shared/fixtures/items'
import type {
  Bootstrap,
  LibraryItemFull,
} from '../../../../../../shared/library-api'
import { registerCoreCommands } from '../../../app/runtime'
import { implementCommand } from '../../../core/commands/registry'
import { libraryKeys } from '../../../core/data/keys'
import { coreStore } from '../../../core/state'
import { subscribeAnnouncements } from '../../../core/ui/announce'
import { failOnReactWarnings } from '../../../test/consoleErrors'
import {
  createTestQueryClient,
  renderWithProviders,
} from '../../../test/renderWithProviders'
import { SCALED_EXPLANATION } from './FileSections'
import { BatchActions, FileSections, ItemActions } from './index'
import { SECTIONS_STORAGE_KEY, sectionStore } from './sections'

// The Info panel's lower half in Chromium: the File / Camera / Sizes
// sections, the Copy controls and the actions row. 1009 is Site Admin's
// edited, attached, scaled photo with EXIF in "Products / Outdoor"; 1001 is
// Jonas Holm's, Uncategorized; 1086 is a video; 1088 a PDF.

registerCoreCommands()
failOnReactWarnings()

function fixture(id: number): LibraryItemFull {
  const item = fullItems.find((candidate) => candidate.id === id)
  if (!item) {
    throw new Error(`No fixture item ${id}`)
  }
  return item as LibraryItemFull
}

function setBootstrap(bootstrap: Bootstrap): void {
  act(() => {
    coreStore.getState().setBootstrap(bootstrap)
  })
}

function renderSections(item: LibraryItemFull, attachedSlot?: ReactNode) {
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(libraryKeys.folders(), folderTree)
  return renderWithProviders(
    <div style={{ width: 280 }}>
      <FileSections item={item} attachedSlot={attachedSlot} />
    </div>,
    { queryClient },
  )
}

function row(testId: string): string {
  return screen.getByTestId(testId).textContent?.trim() ?? ''
}

function section(id: 'file' | 'camera' | 'sizes'): HTMLDetailsElement {
  return screen.getByTestId(`section-${id}`) as HTMLDetailsElement
}

function recordAnnouncements(): string[] {
  const said: string[] = []
  const unsubscribe = subscribeAnnouncements((message) => said.push(message))
  cleanups.push(unsubscribe)
  return said
}

/** Replaces navigator.clipboard for one test. */
function stubClipboard(writeText: (text: string) => Promise<void>) {
  const spy = vi.fn(writeText)
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: spy },
  })
  cleanups.push(() => {
    delete (navigator as { clipboard?: unknown }).clipboard
  })
  return spy
}

/** The text of the element a control's aria-describedby points at. */
function description(element: HTMLElement): string {
  const ids = element.getAttribute('aria-describedby')?.split(/\s+/) ?? []
  return ids
    .map((id) => document.getElementById(id)?.textContent ?? '')
    .join(' ')
    .trim()
}

const cleanups: (() => void)[] = []

beforeEach(() => {
  sectionStore.reset()
  act(() => {
    coreStore.getState().setConnectivity('online')
  })
  setBootstrap(bootstrapOk)
})

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup()
  }
  sectionStore.reset()
})

describe('the File section', () => {
  it('lists the file details of an edited, attached, scaled image', async () => {
    const item = fixture(1009)
    renderSections(item)

    expect(section('file').open).toBe(true)
    expect(row('row-folder')).toBe('Products / Outdoor')
    expect(row('row-uploaded')).toBe('8 Apr 2025 by Site Admin')
    expect(row('row-edited')).toBe('2 Oct 2026')
    expect(row('row-attached')).toBe('About us')
    expect(screen.getByTestId('row-filename').title).toBe(
      'travel-fre-sonneveld-314.jpg',
    )
    expect(row('row-filename')).toBe('travel-fre-sonneveld-314.jpg')
    expect(row('row-type')).toBe('image/jpeg')
    expect(row('row-size')).toBe('1.6 MB')
    expect(row('row-dimensions')).toBe('2560 × 1707')
    expect(screen.getByTestId('row-original').textContent).toContain(
      '4608 × 3072',
    )
    expect(
      within(screen.getByTestId('row-original')).getByRole('button', {
        name: 'Copy URL of the original image',
      }),
    ).toBeTruthy()
    expect(screen.getByText(SCALED_EXPLANATION)).toBeTruthy()
    const url = screen.getByRole('textbox', {
      name: 'File URL',
    }) as HTMLInputElement
    expect(url.value).toBe(item.url)
    expect(url.readOnly).toBe(true)
    expect(screen.queryByTestId('row-duration')).toBeNull()
    expect(screen.queryByTestId('row-pages')).toBeNull()
  })

  it('leaves out what an unedited, unscaled, unattached item lacks', () => {
    renderSections({
      ...fixture(1001),
      folder: 0,
      original: null,
      attachedTo: null,
      edited: false,
      editedAt: null,
    })
    expect(row('row-folder')).toBe('Uncategorized')
    expect(row('row-attached')).toBe('Not attached')
    expect(screen.queryByTestId('row-edited')).toBeNull()
    expect(screen.queryByTestId('row-original')).toBeNull()
    expect(screen.queryByText(SCALED_EXPLANATION)).toBeNull()
  })

  it('hides the folder without FileBird', () => {
    renderSections({ ...fixture(1009), folder: null })
    expect(screen.queryByTestId('row-folder')).toBeNull()
  })

  it('renders the attached-to slot when given', () => {
    renderSections(fixture(1009), <button type='button'>Detach</button>)
    const attached = screen.getByTestId('row-attached')
    expect(
      within(attached).getByRole('button', { name: 'Detach' }),
    ).toBeTruthy()
  })

  it('shows duration and encoding for a video, and no Camera or Sizes', () => {
    const video = fixture(1086)
    renderSections(video)
    expect(row('row-duration')).toBe('1:34')
    expect(row('row-encoding')).toBe('MP4 · h264 · 4.1 Mbps · 48 kHz stereo')
    expect(screen.queryByTestId('section-camera')).toBeNull()
    expect(screen.queryByTestId('section-sizes')).toBeNull()
  })

  it('shows the page count of a PDF', () => {
    renderSections({ ...fixture(1088), pages: 12 })
    expect(row('row-pages')).toBe('12')
  })
})

describe('the Camera section', () => {
  it('shows camera, lens, exposure and the date taken', () => {
    renderSections(fixture(1009))
    expect(section('camera').open).toBe(true)
    expect(row('row-camera')).toBe('iPhone 15 Pro')
    expect(row('row-lens')).toBe('Main camera 6.86mm f/1.78')
    expect(row('row-exposure')).toBe('85 mm · f/8 · 1/1000 s · ISO 200')
    expect(row('row-taken')).toBe('6 Apr 2025')
  })

  it('is hidden without EXIF', () => {
    renderSections({ ...fixture(1009), exif: null })
    expect(screen.queryByTestId('section-camera')).toBeNull()
  })
})

describe('the Sizes section', () => {
  it('starts collapsed and shows the count', () => {
    renderSections(fixture(1009))
    const sizes = section('sizes')
    expect(sizes.open).toBe(false)
    const summary = sizes.querySelector('summary')
    expect(summary?.textContent).toBe('Sizes7')
  })

  it('lists every size with its label, dimensions and a copy button', async () => {
    renderSections(fixture(1009))
    await userEvent.click(
      section('sizes').querySelector('summary') as HTMLElement,
    )
    await waitFor(() => expect(section('sizes').open).toBe(true))
    const rows = [...section('sizes').querySelectorAll('li')].map((li) =>
      [...li.querySelectorAll(':scope > span')]
        .map((span) => span.textContent)
        .join(' | '),
    )
    expect(rows).toEqual([
      'Thumbnail | 150 × 150',
      'Medium | 300 × 200',
      'Medium large | 768 × 512',
      'Large | 1024 × 683',
      '1536 × 1536 | 1536 × 1024',
      '2048 × 2048 | 2048 × 1366',
      'Full (scaled) | 2560 × 1707',
    ])
    expect(
      screen.getByRole('button', { name: 'Copy URL of Large size' }),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'Copy URL of Full (scaled)' }),
    ).toBeTruthy()
  })

  it('says "Full size" when the upload was not scaled', () => {
    renderSections({ ...fixture(1009), original: null })
    expect(
      screen.getByRole('button', { name: 'Copy URL of Full size' }),
    ).toBeTruthy()
  })

  it('remembers toggled sections across items and remounts', async () => {
    const first = renderSections(fixture(1009))
    await userEvent.click(
      section('sizes').querySelector('summary') as HTMLElement,
    )
    await userEvent.click(
      section('camera').querySelector('summary') as HTMLElement,
    )
    await waitFor(() => {
      expect(section('sizes').open).toBe(true)
      expect(section('camera').open).toBe(false)
    })
    expect(
      JSON.parse(sessionStorage.getItem(SECTIONS_STORAGE_KEY) ?? '{}'),
    ).toEqual({ file: true, camera: false, sizes: true })
    first.unmount()

    renderSections(fixture(1000))
    expect(section('sizes').open).toBe(true)
    expect(section('camera').open).toBe(false)
    expect(section('file').open).toBe(true)
  })
})

describe('Copy', () => {
  it('copies the file URL, says "Copied" and announces it', async () => {
    const item = fixture(1009)
    const writeText = stubClipboard(() => Promise.resolve())
    const said = recordAnnouncements()
    renderSections(item)

    const button = screen.getByRole('button', { name: 'Copy file URL' })
    await userEvent.click(button)
    expect(writeText).toHaveBeenCalledWith(item.url)
    await waitFor(() => expect(button.textContent).toBe('Copied'))
    expect(said).toContain('URL copied')
    await waitFor(() => expect(button.textContent).toBe('Copy'), {
      timeout: 3000,
    })
  })

  it('copies the URL of a size and of the original', async () => {
    const item = fixture(1009)
    const writeText = stubClipboard(() => Promise.resolve())
    renderSections(item)
    await userEvent.click(
      section('sizes').querySelector('summary') as HTMLElement,
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Copy URL of Large size' }),
    )
    const large = item.sizes.find((size) => size.name === 'large')
    expect(writeText).toHaveBeenLastCalledWith(large?.url)

    await userEvent.click(
      screen.getByRole('button', { name: 'Copy URL of the original image' }),
    )
    expect(writeText).toHaveBeenLastCalledWith(item.original?.url)
    // Never the display-only cache buster.
    for (const [text] of writeText.mock.calls) {
      expect(text).not.toContain('?v=')
    }
  })

  it('selects the URL field when the clipboard refuses', async () => {
    const item = fixture(1009)
    stubClipboard(() => Promise.reject(new Error('NotAllowedError')))
    const said = recordAnnouncements()
    renderSections(item)

    await userEvent.click(screen.getByRole('button', { name: 'Copy file URL' }))
    const input = screen.getByRole('textbox', {
      name: 'File URL',
    }) as HTMLInputElement
    await waitFor(() => expect(document.activeElement).toBe(input))
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe(item.url.length)
    expect(said).toContain('Press Ctrl+C or Cmd+C to copy')
    expect(
      screen.getByRole('button', { name: 'Copy file URL' }).textContent,
    ).toBe('Copy')
  })

  it('reveals a selected URL for a size when there is no clipboard', async () => {
    const item = fixture(1009)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    })
    cleanups.push(() => {
      delete (navigator as { clipboard?: unknown }).clipboard
    })
    const said = recordAnnouncements()
    renderSections(item)
    await userEvent.click(
      section('sizes').querySelector('summary') as HTMLElement,
    )
    await userEvent.click(
      screen.getByRole('button', { name: 'Copy URL of Large size' }),
    )
    const large = item.sizes.find((size) => size.name === 'large')
    const revealed = await screen.findByDisplayValue(large?.url ?? '')
    expect(document.activeElement).toBe(revealed)
    const field = revealed as HTMLInputElement
    expect(field.readOnly).toBe(true)
    expect(field.selectionStart).toBe(0)
    expect(field.selectionEnd).toBe(field.value.length)
    expect(said).toContain('Press Ctrl+C or Cmd+C to copy')
  })
})

describe('the actions row', () => {
  it('shows Edit image with E, Download and Delete, disabled until implemented', () => {
    renderWithProviders(<ItemActions item={fixture(1009)} />)
    const edit = screen.getByRole('button', { name: 'Edit image' })
    expect(edit.querySelector('kbd')?.textContent).toBe('E')
    expect(edit.getAttribute('aria-keyshortcuts')).toBe('E')
    for (const name of ['Edit image', 'Download', 'Delete']) {
      const button = screen.getByRole('button', { name })
      expect(button.getAttribute('aria-disabled'), name).toBe('true')
      expect(description(button), name).toBe('Not available yet')
    }
  })

  it('runs an implemented command', async () => {
    const run = vi.fn()
    cleanups.push(implementCommand('items.download', { run }))
    renderWithProviders(<ItemActions item={fixture(1009)} />)
    const download = screen.getByRole('button', { name: 'Download' })
    expect(download.getAttribute('aria-disabled')).toBeNull()
    expect(download.getAttribute('aria-describedby')).toBeNull()
    await userEvent.click(download)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('does nothing when a disabled action is clicked', async () => {
    const run = vi.fn()
    cleanups.push(implementCommand('inspector.edit-image', { run }))
    setBootstrap(bootstrapAuthor)
    renderWithProviders(
      <ItemActions
        item={{ ...fixture(1009), perms: { edit: false, delete: false } }}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Edit image' }))
    expect(run).not.toHaveBeenCalled()
  })

  it('hides Delete without the delete permission', () => {
    renderWithProviders(
      <ItemActions
        item={{ ...fixture(1009), perms: { edit: true, delete: false } }}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Download' })).toBeTruthy()
  })

  it("disables Edit image with the reason on an Author's view of others' media", () => {
    cleanups.push(implementCommand('inspector.edit-image', { run: () => {} }))
    setBootstrap(bootstrapAuthor)
    renderWithProviders(
      <ItemActions
        item={{ ...fixture(1009), perms: { edit: false, delete: false } }}
      />,
    )
    const edit = screen.getByRole('button', { name: 'Edit image' })
    expect(edit.getAttribute('aria-disabled')).toBe('true')
    expect(description(edit)).toBe('You can only change your own media')
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  })

  it('offers Edit image for raster images only', () => {
    renderWithProviders(<ItemActions item={fixture(1086)} />)
    expect(screen.queryByRole('button', { name: 'Edit image' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Download' })).toBeTruthy()
  })
})

describe('the batch actions row', () => {
  it('shows Move to folder, Download and Delete', () => {
    renderWithProviders(<BatchActions />)
    for (const name of ['Move to folder', 'Download', 'Delete']) {
      const button = screen.getByRole('button', { name })
      expect(button.getAttribute('aria-disabled'), name).toBe('true')
      expect(description(button), name).toBe('Not available yet')
    }
  })

  it('hides Delete when nothing may be deleted', () => {
    renderWithProviders(<BatchActions deletable={false} />)
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  })
})
