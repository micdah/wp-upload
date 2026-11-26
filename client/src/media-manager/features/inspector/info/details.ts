// Pure helpers for the Info panel's File, Camera and Sizes sections
// (inspector.md §2 "One item", item 5): labels, dates, the exposure line and
// the folder path.

import type {
  ExifInfo,
  Folder,
  LibraryItemFull,
  MediaFileInfo,
} from '../../../../../../shared/library-api'

/** Labels of WordPress's built-in sizes. */
const SIZE_LABELS: Record<string, string> = {
  thumbnail: 'Thumbnail',
  medium: 'Medium',
  medium_large: 'Medium large',
  large: 'Large',
}

/**
 * A size's human label: "Thumbnail", "Medium large", "1536 × 1536", "Post
 * thumbnail". `full` is "Full size", or "Full (scaled)" when WordPress
 * scaled the upload down (the item has an `original`).
 */
export function sizeLabel(name: string, scaled: boolean): string {
  if (name === 'full') {
    return scaled ? 'Full (scaled)' : 'Full size'
  }
  const known = SIZE_LABELS[name]
  if (known) {
    return known
  }
  const words = name
    .replace(/(\d)x(\d)/g, '$1 × $2')
    .replace(/[_-]+/g, ' ')
    .trim()
  if (words === '') {
    return name
  }
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** "1572 × 1179", or null when either side is unknown (0). */
export function dimensions(width: number, height: number): string | null {
  if (width > 0 && height > 0) {
    return `${width} × ${height}`
  }
  return null
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const

/**
 * "11 Jan 2025" (day month year, like en-GB) in the browser's time zone, or
 * '' for an unparseable value. Fixed month names: ICU's en-GB writes
 * "Sept", which differs between browsers.
 */
export function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0')
}

/** "0:07", "1:34", "1:02:05" for a duration in seconds. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60
  if (hours > 0) {
    return `${hours}:${twoDigits(minutes)}:${twoDigits(rest)}`
  }
  return `${minutes}:${twoDigits(rest)}`
}

/** At most one decimal, without a trailing ".0": 4 → "4", 1.78 → "1.8". */
function compactNumber(value: number): string {
  return String(Math.round(value * 10) / 10)
}

/**
 * "70 mm · f/4 · 1/1000 s · ISO 200", skipping unknown parts; null when
 * nothing is known. A shutter already in seconds ("2s") keeps its unit.
 */
export function exposureLine(exif: ExifInfo): string | null {
  const parts: string[] = []
  if (exif.focalLength !== null && exif.focalLength > 0) {
    parts.push(`${compactNumber(exif.focalLength)} mm`)
  }
  if (exif.aperture !== null && exif.aperture > 0) {
    parts.push(`f/${compactNumber(exif.aperture)}`)
  }
  const shutter = exif.shutter?.trim()
  if (shutter) {
    parts.push(/s$/i.test(shutter) ? shutter : `${shutter} s`)
  }
  if (exif.iso !== null && exif.iso > 0) {
    parts.push(`ISO ${exif.iso}`)
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

/** Whether the Camera section has anything to show. */
export function hasCameraInfo(exif: ExifInfo | null): exif is ExifInfo {
  if (!exif) {
    return false
  }
  return Boolean(
    exif.camera?.trim() ||
      exif.lens?.trim() ||
      exposureLine(exif) ||
      (exif.takenAt && formatDate(exif.takenAt)),
  )
}

/** "4.1 Mbps", "128 kbps". */
function formatBitrate(bitsPerSecond: number): string {
  if (bitsPerSecond >= 1_000_000) {
    return `${compactNumber(bitsPerSecond / 1_000_000)} Mbps`
  }
  return `${Math.round(bitsPerSecond / 1000)} kbps`
}

function channelsLabel(channels: number): string {
  if (channels === 1) {
    return 'mono'
  }
  if (channels === 2) {
    return 'stereo'
  }
  return `${channels} channels`
}

/**
 * A video's or audio's encoding: "MP4 · h264 · 4.1 Mbps · 48 kHz stereo",
 * or null when nothing is known.
 */
export function mediaLine(media: MediaFileInfo | null): string | null {
  if (!media) {
    return null
  }
  const parts: string[] = []
  if (media.format) {
    parts.push(media.format.toUpperCase())
  }
  if (
    media.codec &&
    media.codec.toLowerCase() !== media.format?.toLowerCase()
  ) {
    parts.push(media.codec)
  }
  if (media.bitrate !== null && media.bitrate > 0) {
    parts.push(formatBitrate(media.bitrate))
  }
  const audio: string[] = []
  if (media.sampleRate !== null && media.sampleRate > 0) {
    audio.push(`${compactNumber(media.sampleRate / 1000)} kHz`)
  }
  if (media.channels !== null && media.channels > 0) {
    audio.push(channelsLabel(media.channels))
  }
  if (audio.length > 0) {
    parts.push(audio.join(' '))
  }
  return parts.length > 0 ? parts.join(' · ') : null
}

/**
 * The folder's path from the top level, "Blog / 2026": 0 is
 * "Uncategorized"; null when the id isn't in the tree. A broken parent
 * chain (a cycle, a missing parent) stops at what is known.
 */
export function folderPath(
  folders: readonly Folder[],
  id: number,
): string | null {
  if (id === 0) {
    return 'Uncategorized'
  }
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const names: string[] = []
  const seen = new Set<number>()
  let current = byId.get(id)
  if (!current) {
    return null
  }
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    names.unshift(current.name)
    current = current.parent === 0 ? undefined : byId.get(current.parent)
  }
  return names.join(' / ')
}

/** Raster images with generated sizes get the Sizes section. */
export function hasSizes(item: Pick<LibraryItemFull, 'kind' | 'sizes'>) {
  return item.kind === 'image' && item.sizes.length > 0
}

/**
 * An absolute URL to copy. The server sends absolute URLs; a relative one
 * (never expected) is resolved against `base`, so a copied URL works
 * outside this page.
 */
export function absoluteUrl(url: string, base: string): string {
  try {
    return new URL(url, base).href
  } catch {
    return url
  }
}
