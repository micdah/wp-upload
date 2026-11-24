import { describe, expect, it } from 'vitest'
import { MEDIA_KINDS, ROW_STRIDE } from '../../../../../../shared/library-api'
import {
  aspectRatio,
  captureScrollAnchor,
  computeJustifiedLayout,
  DENSITIES,
  DOCUMENT_ASPECT,
  firstRowBelow,
  GRID_GAP,
  rowOfItem,
  scrollTopForAnchor,
  scrollTopToReveal,
  verticalNeighbour,
  withPinnedIndex,
} from './justifiedLayout'
import { syntheticCollectionRows } from './syntheticCollection'

// Spike C1, the pure part: correctness of the ported justified layout and the
// helpers around it, plus its speed at 50k and 100k items (plan §9: ≤ 50 ms
// at 50k). Timings are logged for the decision note and only asserted
// against a generous ceiling, so slower CI hardware doesn't flake.

const KIND = (name: (typeof MEDIA_KINDS)[number]) => MEDIA_KINDS.indexOf(name)

/** Rows for items given as [width, height, kind?]. */
function rowsOf(items: Array<[number, number, number?]>): number[] {
  return items.flatMap(([width, height, kind = 0], index) => [
    index + 1,
    width,
    height,
    kind,
  ])
}

function rowWidth(
  layout: ReturnType<typeof computeJustifiedLayout>,
  row: number,
): number {
  const start = layout.rowStart[row] as number
  const end = layout.rowStart[row + 1] as number
  let width = 0
  for (let i = start; i < end; i++) width += layout.itemWidth[i] as number
  return width + layout.gap * (end - start - 1)
}

describe('aspectRatio', () => {
  it('uses the pixel size, squares for audio, archives and unknown sizes', () => {
    expect(aspectRatio(4000, 3000, KIND('image'))).toBeCloseTo(4 / 3)
    expect(aspectRatio(1920, 1080, KIND('video'))).toBeCloseTo(16 / 9)
    expect(aspectRatio(4000, 3000, KIND('audio'))).toBe(1)
    expect(aspectRatio(0, 0, KIND('archive'))).toBe(1)
    expect(aspectRatio(0, 0, KIND('image'))).toBe(1)
    expect(aspectRatio(800, 600, KIND('document'))).toBe(DOCUMENT_ASPECT)
    // Unknown kind codes behave like `other`.
    expect(aspectRatio(200, 100, 99)).toBe(2)
  })
})

describe('computeJustifiedLayout', () => {
  const options = { containerWidth: 1000, targetHeight: 200, gap: 2 }

  it('packs rows like the prototype and fits full rows to the width', () => {
    // Ratios 1.5 each: 3 tiles at 200 px = 900 + 4 < 1000, the 4th closes it.
    const layout = computeJustifiedLayout(
      rowsOf(Array.from({ length: 10 }, () => [300, 200] as [number, number])),
      options,
    )
    expect(Array.from(layout.rowStart)).toEqual([0, 4, 8, 10])
    const fullHeight = (1000 - 3 * 2) / 6
    expect(layout.rowHeight[0]).toBeCloseTo(fullHeight)
    expect(rowWidth(layout, 0)).toBeCloseTo(1000, 9)
    expect(rowWidth(layout, 1)).toBeCloseTo(1000, 9)
    // The last row keeps the target height and is not stretched.
    expect(layout.rowHeight[2]).toBe(200)
    expect(layout.itemWidth[9]).toBeCloseTo(300)
    expect(layout.rowTop[1]).toBeCloseTo(fullHeight + 2)
    expect(layout.totalHeight).toBeCloseTo(2 * fullHeight + 200 + 2 * 2)
  })

  it('places items left to right with the gap between them', () => {
    const layout = computeJustifiedLayout(
      rowsOf([
        [400, 200],
        [200, 200],
        [600, 200],
      ]),
      options,
    )
    expect(layout.itemX[0]).toBe(0)
    expect(layout.itemX[1]).toBeCloseTo((layout.itemWidth[0] as number) + 2)
    expect(rowWidth(layout, 0)).toBeCloseTo(1000, 9)
  })

  it('gives a very wide panorama a row of its own', () => {
    const layout = computeJustifiedLayout(
      rowsOf([
        [8000, 500],
        [300, 200],
      ]),
      options,
    )
    expect(layout.rowCount).toBe(2)
    expect(layout.itemWidth[0]).toBeCloseTo(1000)
    expect(layout.rowHeight[0]).toBeCloseTo(62.5)
  })

  it('handles an empty collection and a degenerate width', () => {
    const empty = computeJustifiedLayout([], options)
    expect(empty.rowCount).toBe(0)
    expect(empty.totalHeight).toBe(0)
    const narrow = computeJustifiedLayout(rowsOf([[300, 200]]), {
      ...options,
      containerWidth: 0,
    })
    expect(narrow.rowCount).toBe(1)
  })

  it('keeps every full row exactly as wide as the container at 50k', () => {
    const rows = syntheticCollectionRows(50_000)
    const layout = computeJustifiedLayout(rows, {
      containerWidth: 1237,
      targetHeight: 160,
      gap: GRID_GAP,
    })
    expect(layout.count).toBe(rows.length / ROW_STRIDE)
    expect(layout.rowStart[layout.rowCount]).toBe(layout.count)
    for (let row = 0; row < layout.rowCount - 1; row++) {
      expect(Math.abs(rowWidth(layout, row) - 1237)).toBeLessThan(1e-6)
    }
  })
})

