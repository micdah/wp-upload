// The grid's side of keyboard navigation: `grid.move-focus` needs the
// layout on screen (↑/↓ pick the nearest tile in the next row), which lives
// in the mounted GridView. The view registers a controller while mounted;
// the command reads it.

import type { CollectionRows } from '../../core/collection/rows'
import type { Availability, MoveDirection } from '../../core/commands/registry'
import { coreStore } from '../../core/state'
import { type JustifiedLayout, verticalNeighbour } from './justifiedLayout'

export interface GridController {
  layout(): JustifiedLayout
  rows(): CollectionRows
  /** Moves DOM focus to the focused tile once it has rendered. */
  focusAfterRender(): void
}

let controller: GridController | null = null

/** Registers the mounted grid; returns the unregister function. */
export function setGridController(next: GridController): () => void {
  controller = next
  return () => {
    if (controller === next) {
      controller = null
    }
  }
}

export function gridController(): GridController | null {
  return controller
}

/**
 * The index focus moves to from `current` (-1: nothing focused yet, which
 * starts at the first item, or the last for `last`). Clamped at both ends;
 * ↑/↓ stay put in the first and last row.
 */
export function targetIndex(
  layout: JustifiedLayout,
  current: number,
  to: MoveDirection,
): number {
  const last = layout.count - 1
  if (last < 0) {
    return -1
  }
  if (to === 'last') {
    return last
  }
  if (current < 0 || to === 'first') {
    return 0
  }
  switch (to) {
    case 'left':
      return Math.max(0, current - 1)
    case 'right':
      return Math.min(last, current + 1)
    case 'up':
      return verticalNeighbour(layout, current, -1)
    case 'down':
      return verticalNeighbour(layout, current, 1)
    default:
      return current
  }
}

export function moveFocusAvailability(): Availability {
  const grid = controller
  if (!grid) {
    return { ok: false, code: 'no-grid', reason: 'The grid is not shown' }
  }
  return grid.layout().count > 0
    ? { ok: true }
    : { ok: false, code: 'empty', reason: 'Nothing to move to' }
}

/** Runs `grid.move-focus`: moves focus (and the selection, per `mode`). */
export function moveFocus(
  to: MoveDirection,
  mode: 'select' | 'extend' | 'focus-only' = 'select',
): void {
  const grid = controller
  if (!grid) {
    return
  }
  const layout = grid.layout()
  const rows = grid.rows()
  const store = coreStore.getState()
  const current = store.focus === null ? -1 : rows.indexOf(store.focus)
  const index = targetIndex(layout, current, to)
  if (index < 0) {
    return
  }
  const id = rows.idAt(index)
  store.moveFocus(id, mode, mode === 'extend' ? rows.ids : undefined)
  grid.focusAfterRender()
}
