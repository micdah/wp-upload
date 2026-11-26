// The `peek` feature (track A1): Quick Look on `Space` (interaction-spec §4).
// The shell imports these exports directly: keep their names.
//
// - `Space` toggles it on the focused item (grid mode only). It is core's
//   `peek` overlay, so only one centre overlay shows at a time (D36), and
//   core closes it when detail opens or the folder changes.
// - While it is open, ←/→/↑/↓ still move the grid's focus (the keymap's grid
//   bindings; focus stays on the tile) and the peek follows. `Esc` closes it
//   before the grid's own Esc (a key layer); `Enter` opens detail, which
//   closes it. Clicking the scrim closes it.
// - Not detail mode: the grid, the selection and the URL don't change.
//
// The content is a lazy chunk (D31), fetched when the browser is idle.

import { lazy, Suspense, useEffect } from 'react'
import {
  getCurrentCollection,
  useCollection,
} from '../../core/collection/hooks'
import {
  type Availability,
  implementCommand,
} from '../../core/commands/registry'
import { useKeyLayer } from '../../core/keymap/layers'
import { coreStore, useCore } from '../../core/state'
import { announce } from '../../core/ui/announce'
import { urlStore } from '../../core/url/useUrlState'

const loadPeek = () => import('./Peek')

const LazyPeek = lazy(() =>
  loadPeek().then((module) => ({ default: module.Peek })),
)

function usePrefetchPeek(): void {
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((run) => setTimeout(run, 300))
    const handle = idle(() => {
      void loadPeek()
    })
    return () => {
      if (window.cancelIdleCallback && typeof handle === 'number') {
        window.cancelIdleCallback(handle)
      }
    }
  }, [])
}

function closePeek(): void {
  coreStore.getState().closeOverlay('peek')
}

export function PeekOverlay() {
  usePrefetchPeek()
  const open = useCore((state) => state.overlay === 'peek')
  const focus = useCore((state) => state.focus)
  const collection = useCollection()
  useKeyLayer('peek', closePeek, open)
  // Nothing left to show (the item was deleted, the folder changed, a filter
  // hides it): close. Wait for the new query's rows before deciding.
  const shown =
    focus !== null &&
    (collection.isPlaceholder ||
      collection.status !== 'success' ||
      collection.rows.has(focus))
  useEffect(() => {
    if (open && !shown) closePeek()
  }, [open, shown])
  if (!open) {
    return null
  }
  return (
    <Suspense fallback={null}>
      <LazyPeek />
    </Suspense>
  )
}

export function peekAvailability(): Availability {
  const state = coreStore.getState()
  if (urlStore().get().item !== null) {
    return { ok: false, code: 'in-detail', reason: 'Only in the grid' }
  }
  if (state.overlay === 'peek') {
    return { ok: true }
  }
  if (state.overlay !== null) {
    return { ok: false, code: 'overlay', reason: 'Another view is open' }
  }
  if (state.focus === null) {
    return { ok: false, code: 'no-focus', reason: 'Nothing is focused' }
  }
  // The focused item may be one the filters now hide (focus survives them).
  const collection = getCurrentCollection()
  return collection && !collection.rows.has(state.focus)
    ? { ok: false, code: 'not-in-view', reason: 'The focused item is hidden' }
    : { ok: true }
}

let registered = false

/** Implements `peek.toggle` (Space). Idempotent. */
export function register(): void {
  if (registered) {
    return
  }
  registered = true
  implementCommand('peek.toggle', {
    available: peekAvailability,
    run: () => {
      const state = coreStore.getState()
      if (state.overlay === 'peek') {
        closePeek()
        return
      }
      state.openOverlay('peek')
      announce('Quick peek. Space or Esc closes it, Enter opens the item.')
    },
  })
}
