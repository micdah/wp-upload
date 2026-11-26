// Detail mode (interaction-spec §5): an overlay over the centre, opened by
// `?item=` (Enter, double-click, or a deep link). The grid stays mounted and
// inert underneath, so scroll position and selection survive the round trip.
//
// It is the top bar (DetailBar), the stage (Stage, StageMedia, Player) and
// the filmstrip (Filmstrip), all walking the same collection as the grid.
// Core implements opening, leaving, stepping and zoom (app/runtime.ts);
// this lazy chunk renders them and handles the edge cases:
//
// - an item outside the current view (a deep link the filters hide, or an
//   item that left the view while shown): the bar says "Not in this view";
//   stepping goes on from the place it had (core's detail.step), and where
//   there is no such place the step buttons hide;
// - the item on stage is removed while open (deleted, trashed, removed from
//   or moved out of the folder on view, restored from the Trash view;
//   removal.ts): the item that took
//   its place shows, and detail returns to the grid when nothing is left
//   (system.md §4 "After any removal"); a deep link to a missing item shows
//   "Item not found".

import { useEffect, useRef } from 'react'
import { useCollection, useItem } from '../../core/collection/hooks'
import {
  type CollectionRows,
  neighbourOf,
  queryKeyOf,
} from '../../core/collection/rows'
import { runCommand } from '../../core/commands/registry'
import { useCommand } from '../../core/commands/useCommand'
import { announce } from '../../core/ui/announce'
import { urlStore, useUrlState } from '../../core/url/useUrlState'
import classes from './Detail.module.css'
import { DetailBar } from './DetailBar'
import { Filmstrip } from './Filmstrip'
import { successorIn, wasRemoved } from './removal'
import { Stage } from './Stage'
import type { AnyItem } from './StageMedia'
import type { StepTarget } from './useStageGestures'

export function DetailOverlay() {
  const id = useUrlState((state) => state.item)
  if (id === null) {
    return null
  }
  return <Detail id={id} />
}

/**
 * What a step button or swipe reaches. In the view: the neighbour, or the
 * end (D34). Outside it: whatever core's detail.step can do from the place
 * the item had, or nothing.
 */
function stepTarget(
  index: number,
  neighbour: number | null,
  available: boolean,
): StepTarget {
  if (index >= 0) {
    return neighbour !== null ? 'item' : 'edge'
  }
  return available ? 'item' : 'none'
}

interface SeenAt {
  id: number
  index: number
  query: string
  /** The rows it was seen in, to find who followed it after a removal. */
  rows: CollectionRows
}

/**
 * When the item on stage is removed from the view (removal.ts), shows the
 * item that took its place, or returns to the grid when the view is empty
 * (system.md §4, folders.md §11).
 */
function useStepAwayFromRemoved(
  id: number,
  item: AnyItem | null,
  missing: boolean,
  collection: ReturnType<typeof useCollection>,
): void {
  const seen = useRef<SeenAt | null>(null)
  const rows: CollectionRows = collection.rows
  const index = rows.indexOf(id)
  const query = queryKeyOf(collection.query)
  useEffect(() => {
    if (index >= 0) {
      seen.current = { id, index, query, rows }
    }
  }, [id, index, query, rows])

  const removed = wasRemoved(item, missing, collection.query.folder)
  const settled = collection.status === 'success' && !collection.isPlaceholder
  useEffect(() => {
    if (!removed || !settled || rows.has(id)) {
      return
    }
    const last = seen.current
    if (!last || last.id !== id || last.query !== query) {
      // Never seen in this view (a deep link): it stays, with "Not in this
      // view" or "Item not found".
      return
    }
    const next = successorIn(rows, last)
    if (next === null) {
      // Leaving runs the morph, which renders synchronously (flushSync):
      // not from inside an effect.
      queueMicrotask(() => runCommand('detail.close'))
      return
    }
    urlStore().openItem(next)
  }, [removed, settled, rows, id, query])
}

function Detail({ id }: { id: number }) {
  const collection = useCollection()
  const tile = useItem(id, 'tile')
  const fullResult = useItem(id, 'full')
  const full = fullResult.item
  const item: AnyItem | null = full ?? tile.item
  const missing = item === null && (fullResult.missing || tile.missing)
  const rows = collection.rows
  const index = rows.indexOf(id)
  const previous = neighbourOf(rows, id, -1)
  const next = neighbourOf(rows, id, 1)
  const stepBack = useCommand('detail.step', { direction: -1 })
  const stepOn = useCommand('detail.step', { direction: 1 })
  const regionRef = useRef<HTMLElement>(null)
  const title = item
    ? item.title || item.filename
    : missing
      ? 'Item not found'
      : 'Loading…'

  useStepAwayFromRemoved(id, item, missing, collection)

  // The grid under detail is inert, so keyboard focus moves into detail.
  useEffect(() => {
    regionRef.current?.focus({ preventScroll: true })
  }, [])

  // One announcement per item shown (mode change and each step).
  const announcement =
    item || missing
      ? `${title}${index >= 0 ? `, ${index + 1} of ${collection.total}` : ''}`
      : null
  useEffect(() => {
    if (announcement) {
      announce(announcement)
    }
  }, [announcement])

  return (
    <section
      ref={regionRef}
      className={classes.detail}
      aria-label='Detail'
      tabIndex={-1}
      data-mm-detail=''
    >
      <DetailBar
        id={id}
        item={item}
        full={full}
        title={title}
        index={index}
        total={collection.total}
      />
      <Stage
        id={id}
        item={item}
        missing={missing}
        title={title}
        previous={previous}
        next={next}
        targets={{
          previous: stepTarget(index, previous, stepBack.enabled),
          next: stepTarget(index, next, stepOn.enabled),
        }}
      />
      <Filmstrip collection={collection} currentId={id} />
    </section>
  )
}
