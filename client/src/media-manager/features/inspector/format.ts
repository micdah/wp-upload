// Small pure helpers for the Info panel: file name truncation, sizes and the
// meta line.

import type {
  LibraryItemFull,
  LibraryItemTile,
  MediaKind,
} from '../../../../../shared/library-api'
import { IMAGE_LIKE_KINDS } from '../../../../../shared/library-api'

/** Kinds that have alt text (images and SVG). */
export function isImageLike(kind: MediaKind | undefined): boolean {
  return (IMAGE_LIKE_KINDS as readonly string[]).includes(kind ?? '')
}

/** Characters of the name kept after the ellipsis, besides the extension. */
const TAIL_CHARS = 6

/**
 * Splits a file name for middle truncation: the head shrinks with an
 * ellipsis (CSS), the tail keeps the last few characters and the extension.
 */
export function splitFileName(name: string): { head: string; tail: string } {
  const dot = name.lastIndexOf('.')
  const extension = dot > 0 ? name.slice(dot) : ''
  const base = extension ? name.slice(0, dot) : name
  if (base.length <= TAIL_CHARS * 2) {
    return { head: '', tail: name }
  }
  return {
    head: base.slice(0, -TAIL_CHARS),
    tail: `${base.slice(-TAIL_CHARS)}${extension}`,
  }
}

const UNITS = ['KB', 'MB', 'GB'] as const

/** "840 B", "312 KB", "4.2 MB" (1000-based, like WordPress and Finder). */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) {
    return `${bytes} B`
  }
  let value = bytes
  let unit: string = UNITS[0]
  for (const candidate of UNITS) {
    value /= 1000
    unit = candidate
    if (value < 1000) {
      break
    }
  }
  const digits = value < 10 ? 1 : 0
  return `${value.toFixed(digits)} ${unit}`
}

const KIND_LABELS: Record<MediaKind, string> = {
  image: 'Image',
  svg: 'SVG',
  video: 'Video',
  audio: 'Audio',
  document: 'Document',
  archive: 'Archive',
  other: 'File',
}

export function kindLabel(kind: MediaKind): string {
  return KIND_LABELS[kind] ?? 'File'
}

/** "Image · 4.2 MB · 2560 × 1707" (unknown parts left out). */
export function metaLine(item: LibraryItemTile | LibraryItemFull): string {
  const parts = [kindLabel(item.kind)]
  if (item.filesize !== null) {
    parts.push(formatBytes(item.filesize))
  }
  if (item.width > 0 && item.height > 0) {
    parts.push(`${item.width} × ${item.height}`)
  }
  return parts.join(' · ')
}
