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
import { failOnReactWarnings } from '../../test/consoleErrors'
import {
  cleanupLibrary,
  pollRevNow,
  renderLibrary,
} from '../../test/renderLibrary'
import {
  ALL_FILES,
  detailRegion,
  findStageMedia,
  firstOfKind,
  liveRegion,
  probeLibrary,
  rowsOf,
} from './testing'

// Detail mode's edge cases (A2 brief §6) and the top bar's More menu (§4):
// deep links outside the view or to nothing, items removed while open, and
// Copy URL / Open in wp-admin / the actions later tracks implement.

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

function filmCell(id: number): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-mm-film="${id}"]`)
}

describe('deep links', () => {
  it('to an item the filters hide: "Not in this view", no stepping, the strip leads back in', async () => {
    const user = userEvent.setup()
    const image = firstOfKind(probeLibrary(), 'image')
    const videos = rowsOf(probeLibrary(), { ...ALL_FILES, type: 'video' })
    const { search } = await renderLibrary({
      search: `?view=library&type=video&item=${image.id}`,
      waitForGrid: false,
    })
    const detail = await detailRegion()
    await findStageMedia()
    await waitFor(() =>
      expect(within(detail).getByText('Not in this view')).toBeTruthy(),
    )
    // Nowhere to step from: both buttons hide, and ←/→ do nothing.
    for (const name of ['Previous item', 'Next item']) {
      const button = detail.querySelector(`[aria-label="${name}"]`)
      expect(button?.getAttribute('aria-disabled')).toBe('true')
    }
    await user.keyboard('{ArrowRight}')
    expect(search()).toContain(`item=${image.id}`)
    // The strip shows the view, with no current cell; a click steps in.
    const first = (videos[0] as { id: number }).id
    await waitFor(() => expect(filmCell(first)).not.toBeNull())
    expect(document.querySelector('[data-mm-film][aria-current]')).toBeNull()
    await user.click(filmCell(first) as HTMLElement)
    expect(search()).toContain(`item=${first}`)
    await waitFor(() =>
      expect(within(detail).queryByText('Not in this view')).toBeNull(),
    )
    expect(detail.textContent).toContain(`1 / ${videos.length}`)
  })

  it('to an item that doesn’t exist: "Item not found" with a way back', async () => {
    const user = userEvent.setup()
    const { search } = await renderLibrary({
      search: '?view=library&item=987654',
      waitForGrid: false,
    })
    const detail = await detailRegion()
    await waitFor(() =>
      expect(
        within(detail).getByRole('heading', { name: 'Item not found' }),
      ).toBeTruthy(),
    )
    // The card's own button (the bar has one too).
    const back = within(detail).getAllByRole('button', { name: 'Back to grid' })
    await user.click(back.at(-1) as HTMLElement)
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Detail' })).toBeNull(),
    )
    expect(search()).toBe('?view=library')
  })
})

describe('the item on stage is removed while open', () => {
  it('deleted: the item that took its place shows', async () => {
    const rows = rowsOf(probeLibrary())
    const shown = rows[4] as { id: number }
    const after = rows[5] as { id: number }
    const { mock, search } = await renderLibrary({
      search: `?view=library&item=${shown.id}`,
    })
    await detailRegion()
    await findStageMedia()
    mock.library.deleteItems({ ids: [shown.id], mode: 'delete' })
    pollRevNow()
    await waitFor(() => expect(search()).toContain(`item=${after.id}`))
    // It replaced the entry (Back still leads to the grid).
    expect(search()).not.toContain(`item=${shown.id}`)
  })

  it('deleted with others (a batch): the real successor shows', async () => {
    const rows = rowsOf(probeLibrary())
    const ids = rows.map((row) => row.id)
    const shown = ids[4] as number
    const { mock, search } = await renderLibrary({
      search: `?view=library&item=${shown}`,
    })
    await detailRegion()
    await findStageMedia()
    mock.library.deleteItems({ ids: ids.slice(3, 6), mode: 'delete' })
    pollRevNow()
    await waitFor(() => expect(search()).toContain(`item=${ids[6]}`))
  })

  it('removed from the folder on view (moved elsewhere): the next one shows', async () => {
    const probe = probeLibrary()
    const counts = new Map<number, number>()
    for (const row of rowsOf(probe)) {
      const folder = probe.library.item(row.id)?.folder
      if (typeof folder === 'number' && folder > 0) {
        counts.set(folder, (counts.get(folder) ?? 0) + 1)
      }
    }
    const folder = [...counts].find(([, count]) => count >= 3)?.[0]
    if (folder === undefined) throw new Error('no folder with 3 items')
    const inFolder = rowsOf(probe, { ...ALL_FILES, folder })
    const shown = (inFolder[1] as { id: number }).id
    const after = (inFolder[2] as { id: number }).id
    const { mock, search } = await renderLibrary({
      search: `?view=library&folder=${folder}&item=${shown}`,
    })
    await detailRegion()
    await findStageMedia()
    // "Remove from folder": it goes to Uncategorized.
    mock.library.assign(0, [shown])
    pollRevNow()
    await waitFor(() => expect(search()).toContain(`item=${after}`))
  })

  it('trashed (MEDIA_TRASH on): the same', async () => {
    const rows = rowsOf(probeLibrary('trash'))
    const shown = rows[2] as { id: number }
    const after = rows[3] as { id: number }
    const { mock, search } = await renderLibrary({
      scenario: 'trash',
      search: `?view=library&item=${shown.id}`,
    })
    await detailRegion()
    await findStageMedia()
    mock.library.deleteItems({ ids: [shown.id], mode: 'trash' })
    pollRevNow()
    await waitFor(() => expect(search()).toContain(`item=${after.id}`))
  })

  it('the last item of the view: back to the grid', async () => {
    const audio = firstOfKind(probeLibrary(), 'audio')
    const audios = rowsOf(probeLibrary(), { ...ALL_FILES, type: 'audio' })
    expect(audios).toHaveLength(1)
    const { mock, search } = await renderLibrary({
      search: `?view=library&type=audio&item=${audio.id}`,
    })
    await detailRegion()
    await findStageMedia()
    mock.library.deleteItems({ ids: [audio.id], mode: 'delete' })
    pollRevNow()
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Detail' })).toBeNull(),
    )
    expect(search()).toBe('?view=library&type=audio')
  })
})

describe('the More menu', () => {
  async function openMenu(scenario = 'normal') {
    const user = userEvent.setup()
    const image = firstOfKind(probeLibrary(scenario), 'image')
    const rendered = await renderLibrary({
      scenario,
      search: `?view=library&item=${image.id}`,
      waitForGrid: false,
    })
    const detail = await detailRegion()
    await findStageMedia()
    await user.click(
      within(detail).getByRole('button', { name: 'More actions' }),
    )
    const menu = await screen.findByRole('menu')
    return { ...rendered, user, menu, id: image.id }
  }

  it('Copy URL copies the file URL and says so', async () => {
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined)
    const { user, menu, mock, id } = await openMenu()
    await user.click(within(menu).getByRole('menuitem', { name: 'Copy URL' }))
    await waitFor(() => expect(liveRegion()).toBe('URL copied'))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining(`/${id}/`))
    expect(mock.library.item(id)).toBeTruthy()
    writeText.mockRestore()
  })

  it('Open in wp-admin opens the edit screen in a new tab', async () => {
    const { menu } = await openMenu()
    const link = await waitFor(() =>
      within(menu).getByRole('menuitem', { name: 'Open in wp-admin' }),
    )
    await waitFor(() =>
      expect(link.getAttribute('href')).toMatch(
        /post\.php\?post=\d+&action=edit/,
      ),
    )
    expect(link.getAttribute('target')).toBe('_blank')
  })

  it('Move, Edit and Delete run commands; until they exist they are disabled', async () => {
    const { menu } = await openMenu()
    const disabled = (name: RegExp) => {
      const item = within(menu).getByRole('menuitem', { name })
      return item.hasAttribute('disabled') || item.hasAttribute('data-disabled')
    }
    // Move to folder is A3's (folders.move-to); deleting outside a folder is
    // B3's, and the inspector (Edit image) is mocked out in this file.
    expect(disabled(/^Move to folder/)).toBe(false)
    expect(disabled(/^Edit image/)).toBe(true)
    expect(disabled(/^Delete/)).toBe(true)
    // Delete from the library is Shift+Delete.
    expect(
      within(menu).getByRole('menuitem', { name: /^Delete/ }).textContent,
    ).toMatch(/Shift|⇧/)
  })

  it('without FileBird there is no Move to folder', async () => {
    const { menu } = await openMenu('no-filebird')
    expect(
      within(menu).queryByRole('menuitem', { name: /^Move to folder/ }),
    ).toBeNull()
    expect(
      within(menu).getByRole('menuitem', { name: 'Copy URL' }),
    ).toBeTruthy()
  })

  it('Esc closes the menu first, then detail (spike C4)', async () => {
    const { user } = await openMenu()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(screen.getByRole('region', { name: 'Detail' })).toBeTruthy()
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Detail' })).toBeNull(),
    )
  })

  it('Esc with focus still on the trigger closes only the menu', async () => {
    const { user } = await openMenu()
    act(() => screen.getByRole('button', { name: 'More actions' }).focus())
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(screen.getByRole('region', { name: 'Detail' })).toBeTruthy()
  })
})
