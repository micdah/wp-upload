// "Save & next" (inspector.md §4): Enter in the Title or Alt text field of
// one item saves it and moves selection and focus to the next item in the
// collection (Shift+Enter: the previous one), with the same field focused
// and the caret at the end. It walks the same ordered list as the grid and
// detail mode, and stops at both ends with a nudge (D34).
//
// The next item is chosen before the save: with the Missing alt filter on,
// the saved item leaves the view once the collection refetches, and the
// cursor must already have moved on. If the item has already left (a save
// on blur, then Enter), it steps from where it was (stepFrom, M2).
//
// In grid mode the selection moves (and the grid reveals the tile); in
// detail mode the stage steps (`?item=` replaced), and D52 moves the
// selection with it. The save itself runs on; if it fails after we moved
// on, controller.ts says so in a toast with Retry.

import type { QueryClient } from '@tanstack/react-query'
import { centerApi } from '../../core/collection/centerApi'
import { getCurrentCollection } from '../../core/collection/hooks'
import {
  type DetailPosition,
  queryKeyOf,
  stepFrom,
} from '../../core/collection/rows'
import { coreStore } from '../../core/state'
import { announce } from '../../core/ui/announce'
import { urlStore } from '../../core/url/useUrlState'
import { bridgeStore, type FieldName } from './bridge'
import { commitField } from './controller'
import { isImageLike } from './format'

/** Where the panel last saw an item in the collection (stepFrom's memory). */
let position: DetailPosition | null = null

/** Remembers where `id` sits in the collection on screen, if it is there. */
export function rememberPosition(id: number): void {
  const collection = getCurrentCollection()
  if (collection?.status !== 'success') {
    return
  }
  const index = collection.rows.indexOf(id)
  if (index >= 0) {
    position = { id, index, query: queryKeyOf(collection.query) }
  }
}

export type StepTarget =
  | { kind: 'next'; id: number }
  | { kind: 'edge' }
  /** Nowhere to go: the collection isn't settled, or never had the item. */
  | { kind: 'none' }

/**
 * Where Save & next goes from `id` in the collection on screen. From alt
 * text it skips items without alt text (videos, documents, …): only image
 * and SVG rows have the field, and focus must land in one.
 */
export function stepTarget(
  id: number,
  direction: 1 | -1,
  field: FieldName = 'title',
): StepTarget {
  const first = neighbourStep(id, direction)
  if (first.kind !== 'next' || field !== 'alt') {
    return first
  }
  const rows = getCurrentCollection()?.rows
  let target: StepTarget = first
  while (target.kind === 'next' && rows) {
    const index = rows.indexOf(target.id)
    if (index < 0 || isImageLike(rows.kindAt(index))) {
      return target
    }
    const next = index + direction
    target =
      next < 0 || next >= rows.length
        ? { kind: 'edge' }
        : { kind: 'next', id: rows.idAt(next) }
  }
  return target
}

/** The neighbour in the collection on screen, whatever its kind. */
function neighbourStep(id: number, direction: 1 | -1): StepTarget {
  const collection = getCurrentCollection()
  if (
    !collection ||
    collection.isPlaceholder ||
    collection.status !== 'success'
  ) {
    return { kind: 'none' }
  }
  rememberPosition(id)
  const step = stepFrom(
    collection.rows,
    id,
    direction,
    position,
    queryKeyOf(collection.query),
  )
  if (step === null) {
    return { kind: 'none' }
  }
  return 'edge' in step ? { kind: 'edge' } : { kind: 'next', id: step.next }
}

/** Moves the inspector (and selection) to `id`, with `field` focused. */
export function moveTo(id: number, field: FieldName): void {
  const detailItem = urlStore().get().item
  // The panel focuses the field once it shows the item.
  bridgeStore.getState().requestFocus({ id, field })
  if (detailItem !== null) {
    // Replaces `?item=` (already in detail); core sync then moves a
    // selection of 0 or 1 along (D52).
    urlStore().openItem(id)
  } else {
    coreStore.getState().selectOnly(id)
    void centerApi.revealItem(id)
  }
  rememberPosition(id)
}

export type SaveAndStepResult = 'moved' | 'edge' | 'stayed'

/**
 * Commits the field of item `id` and steps. Returns what happened, so the
 * field can nudge at an end.
 */
export function saveAndStep(
  queryClient: QueryClient,
  id: number,
  field: FieldName,
  direction: 1 | -1,
): SaveAndStepResult {
  const target = stepTarget(id, direction, field)
  void commitField(queryClient, id, field)
  if (target.kind === 'next') {
    moveTo(target.id, field)
    return 'moved'
  }
  if (target.kind === 'edge') {
    const what = field === 'alt' ? 'image' : 'item'
    announce(
      direction === 1
        ? `Last ${what} in this view`
        : `First ${what} in this view`,
    )
    return 'edge'
  }
  return 'stayed'
}

/** Tests: forget the remembered position. */
export function resetSaveNextForTesting(): void {
  position = null
}
