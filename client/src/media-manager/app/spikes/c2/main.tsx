// Spike C2 harness: the grid <-> detail morph with a virtualised grid.
// Not part of the app build (nothing imports it); Vite serves it at
// /src/media-manager/app/spikes/c2/index.html. Query parameters:
//   strategy=a   reveal on exit: scrollToIndex, then poll rAF for the tile
//   strategy=a2  reveal on exit, synchronously: pin the rows, set scrollTop
//   strategy=b   grid follows detail while stepping; exit just reads the tile
//   cv=1         content-visibility:auto on the grid rows
//   morph=proposed  use morph-proposed.ts (C2's proposed core change)
// Playwright drives it through window.c2 (see run-c2.mjs).

import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import {
  type KeyboardEvent,
  StrictMode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import {
  centerApi,
  registerCenter,
} from '../../../core/collection/centerApi.ts'
import { morph as coreMorph } from '../../../core/ui/morph.ts'
import { makeImages } from './images.ts'
import {
  instrumentViewTransitions,
  isPaused,
  records,
  resume,
  setPauseAt,
} from './instrument.ts'
import { morph as proposedMorph } from './morph-proposed.ts'

const COUNT = 50_000
const COLS = 6
const ROWS = Math.ceil(COUNT / COLS)
const ROW_H = 136
const POLL_FRAMES = 60

type Strategy = 'a' | 'a2' | 'b'

const params = new URLSearchParams(location.search)
const strategy: Strategy =
  (['a', 'a2', 'b'] as const).find(
    (value) => value === params.get('strategy'),
  ) ?? 'a2'
const contentVisibility = params.get('cv') === '1'
const useProposed = params.get('morph') === 'proposed'
const morph = useProposed ? proposedMorph : coreMorph
const hasApi = instrumentViewTransitions()

// --- A tiny external store, so morph()'s flushSync(update) commits at once.

interface State {
  detailId: number | null
  returnedId: number | null
}

let state: State = { detailId: null, returnedId: null }
const listeners = new Set<() => void>()

function setState(next: Partial<State>): void {
  state = { ...state, ...next }
  for (const listener of listeners) {
    listener()
  }
}

function useStore(): State {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state,
  )
}

// --- Diagnostics for the `to` side of the exit morph.

interface RevealDiag {
  toMs: number | null
  frames: number
  timeouts: number
  found: boolean
}

let diag: RevealDiag = { toMs: null, frames: 0, timeouts: 0, found: false }

function rowOf(id: number): number {
  return Math.floor(id / COLS)
}

function imgOf(element: Element | null): HTMLImageElement | null {
  return element?.querySelector('img') ?? null
}

/** Polls with rAF (and counts setTimeout ticks alongside, for comparison). */
function pollFrames(
  find: () => HTMLElement | null,
): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    let frames = 0
    const ticker = setInterval(() => {
      diag.timeouts += 1
    }, 16)
    const tick = () => {
      frames += 1
      diag.frames = frames
      const element = find()
      if (element || frames >= POLL_FRAMES) {
        clearInterval(ticker)
        resolve(element)
        return
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
}

// --- Grid

function Tile({
  id,
  image,
  returned,
}: {
  id: number
  image: string
  returned: boolean
}) {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      void openItem(id)
    }
  }
  return (
    <button
      type='button'
      className={returned ? 'tile ring' : 'tile'}
      data-id={id}
      onDoubleClick={() => void openItem(id)}
      onKeyDown={onKeyDown}
    >
      <img src={image} alt='' draggable={false} />
      <span>#{id}</span>
    </button>
  )
}

