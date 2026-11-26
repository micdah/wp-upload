import { act, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BatchRequest } from '../../../../../shared/library-api'
import { registerCoreCommands } from '../../app/runtime'
import {
  getCurrentCollection,
  useTrackCurrentCollection,
} from '../../core/collection/hooks'
import { coreStore } from '../../core/state'
import { subscribeAnnouncements } from '../../core/ui/announce'
import { setToastBackendForTesting, undoLast } from '../../core/ui/toast'
import { createUrlStore } from '../../core/url/history'
import { createMemoryHistory } from '../../core/url/memoryHistory'
import { setUrlStoreForTesting, urlStore } from '../../core/url/useUrlState'
import { bootstrapFor, type MockContext } from '../../mocks/context'
import { failOnReactWarnings } from '../../test/consoleErrors'
import { startFakeLibrary, stopFakeLibrary } from '../../test/fakeLibrary'
import { mockNetwork } from '../../test/msw'
import { renderWithProviders } from '../../test/renderWithProviders'
import { bridgeStore } from './bridge'
import { InspectorPanel, register } from './index'
import { inspectorStore } from './store'

// Batch editing (inspector.md §2 "Several items", §7, §9) in Chromium over
// the fake library: Mixed fields, commits through items/batch with a toast
// and its Undo, alt text for images only, Description Append, an Author's
// mixed selection, and D33's hidden items.
//
// From the seed: 1085, 1084 and 1083 are images with three different
// captions (two credits and an empty one); 1089 is a document. In the
// `author` scenario the user (Jonas Holm) uploaded 1079 and 1078, not 1085.

failOnReactWarnings()
registerCoreCommands()
register()

let mock: MockContext

function start(
  scenario = 'normal',
  settings: Parameters<typeof startFakeLibrary>[1] = {},
): void {
  mock = startFakeLibrary(scenario, settings)
  act(() => {
    coreStore.getState().setBootstrap(bootstrapFor(mock))
  })
}

function Tracker() {
  useTrackCurrentCollection()
  return null
}

function renderInspector() {
  return renderWithProviders(
    <>
      <Tracker />
      <aside style={{ display: 'flex', width: 360, height: 700 }}>
        <InspectorPanel />
      </aside>
    </>,
  )
}

function select(...ids: number[]): void {
  act(() => {
    coreStore.getState().setSelection(ids)
  })
}

function panel(): HTMLElement {
  return screen.getByTestId('inspector-panel')
}

async function batchField(
  field: string,
): Promise<HTMLInputElement & HTMLTextAreaElement> {
  const wrapper = await screen.findByTestId(`batch-field-${field}`)
  const input = wrapper.querySelector('input, textarea')
  if (!input) throw new Error(`no ${field} input`)
  return input as HTMLInputElement & HTMLTextAreaElement
}

function batchStatus(field: string): string {
  return (
    screen
      .getByTestId(`batch-field-${field}`)
      .querySelector('[data-status]')
      ?.textContent?.trim() ?? ''
  )
}

/** Records the bodies of items/batch requests; the fake still answers. */
function recordBatches(): BatchRequest[] {
  const bodies: BatchRequest[] = []
  mockNetwork.use(
    http.post('*/api/library/items/batch', async ({ request }) => {
      bodies.push((await request.clone().json()) as BatchRequest)
      return undefined
    }),
  )
  return bodies
}

/** Counts the toasts shown. */
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

function listen(): { spoken: string[]; stop: () => void } {
  const spoken: string[] = []
  const stop = subscribeAnnouncements((message) => {
    spoken.push(message)
  })
  return { spoken, stop }
}

function captions(ids: number[]): string[] {
  return ids.map((id) => mock.library.item(id)?.caption ?? '?')
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
  inspectorStore.setState({
    fields: {},
    mounted: {},
    progress: {},
    descriptionMode: 'replace',
  })
  bridgeStore.setState({ focusRequest: null, shown: null })
})

