// One grid tile: a `gridcell` (not a button, so Enter and Space reach the
// app's keymap, spike C4) with a roving tabindex, `aria-selected`, and the
// picture faded in over a placeholder of the tile's own reserved size, so
// nothing shifts when it loads (interaction-spec §2).

import { type MouseEvent, memo, useEffect, useState } from 'react'
import type {
  LibraryItemTile,
  MediaKind,
} from '../../../../../shared/library-api'
import { pictureFor } from '../../core/collection/renditions'
import {
  ArchiveIcon,
  AudioIcon,
  CheckIcon,
  FileIcon,
  ImageIcon,
  PdfIcon,
  VideoIcon,
} from '../../core/ui/icons'
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
  onOpen(id: number): void
  onFocusTile(id: number): void
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

function TilePicture({
  item,
  width,
  height,
}: {
  item: LibraryItemTile
  width: number
  height: number
}) {
  const [loaded, setLoaded] = useState(false)
  const src = pictureFor(item, width, height, pixelRatio())
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
    <div
      className={classes.media}
      data-checker={item.kind === 'svg' ? '' : undefined}
    >
      <img
        src={shown}
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
}: TileProps) {
  // The file name, as the hover overlay shows it (axe: label = visible text).
  const label = item ? item.filename : 'Loading'
  return (
    // biome-ignore lint/a11y/useSemanticElements: an absolutely positioned ARIA grid, not a table
    // biome-ignore lint/a11y/useKeyWithClickEvents: the app keymap handles the grid's keys (arrows, Space, Enter, X)
    <div
      role='gridcell'
      className={classes.tile}
      data-mm-tile={id}
      aria-selected={selected}
      aria-label={label}
      tabIndex={tabStop ? 0 : -1}
      data-returning={returning ? '' : undefined}
      style={{ left, width }}
      onClick={(event) => onPointerSelect(id, event)}
      onDoubleClick={() => onOpen(id)}
      onFocus={() => onFocusTile(id)}
    >
      {item ? (
        <TilePicture item={item} width={width} height={height} />
      ) : (
        <div className={classes.media} aria-hidden />
      )}
      {!item && kind !== 'image' && kind !== 'svg' && (
        <TypeCard kind={kind} name='' />
      )}
      <span className={classes.check} aria-hidden>
        <CheckIcon size={14} stroke={3} />
      </span>
      {item && (
        <span className={classes.name} aria-hidden>
          {item.filename}
        </span>
      )}
    </div>
  )
}

/** Re-renders only when its own props change (≈ 30 tiles are mounted). */
export const Tile = memo(TileView)
