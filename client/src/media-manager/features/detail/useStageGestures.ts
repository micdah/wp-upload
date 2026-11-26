// Pointer gestures on the stage:
//
// - drag to pan a zoomed picture (mouse, pen and one finger), with the grab
//   cursor (interaction-spec §5);
// - swipe to step on touch (system.md §5): the picture follows the finger,
//   with resistance where there is nothing further, and commits past 64 px
//   or on a flick;
// - pinch to zoom on touch: the picture scales live and settles on the
//   nearest zoom level.
//
// The stage is `touch-action: none`, so the browser neither scrolls nor
// zooms the page under these gestures; a zoomed picture pans here instead
// of by native scrolling (a pinch can't start while the browser pans).
// Controls inside the stage (the player bar, buttons, links) are left alone.
// A press that became a drag doesn't also click (e.g. play a video).
//
// The math is in gestures.ts. Positions are written straight to the slot's
// style while a finger moves, without React renders.

import {
  type PointerEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
  useCallback,
  useRef,
  useState,
} from 'react'
import type { ZoomLevel } from '../../core/state/store'
import {
  distance,
  dragAxis,
  nearestZoom,
  type PointerSample,
  swipeDirection,
  swipeOffset,
  velocityOf,
} from './gestures'

/** What is that way: an item, the end of the collection, or nothing known. */
export type StepTarget = 'item' | 'edge' | 'none'

export interface StageGestureOptions {
  scrollRef: RefObject<HTMLElement | null>
  slotRef: RefObject<HTMLElement | null>
  mediaRef: RefObject<HTMLElement | null>
  zoomed: boolean
  /** The item can zoom (images and SVG). */
  zoomable: boolean
  /** The scale the picture is shown at now, and at Fit (1 = its own pixels). */
  scales(): { now: number; fit: number }
  stepTarget(direction: 1 | -1): StepTarget
  /** A swipe asks to step (also at an end: the step nudges there, D34). */
  onSwipe(direction: 1 | -1): void
  /** A pinch settled on a zoom level, around a point of the picture (0–1). */
  onPinch(level: ZoomLevel, centre: { x: number; y: number }): void
}

/** How long after a drag its click may still arrive (and is swallowed). */
const CLICK_AFTER_DRAG_MS = 300

/** Anything inside the stage that handles its own pointer input. */
const CONTROL = 'button, a, input, select, textarea, [data-mm-player]'

type Gesture =
  | { kind: 'idle' }
  | {
      kind: 'press' | 'pan' | 'swipe'
      pointerId: number
      touch: boolean
      x: number
      y: number
      scrollLeft: number
      scrollTop: number
      samples: PointerSample[]
    }
  | {
      kind: 'pinch'
      startDistance: number
      scale: number
      centre: { x: number; y: number }
    }
  /** After a pinch, until every finger has lifted. */
  | { kind: 'settling' }

function resetSlot(slot: HTMLElement | null, animate: boolean): void {
  if (!slot) return
  slot.style.transition = animate
    ? 'transform var(--dur-2) var(--ease-out)'
    : ''
  slot.style.transform = ''
  slot.style.transformOrigin = ''
}

