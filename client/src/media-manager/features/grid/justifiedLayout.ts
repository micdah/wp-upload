import { MEDIA_KINDS, ROW_STRIDE } from '../../../../../shared/library-api'

// The justified (Flickr-style) grid layout, ported from the design
// prototype's `grid.js` (`justifiedRows`) and `data.js` (`aspectRatio`) as a
// pure module, plus the helpers a virtualised grid needs around it: row
// lookup, the ↑/↓ neighbour rule, a pinned-row range for the virtualiser,
// and scroll anchoring across re-layouts.
//
// Spike C1 (plan §10), lifted into the grid in M2. The `square` option is
// the square layout (interaction-spec §2): every item counts as 1:1, and the
// last row takes the full rows' cell size, so all cells match.
//
// Why typed arrays instead of row/tile objects: a 50k-item collection must
// lay out in ≤ 50 ms (plan §9), and it re-lays out on every container resize
// and density change. One flat pass over `CollectionResponse.rows` that
// writes into a handful of preallocated typed arrays allocates no per-item
// objects, so the cost is a few milliseconds and the GC has nothing to do.
// Consumers read positions by index; only the visible rows ever become
// React elements.

const KIND_AUDIO = MEDIA_KINDS.indexOf('audio')
const KIND_DOCUMENT = MEDIA_KINDS.indexOf('document')
const KIND_ARCHIVE = MEDIA_KINDS.indexOf('archive')

/** Width / height of a document tile: a portrait page (prototype `data.js`). */
export const DOCUMENT_ASPECT = 0.78

/** Target row heights in px, smallest to largest (prototype `store.js`). */
export const DENSITIES = [120, 160, 200, 260, 340] as const

/** The design system's `--grid-gap`, in px. Used between tiles and between rows. */
export const GRID_GAP = 2

/**
 * Width / height used for layout. Audio and archives have no picture, so they
 * get square tiles; documents get a portrait page. Everything else uses its
 * pixel size, and an unknown size (0) counts as square. Unknown kind codes are
 * treated as `other` (the contract allows new kinds to be appended).
 */
export function aspectRatio(
  width: number,
  height: number,
  kindCode: number,
): number {
  if (kindCode === KIND_AUDIO || kindCode === KIND_ARCHIVE) return 1
  if (kindCode === KIND_DOCUMENT) return DOCUMENT_ASPECT
  if (width > 0 && height > 0) return width / height
  return 1
}

export interface JustifiedLayoutOptions {
  /** Inner width of the grid (no padding, no scrollbar), in px. */
  containerWidth: number
  /** The density's target row height, in px. */
  targetHeight: number
  /** Gap between tiles in a row and between rows, in px. */
  gap: number
  /** Square cells (the square layout): every item lays out as 1:1. */
  square?: boolean
}

/**
 * A laid-out collection. Items are addressed by their index in the
 * collection; rows by their index from the top.
 *
 * Row `r` holds items `rowStart[r]` to `rowStart[r + 1] - 1`, so `rowStart`
 * has `rowCount + 1` entries (the last one is `count`).
 */
export interface JustifiedLayout {
  readonly count: number
  readonly rowCount: number
  readonly containerWidth: number
  readonly targetHeight: number
  readonly gap: number
  /** Index of each row's first item, plus a final `count`. */
  readonly rowStart: Uint32Array
  /** Height of each row. Full rows are scaled to fit; the last row is not. */
  readonly rowHeight: Float64Array
  /** Top of each row from the top of the grid (rows are `gap` apart). */
  readonly rowTop: Float64Array
  /** Left of each item within its row. */
  readonly itemX: Float64Array
  /** Width of each item. Its height is its row's height. */
  readonly itemWidth: Float64Array
  /** Height of the whole grid: the last row's bottom, no trailing gap. */
  readonly totalHeight: number
}

/**
 * Lays out a collection in justified rows: fill a row at the target height
 * until it reaches the container width, then scale the row so it fits the
 * width exactly. The last row keeps the target height and is not stretched
 * (unless it happens to fill the width, then it is a full row like any other).
 *
 * `rows` is `CollectionResponse.rows`: `[id, width, height, kindCode, …]`
 * with stride `ROW_STRIDE`.
 *
 * In a full row, the last item's width absorbs floating-point error, so the
 * row's widths plus gaps equal the container width.
 *
 * A container narrower than a single gap is treated as 1 px wide and gives
 * zero-width tiles; callers don't render the grid that narrow.
 */
