import { act, screen, waitFor, within } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { http } from 'msw'
import { afterEach, describe, expect, it } from 'vitest'
import { failOnReactWarnings } from '../../test/consoleErrors'
import { mockNetwork } from '../../test/msw'
import { renderLibrary } from '../../test/renderLibrary'
import { setExpanded } from './store'
import { cleanupFolders } from './test/cleanup'
import { frames, startDrag } from './test/dragDriver'

// Drag and drop onto the folder tree (folders.md §6), through the real app
// and the mock library, driven with synthetic native drag events (spike
// C3's driver): media tiles onto folders (with the selection, the preview,
// dimming and Undo), and folders nested, reordered, refused (cycle) and
// moved to the top level, with auto-expand.

failOnReactWarnings()
afterEach(cleanupFolders)

function tree(): HTMLElement {
  return screen.getByRole('tree', { name: 'Folders' })
}

function row(name: string | RegExp): HTMLElement {
  return within(tree()).getByRole('treeitem', { name })
}

function tiles(): HTMLElement[] {
  return screen.getAllByRole('gridcell')
}

function mediaPreview(): string {
  return document.querySelector('[data-mm-drag-preview]')?.textContent ?? ''
}

function folderPreview(): HTMLElement | null {
  return document.querySelector('[data-mm-folder-drag-preview]')
}

async function expectToast(text: string | RegExp): Promise<void> {
  expect(
    await screen.findAllByText(text, {}, { timeout: 3000 }),
  ).not.toHaveLength(0)
}

async function renderColumn(search = '?view=library', scenario = 'normal') {
  const library = await renderLibrary({ search, scenario })
  await screen.findByRole('tree', { name: 'Folders' })
  // The tiles become drag sources on the next frame.
  await waitFor(() =>
    expect(tiles()[0]?.getAttribute('draggable')).toBe('true'),
  )
  return library
}

describe('drag sources', () => {
  it('stay selectable as far as CSS goes (iPad: draggables are user-select: none by default)', async () => {
    await renderColumn()
    for (const element of [tiles()[0] as HTMLElement, row(/^Brand/)]) {
      expect(element.getAttribute('draggable')).toBe('true')
      const style = getComputedStyle(element)
      expect(style.userSelect).not.toBe('none')
      expect(style.getPropertyValue('-webkit-user-select')).not.toBe('none')
    }
  })
})