function midpoint(points: Iterable<{ x: number; y: number }>): {
  x: number
  y: number
} {
  let x = 0
  let y = 0
  let count = 0
  for (const point of points) {
    x += point.x
    y += point.y
    count += 1
  }
  return count > 0 ? { x: x / count, y: y / count } : { x: 0, y: 0 }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

export function useStageGestures(options: StageGestureOptions) {
  const optionsRef = useRef(options)
  optionsRef.current = options
  const gesture = useRef<Gesture>({ kind: 'idle' })
  const touches = useRef(new Map<number, { x: number; y: number }>())
  const suppressClick = useRef(false)
  const [panning, setPanning] = useState(false)

  const startPinch = useCallback(() => {
    const { slotRef, mediaRef, scales } = optionsRef.current
    const points = [...touches.current.values()]
    const [first, second] = points
    if (!first || !second) return
    resetSlot(slotRef.current, false)
    const centrePoint = midpoint(points)
    const media = mediaRef.current?.getBoundingClientRect()
    const slot = slotRef.current?.getBoundingClientRect()
    if (slotRef.current && slot) {
      slotRef.current.style.transformOrigin = `${centrePoint.x - slot.left}px ${centrePoint.y - slot.top}px`
    }
    gesture.current = {
      kind: 'pinch',
      startDistance: Math.max(1, distance(first, second)),
      scale: scales().now,
      centre:
        media && media.width > 0 && media.height > 0
          ? {
              x: clamp01((centrePoint.x - media.left) / media.width),
              y: clamp01((centrePoint.y - media.top) / media.height),
            }
          : { x: 0.5, y: 0.5 },
    }
    setPanning(false)
  }, [])

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const target = event.target as Element
      if (event.button !== 0 || target.closest(CONTROL)) {
        return
      }
      const { zoomed, zoomable, scrollRef } = optionsRef.current
      const touch = event.pointerType === 'touch'
      if (touch) {
        touches.current.set(event.pointerId, {
          x: event.clientX,
          y: event.clientY,
        })
        if (touches.current.size === 2 && zoomable) {
          startPinch()
          return
        }
        if (touches.current.size !== 1) {
          return
        }
      } else if (!zoomed) {
        // A mouse or pen only drags to pan.
        return
      }
      const scroller = scrollRef.current
      gesture.current = {
        kind: 'press',
        pointerId: event.pointerId,
        touch,
        x: event.clientX,
        y: event.clientY,
        scrollLeft: scroller?.scrollLeft ?? 0,
        scrollTop: scroller?.scrollTop ?? 0,
        samples: [{ x: event.clientX, t: event.timeStamp }],
      }
    },
    [startPinch],
  )

  const onPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    if (touches.current.has(event.pointerId)) {
      touches.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      })
    }
    const current = gesture.current
    const { slotRef, scrollRef, zoomed, stepTarget } = optionsRef.current
    if (current.kind === 'pinch') {
      const [first, second] = [...touches.current.values()]
      if (first && second && slotRef.current) {
        const factor = distance(first, second) / current.startDistance
        slotRef.current.style.transition = 'none'
        slotRef.current.style.transform = `scale(${factor})`
      }
      return
    }
    if (current.kind === 'idle' || current.kind === 'settling') return
    if (event.pointerId !== current.pointerId) return
    // A mouse released outside the stage before the drag began sends us no
    // pointerup; without a button down this is hovering, not panning.
    if (!current.touch && event.buttons === 0) {
      gesture.current = { kind: 'idle' }
      setPanning(false)
      return
    }
    const dx = event.clientX - current.x
    const dy = event.clientY - current.y
    if (current.kind === 'press') {
      const axis = dragAxis(dx, dy)
      if (axis === null) return
      if (zoomed) {
        current.kind = 'pan'
        setPanning(true)
      } else if (current.touch && axis === 'x') {
        current.kind = 'swipe'
      } else {
        gesture.current = { kind: 'idle' }
        return
      }
      suppressClick.current = true
      capture(event.currentTarget, event.pointerId)
    }
    if (current.kind === 'pan') {
      const scroller = scrollRef.current
      if (scroller) {
        scroller.scrollLeft = current.scrollLeft - dx
        scroller.scrollTop = current.scrollTop - dy
      }
      return
    }
    // Swipe: the picture follows the finger.
    current.samples.push({ x: event.clientX, t: event.timeStamp })
    if (current.samples.length > 20) current.samples.shift()
    const offset = swipeOffset(
      dx,
      stepTarget(-1) === 'item',
      stepTarget(1) === 'item',
    )
    const slot = slotRef.current
    if (slot) {
      slot.style.transition = 'none'
      slot.style.transform = `translateX(${offset}px)`
    }
  }, [])

  const finish = useCallback(
    (event: PointerEvent<HTMLElement>, cancelled: boolean) => {
      touches.current.delete(event.pointerId)
      const current = gesture.current
      const { slotRef, scales, onSwipe, onPinch, stepTarget } =
        optionsRef.current
      if (current.kind === 'pinch') {
        if (touches.current.size >= 2) return
        const slot = slotRef.current
        const factor = slot ? readScale(slot) : 1
        resetSlot(slot, false)
        gesture.current =
          touches.current.size > 0 ? { kind: 'settling' } : { kind: 'idle' }
        suppressClick.current = true
        if (!cancelled) {
          onPinch(
            nearestZoom(current.scale * factor, scales().fit),
            current.centre,
          )
        }
        return
      }
      if (current.kind === 'settling') {
        if (touches.current.size === 0) gesture.current = { kind: 'idle' }
        return
      }
      if (current.kind === 'idle' || event.pointerId !== current.pointerId) {
        return
      }
      gesture.current = { kind: 'idle' }
      if (current.kind === 'pan') {
        setPanning(false)
        return
      }
      if (current.kind !== 'swipe') return
      const dx = event.clientX - current.x
      current.samples.push({ x: event.clientX, t: event.timeStamp })
      const direction = cancelled
        ? null
        : swipeDirection(dx, velocityOf(current.samples))
      if (direction !== null && stepTarget(direction) === 'item') {
        resetSlot(slotRef.current, false)
        onSwipe(direction)
        return
      }
      resetSlot(slotRef.current, true)
      if (direction !== null && stepTarget(direction) === 'edge') {
        onSwipe(direction)
      }
    },
    [],
  )

  // A drag that ends sends at most one click right after it; a touch drag
  // usually sends none. So the suppression only lasts a moment.
  const expireSuppression = useCallback(() => {
    if (suppressClick.current) {
      setTimeout(() => {
        suppressClick.current = false
      }, CLICK_AFTER_DRAG_MS)
    }
  }, [])
  const onPointerUp = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      finish(event, false)
      expireSuppression()
    },
    [finish, expireSuppression],
  )
  const onPointerCancel = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      finish(event, true)
      expireSuppression()
    },
    [finish, expireSuppression],
  )

  /**
   * Swallows the click that ends a drag, a swipe or a pinch. Never a
   * keyboard activation (detail 0): Enter or Space on a control after a
   * swipe must still work.
   */
  const onClickCapture = useCallback((event: ReactMouseEvent) => {
    if (suppressClick.current && event.detail !== 0) {
      suppressClick.current = false
      event.stopPropagation()
      event.preventDefault()
    }
  }, [])

  /** A new press starts fresh (a drag that ended outside left no click). */
  const onPointerDownCapture = useCallback(() => {
    suppressClick.current = false
  }, [])

  return {
    panning,
    handlers: {
      onPointerDown,
      onPointerDownCapture,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onClickCapture,
    },
  }
}

/**
 * Keeps the drag's moves coming to the stage when the pointer leaves it.
 * A pointer the browser no longer knows (it lifted already) can't be
 * captured; the drag then just ends with it.
 */
function capture(element: Element, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId)
  } catch {
    // NotFoundError: no active pointer with that id.
  }
}

/** The scale factor a slot's live pinch transform holds. */
function readScale(slot: HTMLElement): number {
  const match = /scale\(([\d.]+)\)/.exec(slot.style.transform)
  const value = match ? Number(match[1]) : 1
  return Number.isFinite(value) && value > 0 ? value : 1
}
