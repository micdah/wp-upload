import { act } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '../../renderWithProviders'
import {
  computeJustifiedLayout,
  DENSITIES,
  GRID_GAP,
  rowOfItem,
} from './justifiedLayout'
import { syntheticCollectionRows } from './syntheticCollection'
import { VirtualJustifiedGrid } from './VirtualJustifiedGrid'

// Spike C1 in Chromium: the 50k justified grid under TanStack Virtual.
// Measures layout time in the browser, long tasks and frame times while
// scrolling, and checks focus pinning and resize anchoring. The numbers are
// logged for docs/media-manager/tracks/spikes/C1.md; timings are asserted
// only against generous ceilings so slow CI machines don't flake.

const COUNT = 50_000
const rows = syntheticCollectionRows(COUNT)
const VIEWPORT = { width: 1000, height: 700 }

function nextFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve))
}

async function frames(count: number) {
  for (let i = 0; i < count; i++) await nextFrame()
}

/** Collects long tasks (> 50 ms main-thread blocks) while `run` runs. */
async function longTasksDuring(run: () => Promise<void>): Promise<number[]> {
  const durations: number[] = []
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) durations.push(entry.duration)
  })
  observer.observe({ type: 'longtask', buffered: false })
  await run()
  await frames(2)
  for (const entry of observer.takeRecords()) durations.push(entry.duration)
  observer.disconnect()
  return durations
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0
}

function renderGrid(
  width = VIEWPORT.width,
  targetHeight: number = DENSITIES[2],
) {
  const result = renderWithProviders(
    <VirtualJustifiedGrid
      rows={rows}
      width={width}
      height={VIEWPORT.height}
      targetHeight={targetHeight}
    />,
  )
  const scroller = result.getByTestId('grid-scroll')
  const rerender = (nextWidth: number) =>
    result.rerender(
      <VirtualJustifiedGrid
        rows={rows}
        width={nextWidth}
        height={VIEWPORT.height}
        targetHeight={targetHeight}
      />,
    )
  return { ...result, scroller, rerender }
}

/** Scrolls to `top` and waits for the virtualiser to render it. */
async function scrollTo(scroller: HTMLElement, top: number) {
  await act(async () => {
    scroller.scrollTop = top
    scroller.dispatchEvent(new Event('scroll'))
    await nextFrame()
  })
}

