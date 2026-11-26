import { act, screen, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibraryItemFull } from '../../../../../shared/library-api'
import { registerCoreCommands } from '../../app/runtime'
import { registerCenter } from '../../core/collection/centerApi'
import { useTrackCurrentCollection } from '../../core/collection/hooks'
import { runCommand } from '../../core/commands/registry'
import { libraryKeys } from '../../core/data/keys'
import { coreStore, resetSession } from '../../core/state'
import { subscribeAnnouncements } from '../../core/ui/announce'
import {
  setToastBackendForTesting,
  type ToastBackend,
} from '../../core/ui/toast'
import { createUrlStore } from '../../core/url/history'
import { createMemoryHistory } from '../../core/url/memoryHistory'
import { setUrlStoreForTesting } from '../../core/url/useUrlState'
import { bootstrapFor, type MockContext } from '../../mocks/context'
import { startFakeLibrary, stopFakeLibrary } from '../../test/fakeLibrary'
import { mockNetwork } from '../../test/msw'
import { renderWithProviders } from '../../test/renderWithProviders'
import { bridgeStore } from './bridge'
import { InspectorPanel, register } from './index'
import { inspectorStore } from './store'

// The inspector of the M2 slice in Chromium, over the fake library: the
// Info panel for 0 / 1 / N targets and the autosaving Title and Alt text.
// 1001 is Jonas Holm's image without alt text; 1000 belongs to Site Admin.

registerCoreCommands()
register()

let mock: MockContext

function start(scenario = 'normal', writeLatency = 0): void {
  mock = startFakeLibrary(scenario, {
    latency: { read: 0, write: writeLatency },
  })
  act(() => {
    coreStore.getState().setBootstrap(bootstrapFor(mock))
  })
}

function Tracker() {
  useTrackCurrentCollection()
  return null
}

function renderInspector(children?: ReactNode) {
  return renderWithProviders(
    <>
      <Tracker />
      <aside style={{ display: 'flex', width: 360, height: 700 }}>
        <InspectorPanel />
      </aside>
      {children}
    </>,
  )
}

function select(id: number): void {
  act(() => {
    coreStore.getState().selectOnly(id)
  })
}

async function titleField(): Promise<HTMLInputElement> {
  return (await screen.findByLabelText('Title')) as HTMLInputElement
}

async function altField(): Promise<HTMLTextAreaElement> {
  return (await screen.findByLabelText('Alt text')) as HTMLTextAreaElement
}

function fieldStatus(field: 'title' | 'alt'): string {
  return (
    screen
      .getByTestId(`field-${field}`)
      .querySelector('[data-status]')
      ?.textContent?.trim() ?? ''
  )
}

/** Counts the PATCH requests; the fake library still answers them. */
function countPatches(): { count: number } {
  const patches = { count: 0 }
  mockNetwork.use(
    http.patch('*/api/library/items/:id', () => {
      patches.count += 1
      return undefined
    }),
  )
  return patches
}

/** Records the toasts shown. */
function recordToasts(): string[] {
  const shown: string[] = []
  setToastBackendForTesting({
    show: (notification) => {
      shown.push(String(notification.id))
    },
    hide: () => {},
  })
  return shown
}

/** Lets pending responses and their handlers run. */
function settle(ms = 100): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

beforeEach(() => {
  setUrlStoreForTesting(
    createUrlStore(createMemoryHistory('http://localhost/?view=library')),
  )
  act(() => {
    const state = coreStore.getState()
    state.resetSelection()
    state.setViewport('wide')
    state.setConnectivity('online')
    if (!(state.panels.inspectorOpen && state.panels.inspectorTab === 'info')) {
      state.setPanels({ inspectorOpen: true, inspectorTab: 'info' })
    }
  })
})

afterEach(() => {
  stopFakeLibrary()
  setUrlStoreForTesting(null)
  setToastBackendForTesting(null)
  inspectorStore.setState({ fields: {}, mounted: {} })
  bridgeStore.setState({ focusRequest: null, shown: null })
})

