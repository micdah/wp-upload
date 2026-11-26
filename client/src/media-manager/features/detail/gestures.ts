// The stage's touch gestures as pure functions (tested in Node):
//
// - swipe to step (system.md §5): the picture follows the finger, with
//   resistance where there is nothing further, and commits past 64 px or
//   on a fast flick;
// - pinch to zoom: the pinch scales the picture live, and settles on the
//   nearest of the zoom levels (Fit, 50, 100, 200 %) when the fingers lift.
//
// Stage.tsx feeds them pointer events.

import type { ZoomLevel } from '../../core/state/store'

/** Movement before a press becomes a drag (a tap stays a tap). */
export const SLOP_PX = 8
/** A released swipe this far commits (system.md §5). */
export const COMMIT_PX = 64
/** A release this fast commits too (a flick), if it moved at least FLICK_MIN_PX. */
export const FLICK_PX_PER_MS = 0.5
export const FLICK_MIN_PX = 16
/** How much of the finger's travel the picture follows at an end. */
export const RESISTANCE = 0.35
/** The pointer samples a release's velocity is measured over. */
export const VELOCITY_WINDOW_MS = 100

/** Which way a drag goes once it passed the slop; null while it hasn't. */
export function dragAxis(dx: number, dy: number): 'x' | 'y' | null {
  if (Math.hypot(dx, dy) < SLOP_PX) {
    return null
  }
  return Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
}

/**
 * Where the picture sits while a swipe follows the finger. Moving left
 * (dx < 0) heads for the next item; where there is none, it moves only a
 * fraction of the way.
 */
export function swipeOffset(
  dx: number,
  canPrevious: boolean,
  canNext: boolean,
): number {
  const towardNext = dx < 0
  const open = towardNext ? canNext : canPrevious
  return open ? dx : dx * RESISTANCE
}

export interface PointerSample {
  x: number
  /** milliseconds */
  t: number
}

/** px/ms over the last VELOCITY_WINDOW_MS of samples (0 with fewer than two). */
export function velocityOf(samples: readonly PointerSample[]): number {
  const last = samples.at(-1)
  if (!last) {
    return 0
  }
  let first = last
  for (let index = samples.length - 1; index >= 0; index -= 1) {
    const sample = samples[index] as PointerSample
    if (last.t - sample.t > VELOCITY_WINDOW_MS) {
      break
    }
    first = sample
  }
  const elapsed = last.t - first.t
  return elapsed > 0 ? (last.x - first.x) / elapsed : 0
}

/**
 * What a released swipe asks for: the direction to step (1 = next, the
 * finger moved left), or null to snap back. Whether there is an item that
 * way is the caller's question; at an end the step nudges (D34).
 */
export function swipeDirection(dx: number, velocity: number): 1 | -1 | null {
  const far = Math.abs(dx) >= COMMIT_PX
  const flick =
    Math.abs(velocity) >= FLICK_PX_PER_MS &&
    Math.abs(dx) >= FLICK_MIN_PX &&
    Math.sign(velocity) === Math.sign(dx)
  if (!far && !flick) {
    return null
  }
  return dx < 0 ? 1 : -1
}

/** The distance between two touches. */
export function distance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * The zoom level nearest to a picture shown at `scale` × its own pixels,
 * compared on a log scale (a pinch is multiplicative). `fitScale` is the
 * scale Fit shows the picture at; Fit wins a tie.
 */
export function nearestZoom(scale: number, fitScale: number): ZoomLevel {
  const candidates: [ZoomLevel, number][] = [
    ['fit', fitScale],
    [0.5, 0.5],
    [1, 1],
    [2, 2],
  ]
  const target = Math.log(Math.max(scale, 1e-6))
  let best: ZoomLevel = 'fit'
  let bestDistance = Number.POSITIVE_INFINITY
  for (const [level, value] of candidates) {
    const gap = Math.abs(Math.log(Math.max(value, 1e-6)) - target)
    if (gap < bestDistance - 1e-9) {
      best = level
      bestDistance = gap
    }
  }
  return best
}
