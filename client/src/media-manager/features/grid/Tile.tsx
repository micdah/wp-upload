// One grid tile: a `gridcell` (not a button, so Enter and Space reach the
// app's keymap, spike C4) with a roving tabindex, `aria-selected`, and the
// picture faded in over a placeholder of the tile's own reserved size, so
// nothing shifts when it loads (interaction-spec §2).
//
// At rest a tile shows only its picture and its badges (Alt missing,
// duration, PDF pages). Hover shows the check circle and the file name.
// Non-images are neutral cards with a type icon; SVG and PNG sit on a
// checkerboard. An upload in progress renders natively from the tile upload
// state (interaction-spec §13.1): dimmed with a progress ring, then
// "Processing", then a one-off accent flash; a failure gets the danger ring,
// a "Failed" badge and Retry.

import { type MouseEvent, memo, useEffect, useRef, useState } from 'react'
import type {
  LibraryItemTile,
  MediaKind,
} from '../../../../../shared/library-api'
import { getCurrentCollection } from '../../core/collection/hooks'
import { pictureFor } from '../../core/collection/renditions'
import { useCommand } from '../../core/commands/useCommand'
import { useIsMediaDragged, useMediaDraggable } from '../../core/dnd'
import {
  AltIcon,
  ArchiveIcon,
  AudioIcon,
  FileIcon,
  ImageIcon,
  PdfIcon,
  RetryIcon,
  VideoIcon,
} from '../../core/ui/icons'
import {
  type TileUploadState,
  useTileUploadState,
} from '../../core/uploads/tileState'
import {
  checkerboardOf,
  type TileBadge,
  tileBadges,
  type UploadLook,
  uploadLook,
} from './badges'
import { flashTiles, useFlashToken } from './flash'

/** Collection order, so a multi-item drag lists its ids in order. */
function collectionOrder(): readonly number[] {
  return getCurrentCollection()?.ids ?? []
}

import classes from './Grid.module.css'

export interface TileProps {
  id: number
  kind: MediaKind
  item: LibraryItemTile | undefined
  left: number
  width: number
  height: number
  selected: boolean
  /** The roving tabindex stop. */
  tabStop: boolean
  returning: boolean
  onPointerSelect(id: number, event: MouseEvent): void
  onOpen(id: number, event: MouseEvent): void
  onFocusTile(id: number): void
  /** Drag to a folder (FileBird is active). */
  canDrag: boolean
}

const KIND_ICONS = {
  image: ImageIcon,
  svg: ImageIcon,
  video: VideoIcon,
  audio: AudioIcon,
  document: PdfIcon,
  archive: ArchiveIcon,
  other: FileIcon,
} as const

/** The check circle: a click on it toggles the tile (GridView). */
export const CHECK_SELECTOR = '[data-mm-check]'

function pixelRatio(): number {
  return typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1
}

function TypeCard({ kind, name }: { kind: MediaKind; name: string }) {
  const Icon = KIND_ICONS[kind] ?? FileIcon
  return (
    <div className={classes.card}>
      <Icon size={32} stroke={1.25} aria-hidden />
      <span className={classes.cardName}>{name}</span>
    </div>
  )
}

/** A picture faded in over the tile's reserved box. */
function FadeInImage({
  src,
  checker,
}: {
  src: string
  checker: 'contain' | 'cover' | null
}) {
  const [loaded, setLoaded] = useState(false)
  return (
    <div className={classes.media} data-checker={checker ?? undefined}>
      <img
        src={src}
        alt=''
        decoding='async'
        draggable={false}
        data-loaded={loaded ? '' : undefined}
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(true)}
      />
    </div>
  )
}

function TilePicture({
  item,
  width,
  height,
  preview,
}: {
  item: LibraryItemTile
  width: number
  height: number
  /** An upload's local picture, shown until the upload is done. */
  preview: string | null
}) {
  const src = preview ?? pictureFor(item, width, height, pixelRatio())
  // The picture on screen. A new src (a sharper size, or `?v=` after a save)
  // is loaded off-screen first and swapped in, so the tile never blanks.
  const [shown, setShown] = useState(src)
  useEffect(() => {
    if (!src || src === shown) return
    if (!shown) {
      setShown(src)
      return
    }
    let cancelled = false
    const image = new Image()
    image.decoding = 'async'
    image.onload = image.onerror = () => {
      if (!cancelled) setShown(src)
    }
    image.src = src
    return () => {
      cancelled = true
    }
  }, [src, shown])
  if (!shown) {
    return <TypeCard kind={item.kind} name={item.filename} />
  }
  return (
    <FadeInImage
      src={shown}
      checker={shown === preview ? null : checkerboardOf(item)}
    />
  )
}

// Text drawn on a tile (badges, the progress, Retry) is CSS content from
// `data-text`, not DOM text: the tile's accessible name is its file name
// (what its hover overlay shows), and visible DOM text that the name doesn't
// contain fails WCAG 2.5.3 (axe's label-content-name-mismatch). Screen
// readers get the same facts from the tile's description instead.

function Badges({ badges }: { badges: TileBadge[] }) {
  if (badges.length === 0) return null
  return (
    <span className={classes.badges} aria-hidden>
      {badges.map((badge) => (
        <span
          key={badge.id}
          className={classes.badge}
          data-tone={badge.tone}
          data-badge={badge.id}
          data-text={badge.text}
        >
          {badge.id === 'alt' && <AltIcon size={12} stroke={2} />}
        </span>
      ))}
    </span>
  )
}

