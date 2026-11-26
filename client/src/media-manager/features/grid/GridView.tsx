// The justified, virtualised grid (interaction-spec §2), driven by the URL's
// folder, filters, sort, layout and density through useCollection().
//
// Built on spike C1's layout and wiring, keeping its rules:
// 1. `virtualizer.measure()` after every re-layout;
// 2. an explicit scroll event after restoring `scrollTop` (Chromium fires
//    none when the content height changes in the same frame);
// 3. the focused tile is re-focused after a re-layout re-creates it;
// 4. a native passive scroll listener keeps the scroll anchor;
// plus `scrollbar-gutter: stable` on the scroller.
//
// And spike C2's, for the morph: while detail is open the inert grid follows
// the current item (its row is revealed whenever focus moves), and
// `revealItem` renders a far-away tile synchronously (flushSync plus a
// direct scrollTop), never waiting for a frame.
//
// Only revealItem (the morph's close path, outside React's lifecycles) may
// flush synchronously. Everything else that scrolls the grid from a layout
// effect tells the virtualiser with notifyScrollSoon(): the virtualiser
// answers a scroll event with flushSync, which React refuses (and warns
// about) inside a lifecycle (iPad feel review).

import { Button } from '@mantine/core'
import { useQueryClient } from '@tanstack/react-query'
import {
  defaultRangeExtractor,
  type Range,
  useVirtualizer,
} from '@tanstack/react-virtual'
import {
  lazy,
  type MouseEvent,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { flushSync } from 'react-dom'
import { registerCenter } from '../../core/collection/centerApi'
import { type CollectionView, useCollection } from '../../core/collection/hooks'
import { runCommand } from '../../core/commands/registry'
import { alignedChunks, useItemChunks } from '../../core/data/items'
import { libraryKeys } from '../../core/data/keys'
import { coreStore, useCore } from '../../core/state'
import { noSelectProps } from '../../core/ui/noSelect'
import { urlStore, useUrlState } from '../../core/url/useUrlState'
import { setGridController } from './controller'
import { flashTiles } from './flash'
import classes from './Grid.module.css'
import {
  captureScrollAnchor,
  computeJustifiedLayout,
  DENSITIES,
  GRID_GAP,
  type JustifiedLayout,
  rowOfItem,
  type ScrollAnchor,
  scrollTopForAnchor,
  scrollTopToReveal,
  withPinnedIndex,
} from './justifiedLayout'
import { CHECK_SELECTOR, Tile } from './Tile'

/** Space around the grid inside the scroller, in px (prototype `.grid`). */
const PADDING_X = 16
const PADDING_TOP = 8
const PADDING_BOTTOM = 32

/** How long the return ring shows on the tile you come back to (ms). */
const RETURN_RING_MS = 900

/** Two taps on one tile within this many ms open detail (touch). */
const DOUBLE_TAP_MS = 350

/** True when the click landed on a tile's check circle. */
function onCheckCircle(event: MouseEvent): boolean {
  return (
    event.target instanceof Element &&
    event.target.closest(CHECK_SELECTOR) !== null
  )
}

/**
 * Whether the tile's check circle is showing. With a mouse it shows on
 * hover; on touch only on a selected tile or while 2 or more are selected.
 */
function checkShown(
  event: MouseEvent,
  store: { selection: ReadonlySet<number> },
): boolean {
  if (lastPointerType(event) !== 'touch') return true
  const tile = event.currentTarget as HTMLElement
  return (
    tile.getAttribute('aria-selected') === 'true' || store.selection.size >= 2
  )
}

/** The pointer type behind a click (clicks are PointerEvents in browsers). */
function lastPointerType(event: MouseEvent): string {
  return (event.nativeEvent as Partial<PointerEvent>).pointerType ?? 'mouse'
}

export function GridView() {
  usePrefetchGridParts()
  const collection = useCollection()
  if (collection.status === 'pending') {
    return <GridSkeleton />
  }
  if (collection.status === 'error' && collection.total === 0) {
    return <GridError />
  }
  if (collection.total === 0 && !collection.isPlaceholder) {
    return <GridEmpty />
  }
  return <JustifiedGrid collection={collection} />
}

function GridSkeleton() {
  const density = useUrlState((state) => state.density)
  const height = DENSITIES[density] ?? DENSITIES[2]
  const widths = [1.5, 0.75, 1.33, 1, 1.5, 0.66, 1.33, 1, 1.5]
  return (
    <div className={classes.skeleton} role='status' aria-label='Loading media'>
      {[0, 1, 2, 3, 4, 5].map((row) => (
        <div key={row} className={classes.skeletonRow} style={{ height }}>
          {widths.map((ratio, index) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
              key={index}
              className={classes.skeletonTile}
              style={{ flex: ratio * ((row + index) % 3 === 0 ? 1.2 : 1) }}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

function GridError() {
  const queryClient = useQueryClient()
  return (
    <div className={classes.empty} role='alert'>
      <p>The media couldn't be loaded.</p>
      <Button
        variant='default'
        onClick={() =>
          void queryClient.invalidateQueries({
            queryKey: libraryKeys.collections(),
          })
        }
      >
        Try again
      </Button>
    </div>
  )
}

/**
 * The empty states are a lazy chunk (D31: they are rare, and their art and
 * copy would weigh on the initial chunk). It is fetched when the browser is
 * idle, like detail; until it is there the centre stays blank, which
 * an empty grid is anyway.
 */
const loadEmptyStates = () => import('./EmptyStates')

const LazyGridEmpty = lazy(() =>
  loadEmptyStates().then((module) => ({ default: module.GridEmpty })),
)

function GridEmpty() {
  return (
    <Suspense fallback={null}>
      <LazyGridEmpty />
    </Suspense>
  )
}

/** Fetches the lazy parts of the grid when the browser has a moment. */
function usePrefetchGridParts(): void {
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((run) => setTimeout(run, 250))
    const handle = idle(() => {
      void loadEmptyStates()
    })
    return () => {
      if (window.cancelIdleCallback && typeof handle === 'number') {
        window.cancelIdleCallback(handle)
      }
    }
  }, [])
}

/**
 * Tells the virtualiser the scroller moved (C1 rule 2), synchronously. Only
 * outside React's render and commit: it re-renders with flushSync.
 */
function notifyScroll(element: HTMLElement): void {
  element.dispatchEvent(new Event('scroll'))
}

/**
 * The same from a layout effect (or anything that may run inside one): a
 * microtask runs once React has left the commit, still before paint.
 */
function notifyScrollSoon(element: HTMLElement): void {
  queueMicrotask(() => {
    if (element.isConnected) {
      notifyScroll(element)
    }
  })
}

function pixelBox(element: HTMLElement): { width: number; height: number } {
  return {
    width: Math.max(0, element.clientWidth - 2 * PADDING_X),
    height: element.clientHeight,
  }
}

/** True when the element is entirely inside the scroller's viewport. */
function fullyInside(element: Element, scroller: Element): boolean {
  const box = element.getBoundingClientRect()
  const view = scroller.getBoundingClientRect()
  return (
    box.top >= view.top - 0.5 &&
    box.bottom <= view.bottom + 0.5 &&
    box.left >= view.left - 0.5 &&
    box.right <= view.right + 0.5
  )
}

function JustifiedGrid({ collection }: { collection: CollectionView }) {
  const { rows } = collection
  const scrollRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const layoutMode = useUrlState((state) => state.layout)
  const density = useUrlState((state) => state.density)
  const detailItem = useUrlState((state) => state.item)
  const focus = useCore((state) => state.focus)
  const selectionSize = useCore((state) => state.selection.size)
  const selection = useCore((state) => state.selection)
  // Tiles drag onto folders, so only while FileBird is there (A3).
  const folderDrops = useCore((state) =>
    Boolean(state.bootstrap?.site?.filebird?.active),
  )

  // The viewport's height, kept from the resize observer so the scroll
  // handler doesn't read layout for it on every scroll event.
  const viewportHeightRef = useRef(0)

  // The width the layout fills, from the scroller (no scrollbar: the gutter
  // is stable). Measured before paint, then on every resize.
  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const measure = () => {
      const box = pixelBox(element)
      viewportHeightRef.current = box.height
      setWidth(box.width)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const targetHeight = DENSITIES[density] ?? DENSITIES[2]
  const layout = useMemo(
    () =>
      computeJustifiedLayout(rows.snapshot.rows, {
        containerWidth: width,
        targetHeight,
        gap: GRID_GAP,
        square: layoutMode === 'square',
      }),
    [rows, width, targetHeight, layoutMode],
  )

  const focusIndex = focus === null ? -1 : rows.indexOf(focus)
  const focusedRow = focusIndex < 0 ? null : rowOfItem(layout, focusIndex)
  const focusedRowRef = useRef(focusedRow)
  focusedRowRef.current = focusedRow
  // A row revealItem rendered on demand; kept until the range covers it.
  const [extraRow, setExtraRow] = useState<number | null>(null)
  const extraRowRef = useRef(extraRow)
  extraRowRef.current = extraRow

  const rangeExtractor = useCallback(
    (range: Range) =>
      withPinnedIndex(
        withPinnedIndex(defaultRangeExtractor(range), focusedRowRef.current),
        extraRowRef.current,
      ),
    [],
  )

  const virtualizer = useVirtualizer({
    count: layout.rowCount,
    getScrollElement: () => scrollRef.current,
    // Rows are `gap` apart: the gap is part of every row but the last.
    estimateSize: (row) =>
      (layout.rowHeight[row] as number) +
      (row < layout.rowCount - 1 ? layout.gap : 0),
    paddingStart: PADDING_TOP,
    paddingEnd: PADDING_BOTTOM,
    overscan: 3,
    rangeExtractor,
  })

  // --- Scroll anchoring across re-layouts (C1 rules 1, 2 and 4) ----------
  const anchorRef = useRef<ScrollAnchor | null>(null)
  const shownLayoutRef = useRef<JustifiedLayout>(layout)
  const focusIndexRef = useRef(focusIndex)
  focusIndexRef.current = focusIndex

  const updateAnchor = useCallback(() => {
    const element = scrollRef.current
    if (!element) return
    anchorRef.current = captureScrollAnchor(
      shownLayoutRef.current,
      element.scrollTop - PADDING_TOP,
      viewportHeightRef.current,
      focusIndexRef.current < 0 ? null : focusIndexRef.current,
    )
  }, [])

  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element) return
    const onScroll = () => {
      updateAnchor()
      const extra = extraRowRef.current
      const range = virtualizer.range
      if (
        extra !== null &&
        range &&
        extra >= range.startIndex &&
        extra <= range.endIndex
      ) {
        setExtraRow(null)
      }
    }
    element.addEventListener('scroll', onScroll, { passive: true })
    return () => element.removeEventListener('scroll', onScroll)
  }, [updateAnchor, virtualizer])

  // The anchor follows focus too (spike C1), so a density or layout change
  // right after a click keeps the focused tile where it is.
  useLayoutEffect(() => {
    if (focusIndex >= 0) updateAnchor()
  }, [focusIndex, updateAnchor])

  // C1 rule 3: tiles are re-created when a re-layout moves them to another
  // row; give focus back to the focused tile once it is rendered again.
  const restoreFocusRef = useRef(false)

  // The query the rows on screen answer. A new rev of the same query (a
  // refetch) keeps the scroll position; another folder, filter or sort
  // starts at the top.
  const queryKey = JSON.stringify(rows.snapshot.query)
  const shownQueryRef = useRef(queryKey)

  useLayoutEffect(() => {
    if (shownLayoutRef.current === layout) return
    const sameQuery = shownQueryRef.current === queryKey
    shownLayoutRef.current = layout
    shownQueryRef.current = queryKey
    virtualizer.measure()
    const element = scrollRef.current
    const anchor = anchorRef.current
    if (element) {
      element.scrollTop =
        sameQuery && anchor
          ? scrollTopForAnchor(layout, anchor) + PADDING_TOP
          : 0
      notifyScrollSoon(element)
    }
    restoreFocusRef.current =
      element?.contains(document.activeElement) === true ||
      document.activeElement === document.body
  }, [layout, queryKey, virtualizer])

  // --- Following focus (keyboard moves, detail stepping: C2) -------------
  const focusDomRef = useRef(false)
  const revealRow = useCallback(
    (row: number) => {
      const element = scrollRef.current
      if (!element) return
      const top = scrollTopToReveal(
        layout,
        row,
        element.scrollTop - PADDING_TOP,
        element.clientHeight - PADDING_TOP - PADDING_BOTTOM,
      )
      const next = top + PADDING_TOP
      if (Math.abs(next - element.scrollTop) > 0.5) {
        element.scrollTop = next
        notifyScrollSoon(element)
      }
    },
    [layout],
  )

  const tileElement = useCallback(
    (id: number) =>
      scrollRef.current?.querySelector<HTMLElement>(`[data-mm-tile="${id}"]`) ??
      null,
    [],
  )

  // Reveal the focused row whenever focus moves; a keyboard move also moves
  // DOM focus (with preventScroll: the scroll above is the only one). Focus
  // that a pointer press gave a tile doesn't scroll: the tile is under the
  // pointer, and scrolling between mousedown and mouseup would move another
  // tile under it, so the click would miss (it focuses without selecting).
  const pointerDownRef = useRef(false)
  const previousFocus = useRef(focus)
  useLayoutEffect(() => {
    if (previousFocus.current === focus) return
    previousFocus.current = focus
    if (focusedRow !== null && !pointerDownRef.current) {
      revealRow(focusedRow)
    }
  }, [focus, focusedRow, revealRow])
  const revealRowRef = useRef(revealRow)
  revealRowRef.current = revealRow
  useEffect(() => {
    const release = () => {
      pointerDownRef.current = false
    }
    window.addEventListener('pointerup', release, true)
    window.addEventListener('pointercancel', release, true)
    return () => {
      window.removeEventListener('pointerup', release, true)
      window.removeEventListener('pointercancel', release, true)
    }
  }, [])

  useLayoutEffect(() => {
    if (focus === null) return
    const wantFocus = focusDomRef.current || restoreFocusRef.current
    if (!wantFocus) return
    const tile = tileElement(focus)
    if (tile) {
      focusDomRef.current = false
      restoreFocusRef.current = false
      if (document.activeElement !== tile) {
        tile.focus({ preventScroll: true })
      }
    }
  })

  // --- The return ring after leaving detail ------------------------------
  const [returning, setReturning] = useState<number | null>(null)
  const previousDetail = useRef(detailItem)
  useEffect(() => {
    const left = previousDetail.current
    previousDetail.current = detailItem
    if (left === null || detailItem !== null) return
    setReturning(left)
    const timer = setTimeout(() => setReturning(null), RETURN_RING_MS)
    return () => clearTimeout(timer)
  }, [detailItem])

  // --- What commands and the morph reach (centerApi, controller) ---------
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  const rowsRef = useRef(rows)
  rowsRef.current = rows

  useEffect(
    () =>
      registerCenter({
        tileElement,
        flashItems: flashTiles,
        heroElement: (id) => {
          const tile = tileElement(id)
          const scroller = scrollRef.current
          if (!tile || !scroller || !fullyInside(tile, scroller)) {
            return null
          }
          return tile.querySelector<HTMLElement>('img') ?? tile
        },
        focusTile: (id) => {
          const tile = tileElement(id)
          if (tile) {
            // A pinned row may be scrolled far away: bring it into view.
            const index = rowsRef.current.indexOf(id)
            if (index >= 0) {
              revealRowRef.current(rowOfItem(layoutRef.current, index))
            }
            tile.focus({ preventScroll: true })
            return
          }
          focusDomRef.current = true
          coreStore.getState().setFocus(id)
        },
        revealItem: (id) => {
          const scroller = scrollRef.current
          const index = rowsRef.current.indexOf(id)
          if (!scroller || index < 0) {
            return Promise.resolve(null)
          }
          const existing = tileElement(id)
          if (existing && fullyInside(existing, scroller)) {
            return Promise.resolve(existing)
          }
          const currentLayout = layoutRef.current
          const row = rowOfItem(currentLayout, index)
          // Render the target row now, then scroll to it directly: no frame
          // or scroll event runs while the morph holds the old snapshot.
          flushSync(() => setExtraRow(row))
          const top = scrollTopToReveal(
            currentLayout,
            row,
            scroller.scrollTop - PADDING_TOP,
            scroller.clientHeight - PADDING_TOP - PADDING_BOTTOM,
          )
          scroller.scrollTop = top + PADDING_TOP
          notifyScroll(scroller)
          return Promise.resolve(tileElement(id))
        },
      }),
    [tileElement],
  )

  useEffect(
    () =>
      setGridController({
        layout: () => layoutRef.current,
        rows: () => rowsRef.current,
        focusAfterRender: () => {
          // Only while the grid is where the keyboard is (not under detail).
          if (urlStore().get().item === null) {
            focusDomRef.current = true
          }
        },
      }),
    [],
  )

  // --- Hydration: the chunks around the rendered rows --------------------
  const virtualRows = virtualizer.getVirtualItems()
  const firstRow = virtualRows[0]?.index ?? 0
  const lastRow = virtualRows[virtualRows.length - 1]?.index ?? -1
  const firstItem = layout.rowStart[firstRow] ?? 0
  const endItem = layout.rowStart[lastRow + 1] ?? 0
  const chunks = useMemo(
    () => alignedChunks(rows.snapshot, firstItem, endItem),
    [rows, firstItem, endItem],
  )
  const hydrated = useItemChunks(chunks, 'tile')

  // --- Pointer selection --------------------------------------------------
  // Touch has no reliable dblclick (iPad Safari), so two taps on the same
  // tile within DOUBLE_TAP_MS open detail, like a double-click.
  const lastTapRef = useRef<{ id: number; at: number } | null>(null)
  const onPointerSelect = useCallback((id: number, event: MouseEvent) => {
    const store = coreStore.getState()
    // The check circle toggles, like Ctrl/Cmd+click (interaction-spec §2),
    // but only while it shows: on touch (no hover) that is with the tile
    // selected or while several are. Shift+click is a range, wherever it lands.
    if (!event.shiftKey && onCheckCircle(event) && checkShown(event, store)) {
      lastTapRef.current = null
      store.toggleSelected(id)
      return
    }
    if (lastPointerType(event) === 'touch') {
      const now = event.timeStamp
      const last = lastTapRef.current
      lastTapRef.current = { id, at: now }
      if (last && last.id === id && now - last.at < DOUBLE_TAP_MS) {
        lastTapRef.current = null
        runCommand('detail.open', { id })
        return
      }
    }
    if (event.shiftKey) {
      store.selectRange(id, rowsRef.current.ids, event.metaKey || event.ctrlKey)
    } else if (event.metaKey || event.ctrlKey) {
      store.toggleSelected(id)
    } else {
      store.selectOnly(id)
    }
  }, [])
  const onOpen = useCallback((id: number, event: MouseEvent) => {
    // Two quick clicks on the check circle toggle twice; they don't open.
    if (!onCheckCircle(event) || event.shiftKey) {
      runCommand('detail.open', { id })
    }
  }, [])
  const onFocusTile = useCallback((id: number) => {
    if (coreStore.getState().focus !== id) {
      coreStore.getState().setFocus(id)
    }
  }, [])

  // The roving tab stop: the focused tile, or else the first tile in view
  // (row 0 may be scrolled away and unmounted, and Tab must still reach the
  // grid).
  const firstVisibleRow = virtualizer.range?.startIndex ?? firstRow
  const tabStopIndex =
    focusIndex >= 0 ? focusIndex : (layout.rowStart[firstVisibleRow] ?? 0)

  return (
    <div
      ref={scrollRef}
      className={classes.scroller}
      data-mm-grid-scroll=''
      {...noSelectProps}
      data-placeholder={collection.isPlaceholder ? '' : undefined}
      onPointerDown={() => {
        pointerDownRef.current = true
      }}
    >
      {/* biome-ignore lint/a11y/useSemanticElements: an absolutely positioned ARIA grid, not a table */}
      <div
        role='grid'
        aria-label='Media'
        aria-multiselectable
        aria-rowcount={layout.rowCount}
        aria-busy={collection.isPlaceholder || undefined}
        className={classes.grid}
        data-layout={layoutMode}
        data-selecting={selectionSize >= 2 ? '' : undefined}
        style={{
          height: virtualizer.getTotalSize(),
          width: layout.containerWidth,
        }}
      >
        {virtualRows.map((virtualRow) => {
          const row = virtualRow.index
          const start = layout.rowStart[row] as number
          const end = layout.rowStart[row + 1] as number
          const height = layout.rowHeight[row] as number
          const tiles = []
          for (let index = start; index < end; index++) {
            const id = rows.idAt(index)
            tiles.push(
              <Tile
                key={id}
                id={id}
                kind={rows.kindAt(index)}
                item={hydrated.items.get(id)}
                left={layout.itemX[index] as number}
                width={layout.itemWidth[index] as number}
                height={height}
                selected={selection.has(id)}
                tabStop={index === tabStopIndex}
                returning={returning === id}
                onPointerSelect={onPointerSelect}
                onOpen={onOpen}
                onFocusTile={onFocusTile}
                canDrag={folderDrops}
              />,
            )
          }
          return (
            // biome-ignore lint/a11y/useSemanticElements: an absolutely positioned ARIA grid, not a table
            // biome-ignore lint/a11y/useFocusableInteractive: rows aren't focusable in a grid; cells are
            <div
              key={row}
              role='row'
              aria-rowindex={row + 1}
              className={classes.row}
              style={{
                top: virtualRow.start,
                width: layout.containerWidth,
                height,
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
