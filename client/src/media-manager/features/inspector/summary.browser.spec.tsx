import { act, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { http } from 'msw'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest'
import type { CollectionQuery } from '../../../../../shared/library-api'
import { registerCoreCommands } from '../../app/runtime'
import {
  getCurrentCollection,
  useTrackCurrentCollection,
} from '../../core/collection/hooks'
import { runCommand } from '../../core/commands/registry'
import { coreStore } from '../../core/state'
import { createUrlStore } from '../../core/url/history'
import { createMemoryHistory } from '../../core/url/memoryHistory'
import { setUrlStoreForTesting, urlStore } from '../../core/url/useUrlState'
import { bootstrapFor, type MockContext } from '../../mocks/context'
import { failOnReactWarnings } from '../../test/consoleErrors'
import { startFakeLibrary, stopFakeLibrary } from '../../test/fakeLibrary'
import { mockNetwork } from '../../test/msw'
import { renderWithProviders } from '../../test/renderWithProviders'
import { completionMessage } from './altPass'
import { bridgeStore } from './bridge'
import { formatBytes } from './format'
import {
  InspectorPanel,
  register,
  registerEditPanel,
  setEditUnsaved,
} from './index'
import { inspectorStore } from './store'

// Wave A of the inspector in Chromium, over the fake library (93 items):
// the summary with nothing selected, the rail's badges and `E`, the Edit
// tab's stub, and one item's Caption and Description. 1001 is an image
// without alt text, caption or description; 1084 is used in posts; 1086 is
// a video.

failOnReactWarnings()
registerCoreCommands()
register()

// As in detail.browser.spec.tsx: Vitest's iframe crashes on a view
// transition (the preview's Open); the update runs the same way without it.
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

let mock: MockContext

const ALL: CollectionQuery = {
  folder: 'all',
  q: null,
  type: null,
  alt: null,
  size: null,
  orient: null,
  month: null,
  sort: 'date-desc',
}

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

/** The value shown above a summary stat's label. */
function statValue(label: string): string {
  const value = within(panel()).getByText(label).previousElementSibling
  return value?.textContent ?? ''
}

function fieldStatus(field: string): string {
  return (
    screen
      .getByTestId(`field-${field}`)
      .querySelector('[data-status]')
      ?.textContent?.trim() ?? ''
  )
}

async function field(label: string): Promise<HTMLTextAreaElement> {
  return (await within(panel()).findByLabelText(label)) as HTMLTextAreaElement
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
  inspectorStore.setState({ fields: {}, mounted: {}, progress: {} })
  bridgeStore.setState({
    focusRequest: null,
    shown: null,
    editUnsaved: false,
    editPanel: null,
  })
})

