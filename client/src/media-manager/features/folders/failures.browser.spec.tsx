import { act, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { http } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { coreStore } from '../../core/state'
import { apiError } from '../../mocks/respond'
import { failOnReactWarnings } from '../../test/consoleErrors'
import { mockNetwork } from '../../test/msw'
import { pollRevNow, renderLibrary } from '../../test/renderLibrary'
import * as actions from './actions'
import { MESSAGES } from './actions'
import { setExpanded } from './store'
import { cleanupFolders } from './test/cleanup'
import { startDrag } from './test/dragDriver'

// What happens when folder changes fail or can't run (folders.md §9, §11):
// optimistic changes roll back (tree, counts, the view), a partly done
// move keeps what was done, offline refuses with one sentence, and Undo
// after later changes puts back exactly what that change changed. The
// server failures are MSW handlers in front of the mock library.

failOnReactWarnings()
afterEach(cleanupFolders)

function tree(): HTMLElement {
  return screen.getByRole('tree', { name: 'Folders' })
}

function row(name: string | RegExp): HTMLElement {
  return within(tree()).getByRole('treeitem', { name })
}

function countOf(item: HTMLElement): string {
  return (
    item
      .querySelector('[class*="count"]')
      ?.textContent?.replace(/[^0-9]/g, '') ?? ''
  )
}

/** Toasts (Mantine notifications) whose text contains `text`. */
function toastsWith(text: string): HTMLElement[] {
  return [
    ...document.querySelectorAll<HTMLElement>('.mantine-Notification-root'),
  ].filter((element) => element.textContent?.includes(text))
}

async function expectOneToast(text: string): Promise<HTMLElement> {
  await waitFor(() => expect(toastsWith(text)).toHaveLength(1), {
    timeout: 3000,
  })
  return toastsWith(text)[0] as HTMLElement
}

async function renderColumn(search = '?view=library', scenario = 'normal') {
  const library = await renderLibrary({ search, scenario })
  await screen.findByRole('tree', { name: 'Folders' })
  await waitFor(() =>
    expect(screen.getAllByRole('gridcell')[0]?.getAttribute('draggable')).toBe(
      'true',
    ),
  )
  return library
}

/** The server answers every matching request with this error from now on. */
function failing(
  method: 'post' | 'patch' | 'delete',
  path: string,
  status = 502,
  code = 'wp_error',
  message = 'Boom',
): void {
  mockNetwork.use(
    http[method](`*/api/library/${path}`, () =>
      apiError(status, code, message),
    ),
  )
}

function folderOf(
  library: Awaited<ReturnType<typeof renderLibrary>>,
  id: number,
) {
  return library.mock.library.folderTree().folders.find((f) => f.id === id)
}

describe('optimistic changes roll back when the server refuses', () => {
  it('a rename', async () => {
    const library = await renderColumn()
    failing('patch', 'folders/:id')
    const user = userEvent.setup()
    act(() => row(/^Team/).focus())
    await user.keyboard('r')
    await screen.findByRole('textbox', { name: 'Rename folder Team' })
    await user.keyboard('People{Enter}')
    await expectOneToast('Couldn’t rename the folder: Boom')
    await within(tree()).findByRole('treeitem', { name: /^Team/ })
    expect(
      within(tree()).queryByRole('treeitem', { name: /^People/ }),
    ).toBeNull()
    expect(folderOf(library, 14)?.name).toBe('Team')
  })

  it('a folder move the server refuses as a cycle', async () => {
    const library = await renderColumn()
    failing('patch', 'folders/:id', 409, 'wpu_folder_cycle', 'Cycle')
    const drag = await startDrag(row(/^Team/))
    await drag.over(row(/^Brand/), 'middle')
    await drag.drop()
    await expectOneToast(MESSAGES.cycle)
    await waitFor(() =>
      expect(row(/^Team/).getAttribute('aria-level')).toBe('1'),
    )
    expect(row(/^Brand/).getAttribute('aria-expanded')).toBe('false')
    expect(folderOf(library, 14)?.parent).toBe(0)
  })

  it('a colour (Pro)', async () => {
    await renderColumn('?view=library', 'pro')
    failing('patch', 'folders/:id')
    const user = userEvent.setup()
    await user.pointer({ keys: '[MouseRight]', target: row(/^Brand/) })
    const menu = await screen.findByRole('menu', { name: 'Folder Brand' })
    await user.click(within(menu).getByRole('menuitem', { name: /Colour/ }))
    await user.click(await screen.findByRole('menuitemradio', { name: 'Red' }))
    await expectOneToast('Couldn’t change the colour: Boom')
    const icon = () =>
      row(/^Brand/)
        .querySelector('[class*="icon"] svg')
        ?.getAttribute('style')
    await waitFor(() => expect(icon()).toContain('#7c5cff'))
  })

  it('a create: the pending row goes and nothing is added', async () => {
    const library = await renderColumn()
    failing('post', 'folders')
    const before = library.mock.library.folderTree().folders.length
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'New folder' }))
    await screen.findByRole('textbox', { name: 'New folder name' })
    await user.keyboard('Drafts{Enter}')
    await expectOneToast('Couldn’t create the folder: Boom')
    expect(
      within(tree()).queryByRole('treeitem', { name: /^Drafts/ }),
    ).toBeNull()
    expect(document.querySelector('[data-pending]')).toBeNull()
    expect(library.mock.library.folderTree().folders.length).toBe(before)
  })
})

