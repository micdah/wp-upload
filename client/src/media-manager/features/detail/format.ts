// Small pure formatters for the stage's cards, the player and the filmstrip
// badges. Sizes are 1000-based, like WordPress, Finder and the inspector.

import type { MediaKind } from '../../../../../shared/library-api'

/** "0:07", "4:05", "1:02:09"; null or a bad value reads "0:00". */
export function formatDuration(seconds: number | null | undefined): string {
  const total =
    typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
      ? Math.floor(seconds)
      : 0
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = String(total % 60).padStart(2, '0')
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${rest}`
  }
  return `${minutes}:${rest}`
}

/** "4 minutes 5 seconds": the scrubber's spoken value. */
export function spokenDuration(seconds: number): string {
  const total =
    Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60
  const parts: string[] = []
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`)
  if (minutes > 0)
    parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`)
  if (rest > 0 || parts.length === 0)
    parts.push(`${rest} ${rest === 1 ? 'second' : 'seconds'}`)
  return parts.join(' ')
}

const UNITS = ['KB', 'MB', 'GB'] as const

/** "840 B", "312 KB", "4.2 MB". */
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
  return `${value.toFixed(value < 10 ? 1 : 0)} ${unit}`
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

/**
 * What a card calls the file: "PDF", "ZIP archive", or the kind ("Audio").
 * The extension names a document or archive better than the kind does.
 */
export function fileTypeLabel(kind: MediaKind, filename: string): string {
  const dot = filename.lastIndexOf('.')
  const extension = dot > 0 ? filename.slice(dot + 1).toUpperCase() : ''
  if (kind === 'archive') {
    return extension ? `${extension} archive` : 'Archive'
  }
  if ((kind === 'document' || kind === 'other') && extension) {
    return extension
  }
  return KIND_LABELS[kind] ?? 'File'
}

/** "Audio · 30:43 · 28 MB", "PDF · page 1 of 3 · 402 KB" (unknown parts left out). */
export function cardMeta(parts: readonly (string | null | false)[]): string {
  return parts.filter((part): part is string => Boolean(part)).join(' · ')
}
