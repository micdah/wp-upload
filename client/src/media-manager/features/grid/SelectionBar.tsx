// The selection bar (interaction-spec §2, design-system §6): at 2 or more
// selected the toolbar becomes "✕ N selected · Move to folder · Edit details
// · Download · Delete". Under D33 it also says how many of the selected items
// the current filters hide, because bulk actions act on those too.
//
// The shell's toolbar has no mode of its own, so the bar is a toolbar item
// that covers the whole toolbar while it shows (the toolbar is its
// positioned ancestor), and its CSS hides the controls underneath, which also
// takes them out of the tab order. The actions run commands other tracks
// implement (A3 move, A4 edit details, B3 download and delete); until then
// they render disabled with the reason in their tooltip.
//
// Its content is a lazy chunk (D31), fetched when the browser is idle.

import { lazy, Suspense, useEffect } from 'react'
import { useCore } from '../../core/state'

/** The bar shows from this many selected items. */
export const SELECTION_BAR_MIN = 2

const loadActions = () => import('./SelectionActions')

const LazyBar = lazy(() =>
  loadActions().then((module) => ({ default: module.Bar })),
)

export function SelectionBar() {
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((run) => setTimeout(run, 300))
    const handle = idle(() => {
      void loadActions()
    })
    return () => {
      if (window.cancelIdleCallback && typeof handle === 'number') {
        window.cancelIdleCallback(handle)
      }
    }
  }, [])
  const count = useCore((state) => state.selection.size)
  if (count < SELECTION_BAR_MIN) {
    return null
  }
  return (
    <Suspense fallback={null}>
      <LazyBar count={count} />
    </Suspense>
  )
}