describe('media onto a folder', () => {
  it('moves an unselected tile alone, with a live preview and Undo', async () => {
    const library = await renderColumn()
    const user = userEvent.setup()
    const [first, second] = tiles()
    await user.click(first as HTMLElement)
    const id = Number(second?.dataset.mmTile)
    const before = library.mock.library.item(id)?.folder
    const drag = await startDrag(second as HTMLElement)
    expect(mediaPreview()).toContain('Move 1 item')
    // The dragged tile dims; the selected one isn't carried.
    expect(second?.hasAttribute('data-mm-drag-source')).toBe(true)
    expect(first?.hasAttribute('data-mm-drag-source')).toBe(false)
    await drag.over(row(/^Press kit/))
    expect(mediaPreview()).toContain('to “Press kit”')
    expect(row(/^Press kit/).getAttribute('data-drop')).toBe('combine')
    await drag.drop()
    await expectToast('Moved 1 item to “Press kit”')
    expect(library.mock.library.item(id)?.folder).toBe(15)
    expect(second?.hasAttribute('data-mm-drag-source')).toBe(false)
    expect(mediaPreview()).toBe('')
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() =>
      expect(library.mock.library.item(id)?.folder).toBe(before),
    )
  })

  it('carries the whole selection in collection order from a selected tile', async () => {
    // In Press kit (15), so both items really move to Uncategorized.
    const library = await renderColumn('?view=library&folder=15')
    await waitFor(() => expect(tiles()).toHaveLength(6))
    const sent: number[][] = []
    mockNetwork.use(
      http.post('*/api/library/folders/assign', async ({ request }) => {
        const body = (await request.clone().json()) as { ids: number[] }
        sent.push(body.ids)
        return undefined
      }),
    )
    const user = userEvent.setup()
    const all = tiles()
    const a = all[0] as HTMLElement
    const b = all[2] as HTMLElement
    const aId = Number(a.dataset.mmTile)
    const bId = Number(b.dataset.mmTile)
    // Selected later-first; the drag still lists them in collection order.
    await user.click(b)
    await user.keyboard('{Control>}')
    await user.click(a)
    await user.keyboard('{/Control}')
    const drag = await startDrag(b)
    expect(mediaPreview()).toContain('Move 2 items')
    expect(a.hasAttribute('data-mm-drag-source')).toBe(true)
    await drag.over(row(/^Uncategorized/))
    expect(mediaPreview()).toContain('to Uncategorized')
    await drag.drop()
    await expectToast('Moved 2 items to Uncategorized')
    expect(sent).toEqual([[aId, bId]])
    for (const id of [aId, bId]) {
      expect(library.mock.library.item(id)?.folder).toBe(0)
    }
  })

  it('refuses All files and says why', async () => {
    const library = await renderColumn()
    const [first] = tiles()
    const id = Number(first?.dataset.mmTile)
    const before = library.mock.library.item(id)?.folder
    const drag = await startDrag(first as HTMLElement)
    await drag.over(row(/^All files/))
    expect(mediaPreview()).toContain('All files isn’t a folder')
    expect(row(/^All files/).hasAttribute('data-drop-blocked')).toBe(true)
    await drag.drop()
    await frames(4)
    expect(library.mock.library.item(id)?.folder).toBe(before)
  })

  it('says "Already in" when nothing changes', async () => {
    await renderColumn('?view=library&folder=15')
    await waitFor(() => expect(tiles()).toHaveLength(6))
    const drag = await startDrag(tiles()[0] as HTMLElement)
    await drag.over(row(/^Press kit/))
    await drag.drop()
    await expectToast('Already in “Press kit”')
  })

  it('opens a closed folder after hovering 700 ms', async () => {
    await renderColumn()
    const drag = await startDrag(tiles()[0] as HTMLElement)
    await drag.over(row(/^Events/))
    await drag.hold(300)
    expect(row(/^Events/).getAttribute('aria-expanded')).toBe('false')
    await drag.hold(600)
    await waitFor(() =>
      expect(row(/^Events/).getAttribute('aria-expanded')).toBe('true'),
    )
    await drag.over(row(/^Summer party/))
    expect(mediaPreview()).toContain('to “Summer party”')
    await drag.cancel()
  })

  it('per-user mode: the preview refuses and the drop explains', async () => {
    const library = await renderColumn('?view=library', 'per-user')
    const [first] = tiles()
    const id = Number(first?.dataset.mmTile)
    const before = library.mock.library.item(id)?.folder
    const drag = await startDrag(first as HTMLElement)
    await drag.over(row(/^Press kit/))
    expect(mediaPreview()).toContain('Folders are read-only here')
    await drag.drop()
    await expectToast(
      'Folder changes are off: FileBird’s per-user folders aren’t supported.',
    )
    expect(library.mock.library.item(id)?.folder).toBe(before)
  })
})

