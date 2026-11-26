import { describe, expect, it } from 'vitest'
import {
  COMMIT_PX,
  dragAxis,
  nearestZoom,
  RESISTANCE,
  SLOP_PX,
  swipeDirection,
  swipeOffset,
  velocityOf,
} from './gestures'

describe('dragAxis', () => {
  it('is undecided inside the slop, so a tap stays a tap', () => {
    expect(dragAxis(SLOP_PX - 1, 0)).toBeNull()
    expect(dragAxis(3, 3)).toBeNull()
  })

  it('picks the axis the finger moved most along', () => {
    expect(dragAxis(-20, 5)).toBe('x')
    expect(dragAxis(4, 30)).toBe('y')
  })
})

describe('swipeOffset', () => {
  it('follows the finger where there is an item that way', () => {
    expect(swipeOffset(-120, true, true)).toBe(-120)
    expect(swipeOffset(80, true, false)).toBe(80)
  })

  it('resists where there is nothing further (system.md §5)', () => {
    // Moving left heads for the next item; at the last one it resists.
    expect(swipeOffset(-100, true, false)).toBeCloseTo(-100 * RESISTANCE)
    expect(swipeOffset(100, false, true)).toBeCloseTo(100 * RESISTANCE)
  })
})

describe('velocityOf', () => {
  it('measures over the last 100 ms only', () => {
    const samples = [
      { x: 0, t: 0 },
      { x: 10, t: 400 },
      { x: 20, t: 450 },
      { x: 70, t: 500 },
    ]
    // From the oldest sample within 100 ms of the last one (x 10 at 400 ms).
    expect(velocityOf(samples)).toBeCloseTo((70 - 10) / 100)
  })

  it('is 0 without movement in time', () => {
    expect(velocityOf([])).toBe(0)
    expect(velocityOf([{ x: 5, t: 10 }])).toBe(0)
  })
})

describe('swipeDirection', () => {
  it('commits past 64 px, leftwards to the next item', () => {
    expect(swipeDirection(-COMMIT_PX, 0)).toBe(1)
    expect(swipeDirection(COMMIT_PX + 10, 0)).toBe(-1)
  })

  it('commits on a fast flick in the same direction', () => {
    expect(swipeDirection(-30, -0.8)).toBe(1)
    expect(swipeDirection(30, 0.8)).toBe(-1)
  })

  it('snaps back on a short, slow drag, a tiny flick or a flick back', () => {
    expect(swipeDirection(-40, -0.1)).toBeNull()
    expect(swipeDirection(-10, -2)).toBeNull()
    expect(swipeDirection(-40, 0.9)).toBeNull()
  })
})

describe('nearestZoom', () => {
  it('settles on the level nearest on a log scale', () => {
    // Fit shows a large photo at 30 % of its pixels.
    expect(nearestZoom(0.32, 0.3)).toBe('fit')
    expect(nearestZoom(0.6, 0.3)).toBe(0.5)
    expect(nearestZoom(1.3, 0.3)).toBe(1)
    expect(nearestZoom(1.6, 0.3)).toBe(2)
    expect(nearestZoom(5, 0.3)).toBe(2)
  })

  it('prefers Fit when Fit and a level are the same size', () => {
    // A small image: Fit is 100 %.
    expect(nearestZoom(1, 1)).toBe('fit')
  })

  it('pinching in goes back to Fit', () => {
    expect(nearestZoom(0.1, 0.3)).toBe('fit')
  })
})