describe('assigning items', () => {
  it('nothing reached the server: items, counts, selection and focus come back', async () => {
    const library = await renderColumn('?view=library&folder=15')
    await waitFor(() => expect(screen.getAllByRole('gridcell')).toHaveLength(6))
    failing('post', 'folders/assign')
    const user = userEvent.setup()
    const [first] = screen.getAllByRole('gridcell')
    const id = Number(first?.dataset.mmTile)
    await user.click(first as HTMLElement)
    expect(countOf(row(/^Press kit/))).toBe('6')
    await user.keyboard('{Delete}')
    await expectOneToast('Couldn’t move the items: Boom')
    await waitFor(() => expect(screen.getAllByRole('gridcell')).toHaveLength(6))
    // The optimistic count deltas are undone too.
    await waitFor(() => expect(countOf(row(/^Press kit/))).toBe('6'))
    expect(countOf(row(/^Uncategorized/))).toBe('13')
    expect([...coreStore.getState().selection]).toEqual([id])
    expect(coreStore.getState().focus).toBe(id)
    expect(library.mock.library.item(id)?.folder).toBe(15)
  })

  it('partly done: what moved stays, with Undo, and the rest is reported', async () => {
    const library = await renderColumn()
    const [first, second] = screen.getAllByRole('gridcell')
    const firstId = Number(first?.dataset.mmTile)
    const secondId = Number(second?.dataset.mmTile)
    const secondBefore = library.mock.library.item(secondId)?.folder
    // 5000 ids per request (D24): the first chunk goes through, the second
    // fails.
    let calls = 0
    mockNetwork.use(
      http.post('*/api/library/folders/assign', () => {
        calls += 1
        return calls === 1 ? undefined : apiError(502, 'wp_error', 'Boom')
      }),
    )
    const missing = Array.from({ length: 4999 }, (_, index) => 900_000 + index)
    await act(() => actions.moveItemsTo([firstId, ...missing, secondId], 16))
    expect(calls).toBe(2)
    await expectOneToast(
      'Moved 1 item to “Archive” · 4,999 items couldn’t be moved',
    )
    await expectOneToast('Couldn’t move the rest: Boom')
    expect(library.mock.library.item(firstId)?.folder).toBe(16)
    expect(library.mock.library.item(secondId)?.folder).toBe(secondBefore)
    const toast = toastsWith('Moved 1 item to “Archive”')[0] as HTMLElement
    expect(within(toast).getByRole('button', { name: 'Undo' })).toBeTruthy()
  })
})

