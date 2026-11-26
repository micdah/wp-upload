// The filmstrip (interaction-spec §5, design-system "Detail bar, stage,
// filmstrip"): the whole collection in a virtual strip (TanStack Virtual,
// horizontal) under the stage.
//
// - Cells are dimmed except the current item, which has a neutral outline
//   outside the cell and is kept centred (the strip has half a strip of
//   padding at both ends, so the first and last items centre too).
// - Selected items keep the grid's neon ring and check. Ctrl/Cmd+click, or
//   the check circle, toggles the selection; a plain click steps there
//   (replacing the history entry, like ←/→).
// - It reads the collection through useCollection(), so it follows filters,
//   sort and library changes, and hydrates the visible cells in the same id
//   chunks the grid uses (their items come from cache when the grid has them).
// - The tile upload state shows on a cell too (interaction-spec §13.1).
//
// ARIA: a one-row grid of gridcells with aria-selected (the selection) and
// aria-current (the item on stage), and a roving tab stop on the current
// cell, like the grid (interaction-spec §10). The app keymap runs as usual
// there: ←/→ step and keyboard focus follows the current cell, X toggles
// its selection, Esc leaves detail.
//
// The whole strip is chrome: `data-mm-no-select` (iPad lesson), no
// user-select: none.

import { useVirtualizer } from '@tanstack/react-virtual'
import {
  type MouseEvent,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  IMAGE_LIKE_KINDS,
  type LibraryItemTile,
  type MediaKind,
} from '../../../../../shared/library-api'
import {
  type CollectionView,
  getCurrentCollection,
} from '../../core/collection/hooks'
import { pictureFor, withVersion } from '../../core/collection/renditions'
import { alignedChunks, useItemChunks } from '../../core/data/items'
import { useIsMediaDragged, useMediaDraggable } from '../../core/dnd'
import { coreStore, useCore } from '../../core/state'
import { announce, plural } from '../../core/ui/announce'
import {
  ArchiveIcon,
  AudioIcon,
  CheckIcon,
  FileIcon,
  ImageIcon,
  PdfIcon,
  VideoIcon,
} from '../../core/ui/icons'
import { prefersReducedMotion } from '../../core/ui/morph'
import { noSelectProps } from '../../core/ui/noSelect'
import { useTileUploadState } from '../../core/uploads/tileState'
import { urlStore } from '../../core/url/useUrlState'
import classes from './Filmstrip.module.css'
import { formatDuration } from './format'

/** Collection order, so a multi-item drag lists its ids in order. */
function collectionOrder(): readonly number[] {
  return getCurrentCollection()?.ids ?? []
}

/** Space between cells (px). */
const GAP = 4
/** Cells rendered beyond the visible ones on each side. */
const OVERSCAN = 8
/** A jump further than this many strip widths scrolls at once, not smoothly. */
const SMOOTH_LIMIT = 3

const KIND_ICONS = {
  image: ImageIcon,
  svg: ImageIcon,
  video: VideoIcon,
  audio: AudioIcon,
  document: PdfIcon,
  archive: ArchiveIcon,
  other: FileIcon,
} as const

function pixelRatio(): number {
  return window.devicePixelRatio || 1
}