function RetryButton({ id }: { id: number }) {
  const retry = useCommand('upload.retry', { key: id })
  return (
    <button
      type='button'
      className={classes.retry}
      data-text='Retry'
      aria-label='Retry upload'
      tabIndex={-1}
      aria-disabled={!retry.enabled || undefined}
      title={retry.enabled ? 'Retry upload' : `Retry: ${retry.reason}`}
      onClick={(event) => {
        // Not a tile click: no selection change, no detail on a double click.
        event.stopPropagation()
        retry.run()
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <RetryIcon size={14} aria-hidden />
    </button>
  )
}

/** The ring or arc over an uploading tile, and Retry after a failure. */
function UploadOverlay({ id, look }: { id: number; look: UploadLook }) {
  if (look.phase === 'error') {
    return (
      <span className={classes.upload}>
        <RetryButton id={id} />
      </span>
    )
  }
  return (
    <span className={classes.upload} aria-hidden>
      <span
        className={classes.ring}
        data-spinning={look.progress === null ? '' : undefined}
        style={
          look.progress === null
            ? undefined
            : ({ '--progress': look.progress } as React.CSSProperties)
        }
        data-text={look.text ?? undefined}
      />
    </span>
  )
}

/** What a screen reader hears after the file name. */
function describe(badges: TileBadge[], upload: UploadLook | null): string {
  const parts = badges.map((badge) => badge.label)
  if (upload?.phase === 'queued') parts.unshift('Waiting to upload')
  if (upload?.phase === 'uploading') {
    parts.unshift(upload.text ? `Uploading, ${upload.text}` : 'Uploading')
  }
  return parts.join(', ')
}

/**
 * Flashes the tile when its upload finishes, or when its item changes
 * while it is on screen (a save, a batch edit, an edit made elsewhere).
 */
function useJustChangedFlash(
  id: number,
  item: LibraryItemTile | undefined,
  upload: TileUploadState | null,
): void {
  const modifiedAt = item?.modifiedAt
  const seen = useRef(modifiedAt)
  useEffect(() => {
    const before = seen.current
    seen.current = modifiedAt
    if (before !== undefined && modifiedAt !== undefined) {
      if (before !== modifiedAt) flashTiles([id])
    }
  }, [id, modifiedAt])
  const phase = upload?.phase ?? null
  const previousPhase = useRef(phase)
  useEffect(() => {
    const before = previousPhase.current
    previousPhase.current = phase
    if (before !== null && before !== 'error' && phase === null) {
      flashTiles([id])
    }
  }, [id, phase])
}

function TileView({
  id,
  kind,
  item,
  left,
  width,
  height,
  selected,
  tabStop,
  returning,
  onPointerSelect,
  onOpen,
  onFocusTile,
  canDrag,
}: TileProps) {
  const ref = useRef<HTMLDivElement>(null)
  useMediaDraggable(ref, id, { disabled: !canDrag, getOrder: collectionOrder })
  const dragged = useIsMediaDragged(id)
  const upload = useTileUploadState(id)
  const flash = useFlashToken(id)
  useJustChangedFlash(id, item, upload)
  const look = uploadLook(upload)
  const badges = item ? tileBadges(item, upload) : []
  const description = describe(badges, look)
  const descriptionId = description ? `mm-tile-${id}-about` : undefined
  // The file name, as the hover overlay shows it (axe: label = visible text).
  const label = item ? item.filename : 'Loading'
  const preview = upload?.previewUrl ?? null
  return (
    // biome-ignore lint/a11y/useSemanticElements: an absolutely positioned ARIA grid, not a table
    // biome-ignore lint/a11y/useKeyWithClickEvents: the app keymap handles the grid's keys (arrows, Space, Enter, X)
    <div
      ref={ref}
      role='gridcell'
      className={classes.tile}
      data-mm-drag-source={dragged ? '' : undefined}
      data-mm-tile={id}
      aria-selected={selected}
      aria-label={label}
      aria-describedby={descriptionId}
      tabIndex={tabStop ? 0 : -1}
      data-returning={returning ? '' : undefined}
      data-upload={look?.phase}
      style={{ left, width }}
      onClick={(event) => onPointerSelect(id, event)}
      onDoubleClick={(event) => onOpen(id, event)}
      onFocus={() => onFocusTile(id)}
    >
      {item ? (
        <TilePicture
          item={item}
          width={width}
          height={height}
          preview={preview}
        />
      ) : preview ? (
        <FadeInImage src={preview} checker={null} />
      ) : (
        <div className={classes.media} aria-hidden />
      )}
      {!item && !preview && kind !== 'image' && kind !== 'svg' && (
        <TypeCard kind={kind} name='' />
      )}
      {/* The check glyph is CSS (::after): one less component per tile. */}
      <span className={classes.check} data-mm-check='' aria-hidden />
      {look && <UploadOverlay id={id} look={look} />}
      <Badges badges={badges} />
      {item && (
        <span className={classes.name} aria-hidden>
          {item.filename}
        </span>
      )}
      {description && (
        <span id={descriptionId} hidden>
          {description}
        </span>
      )}
      {flash !== null && (
        <span
          key={flash}
          className={classes.flash}
          data-mm-flash=''
          aria-hidden
        />
      )}
    </div>
  )
}

/** Re-renders only when its own props change (≈ 30 tiles are mounted). */
export const Tile = memo(TileView)