describe('spike C1: justified grid + TanStack Virtual at 50k', () => {
  it('lays out 50k items in the browser within budget', () => {
    const times: string[] = []
    let worst = 0
    for (const width of [390, 1000, 2520]) {
      for (const targetHeight of DENSITIES) {
        const start = performance.now()
        computeJustifiedLayout(rows, {
          containerWidth: width,
          targetHeight,
          gap: GRID_GAP,
        })
        const ms = performance.now() - start
        worst = Math.max(worst, ms)
        times.push(`${width}@${targetHeight}: ${ms.toFixed(1)}`)
      }
    }
    console.log(`[C1] browser layout 50k (ms): ${times.join(', ')}`)
    expect(worst).toBeLessThan(200)
  })

  it('mounts only the visible rows', async () => {
    const { container } = renderGrid()
    await act(() => frames(2))
    const mountedTiles = container.querySelectorAll('[role="gridcell"]').length
    const mountedRows = container.querySelectorAll('[role="row"]').length
    console.log(
      `[C1] mounted: ${mountedRows} rows, ${mountedTiles} tiles of ${COUNT}`,
    )
    expect(mountedTiles).toBeGreaterThan(0)
    expect(mountedTiles).toBeLessThan(200)
  })

  it('scrolls through the whole grid without long tasks', async () => {
    const { scroller } = renderGrid()
    await act(() => frames(2))
    const total = scroller.scrollHeight
    const frameTimes: number[] = []
    const longTasks = await longTasksDuring(async () => {
      // Smooth scrolling: one viewport per frame for 300 frames…
      for (let i = 0; i < 300; i++) {
        const start = performance.now()
        await scrollTo(scroller, i * VIEWPORT.height)
        frameTimes.push(performance.now() - start)
      }
      // …then scrollbar drags: 100 jumps across the whole height.
      for (let i = 0; i < 100; i++) {
        const start = performance.now()
        await scrollTo(scroller, ((i * 7919) % 100) * (total / 100))
        frameTimes.push(performance.now() - start)
      }
    })
    console.log(
      `[C1] scroll 400 steps over ${Math.round(total)} px: frame p50 ${percentile(frameTimes, 0.5).toFixed(1)} ms, p95 ${percentile(frameTimes, 0.95).toFixed(1)} ms, max ${Math.max(...frameTimes).toFixed(1)} ms; long tasks: ${longTasks.length} (max ${Math.max(0, ...longTasks).toFixed(0)} ms)`,
    )
    expect(Math.max(0, ...longTasks)).toBeLessThan(200)
  })

  it('keeps the focused tile mounted and focused when scrolled far away', async () => {
    const { scroller, container } = renderGrid()
    await act(() => frames(2))
    const tile = container.querySelector<HTMLElement>('[data-index="3"]')
    if (!tile) throw new Error('tile 3 not rendered')
    act(() => tile.focus())
    await scrollTo(scroller, scroller.scrollHeight / 2)
    await scrollTo(scroller, scroller.scrollHeight - VIEWPORT.height)
    expect(tile.isConnected).toBe(true)
    expect(document.activeElement).toBe(tile)

    // Arrow keys keep working from the far-away pinned tile: focus moves and
    // the grid scrolls back to it.
    await act(async () => {
      tile.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
      )
      await frames(3)
    })
    const active = document.activeElement as HTMLElement
    expect(Number(active.dataset.index)).toBeGreaterThan(3)
    expect(scroller.scrollTop).toBeLessThan(VIEWPORT.height)
  })

  it('keeps the focused item in place when the width changes', async () => {
    const view = renderGrid(1000)
    await act(() => frames(2))
    const target = 20_000
    const before = computeJustifiedLayout(rows, {
      containerWidth: 1000,
      targetHeight: DENSITIES[2],
      gap: GRID_GAP,
    })
    const rowTop = before.rowTop[rowOfItem(before, target)] as number
    await scrollTo(view.scroller, rowTop - 150)
    const tile = view.container.querySelector<HTMLElement>(
      `[data-index="${target}"]`,
    )
    if (!tile) throw new Error('target tile not rendered')
    act(() => tile.focus())
    const offsetBefore =
      tile.getBoundingClientRect().top -
      view.scroller.getBoundingClientRect().top

    for (const width of [760, 1280, 1000]) {
      const longTasks = await longTasksDuring(async () => {
        await act(async () => {
          view.rerender(width)
          await frames(2)
        })
      })
      expect(longTasks).toEqual([])
      const moved = view.container.querySelector<HTMLElement>(
        `[data-index="${target}"]`,
      )
      if (!moved) throw new Error(`target tile not rendered at ${width}`)
      const offset =
        moved.getBoundingClientRect().top -
        view.scroller.getBoundingClientRect().top
      expect(Math.abs(offset - offsetBefore)).toBeLessThan(1)
      expect(document.activeElement).toBe(moved)
    }
  })

  it('keeps the first visible item in place when nothing is focused', async () => {
    const view = renderGrid(1000)
    await act(() => frames(2))
    await scrollTo(view.scroller, 500_000)
    const firstRow = view.container.querySelector<HTMLElement>(`[data-row]`)
    // The first mounted row is overscan; find the first visible one.
    const scrollerTop = view.scroller.getBoundingClientRect().top
    const visible = [
      ...view.container.querySelectorAll<HTMLElement>('[data-row]'),
    ]
      .filter((row) => row.getBoundingClientRect().bottom > scrollerTop)
      .sort(
        (a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top,
      )[0]
    expect(firstRow).not.toBeNull()
    const firstItem = visible?.querySelector<HTMLElement>('[data-index]')
    if (!firstItem) throw new Error('no visible item')
    const index = firstItem.dataset.index
    const offsetBefore = firstItem.getBoundingClientRect().top - scrollerTop

    await act(async () => {
      view.rerender(700)
      await frames(2)
    })
    const after = view.container.querySelector<HTMLElement>(
      `[data-index="${index}"]`,
    )
    if (!after) throw new Error('anchor item not rendered after resize')
    expect(
      Math.abs(after.getBoundingClientRect().top - scrollerTop - offsetBefore),
    ).toBeLessThan(1)
  })
})