/** The strip's inner size (padding and scrollbar excluded). */
function useInnerSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => {
      const style = getComputedStyle(element)
      const width = element.clientWidth
      const height =
        element.clientHeight -
        Number.parseFloat(style.paddingTop) -
        Number.parseFloat(style.paddingBottom)
      setSize((current) =>
        current.width === width && current.height === height
          ? current
          : { width, height: Math.max(0, height) },
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return size
}

function announceSelection(): void {
  const count = coreStore.getState().selection.size
  announce(
    count === 0 ? 'Selection cleared' : `${plural(count, 'item')} selected`,
  )
}

export function Filmstrip({
  collection,
  currentId,
}: {
  collection: CollectionView
  currentId: number
}) {
  const rows = collection.rows
  const scrollRef = useRef<HTMLDivElement>(null)
  const size = useInnerSize(scrollRef)
  const cell = Math.max(0, Math.floor(size.height))
  const pad = Math.max(0, (size.width - cell) / 2)
  const currentIndex = rows.indexOf(currentId)
  const selection = useCore((state) => state.selection)
  // Cells drag onto folders, so only while FileBird is there (A3).
  const folderDrops = useCore((state) =>
    Boolean(state.bootstrap?.site?.filebird?.active),
  )

  const currentRef = useRef(currentIndex)
  currentRef.current = currentIndex
  const virtualizer = useVirtualizer({
    horizontal: true,
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => cell,
    gap: GAP,
    paddingStart: pad,
    paddingEnd: pad,
    overscan: OVERSCAN,
    getItemKey: (index) => rows.idAt(index),
    // The current cell stays mounted wherever the strip is scrolled, so it
    // can hold keyboard focus.
    rangeExtractor: (range) => {
      const indexes: number[] = []
      const start = Math.max(0, range.startIndex - range.overscan)
      const end = Math.min(range.count - 1, range.endIndex + range.overscan)
      for (let index = start; index <= end; index += 1) indexes.push(index)
      const current = currentRef.current
      if (current >= 0 && current < range.count && !indexes.includes(current)) {
        indexes.push(current)
        indexes.sort((a, b) => a - b)
      }
      return indexes
    },
  })

  // A new cell size (another breakpoint) changes every offset.
  useEffect(() => {
    if (cell > 0) virtualizer.measure()
  }, [virtualizer, cell])

  // Keep the current item centred: at once when detail opens or the jump
  // is long, smoothly when stepping (never under reduced motion). Scrolling
  // the element directly (not virtualizer.scrollToIndex) keeps react-virtual's
  // synchronous re-render in its own scroll handler, outside React's
  // lifecycles (iPad feel review: no flushSync inside effects).
  const placed = useRef(false)
  useEffect(() => {
    const element = scrollRef.current
    if (!element || cell === 0 || currentIndex < 0) return
    const left = currentIndex * (cell + GAP)
    const far =
      Math.abs(element.scrollLeft - left) > element.clientWidth * SMOOTH_LIMIT
    const smooth = placed.current && !far && !prefersReducedMotion()
    placed.current = true
    element.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' })
  }, [currentIndex, cell])

  // Keyboard focus follows the current cell while it is in the strip.
  useLayoutEffect(() => {
    const element = scrollRef.current
    if (!element?.contains(document.activeElement)) return
    const target = element.querySelector<HTMLElement>(
      `[data-mm-film="${currentId}"]`,
    )
    if (target && target !== document.activeElement) {
      target.focus({ preventScroll: true })
    }
  }, [currentId])

  // Hydrate the visible cells (aligned chunks, as the grid does) and the
  // current one wherever it is.
  const range = virtualizer.range
  const snapshot = rows.snapshot
  const firstVisible = range?.startIndex ?? 0
  const lastVisible = range?.endIndex ?? -1
  const chunks = useMemo(() => {
    const visible = alignedChunks(
      snapshot,
      firstVisible - OVERSCAN,
      lastVisible + OVERSCAN + 1,
    )
    if (currentIndex < 0) return visible
    const [own] = alignedChunks(snapshot, currentIndex, currentIndex + 1)
    if (!own || visible.some((chunk) => chunk[0] === own[0])) return visible
    return [...visible, own]
  }, [snapshot, firstVisible, lastVisible, currentIndex])
  const hydrated = useItemChunks(chunks, 'tile')

  const onCellClick = useCallback((id: number, event: MouseEvent) => {
    if (event.metaKey || event.ctrlKey) {
      coreStore.getState().toggleSelected(id)
      announceSelection()
      return
    }
    if (urlStore().get().item !== id) {
      urlStore().openItem(id)
    }
  }, [])
  const onToggle = useCallback((id: number) => {
    coreStore.getState().toggleSelected(id)
    announceSelection()
  }, [])

  // A vertical wheel scrolls the strip sideways (a mouse without a
  // horizontal wheel); a trackpad's own sideways scroll passes through.
  const onWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
      event.currentTarget.scrollLeft += event.deltaY
    }
  }, [])

  const items = virtualizer.getVirtualItems()
  const tabStop = currentIndex >= 0 ? currentIndex : (items[0]?.index ?? -1)

  return (
    <div className={classes.filmstrip} {...noSelectProps} data-mm-filmstrip=''>
      {/* biome-ignore lint/a11y/useSemanticElements: an absolutely positioned ARIA grid, not a table */}
      <div
        ref={scrollRef}
        className={classes.strip}
        role='grid'
        aria-label='Filmstrip'
        aria-rowcount={1}
        aria-colcount={rows.length}
        aria-multiselectable='true'
        onWheel={onWheel}
      >
        {/* biome-ignore lint/a11y/useSemanticElements: an absolutely positioned ARIA grid, not a table */}
        {/* biome-ignore lint/a11y/useFocusableInteractive: rows aren't focusable in a grid; cells are */}
        <div
          role='row'
          className={classes.row}
          style={{ width: virtualizer.getTotalSize(), height: cell }}
        >
          {cell > 0 &&
            items.map((virtual) => {
              const id = rows.idAt(virtual.index)
              return (
                <FilmCell
                  key={id}
                  id={id}
                  index={virtual.index}
                  kind={rows.kindAt(virtual.index)}
                  item={hydrated.items.get(id)}
                  left={virtual.start}
                  size={cell}
                  current={id === currentId}
                  selected={selection.has(id)}
                  tabStop={virtual.index === tabStop}
                  onClick={onCellClick}
                  onToggle={onToggle}
                  canDrag={folderDrops}
                />
              )
            })}
        </div>
      </div>
    </div>
  )
}