function Grid({ images }: { images: string[] }) {
  const { detailId, returnedId } = useStore()
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [pinned, setPinned] = useState<number[]>([])
  const rangeExtractor = useCallback(
    (range: Parameters<typeof defaultRangeExtractor>[0]) => {
      const base = defaultRangeExtractor(range)
      if (pinned.length === 0) {
        return base
      }
      return [...new Set([...base, ...pinned])].sort((x, y) => x - y)
    },
    [pinned],
  )
  const virtualizer = useVirtualizer({
    count: ROWS,
    getScrollElement: () => scrollerRef.current,
    estimateSize: () => ROW_H,
    overscan: 2,
    rangeExtractor,
  })

  // Pinned rows only bridge the gap until the virtualizer's own range has
  // caught up with the scroll position (a scroll event later).
  useEffect(() => {
    if (pinned.length === 0) {
      return
    }
    const timer = setTimeout(() => setPinned([]), 1000)
    return () => clearTimeout(timer)
  }, [pinned])

  // Strategy b: the inert grid underneath follows the detail item.
  useLayoutEffect(() => {
    if (strategy === 'b' && detailId !== null) {
      virtualizer.scrollToIndex(rowOf(detailId), { align: 'auto' })
    }
  }, [detailId, virtualizer])

  useEffect(() => {
    const tileElement = (id: number): HTMLElement | null =>
      scrollerRef.current?.querySelector<HTMLElement>(`[data-id="${id}"]`) ??
      null
    const tileInView = (id: number): HTMLElement | null => {
      const tile = tileElement(id)
      const scroller = scrollerRef.current
      if (!tile || !scroller) {
        return null
      }
      const box = tile.getBoundingClientRect()
      const view = scroller.getBoundingClientRect()
      return box.top >= view.top && box.bottom <= view.bottom ? tile : null
    }

    // a: the obvious implementation: ask TanStack to scroll, wait for it.
    const revealByScrolling = (id: number) => {
      const existing = tileInView(id)
      if (existing) {
        return Promise.resolve(existing)
      }
      virtualizer.scrollToIndex(rowOf(id), { align: 'center' })
      return pollFrames(() => tileElement(id))
    }

    // a2: no waiting on scroll events or frames: render the rows that will
    // be visible, then scroll there, all synchronously.
    const revealSynchronously = (id: number) => {
      const existing = tileInView(id)
      const scroller = scrollerRef.current
      if (existing || !scroller) {
        return Promise.resolve(existing)
      }
      const height = scroller.clientHeight
      const top = Math.max(0, rowOf(id) * ROW_H - (height - ROW_H) / 2)
      const first = Math.max(0, Math.floor(top / ROW_H) - 1)
      const last = Math.min(ROWS - 1, Math.ceil((top + height) / ROW_H) + 1)
      const rows = Array.from(
        { length: last - first + 1 },
        (_, index) => first + index,
      )
      flushSync(() => setPinned(rows))
      scroller.scrollTop = top
      return Promise.resolve(tileElement(id))
    }

    return registerCenter({
      revealItem: strategy === 'a' ? revealByScrolling : revealSynchronously,
      tileElement,
      focusTile: (id) => tileElement(id)?.focus(),
    })
  }, [virtualizer])

  useEffect(() => {
    window.c2.scroller = () => scrollerRef.current
  }, [])

  return (
    <div ref={scrollerRef} className='scroller' inert={detailId !== null}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((row) => (
          <div
            key={row.key}
            className={contentVisibility ? 'row cv' : 'row'}
            style={{ transform: `translateY(${row.start}px)` }}
          >
            {Array.from({ length: COLS }, (_, col) => {
              const id = row.index * COLS + col
              if (id >= COUNT) {
                return null
              }
              return (
                <Tile
                  key={id}
                  id={id}
                  image={images[id % images.length] ?? ''}
                  returned={id === returnedId}
                />
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

// --- Detail overlay

function Detail({ id, images }: { id: number; images: string[] }) {
  const stageRef = useRef<HTMLImageElement>(null)
  useEffect(() => registerCenter({ stageElement: () => stageRef.current }), [])
  return (
    <div className='detail'>
      <div className='topbar'>
        <button type='button' onClick={() => void closeDetail()}>
          Back
        </button>
        <span>Item #{id}</span>
        <span className='mono'>
          {id + 1} / {COUNT}
        </span>
      </div>
      <div className='stage'>
        <img ref={stageRef} src={images[id % images.length]} alt='' />
      </div>
    </div>
  )
}

function App({ images }: { images: string[] }) {
  const { detailId } = useStore()
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (state.detailId === null) {
        return
      }
      if (event.key === 'ArrowRight') {
        stepBy(1)
      } else if (event.key === 'ArrowLeft') {
        stepBy(-1)
      } else if (event.key === 'Escape') {
        void closeDetail()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
  return (
    <div className='app'>
      <div className='toolbar'>
        C2 spike · strategy {strategy}
        {contentVisibility ? ' · cv' : ''}
        {useProposed ? ' · proposed morph' : ''}
        {hasApi ? '' : ' · no View Transitions API'}
      </div>
      <div className='folders'>folders</div>
      <div className='centre'>
        <Grid images={images} />
        {detailId !== null && <Detail id={detailId} images={images} />}
      </div>
    </div>
  )
}

// --- Actions (what core's commands would do)

async function openItem(id: number): Promise<void> {
  await morph(() => setState({ detailId: id, returnedId: null }), {
    from: () => imgOf(centerApi.tileElement(id)),
    to: () => centerApi.stageElement(),
  })
}

function stepBy(delta: number): void {
  const current = state.detailId
  if (current === null) {
    return
  }
  const next = Math.min(COUNT - 1, Math.max(0, current + delta))
  flushSync(() => setState({ detailId: next }))
}

function exitTarget(
  id: number,
): () => Promise<Element | null> | Element | null {
  if (strategy === 'b') {
    return () => imgOf(centerApi.tileElement(id))
  }
  return async () => {
    const started = performance.now()
    const tile = await centerApi.revealItem(id)
    diag.found = tile !== null
    diag.toMs = Math.round(performance.now() - started)
    return imgOf(tile)
  }
}

async function closeDetail(): Promise<void> {
  const id = state.detailId
  if (id === null) {
    return
  }
  diag = { toMs: null, frames: 0, timeouts: 0, found: false }
  await morph(() => setState({ detailId: null, returnedId: id }), {
    from: () => centerApi.stageElement(),
    to: exitTarget(id),
  })
}

// --- Hooks for Playwright

function tilePlacement(id: number): 'full' | 'partial' | 'outside' | 'missing' {
  const tile = centerApi.tileElement(id)
  const scroller = window.c2.scroller()
  if (!tile || !scroller) {
    return 'missing'
  }
  const box = tile.getBoundingClientRect()
  const view = scroller.getBoundingClientRect()
  if (box.top >= view.top && box.bottom <= view.bottom) {
    return 'full'
  }
  if (box.bottom > view.top && box.top < view.bottom) {
    return 'partial'
  }
  return 'outside'
}

async function measured(id: number, run: () => Promise<void>) {
  const before = records.length
  const started = performance.now()
  await run()
  return {
    ms: Math.round(performance.now() - started),
    transition: records[before] ?? null,
    tile: tilePlacement(id),
    reveal: { ...diag },
    scrollTop: window.c2.scroller()?.scrollTop ?? null,
  }
}

declare global {
  interface Window {
    c2: {
      ready: boolean
      strategy: Strategy
      hasApi: boolean
      scroller: () => HTMLDivElement | null
      open: (id: number) => Promise<unknown>
      step: (count: number) => number
      close: () => Promise<unknown>
      stepAndClose: (count: number) => Promise<unknown>
      state: () => State & { rendered: number }
      setPauseAt: (value: number | null) => void
      isPaused: () => boolean
      resume: () => void
    }
  }
}

window.c2 = {
  ready: false,
  strategy,
  hasApi,
  scroller: () => null,
  open: (id) => measured(id, () => openItem(id)),
  step: (count) => {
    const started = performance.now()
    for (let index = 0; index < count; index += 1) {
      stepBy(1)
    }
    return Math.round(performance.now() - started)
  },
  close: () => measured(state.detailId ?? -1, closeDetail),
  stepAndClose: (count) => {
    window.c2.step(count)
    return window.c2.close()
  },
  state: () => ({
    ...state,
    rendered: document.querySelectorAll('[data-id]').length,
  }),
  setPauseAt,
  isPaused,
  resume,
}

const css = `
html, body, #root { margin: 0; height: 100%; }
.app { display: grid; grid-template: 48px 1fr / 200px 1fr; height: 100vh; font: 13px system-ui, sans-serif; }
.toolbar { grid-column: 1 / 3; background: #222; color: #fff; display: flex; align-items: center; padding: 0 12px; }
.folders { background: #eee; padding: 12px; }
.centre { position: relative; overflow: hidden; }
.scroller { position: absolute; inset: 0; overflow: auto; }
.row { position: absolute; top: 0; left: 0; right: 0; height: ${ROW_H}px; box-sizing: border-box; padding: 4px 8px; display: grid; grid-template-columns: repeat(${COLS}, 1fr); gap: 8px; }
.row.cv { content-visibility: auto; contain-intrinsic-size: auto ${ROW_H}px; }
.tile { position: relative; border: 0; padding: 0; background: #ddd; border-radius: 6px; overflow: hidden; }
.tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
.tile span { position: absolute; left: 4px; bottom: 4px; color: #fff; font-size: 11px; text-shadow: 0 0 2px #000; }
.tile.ring { animation: c2-ring 1.2s ease-out forwards; }
@keyframes c2-ring { from { box-shadow: inset 0 0 0 3px #39ff14; } to { box-shadow: inset 0 0 0 3px transparent; } }
.detail { position: absolute; inset: 0; z-index: 1; background: #111; color: #eee; display: flex; flex-direction: column; }
.topbar { height: 40px; display: flex; gap: 12px; align-items: center; padding: 0 12px; }
.mono { font-family: ui-monospace, monospace; }
.stage { flex: 1; min-height: 0; padding: 16px 40px; display: flex; align-items: center; justify-content: center; }
.stage img { height: 100%; max-width: 100%; aspect-ratio: 4 / 3; object-fit: contain; }
::view-transition-group(mm-hero) { animation-duration: 260ms; }
`

async function boot(): Promise<void> {
  const style = document.createElement('style')
  style.textContent = css
  document.head.append(style)
  const images = await makeImages(8)
  const root = document.getElementById('root')
  if (!root) {
    return
  }
  createRoot(root).render(
    <StrictMode>
      <App images={images} />
    </StrictMode>,
  )
  requestAnimationFrame(() => {
    window.c2.ready = true
  })
}

void boot()
