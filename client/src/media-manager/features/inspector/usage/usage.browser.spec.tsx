import { act, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type {
  ItemPatch,
  UsageResponse,
} from '../../../../../../shared/library-api'
import { registerCoreCommands } from '../../../app/runtime'
import { coreStore } from '../../../core/state'
import { subscribeAnnouncements } from '../../../core/ui/announce'
import { setToastBackendForTesting, undoLast } from '../../../core/ui/toast'
import { createUrlStore } from '../../../core/url/history'
import { createMemoryHistory } from '../../../core/url/memoryHistory'
import { setUrlStoreForTesting } from '../../../core/url/useUrlState'
import { bootstrapFor, type MockContext } from '../../../mocks/context'
import { failOnReactWarnings } from '../../../test/consoleErrors'
import { startFakeLibrary, stopFakeLibrary } from '../../../test/fakeLibrary'
import { mockNetwork } from '../../../test/msw'
import { renderWithProviders } from '../../../test/renderWithProviders'
import { AttachedToRow, UsagePanel } from './UsagePanel'

// The Usage panel (inspector.md §5, §7) in Chromium over the fake library.
// Items (prototype data): 1003 is Jonas Holm's photo, attached to the page
// "Home" and the featured image of "Five ideas for summer"; 1004 is used in
// that post too; 1000 (Site Admin's) is used nowhere and attached to
// nothing; 1091 is the site logo. The Author scenario's user is Jonas Holm.

registerCoreCommands()
failOnReactWarnings()

let mock: MockContext
let spoken: string[] = []
let unsubscribe: () => void = () => {}

function start(scenario = 'normal'): void {
  mock = startFakeLibrary(scenario)
  act(() => {
    coreStore.getState().setBootstrap(bootstrapFor(mock))
  })
}

function renderPanel(ids: number[], hidden = 0) {
  return renderWithProviders(
    <aside style={{ width: 312 }}>
      <UsagePanel ids={ids} hidden={hidden} />
    </aside>,
  )
}

/** Records the bodies of attach requests; the fake library still answers. */
function recordWrites(): { patches: ItemPatch[]; batches: unknown[] } {
  const writes = { patches: [] as ItemPatch[], batches: [] as unknown[] }
  mockNetwork.use(
    http.patch('*/api/library/items/:id', async ({ request }) => {
      writes.patches.push((await request.clone().json()) as ItemPatch)
      return undefined
    }),
    http.post('*/api/library/items/batch', async ({ request }) => {
      writes.batches.push(await request.clone().json())
      return undefined
    }),
  )
  return writes
}

function attachedPost(id: number): number | null | undefined {
  return mock.library.item(id)?.postParent
}

async function openPicker(name: RegExp | string) {
  const user = userEvent.setup()
  const button = await screen.findByRole('button', { name })
  await user.click(button)
  const search = await screen.findByRole('combobox', {
    name: 'Search posts and pages',
  })
  await waitFor(() => expect(document.activeElement).toBe(search))
  return { user, button, search }
}

beforeEach(() => {
  setUrlStoreForTesting(
    createUrlStore(createMemoryHistory('http://localhost/?view=library')),
  )
  act(() => {
    const state = coreStore.getState()
    state.resetSelection()
    state.setConnectivity('online')
  })
  setToastBackendForTesting({ show: () => {}, hide: () => {} })
  spoken = []
  unsubscribe = subscribeAnnouncements((message) => {
    spoken.push(message)
  })
})

afterEach(() => {
  unsubscribe()
  stopFakeLibrary()
  setUrlStoreForTesting(null)
  setToastBackendForTesting(null)
})

describe('one item', () => {
  it('lists its places with how they use it, links, and the featured-image warning', async () => {
    start()
    renderPanel([1003])
    expect((await screen.findByTestId('usage-file-name')).textContent).toBe(
      'portrait-cornelia-bu-chse-337.jpg',
    )
    // The count shows "Loading…" until the usage request answers.
    await waitFor(() =>
      expect(screen.getByTestId('usage-count').textContent).toBe(
        'Used in 2 places',
      ),
    )
    const list = await screen.findByTestId('usage-list')
    const rows = within(list).getAllByRole('listitem')
    expect(
      rows.map((row) => row.querySelector('span:nth-child(2)')?.textContent),
    ).toEqual([
      'Five ideas for summerPost · Featured image',
      'Conference 2025 recapPost · In content',
    ])
    const title = within(rows[0] as HTMLElement).getByRole('link', {
      name: 'Five ideas for summer',
    })
    expect(title.getAttribute('href')).toBe('https://example.com/?p=206')
    expect(title.getAttribute('target')).toBe('_blank')
    expect(title.getAttribute('rel')).toBe('noopener noreferrer')
    const edit = within(rows[0] as HTMLElement).getByRole('link', {
      name: 'Edit “Five ideas for summer” in WordPress',
    })
    expect(edit.getAttribute('href')).toContain('post.php?post=206')
    expect(edit.getAttribute('rel')).toBe('noopener noreferrer')
    expect(screen.getByTestId('featured-warning').textContent).toBe(
      'Featured image of 1 post. Deleting this file clears it there, and that post shows no image until a new one is set.',
    )
    // Attached to the page "Home": the card, Change… and Detach, the hint.
    expect(
      within(screen.getByTestId('attached-to')).getByRole('link', {
        name: 'Home',
      }),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Change…' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Detach' })).toBeTruthy()
    expect(
      screen.getByText(
        'Attaching links the file to one post (“Uploaded to” in WordPress). It doesn’t insert it anywhere.',
      ),
    ).toBeTruthy()
    expect(screen.getByTestId('usage-footnote').textContent).toBe(
      'Found in post content, blocks and featured images. Uses in theme files, custom CSS or other plugins’ settings aren’t detected.',
    )
  })

  it('shows the dashed empty card and Attach to… for an unused, unattached item', async () => {
    start()
    renderPanel([1000])
    expect((await screen.findByTestId('usage-empty')).textContent).toBe(
      'No post or page uses this file.',
    )
    expect(screen.getByTestId('usage-count').textContent).toBe(
      'Not used anywhere',
    )
    expect(screen.queryByTestId('featured-warning')).toBeNull()
    expect((await screen.findByTestId('attached-to')).textContent).toBe(
      'Not attached',
    )
    expect(screen.getByRole('button', { name: 'Attach to…' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Detach' })).toBeNull()
  })

  it('shows site-level places, and the Visual Portfolio placeholder without a view link', async () => {
    start()
    const placeholder: UsageResponse = {
      rev: mock.library.rev,
      complete: true,
      items: [
        {
          id: 1000,
          count: 1,
          refs: [
            {
              postId: null,
              postType: 'site',
              postTypeLabel: 'Site',
              title: 'Visual Portfolio placeholder image',
              status: 'publish',
              editUrl: null,
              viewUrl: null,
              contexts: ['visual-portfolio'],
            },
          ],
        },
      ],
    }
    mockNetwork.use(
      http.get('*/api/library/usage', ({ request }) =>
        new URL(request.url).searchParams.get('ids') === '1000'
          ? HttpResponse.json(placeholder)
          : undefined,
      ),
    )
    const first = renderPanel([1091])
    const logo = (await screen.findAllByTestId('usage-row'))[0] as HTMLElement
    expect(within(logo).getByRole('link', { name: 'Site logo' })).toBeTruthy()
    expect(logo.textContent).toContain('Site · Site logo')
    expect(screen.getByTestId('usage-count').textContent).toBe(
      'Used in 4 places',
    )
    first.unmount()

    renderPanel([1000])
    const row = (await screen.findAllByTestId('usage-row'))[0] as HTMLElement
    expect(row.textContent).toBe(
      'Visual Portfolio placeholder imageSite · Visual Portfolio',
    )
    expect(within(row).queryByRole('link')).toBeNull()
  })

  it('attaches through the picker with the keyboard, then Undo puts it back', async () => {
    start()
    const writes = recordWrites()
    renderPanel([1000])
    const { user, button, search } = await openPicker('Attach to…')
    const picker = screen.getByTestId('post-picker')
    expect(picker.hasAttribute('data-mm-local-keys')).toBe(true)
    expect(picker.getAttribute('role')).toBe('dialog')
    // Empty search: the most recent published posts.
    expect(
      (await screen.findAllByRole('option')).map(
        (option) => option.querySelector('span span')?.textContent,
      )[0],
    ).toBe('Product launch: Outdoor line')
    await user.type(search, 'o')
    await waitFor(() =>
      expect(screen.queryByRole('option', { name: /Press/ })).toBeNull(),
    )
    const options = screen.getAllByRole('option')
    expect(options[0]?.getAttribute('aria-selected')).toBe('true')
    expect(options[0]?.textContent).toBe(
      'Product launch: Outdoor linePost · Published',
    )
    await user.keyboard('{ArrowDown}')
    const second = screen.getAllByRole('option')[1] as HTMLElement
    expect(second.getAttribute('aria-selected')).toBe('true')
    expect(search.getAttribute('aria-activedescendant')).toBe(second.id)
    await user.keyboard('{Enter}')

    await waitFor(() => expect(attachedPost(1000)).toBe(206))
    expect(writes.patches).toEqual([{ post: 206 }])
    await waitFor(() => expect(screen.queryByTestId('post-picker')).toBeNull())
    expect(document.activeElement).toBe(button)
    expect(
      await within(screen.getByTestId('attached-to')).findByRole('link', {
        name: 'Five ideas for summer',
      }),
    ).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Change…' })).toBe(button)
    expect(spoken).toContain(
      'Attached to “Five ideas for summer”. Undo available.',
    )

    await act(async () => {
      await undoLast()
    })
    await waitFor(() => expect(attachedPost(1000)).toBeNull())
    expect(writes.patches).toEqual([{ post: 206 }, { post: null }])
    expect((await screen.findByTestId('attached-to')).textContent).toBe(
      'Not attached',
    )
  })

  it('says when no published post matches', async () => {
    start()
    renderPanel([1000])
    const { user, search } = await openPicker('Attach to…')
    await user.type(search, 'newsletter (draft)')
    expect(await screen.findByText('No published post matches')).toBeTruthy()
    expect(search.getAttribute('aria-expanded')).toBe('false')
  })

  it('closes the picker on Esc and returns focus to its button', async () => {
    start()
    const writes = recordWrites()
    renderPanel([1003])
    const { user, button } = await openPicker('Change…')
    expect(button.getAttribute('aria-expanded')).toBe('true')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('post-picker')).toBeNull())
    expect(document.activeElement).toBe(button)
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(writes.patches).toEqual([])
  })

  it('detaches, moves focus to the picker button, and Undo re-attaches', async () => {
    start()
    const writes = recordWrites()
    const user = userEvent.setup()
    renderPanel([1003])
    await user.click(await screen.findByRole('button', { name: 'Detach' }))
    await waitFor(() => expect(attachedPost(1003)).toBeNull())
    expect(writes.patches).toEqual([{ post: null }])
    expect((await screen.findByTestId('attached-to')).textContent).toBe(
      'Not attached',
    )
    const attach = await screen.findByRole('button', { name: 'Attach to…' })
    await waitFor(() => expect(document.activeElement).toBe(attach))
    expect(spoken).toContain('Detached from “Home”. Undo available.')

    await act(async () => {
      await undoLast()
    })
    await waitFor(() => expect(attachedPost(1003)).toBe(204))
    expect(writes.patches).toEqual([{ post: null }, { post: 204 }])
    expect(
      await within(screen.getByTestId('attached-to')).findByRole('link', {
        name: 'Home',
      }),
    ).toBeTruthy()
  })

  it('shows an error toast with the server message when attaching fails', async () => {
    start()
    mockNetwork.use(
      http.patch('*/api/library/items/:id', () =>
        HttpResponse.json(
          { code: 'wpu_post_not_found', message: 'Post 206 does not exist.' },
          { status: 404 },
        ),
      ),
    )
    renderPanel([1000])
    const { user, search } = await openPicker('Attach to…')
    await user.type(search, 'summer')
    await screen.findByRole('option', { name: /Five ideas for summer/ })
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1))
    await user.keyboard('{Enter}')
    await waitFor(() =>
      expect(spoken).toContain(
        'Couldn’t attach “still-life-joshua-earle-548” to “Five ideas for summer”: Post 206 does not exist',
      ),
    )
    expect((await screen.findByTestId('attached-to')).textContent).toBe(
      'Not attached',
    )
  })

  it('loads with an error state and Retry refetches', async () => {
    start()
    let failures = 1
    mockNetwork.use(
      http.get('*/api/library/usage', () => {
        if (failures > 0) {
          failures -= 1
          return HttpResponse.json(
            { code: 'internal_error', message: 'Something went wrong.' },
            { status: 500 },
          )
        }
        return undefined
      }),
    )
    const user = userEvent.setup()
    renderPanel([1003])
    const error = await screen.findByTestId('usage-error')
    expect(error.textContent).toContain(
      'Couldn’t load where this file is used: Something went wrong.',
    )
    await user.click(within(error).getByRole('button', { name: 'Retry' }))
    expect(await screen.findByTestId('usage-list')).toBeTruthy()
  })
})