describe('folders in the tree', () => {
  it('nests a folder in the middle of a row, with Undo', async () => {
    const library = await renderColumn()
    const user = userEvent.setup()
    const drag = await startDrag(row(/^Team/))
    expect(folderPreview()?.textContent).toContain('Move “Team”')
    expect(row(/^Team/).hasAttribute('data-dragging')).toBe(true)
    await drag.over(row(/^Brand/), 'middle')
    expect(folderPreview()?.textContent).toContain('into “Brand”')
    await drag.drop()
    await expectToast('Moved “Team” into “Brand”')
    const team = () =>
      library.mock.library.folderTree().folders.find((f) => f.id === 14)
    expect(team()?.parent).toBe(1)
    await user.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(team()?.parent).toBe(0))
    // Back in its old place: after Products, before Press kit.
    const top = library.mock.library
      .folderTree()
      .folders.filter((f) => f.parent === 0)
      .sort((a, b) => a.ord - b.ord)
      .map((f) => f.name)
    expect(top.indexOf('Team')).toBe(top.indexOf('Products') + 1)
  })

  it('reorders before a sibling from the top edge, with a line', async () => {
    const library = await renderColumn()
    const drag = await startDrag(row(/^Archive/))
    await drag.over(row(/^Brand/), 'top')
    expect(row(/^Brand/).getAttribute('data-drop')).toBe('reorder-before')
    expect(row(/^Brand/).querySelector('[data-edge="before"]')).toBeTruthy()
    await drag.drop()
    await expectToast('Moved “Archive”')
    const top = library.mock.library
      .folderTree()
      .folders.filter((f) => f.parent === 0)
      .sort((a, b) => a.ord - b.ord)
      .map((f) => f.name)
    expect(top[0]).toBe('Archive')
  })

  it('refuses a move into its own subfolder', async () => {
    const library = await renderColumn()
    act(() => setExpanded(new Set([1])))
    const logos = await within(tree()).findByRole('treeitem', {
      name: /^Logos/,
    })
    const drag = await startDrag(row(/^Brand/))
    await drag.over(logos, 'middle')
    expect(folderPreview()?.textContent).toContain(
      'Can’t move a folder into its own subfolder',
    )
    expect(folderPreview()?.getAttribute('data-valid')).toBe('false')
    await drag.drop()
    await frames(4)
    expect(
      library.mock.library.folderTree().folders.find((f) => f.id === 1)?.parent,
    ).toBe(0)
  })

  it('moves a folder to the top level from the empty tree area', async () => {
    const library = await renderColumn()
    act(() => setExpanded(new Set([1])))
    const logos = await within(tree()).findByRole('treeitem', {
      name: /^Logos/,
    })
    const drag = await startDrag(logos)
    const area = tree()
    const rect = area.getBoundingClientRect()
    await drag.over(area, { x: rect.left + 40, y: rect.bottom - 6 })
    expect(folderPreview()?.textContent).toContain('to the top level')
    await drag.drop()
    await expectToast('Moved “Logos” to the top level')
    expect(
      library.mock.library.folderTree().folders.find((f) => f.id === 2)?.parent,
    ).toBe(0)
  })

  it('refuses the Trash row as a folder target (it is not the top level)', async () => {
    const library = await renderColumn('?view=library', 'trash')
    const drag = await startDrag(row(/^Team/))
    await drag.over(row(/^Trash/))
    expect(folderPreview()?.textContent).toContain('Folders can’t go here')
    expect(row(/^Trash/).hasAttribute('data-drop-blocked')).toBe(true)
    await drag.drop()
    await frames(4)
    const team = library.mock.library
      .folderTree()
      .folders.find((folder) => folder.id === 14)
    expect(team?.parent).toBe(0)
    expect(team?.ord).toBe(13)
  })

  it('refuses All files and Uncategorized as folder targets', async () => {
    await renderColumn()
    const drag = await startDrag(row(/^Team/))
    await drag.over(row(/^Uncategorized/))
    expect(folderPreview()?.textContent).toContain('Folders can’t go here')
    await drag.cancel()
  })

  it('offers only "inside" with Pro’s name sort', async () => {
    await renderColumn('?view=library', 'pro')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Folder options' }))
    await user.click(
      await screen.findByRole('menuitemradio', {
        name: 'Sort folders: name A–Z',
      }),
    )
    const drag = await startDrag(row(/^Team/))
    await drag.over(row(/^Brand/), 'top')
    expect(row(/^Brand/).getAttribute('data-drop')).toBe('combine')
    await drag.cancel()
  })

  it('per-user mode: a folder drag explains why it can’t start', async () => {
    await renderColumn('?view=library', 'per-user')
    await startDrag(row(/^Team/))
    await expectToast(
      'Folder changes are off: FileBird’s per-user folders aren’t supported.',
    )
    expect(folderPreview()).toBeNull()
  })
})
