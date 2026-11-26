// Quick peek's content (interaction-spec §4, screens.md S7): the focused
// item over a scrim with a blur, fitted into the centre, and a caption pill
// with its name, dimensions, size and key hints. A lazy chunk (D31); the
// peek's keys and open state live in index.tsx.
//
// Focus never moves here: it stays on the grid's tile, so ←/→/↑/↓ keep
// moving the grid's focus and the peek follows it.

import { useLayoutEffect, useRef, useState } from 'react'
import type { LibraryItemTile } from '../../../../../shared/library-api'
import { useItem } from '../../core/collection/hooks'
import { pictureFor } from '../../core/collection/renditions'
import { coreStore, useCore } from '../../core/state'
import {
  ArchiveIcon,
  AudioIcon,
  FileIcon,
  ImageIcon,
  PdfIcon,
  VideoIcon,
} from '../../core/ui/icons'
import { noSelectProps } from '../../core/ui/noSelect'
import { PEEK_CARD_SIZE, peekSize, type Size, truncateMiddle } from './fit'
import classes from './Peek.module.css'

const KIND = {
  image: { Icon: ImageIcon, label: 'Image' },
  svg: { Icon: ImageIcon, label: 'SVG image' },
  video: { Icon: VideoIcon, label: 'Video' },
  audio: { Icon: AudioIcon, label: 'Audio' },
  document: { Icon: PdfIcon, label: 'Document' },
  archive: { Icon: ArchiveIcon, label: 'Archive' },
  other: { Icon: FileIcon, label: 'File' },
} as const

function formatSize(bytes: number | null): string | null {
  if (bytes === null) return null
  if (bytes < 1000) return `${bytes} B`
  const units = ['kB', 'MB', 'GB']
  let value = bytes / 1000
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit += 1
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`
}

/** "4000 × 3000 · 2.4 MB", leaving out what isn't known. */
export function peekFacts(
  item: Pick<LibraryItemTile, 'width' | 'height' | 'filesize'>,
): string {
  const parts: string[] = []
  if (item.width > 0 && item.height > 0) {
    parts.push(`${item.width} × ${item.height}`)
  }
  const size = formatSize(item.filesize)
  if (size) parts.push(size)
  return parts.join(' · ')
}

/** The centre area's size, followed as it resizes. */
function useAreaSize(): [React.RefObject<HTMLDivElement | null>, Size] {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () =>
      setSize({ width: element.clientWidth, height: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  return [ref, size]
}

function PeekPicture({ item, area }: { item: LibraryItemTile; area: Size }) {
  const box = peekSize(item, area)
  const ratio = window.devicePixelRatio || 1
  const src = pictureFor(item, box.width, box.height, ratio)
  const [loaded, setLoaded] = useState<string | null>(null)
  if (!src || box.width === 0) {
    const { Icon, label } = KIND[item.kind] ?? KIND.other
    return (
      <div
        className={classes.card}
        style={{ width: PEEK_CARD_SIZE, height: PEEK_CARD_SIZE }}
        data-peek-media=''
      >
        <Icon size={48} stroke={1.25} aria-hidden />
        <span>{label}</span>
      </div>
    )
  }
  return (
    <img
      className={classes.media}
      src={src}
      alt={item.alt}
      width={box.width}
      height={box.height}
      decoding='async'
      draggable={false}
      data-peek-media=''
      data-loaded={loaded === src ? '' : undefined}
      onLoad={() => setLoaded(src)}
      onError={() => setLoaded(src)}
      style={{ width: box.width, height: box.height }}
    />
  )
}

function close(): void {
  coreStore.getState().closeOverlay('peek')
}

export function Peek() {
  const focus = useCore((state) => state.focus)
  const { item } = useItem(focus)
  const [ref, area] = useAreaSize()
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Space and Esc close it through the keymap
    // biome-ignore lint/a11y/noStaticElementInteractions: a click on the scrim closes, as in Quick Look
    <div
      ref={ref}
      className={classes.peek}
      data-mm-peek=''
      {...noSelectProps}
      // A press on the scrim must not take focus from the grid's tile.
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        if (
          !(event.target instanceof Element) ||
          !event.target.closest('[data-peek-media]')
        ) {
          close()
        }
      }}
    >
      {item && (
        <figure
          className={classes.figure}
          aria-label={`Quick peek: ${item.filename}`}
        >
          <PeekPicture item={item} area={area} />
          <figcaption className={classes.caption}>
            <strong className={classes.name}>
              {truncateMiddle(item.filename, 48)}
            </strong>
            {peekFacts(item) && (
              <span className={classes.facts}>{peekFacts(item)}</span>
            )}
            <span className={classes.hints}>
              <kbd>Space</kbd> close · <kbd>Enter</kbd> open · <kbd>←</kbd>
              <kbd>→</kbd> browse
            </span>
          </figcaption>
        </figure>
      )}
    </div>
  )
}