describe('offline', () => {
  async function goOffline(library: Awaited<ReturnType<typeof renderLibrary>>) {
    library.mock.network = 'offline'
    pollRevNow()
    await waitFor(() =>
      expect(coreStore.getState().connectivity.state).toBe('offline'),
    )
  }

  it('refuses folder changes with one sentence each', async () => {
    const library = await renderColumn('?view=library&folder=15')
    await goOffline(library)
    const user = userEvent.setup()
    act(() => row(/^Team/).focus())
    await user.keyboard('n')
    await expectOneToast(MESSAGES.offline)
    expect(
      screen.queryByRole('textbox', { name: 'New folder name' }),
    ).toBeNull()
    await startDrag(row(/^Archive/))
    await waitFor(() => expect(toastsWith(MESSAGES.offline)).toHaveLength(2))
    expect(document.querySelector('[data-mm-folder-drag-preview]')).toBeNull()
  })

  it('an Undo that can’t run says why once, in words', async () => {
    const library = await renderColumn()
    const [first] = screen.getAllByRole('gridcell')
    const id = Number(first?.dataset.mmTile)
    const drag = await startDrag(first as HTMLElement)
    await drag.over(row(/^Archive/))
    await drag.drop()
    const moved = await expectOneToast('to “Archive”')
    await goOffline(library)
    const user = userEvent.setup()
    await user.click(within(moved).getByRole('button', { name: 'Undo' }))
    // core's toast words it "Couldn't undo: <reason>"
    await expectOneToast(`Couldn't undo: ${MESSAGES.offline}`)
    expect(toastsWith(MESSAGES.offline)).toHaveLength(1)
    expect(library.mock.library.item(id)?.folder).toBe(16)
  })
})

describe('Undo after later changes', () => {
  it('puts items back in the folder they had before that move', async () => {
    const library = await renderColumn()
    const [first] = screen.getAllByRole('gridcell')
    const id = Number(first?.dataset.mmTile)
    const original = library.mock.library.item(id)?.folder
    let drag = await startDrag(first as HTMLElement)
    await drag.over(row(/^Archive/))
    await drag.drop()
    const toArchive = await expectOneToast('to “Archive”')
    drag = await startDrag(
      document.querySelector(`[data-mm-tile="${id}"]`) as HTMLElement,
    )
    await drag.over(row(/^Team/))
    await drag.drop()
    await expectOneToast('to “Team”')
    expect(library.mock.library.item(id)?.folder).toBe(14)
    const user = userEvent.setup()
    await user.click(within(toArchive).getByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(library.mock.library.item(id)?.folder).toBe(original),
    )
  })

  it('moves a folder back to its old parent and position (one PATCH)', async () => {
    const library = await renderColumn()
    let drag = await startDrag(row(/^Team/))
    await drag.over(row(/^Brand/), 'middle')
    await drag.drop()
    const intoBrand = await expectOneToast('Moved “Team” into “Brand”')
    drag = await startDrag(row(/^Archive/))
    await drag.over(row(/^Brand/), 'top')
    await drag.drop()
    await expectOneToast('Moved “Archive”')
    const user = userEvent.setup()
    await user.click(within(intoBrand).getByRole('button', { name: 'Undo' }))
    // Team's old place among the top level, counted without itself (4):
    // the later move of Archive stays.
    await waitFor(() => expect(folderOf(library, 14)?.parent).toBe(0))
    const top = library.mock.library
      .folderTree()
      .folders.filter((folder) => folder.parent === 0)
      .sort((a, b) => a.ord - b.ord)
      .map((folder) => folder.name)
    expect(top).toEqual([
      'Archive',
      'Brand',
      'Blog',
      'Events',
      'Team',
      'Products',
      'Press kit',
    ])
  })

  it('an Undo the tree no longer allows (a cycle) says so in words', async () => {
    const library = await renderColumn()
    act(() => setExpanded(new Set([1])))
    const logos = await within(tree()).findByRole('treeitem', {
      name: /^Logos/,
    })
    // Logos out of Brand to the top level, then Brand into Logos.
    let drag = await startDrag(logos)
    const area = tree()
    const rect = area.getBoundingClientRect()
    await drag.over(area, { x: rect.left + 40, y: rect.bottom - 6 })
    await drag.drop()
    const toTop = await expectOneToast('Moved “Logos” to the top level')
    drag = await startDrag(row(/^Brand/))
    await drag.over(row(/^Logos/), 'middle')
    await drag.drop()
    await expectOneToast('Moved “Brand” into “Logos”')
    const user = userEvent.setup()
    await user.click(within(toTop).getByRole('button', { name: 'Undo' }))
    await expectOneToast(`Couldn't undo: ${MESSAGES.cycle}`)
    expect(folderOf(library, 2)?.parent).toBe(0)
    expect(folderOf(library, 1)?.parent).toBe(2)
  })
})