export function computeJustifiedLayout(
  rows: ArrayLike<number>,
  {
    containerWidth: requestedWidth,
    targetHeight,
    gap,
    square = false,
  }: JustifiedLayoutOptions,
): JustifiedLayout {
  const count = Math.floor(rows.length / ROW_STRIDE)
  const containerWidth = Math.max(1, requestedWidth)
  const itemX = new Float64Array(count)
  // Holds each item's aspect ratio until its row closes, then its width.
  const itemWidth = new Float64Array(count)
  // Worst case is one row per item; trimmed to size at the end.
  const rowStartScratch = new Uint32Array(count + 1)
  const rowHeightScratch = new Float64Array(count)

  let rowCount = 0
  let start = 0
  let ratioSum = 0

  // Turns the ratios of items [first, end) into x positions and widths.
  const closeRow = (
    first: number,
    end: number,
    height: number,
    fit: boolean,
  ) => {
    let x = 0
    for (let i = first; i < end; i++) {
      const width = (itemWidth[i] as number) * height
      itemX[i] = x
      itemWidth[i] = width
      x += width + gap
    }
    if (fit && end > first) {
      const last = end - 1
      itemWidth[last] = Math.max(0, containerWidth - (itemX[last] as number))
    }
    rowStartScratch[rowCount] = first
    rowHeightScratch[rowCount] = height
    rowCount++
  }

  for (let i = 0; i < count; i++) {
    const offset = i * ROW_STRIDE
    const ratio = square
      ? 1
      : aspectRatio(
          rows[offset + 1] ?? 0,
          rows[offset + 2] ?? 0,
          rows[offset + 3] ?? 0,
        )
    itemWidth[i] = ratio
    ratioSum += ratio
    const gaps = gap * (i - start)
    if (ratioSum * targetHeight + gaps >= containerWidth) {
      const height = Math.max(0, (containerWidth - gaps) / ratioSum)
      closeRow(start, i + 1, height, true)
      start = i + 1
      ratioSum = 0
    }
  }
  if (start < count) {
    // Square cells keep one size: the last row matches the full rows.
    const lastHeight =
      square && rowCount > 0
        ? (rowHeightScratch[rowCount - 1] as number)
        : targetHeight
    closeRow(start, count, lastHeight, false)
  }

  const rowStart = rowStartScratch.slice(0, rowCount + 1)
  rowStart[rowCount] = count
  const rowHeight = rowHeightScratch.slice(0, rowCount)
  const rowTop = new Float64Array(rowCount)
  let top = 0
  for (let r = 0; r < rowCount; r++) {
    rowTop[r] = top
    top += (rowHeight[r] as number) + gap
  }
  const totalHeight = rowCount > 0 ? top - gap : 0

  return {
    count,
    rowCount,
    containerWidth,
    targetHeight,
    gap,
    rowStart,
    rowHeight,
    rowTop,
    itemX,
    itemWidth,
    totalHeight,
  }
}

/** The row that holds item `index` (binary search over `rowStart`). */
export function rowOfItem(layout: JustifiedLayout, index: number): number {
  const { rowStart, rowCount } = layout
  let low = 0
  let high = rowCount - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if ((rowStart[mid] as number) <= index) low = mid
    else high = mid - 1
  }
  return low
}

/**
 * The first row whose bottom is below `offset`, i.e. the first row visible
 * when the grid is scrolled to `offset`. Returns `rowCount - 1` past the end.
 */
export function firstRowBelow(layout: JustifiedLayout, offset: number): number {
  const { rowTop, rowHeight, rowCount } = layout
  let low = 0
  let high = rowCount - 1
  while (low < high) {
    const mid = (low + high) >> 1
    if ((rowTop[mid] as number) + (rowHeight[mid] as number) > offset) {
      high = mid
    } else low = mid + 1
  }
  return low
}

/**
 * The ↑/↓ neighbour of item `index` (prototype `verticalNeighbour`): in the
 * row above (`-1`) or below (`1`), the item whose horizontal centre is
 * nearest this item's centre. Ties go to the leftmost. At the first or last
 * row the focus stays put, so the item itself is returned.
 */