describe('the summary (nothing selected)', () => {
  it('names the folder and shows the facets’ stats, coverage and types', async () => {
    start()
    renderInspector()
    const facets = mock.library.facets(ALL)
    expect(
      await screen.findByRole('heading', { name: 'All files' }),
    ).toBeTruthy()
    expect(
      await screen.findByText('Nothing selected · 93 items in view'),
    ).toBeTruthy()
    await waitFor(() => expect(statValue('items')).toBe('93'))
    expect(statValue('total size')).toBe(formatBytes(facets.view.bytes))
    expect(statValue('missing alt text')).toBe(String(facets.view.missingAlt))
    expect(statValue('not used anywhere')).toBe(String(facets.view.unused))

    // Coverage of the folder's images.
    const images = facets.folder.types.image
    const withAlt = images - facets.folder.missingAlt
    const percent = Math.floor((withAlt / images) * 100)
    const coverage = screen.getByRole('region', { name: 'Alt text coverage' })
    expect(
      within(coverage)
        .getByText(/have alt text$/)
        .textContent?.trim(),
    ).toBe(`${withAlt} of ${images} images in All files have alt text`)
    expect(within(coverage).getByText(`${percent}%`)).toBeTruthy()
    const meter = within(coverage).getByRole('meter', {
      name: 'Alt text coverage in All files',
    }) as HTMLMeterElement
    expect(meter.value).toBe(percent)
    expect(
      within(coverage).getByRole('button', { name: 'Start alt-text pass' }),
    ).toBeTruthy()

    // The type breakdown of the view.
    const types = screen.getByRole('region', { name: 'In this view' })
    const rows = [
      ['Images', facets.view.types.image],
      ['Videos', facets.view.types.video],
      ['Audio', facets.view.types.audio],
      ['Documents', facets.view.types.document],
    ] as const
    for (const [label, count] of rows) {
      expect(
        within(types).getByText(label).nextElementSibling?.textContent,
      ).toBe(String(count))
    }
    // An editor may edit everything: no "You can edit" line.
    expect(screen.queryByText(/^You can edit/)).toBeNull()
  })

  it('turns on the Missing alt filter from the stat', async () => {
    const user = userEvent.setup()
    start()
    renderInspector()
    const missing = mock.library.facets(ALL).view.missingAlt
    const button = await screen.findByRole('button', {
      name: new RegExp(`^${missing}\\s*missing alt text$`),
    })
    await user.click(button)
    expect(urlStore().get().alt).toBe('missing')
    // The view is the filtered one now; the stat no longer turns it on.
    await waitFor(() =>
      expect(
        screen.getByText(`Nothing selected · ${missing} items in view`),
      ).toBeTruthy(),
    )
    expect(
      (
        screen.getByRole('button', {
          name: new RegExp(`^${missing}\\s*missing alt text$`),
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
  })

  it('tells an Author how many items they can edit', async () => {
    start('author')
    renderInspector()
    const { view } = mock.library.facets(ALL)
    expect(view.editable).toBeLessThan(view.total)
    expect(
      await screen.findByText(
        `You can edit ${view.editable} of ${view.total} items here — the ones you uploaded.`,
      ),
    ).toBeTruthy()
  })
})

describe('the rail', () => {
  it('warns on Info while the one image lacks alt text', async () => {
    start()
    select(1001)
    renderInspector()
    expect(
      await screen.findByRole('button', { name: 'Info (alt text missing)' }),
    ).toBeTruthy()
    select(1000)
    expect(await screen.findByRole('button', { name: 'Info' })).toBeTruthy()
  })

  it('counts the places that use the item on Usage', async () => {
    start()
    const places = mock.library.item(1084)?.usage.length ?? 0
    expect(places).toBeGreaterThan(1)
    select(1084)
    renderInspector()
    const usage = await screen.findByRole('button', {
      name: `Usage (used in ${places} places)`,
    })
    // Drawn by CSS from data-count, so it isn't part of the visible label.
    expect(
      usage.querySelector('[data-count]')?.getAttribute('data-count'),
    ).toBe(String(places))
    // An unused item has no count.
    select(1085)
    expect(await screen.findByRole('button', { name: 'Usage' })).toBeTruthy()
  })

  it('marks Edit while the editor has unsaved edits, and the header says so', async () => {
    start()
    select(1001)
    renderInspector()
    await screen.findByRole('button', { name: 'Edit image' })
    act(() => setEditUnsaved(true))
    const edit = await screen.findByRole('button', {
      name: 'Edit image (unsaved edits)',
    })
    // Info has no unsaved text, so its header doesn't say it.
    expect(within(panel()).queryByText('Unsaved changes')).toBeNull()
    act(() => {
      coreStore.getState().selectInspectorTab('edit')
    })
    expect(await within(panel()).findByText('Unsaved changes')).toBeTruthy()
    act(() => setEditUnsaved(false))
    await waitFor(() =>
      expect(edit.getAttribute('aria-label')).toBe('Edit image'),
    )
    expect(within(panel()).queryByText('Unsaved changes')).toBeNull()
  })

  it('`E` opens the Edit tab, and again collapses the inspector', async () => {
    start()
    renderInspector()
    await screen.findByText('Nothing selected · 93 items in view')
    act(() => {
      expect(runCommand('inspector.edit-image')).toBe(true)
    })
    expect(
      await within(panel()).findByRole('heading', { name: 'Edit image' }),
    ).toBeTruthy()
    expect(
      screen
        .getByRole('button', { name: 'Edit image' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    act(() => {
      runCommand('inspector.edit-image')
    })
    await waitFor(() =>
      expect(screen.queryByTestId('inspector-panel')).toBeNull(),
    )
    act(() => {
      runCommand('inspector.edit-image')
    })
    expect(
      await within(panel()).findByRole('heading', { name: 'Edit image' }),
    ).toBeTruthy()
  })
})

describe('the Edit tab’s stub', () => {
  function showEditTab(): void {
    act(() => {
      coreStore
        .getState()
        .setPanels({ inspectorOpen: true, inspectorTab: 'edit' })
    })
  }

  it('edits one image at a time, and offers the first of several', async () => {
    const user = userEvent.setup()
    start()
    showEditTab()
    select(1000, 1001)
    renderInspector()
    expect(
      await screen.findByText(
        'Crop, rotate and flip work on one image at a time.',
      ),
    ).toBeTruthy()
    // Collection order (newest first): 1001 before 1000.
    await user.click(
      await screen.findByRole('button', {
        name: 'Edit “detail-oisin-conolly-330”',
      }),
    )
    expect([...coreStore.getState().selection]).toEqual([1001])
    expect(
      await screen.findByText(
        'Cropping, rotating, flipping and scaling arrive with the image editor.',
      ),
    ).toBeTruthy()
  })

  it('explains that a video has nothing to crop', async () => {
    start()
    showEditTab()
    select(1086)
    renderInspector()
    expect(
      await screen.findByText(
        'Crop, rotate and flip are for images (JPEG, PNG, WebP, AVIF).',
      ),
    ).toBeTruthy()
  })

  it('gives way to the panel the editor registers', async () => {
    start()
    showEditTab()
    select(1001)
    renderInspector()
    await screen.findByText(
      'Cropping, rotating, flipping and scaling arrive with the image editor.',
    )
    let unregister = () => {}
    act(() => {
      unregister = registerEditPanel(({ ids }) => (
        <p>Editor for {ids.join(', ')}</p>
      ))
    })
    expect(await screen.findByText('Editor for 1001')).toBeTruthy()
    act(() => unregister())
    expect(
      await screen.findByText(
        'Cropping, rotating, flipping and scaling arrive with the image editor.',
      ),
    ).toBeTruthy()
  })
})

describe('one item’s Caption and Description', () => {
  it('autosave on blur', async () => {
    const user = userEvent.setup()
    start()
    select(1001)
    renderInspector()
    const caption = await field('Caption')
    await user.type(caption, 'Photo: someone')
    expect(fieldStatus('caption')).toBe('Unsaved')
    act(() => caption.blur())
    await waitFor(() =>
      expect(mock.library.item(1001)?.caption).toBe('Photo: someone'),
    )
    await waitFor(() => expect(fieldStatus('caption')).toBe('Saved'))

    const description = await field('Description')
    await user.type(description, 'A longer text')
    act(() => description.blur())
    await waitFor(() =>
      expect(mock.library.item(1001)?.description).toBe('A longer text'),
    )
    expect(caption.value).toBe('Photo: someone')
  })

  it('take Enter as a line break, and commit on Ctrl+Enter, keeping focus', async () => {
    const user = userEvent.setup()
    start()
    const patches = countPatches()
    select(1001)
    renderInspector()
    const caption = await field('Caption')
    await user.type(caption, 'Line one{Enter}Line two')
    expect(caption.value).toBe('Line one\nLine two')
    expect(fieldStatus('caption')).toBe('Unsaved')
    expect(patches.count).toBe(0)
    // The selection stayed: Enter isn't Save & next here.
    expect([...coreStore.getState().selection]).toEqual([1001])

    await user.keyboard('{Control>}{Enter}{/Control}')
    await waitFor(() =>
      expect(mock.library.item(1001)?.caption).toBe('Line one\nLine two'),
    )
    expect(caption.value).toBe('Line one\nLine two')
    expect(document.activeElement).toBe(caption)
    expect(patches.count).toBe(1)

    const description = await field('Description')
    await user.type(description, 'First{Enter}{Enter}Second')
    expect(description.value).toBe('First\n\nSecond')
    await user.keyboard('{Control>}{Enter}{/Control}')
    await waitFor(() =>
      expect(mock.library.item(1001)?.description).toBe('First\n\nSecond'),
    )
    expect(document.activeElement).toBe(description)
  })
})

describe('the header’s "Unsaved changes"', () => {
  it('counts typing done while a save runs', async () => {
    const user = userEvent.setup()
    start('normal', 500)
    select(1001)
    renderInspector()
    const title = (await within(panel()).findByLabelText(
      'Title',
    )) as HTMLInputElement
    await user.type(title, ' two{Control>}{Enter}{/Control}')
    await waitFor(() => expect(fieldStatus('title')).toBe('Saving…'))
    // The save holds everything typed so far.
    expect(within(panel()).queryByText('Unsaved changes')).toBeNull()

    await user.type(title, ' more')
    expect(fieldStatus('title')).toBe('Saving…')
    expect(within(panel()).getByText('Unsaved changes')).toBeTruthy()

    // The save settles with older text: the rest is still unsaved.
    await waitFor(() => expect(fieldStatus('title')).toBe('Unsaved'))
    expect(mock.library.item(1001)?.title).toBe('detail-oisin-conolly-330 two')
    expect(within(panel()).getByText('Unsaved changes')).toBeTruthy()
  })
})

describe('one item’s preview and alt-text strip', () => {
  it('opens the item from the preview, and marks an image edited in place', async () => {
    const user = userEvent.setup()
    start()
    const item = mock.library.item(1001)
    if (!item) throw new Error('no item 1001')
    item.edited = true
    select(1001)
    renderInspector()
    const preview = await screen.findByTestId('preview')
    expect(await within(preview).findByText('Edited')).toBeTruthy()
    await user.click(within(preview).getByRole('button', { name: 'Open' }))
    await waitFor(() => expect(urlStore().get().item).toBe(1001))
    // Detail mode: the stage shows the image, so the preview goes.
    await waitFor(() => expect(screen.queryByTestId('preview')).toBeNull())
  })

  it('shows what is missing in the folder and the position under an empty alt field', async () => {
    start()
    select(1001)
    renderInspector()
    const strip = await screen.findByTestId('alt-pass-strip')
    const { folder } = mock.library.facets(ALL)
    await waitFor(() =>
      expect(strip.firstElementChild?.firstElementChild?.textContent).toBe(
        `${folder.missingAlt} missing in All files`,
      ),
    )
    // 1001 is the second oldest of 93.
    expect(within(strip).getByText('92 / 93')).toBeTruthy()
    // The keys show while the field is focused.
    expect(within(strip).queryByText('save & next')).toBeNull()
    act(() => {
      ;(screen.getByLabelText('Alt text') as HTMLTextAreaElement).focus()
    })
    expect(await within(strip).findByText('save & next')).toBeTruthy()
  })

  it('has no strip under alt text that is there, unless focused', async () => {
    start()
    select(1000)
    renderInspector()
    const alt = await field('Alt text')
    await waitFor(() => expect(alt.value).not.toBe(''))
    expect(screen.queryByTestId('alt-pass-strip')).toBeNull()
    act(() => alt.focus())
    expect(await screen.findByTestId('alt-pass-strip')).toBeTruthy()
  })
})

describe('review fixes', () => {
  it('offers the first image of several, not the first item (11)', async () => {
    const user = userEvent.setup()
    start()
    act(() => {
      coreStore
        .getState()
        .setPanels({ inspectorOpen: true, inspectorTab: 'edit' })
    })
    renderInspector()
    await waitFor(() => expect(getCurrentCollection()?.total).toBe(93))
    const order = getCurrentCollection()?.ids ?? []
    const kinds = (id: number) => mock.library.item(id)?.kind
    const video = order.find((id) => kinds(id) === 'video') as number
    const image = order
      .slice(order.indexOf(video))
      .find((id) => kinds(id) === 'image') as number
    select(video, image)
    const title = mock.library.item(image)?.title
    await user.click(
      await screen.findByRole('button', { name: `Edit “${title}”` }),
    )
    expect([...coreStore.getState().selection]).toEqual([image])
  })

  it('opens Attach… from the File section, unclipped, with one label (2, 4)', async () => {
    const user = userEvent.setup()
    start()
    select(1000)
    renderInspector()
    const row = await screen.findByTestId('row-attached')
    expect(row.textContent).toBe('Not attachedAttach…')
    expect(
      within(panel()).getAllByText('Attached to', { exact: true }),
    ).toHaveLength(1)
    await user.click(within(row).getByRole('button', { name: 'Attach…' }))
    const listbox = await screen.findByRole('listbox')
    await within(listbox).findAllByRole('option')
    // Visible: inside the window, and what is painted at its centre is it.
    const rect = listbox.getBoundingClientRect()
    expect(rect.width).toBeGreaterThan(200)
    expect(rect.right).toBeLessThanOrEqual(window.innerWidth)
    const hit = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + Math.min(rect.height / 2, 20),
    )
    expect(hit && listbox.contains(hit)).toBe(true)

    // Pick the first post: the row now shows Detach, and focus is on it.
    await user.keyboard('{ArrowDown}{Enter}')
    const detach = await within(row).findByRole('button', { name: 'Detach' })
    await waitFor(() => expect(document.activeElement).toBe(detach))
  })

  it('closes the picker on Esc from the dialog, and keeps focus inside on a press (5)', async () => {
    const user = userEvent.setup()
    start()
    select(1000)
    renderInspector()
    const row = await screen.findByTestId('row-attached')
    const button = within(row).getByRole('button', { name: 'Attach…' })
    await user.click(button)
    const dialog = await screen.findByRole('dialog', {
      name: 'Attach to a post or page',
    })
    const search = within(dialog).getByRole('combobox')
    await waitFor(() => expect(document.activeElement).toBe(search))
    // A press on the dialog's padding keeps focus in the search field.
    await user.pointer({ keys: '[MouseLeft]', target: dialog })
    expect(document.activeElement).toBe(search)
    // Esc with focus on the dialog itself closes it, focus back on Attach….
    act(() => {
      dialog.tabIndex = -1
      dialog.focus()
    })
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: 'Attach to a post or page' }),
      ).toBeNull(),
    )
    expect(document.activeElement).toBe(button)
  })
})

describe('the alt pass completion toast (8)', () => {
  it('names the folder only when the folder is done', () => {
    expect(completionMessage('Blog / 2025', 0)).toBe(
      'Every image in Blog / 2025 now has alt text — showing all files again',
    )
    expect(completionMessage('All files', 3)).toBe(
      'Every image in this view now has alt text — the Missing alt filter is off',
    )
    expect(completionMessage('All files', null)).toBe(
      'Every image in this view now has alt text — the Missing alt filter is off',
    )
  })
})
