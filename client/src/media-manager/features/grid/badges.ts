// What a tile says about its item at a glance (interaction-spec §2, system.md
// §1): the badges bottom right, and the state an upload in progress gives
// the tile. Pure, so the rules are unit-tested without a browser.

import {
  IMAGE_LIKE_KINDS,
  type LibraryItemTile,
  type MediaKind,
} from '../../../../../shared/library-api'
import type { TileUploadState } from '../../core/uploads/tileState'

export type BadgeTone = 'neutral' | 'warn' | 'danger'

export interface TileBadge {
  /** Stable key, and what tests look for. */
  id: 'alt' | 'duration' | 'pages' | 'processing' | 'failed'
  /** The visible text. */
  text: string
  /** What a screen reader hears (the badge's text is short hand). */
  label: string
  tone: BadgeTone
}

const IMAGE_LIKE = new Set<MediaKind>(IMAGE_LIKE_KINDS)

/** `m:ss`, or `h:mm:ss` from an hour, for video and audio durations. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = String(total % 60).padStart(2, '0')
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}`
    : `${minutes}:${rest}`
}

/** Image-like items (image, SVG) whose alt text is empty count as missing. */
export function isMissingAlt(
  item: Pick<LibraryItemTile, 'kind' | 'alt'>,
): boolean {
  return IMAGE_LIKE.has(item.kind) && item.alt.trim() === ''
}

/** True for a PDF (documents can be other formats, with no page count). */
function isPdf(item: Pick<LibraryItemTile, 'mime'>): boolean {
  return item.mime === 'application/pdf'
}

/**
 * The badges of a tile, left to right: an upload problem or processing
 * first (they need attention), then missing alt, then duration or pages.
 */
export function tileBadges(
  item: Pick<
    LibraryItemTile,
    'kind' | 'alt' | 'mime' | 'duration' | 'pages' | 'sizesPending'
  >,
  upload: TileUploadState | null = null,
): TileBadge[] {
  const badges: TileBadge[] = []
  if (upload?.phase === 'error') {
    badges.push({
      id: 'failed',
      text: 'Failed',
      label: 'Upload failed',
      tone: 'danger',
    })
  } else if (upload?.phase === 'processing' || item.sizesPending) {
    badges.push({
      id: 'processing',
      text: 'Processing',
      label: 'Processing: generating thumbnail sizes',
      tone: 'neutral',
    })
  }
  if (isMissingAlt(item)) {
    badges.push({
      id: 'alt',
      text: 'Alt',
      label: 'Missing alt text',
      tone: 'warn',
    })
  }
  if (
    (item.kind === 'video' || item.kind === 'audio') &&
    item.duration !== null &&
    item.duration > 0
  ) {
    badges.push({
      id: 'duration',
      text: formatDuration(item.duration),
      label: `Duration ${formatDuration(item.duration)}`,
      tone: 'neutral',
    })
  }
  if (isPdf(item) && item.pages !== null && item.pages > 0) {
    badges.push({
      id: 'pages',
      text: `PDF · ${item.pages} p`,
      label: `PDF, ${item.pages} ${item.pages === 1 ? 'page' : 'pages'}`,
      tone: 'neutral',
    })
  }
  return badges
}

/**
 * Transparent pictures sit on a checkerboard (interaction-spec §2): SVG and
 * PNG. An SVG is contained with padding; a PNG fills its tile like a photo.
 */
export function checkerboardOf(
  item: Pick<LibraryItemTile, 'kind' | 'mime'>,
): 'contain' | 'cover' | null {
  if (item.kind === 'svg') return 'contain'
  if (item.mime === 'image/png') return 'cover'
  return null
}

/** How an upload in progress shows on the tile (system.md §1 "Lifecycle"). */
export interface UploadLook {
  phase: TileUploadState['phase']
  /** 0–1 for the progress ring; null shows the spinning arc. */
  progress: number | null
  /** The ring's text: "42 %" while uploading. */
  text: string | null
}

export function uploadLook(state: TileUploadState | null): UploadLook | null {
  if (state === null) return null
  switch (state.phase) {
    case 'queued':
      return { phase: 'queued', progress: 0, text: null }
    case 'uploading': {
      const progress =
        state.progress === null
          ? null
          : Math.min(1, Math.max(0, state.progress))
      return {
        phase: 'uploading',
        progress,
        text: progress === null ? null : `${Math.round(progress * 100)} %`,
      }
    }
    case 'processing':
      return { phase: 'processing', progress: null, text: null }
    case 'error':
      return { phase: 'error', progress: null, text: null }
  }
}
