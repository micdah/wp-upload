import {
  defaultRangeExtractor,
  type Range,
  useVirtualizer,
} from '@tanstack/react-virtual'
import {
  type KeyboardEvent,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { ROW_STRIDE } from '../../../../../../shared/library-api'
import {
  captureScrollAnchor,
  computeJustifiedLayout,
  GRID_GAP,
  type JustifiedLayout,
  rowOfItem,
  type ScrollAnchor,
  scrollTopForAnchor,
  scrollTopToReveal,
  verticalNeighbour,
  withPinnedIndex,
} from './justifiedLayout'

// Spike C1: a virtualised justified grid. Only the visible rows (plus
// overscan, plus the focused tile's row) are in the DOM; every row's size is
// known exactly from the layout, so the virtualiser never measures.
//
// What it demonstrates for A1:
// - the layout is recomputed (≈ 2 ms at 50k) whenever the width or density
//   changes, and fed to TanStack Virtual as exact row sizes;
// - `rangeExtractor` pins the focused row, so the focused element never
//   unmounts and DOM focus survives any scroll;
// - a scroll anchor (the focused item if visible, else the first visible
//   item) is kept up to date on scroll and restored after a re-layout, so a
//   resize doesn't throw the user to a different part of the library;
// - arrow keys move focus with the ported ↑/↓ rule, focusing with
//   `preventScroll` and scrolling by the least amount.

export interface VirtualJustifiedGridProps {
  /** `CollectionResponse.rows` */
  rows: ArrayLike<number>
  /** Inner width the layout fills, in px (A1 reads it from a ResizeObserver). */
  width: number
  /** Viewport height, in px. */
  height: number
  targetHeight: number
  overscan?: number
}

export function VirtualJustifiedGrid({
  rows,
  width,
  height,
  targetHeight,
  overscan = 3,
}: VirtualJustifiedGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [focused, setFocused] = useState<number | null>(null)
  const layout = useMemo(
    () =>
      computeJustifiedLayout(rows, {
        containerWidth: width,
        targetHeight,
        gap: GRID_GAP,
      }),
    [rows, width, targetHeight],
  )

  const focusedRow = focused === null ? null : rowOfItem(layout, focused)
  const focusedRowRef = useRef(focusedRow)
  focusedRowRef.current = focusedRow

  const rangeExtractor = useCallback(
    (range: Range) =>
      withPinnedIndex(defaultRangeExtractor(range), focusedRowRef.current),
    [],
  )

  const virtualizer = useVirtualizer({
    count: layout.rowCount,
    getScrollElement: () => scrollRef.current,
    // Rows are `gap` apart: the gap is part of every row but the last.
    estimateSize: (row) =>
      (layout.rowHeight[row] as number) +
      (row < layout.rowCount - 1 ? layout.gap : 0),
    overscan,
    rangeExtractor,
  })

  // The anchor is tracked against the layout currently on screen; after a
  // re-layout it is restored before paint.
  const anchorRef = useRef<ScrollAnchor | null>(null)
  const shownLayoutRef = useRef<JustifiedLayout>(layout)

  const updateAnchor = useCallback(() => {
    const element = scrollRef.current
    if (!element) return
    anchorRef.current = captureScrollAnchor(
      shownLayoutRef.current,
      element.scrollTop,
      element.clientHeight,
      focusedRef.current,
    )
  }, [])
  const focusedRef = useRef(focused)
  focusedRef.current = focused

  // A native, passive listener: React's onScroll would do too, but A1 wants
  // the anchor updated without a React render per scroll event.
  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return
    element.addEventListener('scroll', updateAnchor, { passive: true })
    return () => element.removeEventListener('scroll', updateAnchor)
  }, [updateAnchor])

  // After a re-layout, items move to other rows, and rows are keyed by index,
  // so the focused tile is re-created and the browser drops focus to <body>.
  // Remember to give it back once its new element is rendered.
  const restoreFocusRef = useRef(false)

  useLayoutEffect(() => {
    if (shownLayoutRef.current === layout) return
    shownLayoutRef.current = layout
    virtualizer.measure()
    const element = scrollRef.current
    const anchor = anchorRef.current
    if (element && anchor) {
      element.scrollTop = scrollTopForAnchor(layout, anchor)
      // Chromium fires no scroll event for this change (the content height
      // changes in the same frame), so TanStack Virtual would keep rendering
      // the old range. Tell it, and the anchor listener, explicitly.
      element.dispatchEvent(new Event('scroll'))
    }
    restoreFocusRef.current = focusedRef.current !== null
  }, [layout, virtualizer])

  useLayoutEffect(() => {
    if (!restoreFocusRef.current) return
    const lostFocus =
      document.activeElement === null ||
      document.activeElement === document.body
    const tile = scrollRef.current?.querySelector<HTMLElement>(
      `[data-index="${focusedRef.current}"]`,
    )
    if (!lostFocus) {
      restoreFocusRef.current = false
    } else if (tile) {
      tile.focus({ preventScroll: true })
      restoreFocusRef.current = false
    }
  })

  const focusItem = (index: number) => {
    const element = scrollRef.current
    if (!element) return
    setFocused(index)
    const row = rowOfItem(layout, index)
    element.scrollTop = scrollTopToReveal(
      layout,
      row,
      element.scrollTop,
      element.clientHeight,
    )
    // The row may only mount on the next render: focus once it exists.
    requestAnimationFrame(() => {
      element
        .querySelector<HTMLElement>(`[data-index="${index}"]`)
        ?.focus({ preventScroll: true })
      updateAnchor()
    })
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (focused === null) return
    const moves: Record<string, () => number> = {
      ArrowLeft: () => Math.max(0, focused - 1),
      ArrowRight: () => Math.min(layout.count - 1, focused + 1),
      ArrowUp: () => verticalNeighbour(layout, focused, -1),
      ArrowDown: () => verticalNeighbour(layout, focused, 1),
    }
    const move = moves[event.key]
    if (!move) return
    event.preventDefault()
    focusItem(move())
  }

  return (
    <div
      ref={scrollRef}
      data-testid='grid-scroll'
      style={{
        width,
        height,
        overflowY: 'auto',
        overflowX: 'hidden',
        // The scrollbar never changes the width the layout fills.
        scrollbarGutter: 'stable',
      }}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: an ARIA grid of tiles */}
      <div
        role='grid'
        aria-rowcount={layout.rowCount}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={{
          height: virtualizer.getTotalSize(),
          position: 'relative',
          width: layout.containerWidth,
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = virtualRow.index
          const start = layout.rowStart[row] as number
          const end = layout.rowStart[row + 1] as number
          const tiles = []
          for (let index = start; index < end; index++) {
            const id = rows[index * ROW_STRIDE] as number
            tiles.push(
              // biome-ignore lint/a11y/useSemanticElements: absolutely positioned ARIA grid, not a table
              <div
                key={id}
                role='gridcell'
                data-index={index}
                tabIndex={index === focused ? 0 : -1}
                aria-selected={index === focused}
                onFocus={() => {
                  if (focusedRef.current === index) return
                  focusedRef.current = index
                  setFocused(index)
                  updateAnchor()
                }}
                style={{
                  position: 'absolute',
                  left: layout.itemX[index],
                  width: layout.itemWidth[index],
                  height: '100%',
                  background: 'var(--surface-tile)',
                  borderRadius: 'var(--radius-tile)',
                }}
              />,
            )
          }
          return (
            // biome-ignore lint/a11y/useSemanticElements: absolutely positioned ARIA grid, not a table
            // biome-ignore lint/a11y/useFocusableInteractive: rows aren't focusable in a grid; cells are
            <div
              key={row}
              role='row'
              aria-rowindex={row + 1}
              data-row={row}
              style={{
                position: 'absolute',
                top: layout.rowTop[row],
                left: 0,
                width: '100%',
                height: layout.rowHeight[row],
              }}
            >
              {tiles}
            </div>
          )
        })}
      </div>
    </div>
  )
}
