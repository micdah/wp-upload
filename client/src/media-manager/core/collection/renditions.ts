// Which rendition of an item to show at a given size: the grid's tiles, the
// detail stage and the inspector preview all ask the same question. Items
// carry `srcset` (uncropped renditions, ascending by width, ending with the
// full file) and `thumb` (the 150 px square crop) per server-api.md §8.1.
//
// The answer is the smallest uncropped rendition that covers the box at the
// device's pixel ratio, so a tile never downloads the full file and the stage
// gets a sharp sub-size. In-place edits keep the URL, so the item's
// `modifiedAt` is appended as `?v=` to bust the browser's cache (D19).

import type {
  ImageSource,
  LibraryItemTile,
} from '../../../../../shared/library-api'

/** What the pickers read; tiles and full items both fit. */
export type RenditionItem = Pick<
  LibraryItemTile,
  | 'kind'
  | 'mime'
  | 'url'
  | 'width'
  | 'height'
  | 'srcset'
  | 'thumb'
  | 'poster'
  | 'modifiedAt'
>

/** Kinds whose own file is a picture the browser can show in an <img>. */
const PICTURE_KINDS: ReadonlySet<string> = new Set(['image', 'svg'])

/** Adds `v=<modifiedAt>` so an edited-in-place file isn't served stale. */
export function withVersion(url: string, modifiedAt: string): string {
  const version = encodeURIComponent(modifiedAt)
  return `${url}${url.includes('?') ? '&' : '?'}v=${version}`
}

/**
 * The smallest source at least `width` × `height` CSS px at `pixelRatio`, or
 * the largest when none is that big. `sources` must ascend by width.
 */
export function pickSource(
  sources: readonly ImageSource[],
  width: number,
  height: number,
  pixelRatio = 1,
): ImageSource | null {
  const wantedWidth = width * pixelRatio
  const wantedHeight = height * pixelRatio
  for (const source of sources) {
    if (source.width >= wantedWidth && source.height >= wantedHeight) {
      return source
    }
  }
  return sources[sources.length - 1] ?? null
}

/**
 * The picture to show for an item in a box of `width` × `height` CSS px: a
 * rendition of an image (an SVG is its own file), or the poster of a video or
 * audio item, or the thumbnail a PDF may have. Null when there is no picture
 * (the caller shows a type card).
 */
export function pictureFor(
  item: RenditionItem,
  width: number,
  height: number,
  pixelRatio = 1,
): string | null {
  if (item.kind === 'svg') {
    return withVersion(item.url, item.modifiedAt)
  }
  if (PICTURE_KINDS.has(item.kind)) {
    const source = pickSource(item.srcset, width, height, pixelRatio)
    return withVersion(source?.url ?? item.url, item.modifiedAt)
  }
  const cover = item.poster ?? item.thumb
  return cover ? withVersion(cover.url, item.modifiedAt) : null
}

/**
 * The smallest picture of an item: a cheap placeholder while a sharper one
 * loads, when nothing better is already in the browser's cache.
 */
export function smallestPictureFor(item: RenditionItem): string | null {
  return pictureFor(item, 1, 1, 1)
}