describe('batch editing', () => {
  const IDS = [1085, 1084, 1083]

  it('shows differing values as Mixed, and an empty Mixed field commits nothing', async () => {
    const user = userEvent.setup()
    start()
    const batches = recordBatches()
    select(...IDS)
    renderInspector()
    expect(await screen.findByText('Editing 3 items')).toBeTruthy()
    const caption = await batchField('caption')
    await waitFor(() =>
      expect(caption.placeholder).toBe('Mixed — 3 different values'),
    )
    expect(caption.value).toBe('')
    expect(caption.dataset.state).toBe('mixed')
    expect(
      within(screen.getByTestId('batch-field-caption')).getByText(
        'Leave empty to keep each item’s own text.',
      ),
    ).toBeTruthy()

    await user.click(caption)
    act(() => caption.blur())
    // Typed, then cleared again: still nothing to send.
    await user.type(caption, 'x{Backspace}')
    act(() => caption.blur())
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(batches).toHaveLength(0)
    expect(batchStatus('caption')).toBe('')
  })

  it('commits to every item with a toast, and Undo puts each previous value back', async () => {
    const user = userEvent.setup()
    start()
    const shown = recordToasts()
    const batches = recordBatches()
    const before = captions(IDS)
    expect(new Set(before).size).toBe(3)
    select(...IDS)
    renderInspector()
    const caption = await batchField('caption')
    await waitFor(() => expect(caption.dataset.state).toBe('mixed'))
    const { spoken, stop } = listen()
    await user.type(caption, 'Shared credit{Control>}{Enter}{/Control}')
    await waitFor(() =>
      expect(captions(IDS)).toEqual([
        'Shared credit',
        'Shared credit',
        'Shared credit',
      ]),
    )
    await waitFor(() => expect(shown).toHaveLength(1))
    stop()
    expect(spoken).toContain('Updated caption on 3 items. Undo available.')
    expect(batches).toHaveLength(1)
    expect(batches[0]).toEqual({
      ids: IDS,
      set: { caption: 'Shared credit' },
    })
    // No longer Mixed; focus stays in the field.
    await waitFor(() => expect(caption.value).toBe('Shared credit'))
    expect(caption.dataset.state).toBeUndefined()
    expect(document.activeElement).toBe(caption)
    await waitFor(() => expect(batchStatus('caption')).toBe('Saved'))

    let undone = false
    await act(async () => {
      undone = await undoLast()
    })
    expect(undone).toBe(true)
    await waitFor(() => expect(captions(IDS)).toEqual(before))
    await waitFor(() =>
      expect(caption.placeholder).toBe('Mixed — 3 different values'),
    )
  })

  it('commits Title to all on Enter', async () => {
    const user = userEvent.setup()
    start()
    select(...IDS)
    renderInspector()
    const title = await batchField('title')
    await waitFor(() => expect(title.dataset.state).toBe('mixed'))
    await user.type(title, 'Series{Enter}')
    await waitFor(() =>
      expect(IDS.map((id) => mock.library.item(id)?.title)).toEqual([
        'Series',
        'Series',
        'Series',
      ]),
    )
    // The fake changes before its response reaches the cache.
    await waitFor(() => expect(title.value).toBe('Series'))
    // Never Save & next in a batch: the selection stays.
    expect([...coreStore.getState().selection].sort()).toEqual([...IDS].sort())
  })

  it('writes alt text to the images only, and says how many', async () => {
    const user = userEvent.setup()
    start()
    const batches = recordBatches()
    select(1085, 1089, 1084)
    renderInspector()
    const alt = (await within(
      await screen.findByTestId('inspector-panel'),
    ).findByLabelText('Alt text · 2 images')) as HTMLTextAreaElement
    expect(
      screen.getByText('2 images, 1 other file', { exact: false }),
    ).toBeTruthy()
    await user.type(alt, 'A sample photo{Enter}')
    await waitFor(() => expect(batches).toHaveLength(1))
    expect(batches[0]).toEqual({
      ids: [1085, 1084],
      set: { alt: 'A sample photo' },
    })
    await waitFor(() =>
      expect(mock.library.item(1084)?.alt).toBe('A sample photo'),
    )
    expect(mock.library.item(1085)?.alt).toBe('A sample photo')
    expect(mock.library.item(1089)?.alt).toBe('')
  })

  it('appends a paragraph to every description, then clears the field', async () => {
    const user = userEvent.setup()
    start()
    const batches = recordBatches()
    mock.library.patchItem(1085, { description: 'Old text' })
    select(1085, 1084)
    renderInspector()
    const description = await batchField('description')
    await waitFor(() => expect(description.dataset.state).toBe('mixed'))
    await user.click(within(panel()).getByRole('button', { name: 'Append' }))
    expect(
      within(panel())
        .getByRole('button', { name: 'Append' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    expect(description.placeholder).toBe(
      'Text to add as a new paragraph to every description',
    )
    await user.type(description, 'Shot in 2026.')
    act(() => description.blur())
    await waitFor(() =>
      expect(mock.library.item(1085)?.description).toBe(
        'Old text\n\nShot in 2026.',
      ),
    )
    expect(mock.library.item(1084)?.description).toBe('Shot in 2026.')
    expect(batches[0]).toEqual({
      ids: [1085, 1084],
      set: {},
      appendDescription: 'Shot in 2026.',
    })
    await waitFor(() => expect(description.value).toBe(''))
  })

  it('edits an Author’s own items only, and says so', async () => {
    const user = userEvent.setup()
    start('author')
    const batches = recordBatches()
    select(1085, 1079, 1078)
    renderInspector()
    const notice = await screen.findByTestId('partition-notice')
    expect(notice.textContent).toBe(
      'Changes apply to the 2 items you uploaded. 1 uploaded by others stay as they are.',
    )
    const title = await batchField('title')
    expect(title.readOnly).toBe(false)
    await user.type(title, 'Mine{Enter}')
    await waitFor(() => expect(batches).toHaveLength(1))
    expect(batches[0]).toEqual({ ids: [1079, 1078], set: { title: 'Mine' } })
    await waitFor(() => expect(mock.library.item(1079)?.title).toBe('Mine'))
    expect(mock.library.item(1078)?.title).toBe('Mine')
    expect(mock.library.item(1085)?.title).not.toBe('Mine')
  })

  it('makes everything read-only when the Author uploaded none of them', async () => {
    start('author')
    select(1085, 1084)
    renderInspector()
    expect((await screen.findByTestId('lock-notice')).textContent).toBe(
      'You can view but not edit media uploaded by others (Author role).',
    )
    await waitFor(async () =>
      expect((await batchField('title')).readOnly).toBe(true),
    )
    expect((await batchField('caption')).readOnly).toBe(true)
    expect(screen.queryByRole('button', { name: 'Append' })).toBeNull()
  })

  it('says when the filters hide some of the selection (D33)', async () => {
    start()
    // 1085 has alt text, 1082 has none.
    select(1085, 1082)
    renderInspector()
    expect(
      await screen.findByText(
        'Edits apply to all 2 items. Fields left empty stay as they are.',
      ),
    ).toBeTruthy()
    act(() => urlStore().navigate({ alt: 'missing' }))
    expect(
      await screen.findByText(
        'Edits apply to all 2 items, 1 of them hidden by the filters. Fields left empty stay as they are.',
      ),
    ).toBeTruthy()
    // A commit writes the hidden item too.
    const user = userEvent.setup()
    const title = await batchField('title')
    await user.type(title, 'Both{Enter}')
    await waitFor(() => expect(mock.library.item(1085)?.title).toBe('Both'))
    expect(mock.library.item(1082)?.title).toBe('Both')
  })

  it('ends the alt pass when a batch alt text empties the Missing alt view', async () => {
    const messages: string[] = []
    setToastBackendForTesting({
      show: (notification) => {
        messages.push(String(notification.message))
      },
      hide: () => {},
    })
    start()
    // Blog / 2025: 1024 and 1010 are its only images without alt text.
    act(() => urlStore().navigate({ folder: 5, alt: 'missing' }))
    select(1024, 1010)
    renderInspector()
    const user = userEvent.setup()
    const alt = await batchField('alt')
    await user.type(alt, 'A shared logo{Enter}')
    await waitFor(() => expect(urlStore().get().alt).toBeNull())
    expect(mock.library.item(1024)?.alt).toBe('A shared logo')
    const done = messages.filter((message) =>
      message.includes('now has alt text'),
    )
    expect(done).toHaveLength(1)
  })

  it('says "Unsaved changes" while batch text is typed', async () => {
    const user = userEvent.setup()
    start()
    select(...IDS)
    renderInspector()
    expect(await within(panel()).findByText('3 selected')).toBeTruthy()
    await user.type(await batchField('caption'), 'Half')
    expect(within(panel()).getByText('Unsaved changes')).toBeTruthy()
    expect(within(panel()).queryByText('3 selected')).toBeNull()
  })

  it('commits half-typed text to the items it was typed for when the selection moves', async () => {
    const user = userEvent.setup()
    start()
    select(...IDS)
    renderInspector()
    const caption = await batchField('caption')
    await waitFor(() => expect(caption.dataset.state).toBe('mixed'))
    await user.type(caption, 'Typed for three')
    select(1001)
    await within(panel()).findByLabelText('Title')
    await waitFor(() =>
      expect(captions(IDS)).toEqual([
        'Typed for three',
        'Typed for three',
        'Typed for three',
      ]),
    )
    expect(mock.library.item(1001)?.caption).toBe('')
  })
})

describe('batch editing, review fixes', () => {
  it('keeps Append when the selection changes, and the commit appends (critical 1)', async () => {
    const user = userEvent.setup()
    start()
    const batches = recordBatches()
    mock.library.patchItem(1085, { description: 'Old text' })
    select(1085, 1084)
    renderInspector()
    await batchField('description')
    await user.click(within(panel()).getByRole('button', { name: 'Append' }))
    // Extend the selection: a new batch, the toggle still says Append.
    select(1085, 1084, 1083)
    await screen.findByText('Editing 3 items')
    expect(
      within(panel())
        .getByRole('button', { name: 'Append' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    const description = await batchField('description')
    await user.type(description, 'Shot in 2026.')
    act(() => description.blur())
    await waitFor(() => expect(batches).toHaveLength(1))
    expect(batches[0]).toEqual({
      ids: [1085, 1084, 1083],
      set: {},
      appendDescription: 'Shot in 2026.',
    })
    await waitFor(() =>
      expect(mock.library.item(1085)?.description).toBe(
        'Old text\n\nShot in 2026.',
      ),
    )
    // And back to Replace: the commit replaces.
    await user.click(within(panel()).getByRole('button', { name: 'Replace' }))
    await user.type(description, 'Fresh')
    act(() => description.blur())
    await waitFor(() => expect(batches).toHaveLength(2))
    expect(batches[1]).toEqual({
      ids: [1085, 1084, 1083],
      set: { description: 'Fresh' },
    })
  })

  it('never commits an empty field, even when the items share a value (12)', async () => {
    const user = userEvent.setup()
    start()
    const batches = recordBatches()
    for (const id of [1085, 1084]) {
      mock.library.patchItem(id, { caption: 'Same' })
    }
    select(1085, 1084)
    renderInspector()
    const caption = await batchField('caption')
    await waitFor(() => expect(caption.value).toBe('Same'))
    await user.clear(caption)
    await user.keyboard('{Control>}{Enter}{/Control}')
    act(() => caption.blur())
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(batches).toEqual([])
    expect(captions([1085, 1084])).toEqual(['Same', 'Same'])
    // The field shows the shared value again.
    await waitFor(() => expect(caption.value).toBe('Same'))
  })

  it('re-commits text typed during a save, and Append never repeats it (6)', async () => {
    const user = userEvent.setup()
    start('normal', { latency: { read: 0, write: 300 } })
    const batches = recordBatches()
    select(1085, 1084)
    renderInspector()
    const description = await batchField('description')
    await user.click(within(panel()).getByRole('button', { name: 'Append' }))
    await user.type(description, 'One.')
    await user.keyboard('{Control>}{Enter}{/Control}')
    await waitFor(() => expect(batchStatus('description')).toMatch(/^Saving/))
    await user.type(description, ' Two.')
    // A commit while the first runs is queued, then sent.
    await user.keyboard('{Control>}{Enter}{/Control}')
    await waitFor(() => expect(batches).toHaveLength(2), { timeout: 3000 })
    expect(
      batches.map(
        (batch) => 'appendDescription' in batch && batch.appendDescription,
      ),
    ).toEqual(['One.', 'Two.'])
    await waitFor(() =>
      expect(mock.library.item(1085)?.description).toBe('One.\n\nTwo.'),
    )
  })

  it('hides Delete when no selected item may be deleted (7)', async () => {
    start('author')
    // Both belong to Site Admin: the Author may delete neither.
    select(1000, 1002)
    renderInspector()
    await screen.findByText('Editing 2 items')
    await waitFor(() =>
      expect(
        within(panel()).queryByRole('button', { name: /Move to folder/ }),
      ).toBeTruthy(),
    )
    expect(
      within(panel()).queryByRole('button', { name: /^Delete/ }),
    ).toBeNull()
  })

  it('counts ownership, not connectivity, in the mixed-selection notice (9)', async () => {
    start('author')
    select(1079, 1078, 1000)
    renderInspector()
    const notice = await screen.findByTestId('partition-notice')
    const before = notice.textContent
    expect(before).toContain('Changes apply to the 2 items you uploaded.')
    act(() => {
      coreStore.getState().setConnectivity('offline', 'wp_unreachable')
    })
    await screen.findByText('WordPress is unreachable right now.')
    expect(screen.getByTestId('partition-notice').textContent).toBe(before)
  })

  it('reports a partial Undo with the real count (11)', async () => {
    const user = userEvent.setup()
    const messages: string[] = []
    setToastBackendForTesting({
      show: (notification) => {
        messages.push(String(notification.message))
      },
      hide: () => {},
    })
    start()
    select(1085, 1084)
    renderInspector()
    const caption = await batchField('caption')
    await user.type(caption, 'Credit{Control>}{Enter}{/Control}')
    await waitFor(() =>
      expect(captions([1085, 1084])).toEqual(['Credit', 'Credit']),
    )
    // The Undo request: the server refuses one of the two items.
    mockNetwork.use(
      http.post('*/api/library/items/batch', async ({ request }) => {
        const body = (await request.clone().json()) as {
          items?: { id: number }[]
        }
        if (!body.items) {
          return undefined
        }
        return HttpResponse.json({
          rev: 'r-undo',
          results: body.items.map((item, index) =>
            index === 0
              ? {
                  id: item.id,
                  ok: true,
                  previous: { caption: 'Credit' },
                  item: {
                    title: 't',
                    alt: '',
                    caption: '',
                    description: '',
                    post: null,
                    modifiedAt: '2026-11-26T12:00:00Z',
                  },
                }
              : {
                  id: item.id,
                  ok: false,
                  error: { code: 'wpu_forbidden', message: 'Not yours.' },
                },
          ),
        })
      }),
    )
    await act(async () => {
      await undoLast()
    })
    await waitFor(() =>
      expect(messages).toContain(
        "Couldn't undo: only 1 of 2 items restored (Not yours)",
      ),
    )
    expect(messages.some((message) => message.startsWith('Restored'))).toBe(
      false,
    )
  })
})

describe('more than 1,000 selected (10)', () => {
  it('shows Mixed values, says what it counted, and writes alt text to every image', async () => {
    const user = userEvent.setup()
    start('normal', { library: 'large', largeCount: 1050 })
    const batches = recordBatches()
    renderInspector()
    await waitFor(() => expect(getCurrentCollection()?.total).toBe(1050))
    const all = [...(getCurrentCollection()?.ids ?? [])]
    select(...all)
    // Filter the images out of the view: kinds past the first 1,000 then
    // come from neither the rows nor the hydrated items, only from the
    // batch loading them before it writes alt text.
    act(() => urlStore().navigate({ type: 'video' }))
    await waitFor(() =>
      expect(getCurrentCollection()?.query.type).toBe('video'),
    )
    await screen.findByText('Editing 1,050 items')
    expect(
      screen.getByText(
        /Values and permissions are shown for the first 1,000 items/,
      ),
    ).toBeTruthy()
    await screen.findByText(/of them hidden by the filters/)
    const alt = await batchField('alt')
    await waitFor(() => expect(alt.placeholder).toBe('Mixed values'))
    const title = await batchField('title')
    expect(title.placeholder).toBe('Mixed values')
    await user.type(alt, 'Generated{Control>}{Enter}{/Control}')
    await waitFor(() => expect(batchStatus('alt')).toBe('Saved'), {
      timeout: 40_000,
    })
    const sent = batches.flatMap((batch) => ('ids' in batch ? batch.ids : []))
    const images = all.filter((id) =>
      ['image', 'svg'].includes(mock.library.item(id)?.kind ?? ''),
    )
    expect(new Set(sent)).toEqual(new Set(images))
    expect(images.some((id) => all.indexOf(id) >= 1000)).toBe(true)
  }, 60_000)
})
