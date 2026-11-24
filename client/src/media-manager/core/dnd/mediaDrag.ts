// Media drag and drop over Pragmatic drag-and-drop (plan §3):
//
// - useMediaDraggable(ref, id) makes a tile (or filmstrip cell) draggable.
//   Dragging a selected tile drags the whole selection; an unselected tile
//   drags only itself (interaction-spec §2).
// - The native drag image is turned off; <MediaDragPreview/> follows the
//   pointer instead ("Move N items · to X", folders.md §6). Drop targets
//   (the folder tree) name themselves with setMediaDropTarget().
// - Drop targets recognise our payload with isMediaDragData().

import {
  draggable,
  monitorForElements,
} from '@atlaskit/pragmatic-drag-and-drop/adapter/element-adapter'
import { disableNativeDragPreview } from '@atlaskit/pragmatic-drag-and-drop/element/disable-native-drag-preview'
import { type RefObject, useEffect, useState } from 'react'
import { createStore } from 'zustand/vanilla'
import { coreStore } from '../state'
import { targetIds } from '../state/selection'

export const MEDIA_DRAG_TYPE = 'wpu-media'

export interface MediaDragData {
  [key: string | symbol]: unknown
  type: typeof MEDIA_DRAG_TYPE
  /** Every item being dragged, in collection order. */
  ids: number[]
  /** The tile the drag started on. */
  sourceId: number
}

export function isMediaDragData(
  data: Record<string | symbol, unknown>,
): data is MediaDragData {
  return data.type === MEDIA_DRAG_TYPE && Array.isArray(data.ids)
}

/** The ids a drag from `id` moves: the selection if `id` is in it, else `id`. */
export function dragIdsFor(
  id: number,
  selection: ReadonlySet<number>,
  order: readonly number[],
): number[] {
  if (!selection.has(id)) {
    return [id]
  }
  return targetIds({ selection, anchor: null, focus: id }, order)
}

export interface MediaDropTarget {
  /** What the preview says after "to", e.g. a folder name. */
  label: string
  /** Shown instead of the label when the drop isn't allowed. */
  refusal?: string
}

export interface MediaDragState {
  active: {
    ids: number[]
    sourceId: number
    x: number
    y: number
    target: MediaDropTarget | null
  } | null
}

/** The current media drag, for the preview and for drop targets. */
export const mediaDragStore = createStore<MediaDragState>(() => ({
  active: null,
}))

/** A drop target says what dropping here would do (null when the pointer leaves). */
export function setMediaDropTarget(target: MediaDropTarget | null): void {
  const { active } = mediaDragStore.getState()
  if (active) {
    mediaDragStore.setState({ active: { ...active, target } })
  }
}

export interface MediaDraggableOptions {
  disabled?: boolean
  /** Collection order, so a multi-item drag lists ids in order. */
  getOrder?: () => readonly number[]
}

let monitorInstalled = false

/** One monitor keeps the preview's pointer position current. */
function ensureMonitor(): void {
  if (monitorInstalled) {
    return
  }
  monitorInstalled = true
  monitorForElements({
    canMonitor: ({ source }) => isMediaDragData(source.data),
    onDrag: ({ location }) => {
      const { active } = mediaDragStore.getState()
      if (active) {
        const { clientX: x, clientY: y } = location.current.input
        mediaDragStore.setState({ active: { ...active, x, y } })
      }
    },
    onDrop: () => {
      mediaDragStore.setState({ active: null })
    },
  })
}

/** Makes the element draggable as media item `id`. Returns whether it is being dragged. */
export function useMediaDraggable(
  ref: RefObject<HTMLElement | null>,
  id: number,
  options: MediaDraggableOptions = {},
): { dragging: boolean } {
  const [dragging, setDragging] = useState(false)
  const { disabled = false, getOrder } = options
  useEffect(() => {
    const element = ref.current
    if (!element || disabled) {
      return
    }
    ensureMonitor()
    return draggable({
      element,
      getInitialData: () => {
        const order = getOrder?.() ?? []
        const ids = dragIdsFor(id, coreStore.getState().selection, order)
        const data: MediaDragData = { type: MEDIA_DRAG_TYPE, ids, sourceId: id }
        return data
      },
      onGenerateDragPreview: ({ nativeSetDragImage }) => {
        disableNativeDragPreview({ nativeSetDragImage })
      },
      onDragStart: ({ source, location }) => {
        setDragging(true)
        const data = source.data as MediaDragData
        const { clientX: x, clientY: y } = location.current.input
        mediaDragStore.setState({
          active: { ids: data.ids, sourceId: id, x, y, target: null },
        })
      },
      onDrop: () => {
        setDragging(false)
        mediaDragStore.setState({ active: null })
      },
    })
  }, [ref, id, disabled, getOrder])
  return { dragging }
}