describe('several items', () => {
  it('groups places with selected-item counts and attaches all of them, with Undo', async () => {
    start()
    const writes = recordWrites()
    renderPanel([1003, 1004, 1000], 1)
    await waitFor(() =>
      expect(screen.getByTestId('usage-count').textContent).toBe(
        'Used in 2 posts · 1 not used anywhere',
      ),
    )
    expect(screen.getByText('3 items selected')).toBeTruthy()
    expect(screen.getByText('1 of them hidden by the filters')).toBeTruthy()
    const rows = within(screen.getByTestId('usage-list')).getAllByRole(
      'listitem',
    )
    expect(rows.map((row) => row.textContent)).toEqual([
      'Five ideas for summerPost · Featured image, In content · 2 selected items',
      'Conference 2025 recapPost · In content · 1 selected item',
    ])
    expect((await screen.findByTestId('attached-count')).textContent).toBe(
      '1 of 3 attached',
    )
    expect(screen.getByRole('button', { name: 'Detach all' })).toBeTruthy()

    const { user, search } = await openPicker('Attach 3 to…')
    await user.type(search, 'press')
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1))
    await user.keyboard('{Enter}')
    await waitFor(() =>
      expect([1003, 1004, 1000].map(attachedPost)).toEqual([207, 207, 207]),
    )
    expect(writes.batches).toEqual([
      { ids: [1003, 1004, 1000], set: { post: 207 } },
    ])
    expect(await screen.findByText('3 of 3 attached')).toBeTruthy()
    expect(spoken).toContain('Attached 3 items to “Press”. Undo available.')

    await act(async () => {
      await undoLast()
    })
    await waitFor(() =>
      expect([1003, 1004, 1000].map(attachedPost)).toEqual([204, null, null]),
    )
    expect(writes.batches[1]).toEqual({
      items: [
        { id: 1003, set: { post: 204 } },
        { id: 1004, set: { post: null } },
        { id: 1000, set: { post: null } },
      ],
    })
    expect(await screen.findByText('1 of 3 attached')).toBeTruthy()
  })

  it('detaches all attached items', async () => {
    start()
    const writes = recordWrites()
    const user = userEvent.setup()
    renderPanel([1003, 1004])
    await user.click(await screen.findByRole('button', { name: 'Detach all' }))
    await waitFor(() => expect(attachedPost(1003)).toBeNull())
    expect(writes.batches).toEqual([{ ids: [1003], set: { post: null } }])
    expect(await screen.findByText('0 of 2 attached')).toBeTruthy()
    expect(spoken).toContain('Detached 1 item. Undo available.')
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole('button', { name: 'Attach 2 to…' }),
      ),
    )
  })

  it('says when a large selection is capped', async () => {
    start()
    const ids = Array.from({ length: 501 }, (_, index) => 100_000 + index)
    ids[0] = 1003
    renderPanel(ids)
    expect((await screen.findByTestId('usage-capped')).textContent).toContain(
      'Usage of the first 500 selected items.',
    )
    expect(screen.getByText('501 items selected')).toBeTruthy()
  })
})