describe('the Info panel', () => {
  it('summarises the view when nothing is selected, and counts several items', async () => {
    start()
    renderInspector()
    expect(await screen.findByText('Nothing selected')).toBeTruthy()
    expect(await screen.findByText('93 items in view')).toBeTruthy()
    act(() => {
      coreStore.getState().setSelection([1000, 1001])
    })
    expect(await screen.findByText('2 items selected')).toBeTruthy()
    expect(screen.getByText('2 selected')).toBeTruthy()
    expect(screen.queryByLabelText('Title')).toBeNull()
  })

  it('shows one item: name with its extension, meta line, preview, Title and Alt text', async () => {
    start()
    select(1001)
    renderInspector()
    const name = await screen.findByTestId('file-name')
    expect(name.getAttribute('title')).toBe('detail-oisin-conolly-330.png')
    expect(name.textContent).toBe('detail-oisin-conolly-330.png')
    expect(screen.getByText(/^Image · .+ · \d+ × \d+$/)).toBeTruthy()
    const preview = screen.getByTestId('preview')
    const box = preview.getBoundingClientRect()
    expect(box.width / box.height).toBeCloseTo(1.6, 1)
    // A rendition with the item's version, so an in-place edit isn't stale.
    expect(preview.querySelector('img')?.getAttribute('src')).toMatch(
      /[?&]v=[^&]+$/,
    )
    expect((await titleField()).value).toBe('detail-oisin-conolly-330')
    // No alt text: the flag (icon + word), the hint and the rail's dot.
    expect((await altField()).value).toBe('')
    expect(screen.getByText('Missing')).toBeTruthy()
    expect(
      screen.getByText('Screen readers skip images without alt text.'),
    ).toBeTruthy()
    expect(
      await screen.findByRole('button', { name: 'Info (alt text missing)' }),
    ).toBeTruthy()
  })

  it('keeps its values selectable for copying, while the rail is chrome', async () => {
    start()
    select(1001)
    renderInspector()
    const rail = screen.getByRole('navigation', { name: 'Inspector panels' })
    expect(getComputedStyle(rail).userSelect).toBe('none')
    expect(
      getComputedStyle(screen.getByRole('button', { name: /^Info/ }))
        .touchAction,
    ).toBe('manipulation')
    const name = await screen.findByTestId('file-name')
    const values = [
      name,
      name.nextElementSibling,
      await titleField(),
      await altField(),
    ]
    for (const element of values) {
      expect(element).not.toBeNull()
      expect(getComputedStyle(element as Element).userSelect).not.toBe('none')
    }
  })

  it('hides the preview in detail mode and Alt text for non-images', async () => {
    setUrlStoreForTesting(
      createUrlStore(
        createMemoryHistory('http://localhost/?view=library&item=1088'),
      ),
    )
    start()
    select(1088)
    renderInspector()
    await titleField()
    expect(screen.queryByTestId('preview')).toBeNull()
    expect(screen.queryByLabelText('Alt text')).toBeNull()
  })

  it('collapses on the active rail tab and says Edit and Usage come later', async () => {
    const user = userEvent.setup()
    start()
    renderInspector()
    await screen.findByText('Nothing selected')
    await user.click(screen.getByRole('button', { name: 'Usage' }))
    expect(await screen.findByText(/isn’t shown yet/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Usage' }))
    expect(screen.queryByTestId('inspector-panel')).toBeNull()
    expect(
      screen
        .getByRole('button', { name: 'Usage' })
        .getAttribute('aria-pressed'),
    ).toBe('false')
  })
})

describe('autosave', () => {
  it('Unsaved while typing, then Saving… and ✓ Saved on blur, with the new value cached', async () => {
    const user = userEvent.setup()
    start('normal', 150)
    select(1001)
    const { queryClient } = renderInspector()
    const title = await titleField()
    await user.clear(title)
    await user.type(title, 'Leaf detail')
    expect(fieldStatus('title')).toBe('Unsaved')
    expect(screen.getByText('Unsaved changes')).toBeTruthy()

    act(() => title.blur())
    await waitFor(() => expect(fieldStatus('title')).toBe('Saving…'))
    // Optimistic: the cache has it while the request runs.
    expect(
      queryClient.getQueryData<LibraryItemFull>(libraryKeys.item('full', 1001))
        ?.title,
    ).toBe('Leaf detail')
    await waitFor(() => expect(fieldStatus('title')).toBe('Saved'))
    expect(mock.library.item(1001)?.title).toBe('Leaf detail')
    expect(title.value).toBe('Leaf detail')
    // "✓ Saved" clears after 1.8 s.
    await waitFor(() => expect(fieldStatus('title')).toBe(''), {
      timeout: 3000,
    })
  })

  it('Ctrl+Enter commits and keeps focus; Enter in Alt text commits without a newline', async () => {
    const user = userEvent.setup()
    start()
    select(1001)
    renderInspector()
    const title = await titleField()
    await user.type(title, ' two')
    await user.keyboard('{Control>}{Enter}{/Control}')
    await waitFor(() =>
      expect(mock.library.item(1001)?.title).toBe(
        'detail-oisin-conolly-330 two',
      ),
    )
    expect(document.activeElement).toBe(title)

    const alt = await altField()
    await user.type(alt, 'A leaf{Enter}')
    await waitFor(() => expect(mock.library.item(1001)?.alt).toBe('A leaf'))
    expect(alt.value).toBe('A leaf')
    expect(document.activeElement).toBe(alt)
    // Saved alt text: no more flag or rail dot.
    await waitFor(() => expect(screen.queryByText('Missing')).toBeNull())
    expect(screen.getByRole('button', { name: 'Info' })).toBeTruthy()
  })

  it('keeps the text after a failed save, rolls the cache back, and Retry sends it', async () => {
    const user = userEvent.setup()
    start()
    select(1001)
    const { queryClient } = renderInspector()
    let failing = true
    mockNetwork.use(
      http.patch('*/api/library/items/:id', () =>
        failing
          ? HttpResponse.json(
              { code: 'wp_unreachable', message: 'WordPress is unreachable.' },
              { status: 502 },
            )
          : undefined,
      ),
    )
    const alt = await altField()
    await user.type(alt, 'A green leaf')
    act(() => alt.blur())

    await waitFor(() => expect(fieldStatus('alt')).toMatch(/^Not saved/))
    expect(alt.value).toBe('A green leaf')
    expect(alt.getAttribute('aria-invalid')).toBe('true')
    expect(
      screen.getByText(
        "Not saved — WordPress didn't respond. Your text is kept here.",
      ),
    ).toBeTruthy()
    expect(
      queryClient.getQueryData<LibraryItemFull>(libraryKeys.item('full', 1001))
        ?.alt,
    ).toBe('')

    failing = false
    await user.click(screen.getByRole('button', { name: /^Retry/ }))
    await waitFor(() => expect(fieldStatus('alt')).toBe('Saved'))
    expect(mock.library.item(1001)?.alt).toBe('A green leaf')
  })

  it('Esc reverts unsaved text and keeps focus; a second Esc returns to the tile', async () => {
    const user = userEvent.setup()
    const focusTile = vi.fn()
    const unregister = registerCenter({ focusTile })
    try {
      start()
      select(1001)
      renderInspector()
      const title = await titleField()
      await user.type(title, ' oops')
      await user.keyboard('{Escape}')
      expect(title.value).toBe('detail-oisin-conolly-330')
      expect(fieldStatus('title')).toBe('')
      expect(document.activeElement).toBe(title)
      expect(focusTile).not.toHaveBeenCalled()

      await user.keyboard('{Escape}')
      expect(focusTile).toHaveBeenCalledWith(1001)
      expect(document.activeElement).not.toBe(title)
      expect(mock.library.item(1001)?.title).toBe('detail-oisin-conolly-330')
    } finally {
      unregister()
    }
  })

  it('Esc while saving drops the typing since, and a blur then sends nothing more', async () => {
    const user = userEvent.setup()
    start('normal', 400)
    const patches = countPatches()
    select(1001)
    renderInspector()
    const title = await titleField()
    await user.type(title, ' two{Enter}')
    await waitFor(() => expect(fieldStatus('title')).toBe('Saving…'))
    await user.type(title, ' more')
    expect(title.value).toBe('detail-oisin-conolly-330 two more')

    await user.keyboard('{Escape}')
    expect(title.value).toBe('detail-oisin-conolly-330 two')
    expect(document.activeElement).toBe(title)
    expect(fieldStatus('title')).toBe('Saving…')

    act(() => title.blur())
    await waitFor(() => expect(fieldStatus('title')).toBe('Saved'))
    await settle()
    expect(title.value).toBe('detail-oisin-conolly-330 two')
    expect(mock.library.item(1001)?.title).toBe('detail-oisin-conolly-330 two')
    expect(patches.count).toBe(1)
  })

  it('keeps ✓ Saved when the field blurs right after the save', async () => {
    const user = userEvent.setup()
    start()
    select(1001)
    renderInspector()
    const title = await titleField()
    await user.type(title, ' two{Enter}')
    await waitFor(() => expect(fieldStatus('title')).toBe('Saved'))
    act(() => title.blur())
    expect(fieldStatus('title')).toBe('Saved')
  })

  it('keeps a draft across re-renders, and commits it to its own item when the selection moves', async () => {
    const user = userEvent.setup()
    start()
    select(1001)
    const { queryClient } = renderInspector()
    const title = await titleField()
    await user.clear(title)
    await user.type(title, 'Half typed')
    // A refetch or rev poll changes the item under the field.
    act(() => {
      queryClient.setQueryData<LibraryItemFull>(
        libraryKeys.item('full', 1001),
        (item) => (item ? { ...item, caption: 'Changed elsewhere' } : item),
      )
    })
    expect((await titleField()).value).toBe('Half typed')

    select(1002)
    await waitFor(() =>
      expect(mock.library.item(1001)?.title).toBe('Half typed'),
    )
    expect(mock.library.item(1002)?.title).toBe('workspace-davide-ragusa-687')
    await waitFor(async () =>
      expect((await titleField()).value).toBe('workspace-davide-ragusa-687'),
    )
  })

  it('tells the user with a toast when a save fails after they moved on', async () => {
    const user = userEvent.setup()
    const shown: string[] = []
    const backend: ToastBackend = {
      show: (notification) => {
        shown.push(String(notification.id))
      },
      hide: () => {},
    }
    setToastBackendForTesting(backend)
    start('normal', 100)
    mockNetwork.use(
      http.patch('*/api/library/items/:id', () =>
        HttpResponse.json(
          { code: 'wp_unreachable', message: 'WordPress is unreachable.' },
          { status: 502 },
        ),
      ),
    )
    select(1001)
    renderInspector()
    const alt = await altField()
    await user.type(alt, 'Lost?')
    const spoken: string[] = []
    const unsubscribe = subscribeAnnouncements((message) => {
      spoken.push(message)
    })
    select(1002)
    await waitFor(() => expect(shown).toHaveLength(1))
    unsubscribe()
    expect(spoken).toContain(
      "Alt text for “detail-oisin-conolly-330” wasn't saved",
    )
    // Back on the item, its field still holds the text in the error state.
    select(1001)
    expect((await altField()).value).toBe('Lost?')
    expect(fieldStatus('alt')).toMatch(/^Not saved/)
  })

  it('tells the user with a toast when a commit is refused after they moved on', async () => {
    const user = userEvent.setup()
    const shown = recordToasts()
    start()
    const patches = countPatches()
    select(1001)
    renderInspector()
    const alt = await altField()
    await user.type(alt, 'Kept?')
    act(() => {
      coreStore.getState().setConnectivity('offline', 'wp_unreachable')
    })
    const spoken: string[] = []
    const unsubscribe = subscribeAnnouncements((message) => {
      spoken.push(message)
    })
    select(1002)
    await waitFor(() => expect(shown).toHaveLength(1))
    unsubscribe()
    expect(spoken).toEqual([
      'Alt text not saved. WordPress is unreachable right now.',
      "Alt text for “detail-oisin-conolly-330” wasn't saved",
    ])
    select(1001)
    expect((await altField()).value).toBe('Kept?')
    expect(fieldStatus('alt')).toMatch(/^Not saved/)
    expect(patches.count).toBe(0)
  })

  it('keeps taking input when WordPress goes away mid-typing, and refuses the commit with the reason', async () => {
    const user = userEvent.setup()
    start()
    const patches = countPatches()
    select(1001)
    renderInspector()
    const alt = await altField()
    await user.type(alt, 'A green')
    act(() => {
      coreStore.getState().setConnectivity('offline', 'wp_unreachable')
    })
    expect((await screen.findByTestId('lock-notice')).textContent).toBe(
      'WordPress is unreachable right now.',
    )
    // The clean field is read-only; the one being typed in is not.
    expect((await titleField()).readOnly).toBe(true)
    expect(alt.readOnly).toBe(false)
    await user.type(alt, ' leaf')
    expect(alt.value).toBe('A green leaf')

    await user.keyboard('{Enter}')
    await waitFor(() => expect(fieldStatus('alt')).toMatch(/^Not saved/))
    expect(alt.value).toBe('A green leaf')
    expect(
      screen.getByText(
        'Not saved — WordPress is unreachable right now. Your text is kept here.',
      ),
    ).toBeTruthy()
    expect(alt.readOnly).toBe(false)
    expect(patches.count).toBe(0)
  })

  it('makes fields read-only, with the lock notice, on an item the Author may not edit', async () => {
    const user = userEvent.setup()
    start('author')
    select(1000)
    renderInspector()
    const title = await titleField()
    expect(title.readOnly).toBe(true)
    expect(title.disabled).toBe(false)
    expect((await altField()).readOnly).toBe(true)
    expect(screen.getByTestId('lock-notice').textContent).toBe(
      'You can view but not edit media uploaded by others (Author role).',
    )
    await user.type(title, 'nope')
    act(() => title.blur())
    expect(title.value).toBe('still-life-joshua-earle-548')
    expect(fieldStatus('title')).toBe('')
  })

  it('shows the can() reason when offline', async () => {
    start()
    select(1001)
    act(() => {
      coreStore.getState().setConnectivity('offline')
    })
    renderInspector()
    expect((await titleField()).readOnly).toBe(true)
    expect(screen.getByTestId('lock-notice').textContent).toBe(
      'WordPress is unreachable right now.',
    )
  })
})

describe('logout', () => {
  it('drops drafts and errors, and a save that settles afterwards changes nothing', async () => {
    const user = userEvent.setup()
    const shown = recordToasts()
    start()
    // Alt text fails at once; the title's save hangs until released.
    const held: (() => void)[] = []
    mockNetwork.use(
      http.patch('*/api/library/items/:id', async ({ request }) => {
        const patch = (await request.clone().json()) as Record<string, unknown>
        if ('title' in patch) {
          await new Promise<void>((resolve) => held.push(resolve))
        }
        return HttpResponse.json(
          { code: 'wp_unreachable', message: 'WordPress is unreachable.' },
          { status: 502 },
        )
      }),
    )
    select(1001)
    const { queryClient } = renderInspector()
    const alt = await altField()
    await user.type(alt, 'Gone{Enter}')
    await waitFor(() => expect(fieldStatus('alt')).toMatch(/^Not saved/))
    const title = await titleField()
    await user.type(title, ' draft{Enter}')
    await waitFor(() => expect(fieldStatus('title')).toBe('Saving…'))
    await waitFor(() => expect(held).toHaveLength(1))
    expect(Object.keys(inspectorStore.getState().fields)).toHaveLength(2)
    expect(bridgeStore.getState().shown?.id).toBe(1001)

    const spoken: string[] = []
    const unsubscribe = subscribeAnnouncements((message) => {
      spoken.push(message)
    })
    act(() => {
      resetSession()
    })
    expect(inspectorStore.getState().fields).toEqual({})
    expect(bridgeStore.getState().shown).toBeNull()

    for (const release of held) {
      release()
    }
    // The failed save rolls the cache back, then the inspector hears of it.
    await waitFor(() =>
      expect(
        queryClient.getQueryData<LibraryItemFull>(
          libraryKeys.item('full', 1001),
        )?.title,
      ).toBe('detail-oisin-conolly-330'),
    )
    await settle()
    unsubscribe()
    expect(inspectorStore.getState().fields).toEqual({})
    expect(shown).toHaveLength(0)
    expect(spoken.filter((message) => /saved/i.test(message))).toEqual([])
  })
})

describe('`A`: jump to alt text', () => {
  it('opens Info and focuses the alt field of the one image', async () => {
    start()
    renderInspector()
    act(() => {
      coreStore.getState().setInspectorOpen(false)
    })
    await screen.findByRole('button', { name: 'Info' })
    await waitFor(() =>
      expect(screen.queryByTestId('inspector-panel')).toBeNull(),
    )
    select(1001)
    await waitFor(() => expect(runCommand('inspector.focus-alt')).toBe(true))
    const alt = await altField()
    await waitFor(() => expect(document.activeElement).toBe(alt))
    expect(coreStore.getState().panels.inspectorTab).toBe('info')
  })

  it('is unavailable without exactly one image', async () => {
    start()
    renderInspector()
    await screen.findByText('93 items in view')
    expect(runCommand('inspector.focus-alt')).toBe(false)
    select(1088)
    expect(runCommand('inspector.focus-alt')).toBe(false)
    act(() => {
      coreStore.getState().setSelection([1000, 1001])
    })
    expect(runCommand('inspector.focus-alt')).toBe(false)
  })
})
