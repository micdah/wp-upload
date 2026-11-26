import { notifications } from '@mantine/notifications'
import { act, screen, waitFor } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useTrackCurrentCollection } from '../core/collection/hooks'
import { runCommand } from '../core/commands/registry'
import { useCommand } from '../core/commands/useCommand'
import { DEFAULT_COLLECTION_QUERY } from '../core/data/params'
import { coreStore } from '../core/state'
import { setToastBackendForTesting, toast } from '../core/ui/toast'
import { createUrlStore } from '../core/url/history'
import { createMemoryHistory } from '../core/url/memoryHistory'
import { setUrlStoreForTesting, urlStore } from '../core/url/useUrlState'
import { mockNetwork } from '../test/msw'
import { renderWithProviders } from '../test/renderWithProviders'
import { registerCoreCommands } from './runtime'

// Core commands whose availability depends on the collection on screen
// (C-7, C-8) and on the undo registry (C-17), through useCommand() as the
// toolbar uses it.

registerCoreCommands()

/** `rows` for ids, stride 4: id, width, height, kind (0 = image). */
function rows(ids: readonly number[]): number[] {
  return ids.flatMap((id) => [id, 400, 300, 0])
}

function collection(ids: readonly number[]) {
  return {
    rev: '1',
    query: DEFAULT_COLLECTION_QUERY,
    total: ids.length,
    rows: rows(ids),
    indexComplete: true,
  }
}

/** Folder id → ids; a folder listed in `held` answers only when released. */
function serveFolders(folders: Record<string, readonly number[]>) {
  const held = new Map<string, () => void>()
  const gates = new Map<string, Promise<void>>()
  function hold(folder: string): void {
    gates.set(
      folder,
      new Promise<void>((resolve) => {
        held.set(folder, resolve)
      }),
    )
  }
  mockNetwork.use(
    http.get('*/api/library/collection', async ({ request }) => {
      const folder = new URL(request.url).searchParams.get('folder') ?? 'all'
      await gates.get(folder)
      return HttpResponse.json(collection(folders[folder] ?? []))
    }),
  )
  return {
    hold,
    release(folder: string) {
      held.get(folder)?.()
    },
  }
}

function Tracker() {
  useTrackCurrentCollection()
  return null
}

/** A sibling of the tracker, like the toolbar: it doesn't re-render with it. */
function Probe() {
  const next = useCommand('detail.step', { direction: 1 })
  const all = useCommand('selection.select-all')
  const undo = useCommand('undo.last')
  return (
    <ul>
      <li data-testid='next'>{next.enabled ? 'on' : (next.code ?? 'off')}</li>
      <li data-testid='all'>{all.enabled ? 'on' : (all.code ?? 'off')}</li>
      <li data-testid='undo'>{undo.enabled ? 'on' : (undo.code ?? 'off')}</li>
    </ul>
  )
}

function renderApp() {
  return renderWithProviders(
    <>
      <Tracker />
      <Probe />
    </>,
  )
}

function useUrl(search: string): void {
  setUrlStoreForTesting(
    createUrlStore(
      createMemoryHistory(`https://example.com/wp-upload/${search}`),
    ),
  )
}

beforeEach(() => {
  coreStore.getState().clearSelection()
})

afterEach(() => {
  setUrlStoreForTesting(null)
  act(() => {
    notifications.clean()
  })
})

describe('core commands and the collection on screen', () => {
  it('enables ←/→ in detail once a deep link’s collection has loaded (C-8)', async () => {
    serveFolders({ all: [1, 2, 3] })
    useUrl('?view=library&item=2')
    renderApp()
    // The toolbar doesn't re-render with the collection: only a command
    // change notification makes it re-check.
    await waitFor(() => {
      expect(screen.getByTestId('next').textContent).toBe('on')
    })
  })

  it('select all and ←/→ wait while the previous folder’s rows are shown (C-7)', async () => {
    const server = serveFolders({ all: [1, 2, 3], '6': [7, 8] })
    useUrl('?view=library&item=2')
    renderApp()
    await waitFor(() => {
      expect(screen.getByTestId('all').textContent).toBe('on')
    })
    expect(screen.getByTestId('next').textContent).toBe('on')

    // A new folder loads; the grid keeps the old rows as a placeholder.
    server.hold('6')
    act(() => {
      urlStore().navigate({ folder: 6 })
    })
    await waitFor(() => {
      expect(screen.getByTestId('all').textContent).toBe('loading')
    })
    expect(screen.getByTestId('next').textContent).toBe('loading')

    server.release('6')
    await waitFor(() => {
      expect(screen.getByTestId('all').textContent).toBe('on')
    })
    // Item 2 isn't in folder 6, so there is nothing to step from.
    expect(screen.getByTestId('next').textContent).not.toBe('on')
  })
})

describe('undo.last (C-17)', () => {
  it('is available only while an undoable toast is on screen', async () => {
    serveFolders({ all: [] })
    useUrl('?view=library')
    renderApp()
    expect(screen.getByTestId('undo').textContent).toBe('nothing-to-undo')
    let close = () => {}
    act(() => {
      close = toast({ message: 'Moved 2 items', undo: { run: () => {} } }).close
    })
    expect(screen.getByTestId('undo').textContent).toBe('on')
    act(() => close())
    expect(screen.getByTestId('undo').textContent).toBe('nothing-to-undo')
  })
})

describe('panels.toggle-folders without FileBird (folders.md §9, A3 CR-7)', () => {
  it('explains in a toast instead of doing nothing', () => {
    const shown: string[] = []
    setToastBackendForTesting({
      show: (notification) => {
        shown.push(String(notification.message))
      },
      hide: () => {},
    })
    try {
      coreStore.getState().setBootstrap(null)
      const panelsBefore = coreStore.getState().panels
      expect(runCommand('panels.toggle-folders')).toBe(true)
      expect(shown).toEqual([
        'Folders need the FileBird plugin on your WordPress site.',
      ])
      expect(coreStore.getState().panels).toEqual(panelsBefore)
    } finally {
      setToastBackendForTesting(null)
    }
  })
})
