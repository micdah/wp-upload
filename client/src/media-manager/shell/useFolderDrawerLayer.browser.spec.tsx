import { act, screen, waitFor } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { topKeyLayer } from '../core/keymap/layers'
import {
  coreStore,
  isCompactViewport,
  isFoldersOpen,
  useCore,
} from '../core/state'
import { renderWithProviders } from '../test/renderWithProviders'
import { useFolderDrawerLayer } from './useFolderDrawerLayer'

// The drawer part of the shell: a toolbar button that opens it, and the
// drawer, inert while closed (as in Shell.tsx).
function DrawerShell() {
  const compact = useCore((state) => isCompactViewport(state.viewport))
  const open = useCore(isFoldersOpen)
  const drawer = useRef<HTMLElement>(null)
  useFolderDrawerLayer(compact && open, drawer)
  return (
    <>
      <button
        type='button'
        onClick={() => coreStore.getState().toggleFolders()}
      >
        Folders
      </button>
      <aside ref={drawer} inert={!open} aria-label='Folders'>
        <button type='button'>Holidays</button>
      </aside>
    </>
  )
}

afterEach(() => {
  act(() => {
    coreStore.getState().setFoldersOpen(false)
    coreStore.getState().setViewport('wide')
  })
})

describe('the compact folder drawer (C-18)', () => {
  it('gives focus back to its opener when Esc closes it', async () => {
    act(() => {
      coreStore.getState().setViewport('narrow')
      coreStore.getState().setFoldersOpen(false)
    })
    renderWithProviders(<DrawerShell />)
    const opener = screen.getByRole('button', { name: 'Folders' })
    opener.focus()
    act(() => {
      opener.click()
    })
    // Focus moves into the drawer.
    const folder = screen.getByRole('button', { name: 'Holidays' })
    folder.focus()
    expect(document.activeElement).toBe(folder)
    expect(topKeyLayer()?.name).toBe('folder-drawer')

    act(() => {
      topKeyLayer()?.onEscape()
    })
    expect(isFoldersOpen(coreStore.getState())).toBe(false)
    await waitFor(() => {
      expect(document.activeElement).toBe(opener)
    })
  })
})
