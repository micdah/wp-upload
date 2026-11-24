// The compact folder drawer (< 900 px) as an Esc layer that gives focus back
// to whatever opened it (the toolbar's Folders button, or the grid tile that
// had focus when F was pressed). Closing makes the drawer inert, which drops
// focus to the page body; without this, keyboard users would start over
// from the top of the page.

import { type RefObject, useEffect, useRef } from 'react'
import { useKeyLayer } from '../core/keymap/layers'
import { coreStore, isFoldersOpen } from '../core/state'

export function useFolderDrawerLayer(
  active: boolean,
  drawer: RefObject<HTMLElement | null>,
): void {
  const opener = useRef<Element | null>(null)

  // The store changes before React renders the open drawer, so what has
  // focus at that moment is the opener, not something inside the drawer.
  useEffect(
    () =>
      coreStore.subscribe((state, previous) => {
        if (isFoldersOpen(state) && !isFoldersOpen(previous)) {
          opener.current = document.activeElement
        }
      }),
    [],
  )

  useKeyLayer(
    'folder-drawer',
    () => {
      const target = opener.current
      coreStore.getState().setFoldersOpen(false)
      // After the drawer has rendered closed (inert), unless focus already
      // went somewhere outside it on purpose.
      requestAnimationFrame(() => {
        const focused = document.activeElement
        if (
          target instanceof HTMLElement &&
          target.isConnected &&
          (focused === document.body || drawer.current?.contains(focused))
        ) {
          target.focus()
        }
      })
    },
    active,
  )
}