export function verticalNeighbour(
  layout: JustifiedLayout,
  index: number,
  direction: -1 | 1,
): number {
  if (index < 0 || index >= layout.count) return index
  const target = rowOfItem(layout, index) + direction
  if (target < 0 || target >= layout.rowCount) return index
  const { itemX, itemWidth, rowStart } = layout
  const centre = (itemX[index] as number) + (itemWidth[index] as number) / 2
  const end = rowStart[target + 1] as number
  let best = rowStart[target] as number
  let bestDistance = Number.POSITIVE_INFINITY
  for (let i = best; i < end; i++) {
    const distance = Math.abs(
      (itemX[i] as number) + (itemWidth[i] as number) / 2 - centre,
    )
    if (distance < bestDistance) {
      best = i
      bestDistance = distance
    }
  }
  return best
}

/**
 * Adds a pinned row to the virtualiser's indexes, keeping them sorted. Used
 * as TanStack Virtual's `rangeExtractor` (wrapping `defaultRangeExtractor`)
 * so the focused tile's row stays mounted while it is scrolled out of view:
 * the DOM element that has focus is never removed, and keyboard navigation
 * can always focus the next tile synchronously.
 */
export function withPinnedIndex(
  indexes: number[],
  pinned: number | null,
): number[] {
  if (pinned === null || pinned < 0) return indexes
  if (indexes.length === 0) return [pinned]
  const first = indexes[0] as number
  const last = indexes[indexes.length - 1] as number
  if (pinned < first) return [pinned, ...indexes]
  if (pinned > last) return [...indexes, pinned]
  return indexes
}

/**
 * Where an item sits in the viewport: its row's top minus the scroll offset.
 * Captured before a re-layout and restored after it.
 */
export interface ScrollAnchor {
  index: number
  offset: number
}

/**
 * The anchor to keep in place across a re-layout (resize, density change):
 * the focused item if any part of its row is in the viewport, otherwise the
 * first item of the first visible row. A focused item that is scrolled far
 * away (its row only pinned) doesn't anchor, or the viewport would jump to it.
 */
export function captureScrollAnchor(
  layout: JustifiedLayout,
  scrollTop: number,
  viewportHeight: number,
  focusedIndex: number | null,
): ScrollAnchor | null {
  if (layout.rowCount === 0) return null
  if (
    focusedIndex !== null &&
    focusedIndex >= 0 &&
    focusedIndex < layout.count
  ) {
    const row = rowOfItem(layout, focusedIndex)
    const top = layout.rowTop[row] as number
    const bottom = top + (layout.rowHeight[row] as number)
    if (bottom > scrollTop && top < scrollTop + viewportHeight) {
      return { index: focusedIndex, offset: top - scrollTop }
    }
  }
  const row = firstRowBelow(layout, scrollTop)
  return {
    index: layout.rowStart[row] as number,
    offset: (layout.rowTop[row] as number) - scrollTop,
  }
}

/** The scroll offset that puts the anchor's item back where it was. */
export function scrollTopForAnchor(
  layout: JustifiedLayout,
  anchor: ScrollAnchor,
): number {
  if (layout.rowCount === 0) return 0
  const index = Math.min(anchor.index, layout.count - 1)
  const top = layout.rowTop[rowOfItem(layout, index)] as number
  return Math.max(0, top - anchor.offset)
}

/**
 * The scroll offset that brings `row` fully into view with the least
 * movement (or `scrollTop` itself if it is already in view). For keyboard
 * focus moves: the tile is focused with `preventScroll`, then the grid
 * scrolls by exactly this much.
 */
export function scrollTopToReveal(
  layout: JustifiedLayout,
  row: number,
  scrollTop: number,
  viewportHeight: number,
): number {
  const top = layout.rowTop[row]
  const height = layout.rowHeight[row]
  if (top === undefined || height === undefined) return scrollTop
  if (top < scrollTop) return top
  if (top + height > scrollTop + viewportHeight) {
    // Align the bottom, unless the row is taller than the viewport.
    return Math.min(top, top + height - viewportHeight)
  }
  return scrollTop
}