describe('permissions and states', () => {
  it('is read-only on an item the Author may not edit', async () => {
    start('author')
    renderPanel([1000])
    expect((await screen.findByTestId('usage-lock-notice')).textContent).toBe(
      'You can view but not edit media uploaded by others (Author role).',
    )
    expect(await screen.findByTestId('attached-to')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Attach/ })).toBeNull()
  })

  it('acts on the Author’s own items in a mixed selection, and says so', async () => {
    start('author')
    const writes = recordWrites()
    renderPanel([1001, 1003, 1000])
    expect((await screen.findByTestId('usage-mixed')).textContent).toBe(
      'Changes apply to the 2 items you uploaded. 1 uploaded by others stays as it is.',
    )
    const { user, search } = await openPicker('Attach 2 to…')
    await user.type(search, 'press')
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1))
    await user.keyboard('{Enter}')
    await waitFor(() => expect(attachedPost(1003)).toBe(207))
    expect(writes.batches).toEqual([{ ids: [1001, 1003], set: { post: 207 } }])
    expect(attachedPost(1000)).toBeNull()
  })

  it('disables the controls with the reason when offline', async () => {
    start()
    renderPanel([1003])
    const change = await screen.findByRole('button', { name: 'Change…' })
    act(() => {
      coreStore.getState().setConnectivity('offline')
    })
    await waitFor(() =>
      expect((change as HTMLButtonElement).disabled).toBe(true),
    )
    expect(change.getAttribute('title')).toBe(
      'WordPress is unreachable right now',
    )
    expect(screen.getByText('WordPress is unreachable right now.')).toBeTruthy()
  })

  it('says the usage may be incomplete while the index is building', async () => {
    start('indexing')
    const first = renderPanel([1003])
    expect((await screen.findByTestId('usage-incomplete')).textContent).toBe(
      'The usage index is still being built, so this may be incomplete.',
    )
    first.unmount()
    renderPanel([])
    expect((await screen.findByTestId('usage-incomplete')).textContent).toBe(
      'The usage index is still being built, so these counts may be incomplete.',
    )
  })

  it('counts used and unused items in the view when nothing is selected', async () => {
    start()
    renderPanel([])
    const stats = await screen.findByTestId('usage-stats')
    const values = [...stats.querySelectorAll('dd')].map((value) =>
      Number(value.textContent),
    )
    expect(values).toHaveLength(2)
    expect((values[0] ?? 0) + (values[1] ?? 0)).toBe(93)
    expect(values[0]).toBeGreaterThan(0)
    expect(await screen.findByText('93 items in view')).toBeTruthy()
    expect(screen.queryByTestId('usage-incomplete')).toBeNull()
  })
})

describe('AttachedToRow', () => {
  it('shows the post with Detach, or Not attached with Attach…', async () => {
    start()
    const user = userEvent.setup()
    const item = mock.library.items([1003], 'full').items[0]
    if (!item) {
      throw new Error('no item')
    }
    renderWithProviders(<AttachedToRow item={item} />)
    const row = screen.getByTestId('attached-to-row')
    expect(row.textContent).toBe('HomeDetach')
    expect(within(row).getByRole('link', { name: 'Home' })).toBeTruthy()
    await user.click(within(row).getByRole('button', { name: 'Detach' }))
    await waitFor(() => expect(attachedPost(1003)).toBeNull())

    const unattached = mock.library.items([1000], 'full').items[0]
    if (!unattached) {
      throw new Error('no item')
    }
    renderWithProviders(<AttachedToRow item={unattached} />)
    const rows = screen.getAllByTestId('attached-to-row')
    expect(rows[1]?.textContent).toBe('Not attachedAttach…')
  })
})
