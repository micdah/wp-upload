import { act, screen } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { getCurrentCollection } from '../../core/collection/hooks'
import { urlStore } from '../../core/url/useUrlState'
import { cleanupLibrary, renderLibrary } from '../../test/renderLibrary'
import { computeJustifiedLayout, DENSITIES, GRID_GAP } from './justifiedLayout'

// Plan §9 at 50k in mock mode (A1 brief §7): the real app over the
// `large` mock scenario (50 000 items), in Chromium. It measures
//
// - the justified layout of the whole collection, at every density and in
//   both layouts (budget: 50 ms, asserted);
// - long tasks while scrolling through the grid, tiles hydrating as they come
//   into view;
// - and, for the record, density and layout switches and select all.
//
// This runs React's development build inside Vitest's iframe, with MSW
// answering on the same main thread, so its scrolling numbers are a
// pessimistic upper bound: they only have to stay clear of a frozen UI
// here. The scrolling budget itself (no long task over 50 ms) is asserted
// on the production mock build by e2e/mock/a1-perf.spec.ts. The `[A1 perf]`
// lines are the numbers in the A1 handoff.

afterEach(cleanupLibrary)

vi.mock('../inspector', () => ({
  InspectorPanel: () => null,
  register: () => {},
}))

const LAYOUT_BUDGET_MS = 50
/** Development React in an iframe: a frozen UI, not the 50 ms budget. */
const FROZEN_MS = 400

function nextFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve))
}

async function frames(count: number): Promise<void> {
  for (let index = 0; index < count; index++) await nextFrame()
}

/** Long tasks (main-thread blocks over 50 ms) while `run` runs. */
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

function median(values: number[]): number {
  return percentile(values, 0.5)
}

/**
 * Keeps the mock's placeholder pictures out of the measurement. They are
 * SVGs that MSW generates on the main thread, and Chromium rasterises SVG
 * images on the main thread too, so at 25 new tiles a frame they dominate a
 * profile (85 % of it) and say nothing about the app: real renditions are
 * JPEGs from WordPress, decoded off the main thread (`decoding=async`). The
 * e2e perf flow measures with them, for the record.
 */
function withoutMockPictures(): () => void {
  const prototype = HTMLImageElement.prototype
  const setAttribute = prototype.setAttribute
  const src = Object.getOwnPropertyDescriptor(prototype, 'src')
  const isMock = (value: unknown) => String(value).includes('mock-media')
  prototype.setAttribute = function (name: string, value: string) {
    if (name === 'src' && isMock(value)) return
    setAttribute.call(this, name, value)
  }
  Object.defineProperty(prototype, 'src', {
    ...src,
    set(value: string) {
      if (!isMock(value)) src?.set?.call(this, value)
    },
  })
  return () => {
    prototype.setAttribute = setAttribute
    if (src) Object.defineProperty(prototype, 'src', src)
  }
}

function scroller(): HTMLElement {
  return document.querySelector<HTMLElement>(
    '[data-mm-grid-scroll]',
  ) as HTMLElement
}

async function scrollTo(top: number): Promise<void> {
  await act(async () => {
    scroller().scrollTop = top
    scroller().dispatchEvent(new Event('scroll'))
    await nextFrame()
  })
}

/** Runs `change` and waits until the app has painted it; returns the ms. */
async function timed(change: () => void | Promise<void>): Promise<number> {
  const start = performance.now()
  await act(async () => {
    await change()
  })
  await frames(1)
  return performance.now() - start
}

describe('the grid at 50k (plan §9)', () => {
  it('meets the layout and scrolling budgets', {
    timeout: 120_000,
  }, async () => {
    const user = userEvent.setup()
    onTestFinished(withoutMockPictures())
    await renderLibrary({ scenario: 'large' })
    const collection = getCurrentCollection()
    expect(collection?.total).toBe(50_000)
    const rows = collection?.rows.snapshot.rows as ArrayLike<number>
    const width = scroller().clientWidth - 32

    // Layout: every density, both layouts, 5 runs each (median, and worst).
    const layout: string[] = []
    let worstLayout = 0
    for (const square of [false, true]) {
      for (const targetHeight of DENSITIES) {
        const runs: number[] = []
        for (let run = 0; run < 5; run++) {
          const start = performance.now()
          computeJustifiedLayout(rows, {
            containerWidth: width,
            targetHeight,
            gap: GRID_GAP,
            square,
          })
          runs.push(performance.now() - start)
        }
        worstLayout = Math.max(worstLayout, ...runs)
        layout.push(
          `${square ? 'square' : 'justified'}@${targetHeight}: ${median(runs).toFixed(1)}`,
        )
      }
    }
    console.log(
      `[A1 perf] layout of 50k at ${width} px (median ms): ${layout.join(', ')}; worst ${worstLayout.toFixed(1)} ms`,
    )
    expect(worstLayout).toBeLessThanOrEqual(LAYOUT_BUDGET_MS)

    // Scrolling the real grid: 200 one-viewport steps, then 60 scrollbar
    // jumps across the whole height. Tiles hydrate as they come into view.
    await frames(5)
    const total = scroller().scrollHeight
    const step = scroller().clientHeight
    const frameTimes: number[] = []
    const scrolling = await longTasksDuring(async () => {
      for (let index = 0; index < 200; index++) {
        const start = performance.now()
        await scrollTo(index * step)
        frameTimes.push(performance.now() - start)
      }
      for (let index = 0; index < 60; index++) {
        const start = performance.now()
        await scrollTo(((index * 7919) % 100) * (total / 100))
        frameTimes.push(performance.now() - start)
      }
    })
    console.log(
      `[A1 perf] scroll 260 steps over ${Math.round(total)} px: frame p50 ${median(frameTimes).toFixed(1)} ms, p95 ${percentile(frameTimes, 0.95).toFixed(1)} ms, max ${Math.max(...frameTimes).toFixed(1)} ms; long tasks ${scrolling.length} (max ${Math.max(0, ...scrolling).toFixed(0)} ms)`,
    )
    expect(scrolling.filter((ms) => ms > FROZEN_MS)).toEqual([])

    // For the record: switches at 50k, from a focused tile mid-grid.
    await scrollTo(total / 2)
    await frames(3)
    const tile = screen.getAllByRole('gridcell')[4] as HTMLElement
    await user.click(tile)
    const switches: string[] = []
    let worstSwitch = 0
    const record = async (name: string, change: () => void) => {
      const ms = await timed(change)
      worstSwitch = Math.max(worstSwitch, ms)
      switches.push(`${name} ${ms.toFixed(0)}`)
    }
    const switchTasks = await longTasksDuring(async () => {
      await record('density +', () => urlStore().navigate({ density: 3 }))
      await record('density -', () => urlStore().navigate({ density: 2 }))
      await record('square', () => urlStore().navigate({ layout: 'square' }))
      await record('justified', () =>
        urlStore().navigate({ layout: 'justified' }),
      )
    })
    const selectAll = await longTasksDuring(async () => {
      await user.keyboard('{Control>}a{/Control}')
      await frames(2)
    })
    console.log(
      `[A1 perf] switches at 50k (ms, to the next frame): ${switches.join(', ')}; long tasks ${switchTasks.length} (max ${Math.max(0, ...switchTasks).toFixed(0)} ms); select all: long tasks ${selectAll.length} (max ${Math.max(0, ...selectAll).toFixed(0)} ms)`,
    )
    expect(worstSwitch).toBeLessThan(1000)
  })
})