describe('lookups and neighbours', () => {
  // Two rows of four 1.5:1 tiles, then a last row of two.
  const layout = computeJustifiedLayout(
    rowsOf(Array.from({ length: 10 }, () => [300, 200] as [number, number])),
    { containerWidth: 1000, targetHeight: 200, gap: 2 },
  )

  it('finds an item’s row and the first row below an offset', () => {
    expect(rowOfItem(layout, 0)).toBe(0)
    expect(rowOfItem(layout, 3)).toBe(0)
    expect(rowOfItem(layout, 4)).toBe(1)
    expect(rowOfItem(layout, 9)).toBe(2)
    expect(firstRowBelow(layout, 0)).toBe(0)
    expect(firstRowBelow(layout, (layout.rowHeight[0] as number) + 1)).toBe(1)
    expect(firstRowBelow(layout, 1e9)).toBe(2)
  })

  it('moves ↑/↓ to the nearest centre and stays put at the edges', () => {
    expect(verticalNeighbour(layout, 1, 1)).toBe(5)
    expect(verticalNeighbour(layout, 5, -1)).toBe(1)
    expect(verticalNeighbour(layout, 7, 1)).toBe(9)
    expect(verticalNeighbour(layout, 2, -1)).toBe(2)
    expect(verticalNeighbour(layout, 9, 1)).toBe(9)
  })

  it('adds a pinned row to the virtualiser range, keeping it sorted', () => {
    expect(withPinnedIndex([5, 6, 7], null)).toEqual([5, 6, 7])
    expect(withPinnedIndex([5, 6, 7], 6)).toEqual([5, 6, 7])
    expect(withPinnedIndex([5, 6, 7], 1)).toEqual([1, 5, 6, 7])
    expect(withPinnedIndex([5, 6, 7], 90)).toEqual([5, 6, 7, 90])
    expect(withPinnedIndex([], 3)).toEqual([3])
  })

  it('reveals a row with the least scrolling', () => {
    const second = layout.rowTop[1] as number
    expect(scrollTopToReveal(layout, 1, 0, 1000)).toBe(0)
    expect(scrollTopToReveal(layout, 0, second, 300)).toBe(0)
    // Below the viewport: align its bottom with the viewport's bottom…
    expect(scrollTopToReveal(layout, 2, 0, 300)).toBeCloseTo(
      (layout.rowTop[2] as number) + 200 - 300,
    )
    // …unless it is taller than the viewport: then align its top.
    expect(scrollTopToReveal(layout, 2, 0, 100)).toBe(layout.rowTop[2])
  })

  it('anchors the focused item, or the first visible one, across re-layouts', () => {
    const rows = syntheticCollectionRows(5000)
    const wide = computeJustifiedLayout(rows, {
      containerWidth: 1200,
      targetHeight: 200,
      gap: 2,
    })
    const narrow = computeJustifiedLayout(rows, {
      containerWidth: 700,
      targetHeight: 200,
      gap: 2,
    })
    const focused = 2345
    const focusedTop = wide.rowTop[rowOfItem(wide, focused)] as number
    const scrollTop = focusedTop - 120
    const anchor = captureScrollAnchor(wide, scrollTop, 800, focused)
    expect(anchor).toEqual({ index: focused, offset: 120 })
    const restored = scrollTopForAnchor(
      narrow,
      anchor as NonNullable<typeof anchor>,
    )
    expect(
      (narrow.rowTop[rowOfItem(narrow, focused)] as number) - restored,
    ).toBe(120)

    // A focused item far away doesn't anchor: the first visible row does.
    const away = captureScrollAnchor(wide, 0, 800, focused)
    expect(away).toEqual({ index: 0, offset: 0 })
  })
})

describe('layout speed (logged for docs/media-manager/tracks/spikes/C1.md)', () => {
  // Medians of several runs, after a warm-up, so JIT start-up isn't counted.
  function medianMs(run: () => void, repeats = 7): number {
    run()
    const times: number[] = []
    for (let i = 0; i < repeats; i++) {
      const start = performance.now()
      run()
      times.push(performance.now() - start)
    }
    times.sort((a, b) => a - b)
    return times[Math.floor(times.length / 2)] as number
  }

  it.each([50_000, 100_000])(
    'lays out %i items well within budget',
    (count) => {
      const rows = syntheticCollectionRows(count)
      const results: string[] = []
      let worst = 0
      for (const containerWidth of [390, 1264, 2520]) {
        for (const targetHeight of [DENSITIES[0], DENSITIES[2], DENSITIES[4]]) {
          const ms = medianMs(() =>
            computeJustifiedLayout(rows, {
              containerWidth,
              targetHeight,
              gap: GRID_GAP,
            }),
          )
          worst = Math.max(worst, ms)
          results.push(
            `${containerWidth}px@${targetHeight}: ${ms.toFixed(2)} ms`,
          )
        }
      }
      console.log(`[C1] node layout ${count}: ${results.join(', ')}`)
      // Budget is 50 ms at 50k; 4× headroom for slow CI machines.
      expect(worst).toBeLessThan(count === 50_000 ? 200 : 400)
    },
  )
})