interface FilmCellProps {
  id: number
  index: number
  kind: MediaKind
  item: LibraryItemTile | undefined
  left: number
  size: number
  current: boolean
  selected: boolean
  tabStop: boolean
  onClick(id: number, event: MouseEvent): void
  onToggle(id: number): void
  /** Drag to a folder (FileBird is active). */
  canDrag: boolean
}

/** The cell's picture: the square thumbnail when it is big enough. */
function cellPicture(item: LibraryItemTile, size: number): string | null {
  const wanted = size * pixelRatio()
  const isImage = (IMAGE_LIKE_KINDS as readonly string[]).includes(item.kind)
  if (
    isImage &&
    item.kind !== 'svg' &&
    item.thumb &&
    item.thumb.width >= wanted &&
    item.thumb.height >= wanted
  ) {
    return withVersion(item.thumb.url, item.modifiedAt)
  }
  return pictureFor(item, size, size, pixelRatio())
}

/**
 * A badge: duration, PDF pages, or missing alt text. `spoken` goes into the
 * cell's name, which must contain the visible text (axe's
 * label-content-name-mismatch).
 */
function badgeOf(
  item: LibraryItemTile,
): { text: string; spoken: string; warn?: boolean } | null {
  if ((item.kind === 'video' || item.kind === 'audio') && item.duration) {
    const text = formatDuration(item.duration)
    return { text, spoken: text }
  }
  if (item.kind === 'document' && item.pages) {
    return { text: `${item.pages} p`, spoken: `${item.pages} p (pages)` }
  }
  if (
    (IMAGE_LIKE_KINDS as readonly string[]).includes(item.kind) &&
    item.alt.trim() === ''
  ) {
    return { text: 'Alt', spoken: 'Alt text missing', warn: true }
  }
  return null
}

function FilmCellView({
  id,
  index,
  kind,
  item,
  left,
  size,
  current,
  selected,
  tabStop,
  onClick,
  onToggle,
  canDrag,
}: FilmCellProps) {
  // Cells drag onto folders like tiles (folders.md §6).
  const ref = useRef<HTMLDivElement>(null)
  useMediaDraggable(ref, id, { disabled: !canDrag, getOrder: collectionOrder })
  const dragged = useIsMediaDragged(id)
  const upload = useTileUploadState(id)
  const picture = item ? cellPicture(item, size) : null
  const src = picture ?? upload?.previewUrl ?? null
  const [loaded, setLoaded] = useState(false)
  const Icon = KIND_ICONS[kind] ?? FileIcon
  const badge = item ? badgeOf(item) : null
  return (
    // biome-ignore lint/a11y/useSemanticElements: an absolutely positioned ARIA grid, not a table
    // biome-ignore lint/a11y/useKeyWithClickEvents: the app keymap handles the strip's keys (←/→, X, Esc)
    <div
      ref={ref}
      role='gridcell'
      className={classes.cell}
      data-mm-drag-source={dragged ? '' : undefined}
      style={{ left, width: size, height: size }}
      data-mm-film={id}
      aria-colindex={index + 1}
      aria-selected={selected}
      aria-current={current ? 'true' : undefined}
      aria-label={
        item
          ? badge
            ? `${item.filename}, ${badge.spoken}`
            : item.filename
          : 'Loading'
      }
      tabIndex={tabStop ? 0 : -1}
      data-current={current ? '' : undefined}
      onClick={(event) => onClick(id, event)}
    >
      <span
        className={classes.picture}
        data-checker={kind === 'svg' ? '' : undefined}
      >
        {src ? (
          <img
            src={src}
            alt=''
            decoding='async'
            draggable={false}
            data-loaded={loaded ? '' : undefined}
            onLoad={() => setLoaded(true)}
            onError={() => setLoaded(true)}
          />
        ) : (
          <Icon size={Math.round(size * 0.32)} stroke={1.25} aria-hidden />
        )}
      </span>
      {badge && (
        <span
          className={classes.badge}
          data-warn={badge.warn ? '' : undefined}
          aria-hidden
        >
          {badge.text}
        </span>
      )}
      {upload && (
        <span className={classes.upload} data-phase={upload.phase} aria-hidden>
          <span
            className={classes.uploadBar}
            style={{
              width: `${Math.round((upload.phase === 'uploading' ? (upload.progress ?? 0) : 1) * 100)}%`,
            }}
          />
        </span>
      )}
      <span
        className={classes.check}
        data-mm-film-check=''
        aria-hidden
        onClick={(event) => {
          event.stopPropagation()
          onToggle(id)
        }}
      >
        <CheckIcon size={12} stroke={3} />
      </span>
    </div>
  )
}

/** Re-renders only when its own props change (≈ 20–40 cells are mounted). */
const FilmCell = memo(FilmCellView)
