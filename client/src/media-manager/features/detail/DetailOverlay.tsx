// Detail mode (interaction-spec §5): an overlay over the centre, opened by
// `?item=` (Enter, double-click, or a deep link). The grid stays mounted and
// inert underneath, so scroll position and selection survive the round trip.
//
// The stage shows the item fitted with 40 px side and 16 px vertical
// padding. The picture the grid already loaded shows at once and upgrades
// to the sub-size that fits the stage; the neighbours' pictures preload.
// The stage's media element is the morph's target (spike C2), sized to its
// fitted box so the hero never stretches into the letterbox.
//
// Wave A (track A2) adds the filmstrip, pan, the More menu, video/audio
// players and PDF pages; this is the M2 slice.

import { ActionIcon, Tooltip } from '@mantine/core'
import {
  type CSSProperties,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type {
  LibraryItemFull,
  LibraryItemTile,
} from '../../../../../shared/library-api'
import { centerApi, registerCenter } from '../../core/collection/centerApi'
import { useCollection, useItem } from '../../core/collection/hooks'
import { pictureFor } from '../../core/collection/renditions'
import { neighbourOf } from '../../core/collection/rows'
import { runCommand } from '../../core/commands/registry'
import { libraryApi } from '../../core/data/api'
import { useCore } from '../../core/state'
import { announce } from '../../core/ui/announce'
import {
  ArchiveIcon,
  AudioIcon,
  BackIcon,
  DownloadIcon,
  FileIcon,
  NextIcon,
  PdfIcon,
  PreviousIcon,
  ZoomInIcon,
} from '../../core/ui/icons'
import { useUrlState } from '../../core/url/useUrlState'
import classes from './Detail.module.css'
import { fitInto, zoomedSize } from './fit'

/** Stage padding (interaction-spec §5): 40 px at the sides, 16 px top and bottom. */
const PAD_X = 40
const PAD_Y = 16

type AnyItem = LibraryItemTile | LibraryItemFull

function pixelRatio(): number {
  return window.devicePixelRatio || 1
}

export function DetailOverlay() {
  const id = useUrlState((state) => state.item)
  if (id === null) {
    return null
  }
  return <Detail id={id} />
}

function Detail({ id }: { id: number }) {
  const collection = useCollection()
  const tile = useItem(id, 'tile').item
  const full = useItem(id, 'full').item
  const item: AnyItem | null = full ?? tile
  const index = collection.rows.indexOf(id)
  const previous = neighbourOf(collection.rows, id, -1)
  const next = neighbourOf(collection.rows, id, 1)
  const regionRef = useRef<HTMLElement>(null)
  const title = item ? item.title || item.filename : 'Loading…'

  // The grid under detail is inert, so keyboard focus moves into detail.
  useEffect(() => {
    regionRef.current?.focus({ preventScroll: true })
  }, [])

  // One announcement per item shown (mode change and each step).
  const announcement = item
    ? `${title}${index >= 0 ? `, ${index + 1} of ${collection.total}` : ''}`
    : null
  useEffect(() => {
    if (announcement) {
      announce(announcement)
    }
  }, [announcement])

  return (
    <section
      ref={regionRef}
      className={classes.detail}
      aria-label='Detail'
      tabIndex={-1}
      data-mm-detail=''
    >
      <header className={classes.bar}>
        <Tooltip label='Back to grid (Esc)' openDelay={400}>
          <ActionIcon
            variant='subtle'
            color='gray'
            size='lg'
            aria-label='Back to grid'
            onClick={() => runCommand('detail.close')}
          >
            <BackIcon size={20} />
          </ActionIcon>
        </Tooltip>
        <h2 className={classes.title} title={title}>
          {title}
        </h2>
        {index >= 0 && (
          <span className={classes.index}>
            {index + 1} / {collection.total}
          </span>
        )}
        <span className={classes.spacer} />
        <ZoomButton item={item} />
        <Tooltip label='Download' openDelay={400}>
          <ActionIcon
            component='a'
            href={libraryApi.downloadUrl(id)}
            variant='subtle'
            color='gray'
            size='lg'
            aria-label='Download'
          >
            <DownloadIcon size={20} />
          </ActionIcon>
        </Tooltip>
      </header>
      <Stage
        id={id}
        item={item}
        previous={previous}
        next={next}
        title={title}
        inView={index >= 0}
      />
    </section>
  )
}

function canZoom(item: AnyItem | null): boolean {
  return item?.kind === 'image' || item?.kind === 'svg'
}

function ZoomButton({ item }: { item: AnyItem | null }) {
  const zoom = useCore((state) => state.zoom)
  if (!canZoom(item)) {
    return null
  }
  const zoomed = zoom !== 'fit'
  return (
    <Tooltip label={zoomed ? 'Fit (Z)' : '100 % (Z)'} openDelay={400}>
      <ActionIcon
        variant={zoomed ? 'light' : 'subtle'}
        color='gray'
        size='lg'
        aria-label='Zoom'
        aria-pressed={zoomed}
        onClick={() => runCommand('detail.zoom-toggle')}
      >
        <ZoomInIcon size={20} />
      </ActionIcon>
    </Tooltip>
  )
}

/** The stage's inner box (padding excluded), kept current by a ResizeObserver. */
function useStageBox(ref: React.RefObject<HTMLElement | null>) {
  const [box, setBox] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () =>
      setBox({
        width: Math.max(0, element.clientWidth - 2 * PAD_X),
        height: Math.max(0, element.clientHeight - 2 * PAD_Y),
      })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return box
}

/** Preloads a picture into the browser cache. */
function preload(url: string | null): void {
  if (url) {
    const image = new Image()
    image.decoding = 'async'
    image.src = url
  }
}

function Stage({
  id,
  item,
  previous,
  next,
  title,
  inView,
}: {
  id: number
  item: AnyItem | null
  previous: number | null
  next: number | null
  title: string
  inView: boolean
}) {
  const stageRef = useRef<HTMLDivElement>(null)
  const mediaRef = useRef<HTMLElement | null>(null)
  const box = useStageBox(stageRef)
  const zoom = useCore((state) => state.zoom)
  const [nudge, setNudge] = useState<1 | -1 | null>(null)

  // A layout effect: the morph asks for the stage element right after the
  // flushSync that opened detail, before passive effects would have run.
  useLayoutEffect(
    () =>
      registerCenter({
        stageElement: () => mediaRef.current,
        nudgeStage: (direction) => {
          setNudge(null)
          requestAnimationFrame(() => setNudge(direction))
        },
      }),
    [],
  )

  // Preload the neighbours at the stage size, so stepping is instant.
  const previousItem = useItem(previous, 'tile').item
  const nextItem = useItem(next, 'tile').item
  useEffect(() => {
    for (const neighbour of [previousItem, nextItem]) {
      if (!neighbour || box.width === 0) continue
      const fitted = fitInto(neighbour, box.width, box.height)
      preload(pictureFor(neighbour, fitted.width, fitted.height, pixelRatio()))
    }
  }, [previousItem, nextItem, box.width, box.height])

  const zoomed = zoom !== 'fit' && canZoom(item)

  return (
    <div
      ref={stageRef}
      className={classes.stage}
      data-zoomed={zoomed ? '' : undefined}
      data-nudge={nudge ?? undefined}
      onAnimationEnd={() => setNudge(null)}
    >
      {item && box.width > 0 && (
        <StageMedia
          key={id}
          item={item}
          box={box}
          zoom={zoomed ? (zoom as number) : null}
          title={title}
          mediaRef={mediaRef}
        />
      )}
      {/* At an end of the collection the button hides. An item that left
          the view (index -1) still steps from its old place (detail.step). */}
      <StepButton direction={-1} disabled={previous === null && inView} />
      <StepButton direction={1} disabled={next === null && inView} />
    </div>
  )
}

function StepButton({
  direction,
  disabled,
}: {
  direction: 1 | -1
  disabled: boolean
}) {
  const label = direction === 1 ? 'Next item' : 'Previous item'
  return (
    <ActionIcon
      className={`${classes.nav} ${direction === 1 ? classes.next : classes.previous}`}
      variant='default'
      size='xl'
      aria-label={label}
      aria-disabled={disabled || undefined}
      data-at-end={disabled ? '' : undefined}
      tabIndex={disabled ? -1 : undefined}
      onClick={() => {
        if (!disabled) {
          runCommand('detail.step', { direction })
        }
      }}
    >
      {direction === 1 ? <NextIcon size={22} /> : <PreviousIcon size={22} />}
    </ActionIcon>
  )
}

const CARD_ICONS = {
  audio: AudioIcon,
  document: PdfIcon,
  archive: ArchiveIcon,
  other: FileIcon,
} as const

/**
 * The picture the grid most likely shows for this item already: its tile's
 * loaded image, so the stage has something sharp-enough at once.
 */
function tilePicture(id: number): string | null {
  const image = centerApi.tileElement(id)?.querySelector('img')
  return image?.complete && image.currentSrc ? image.currentSrc : null
}

function StageMedia({
  item,
  box,
  zoom,
  title,
  mediaRef,
}: {
  item: AnyItem
  box: { width: number; height: number }
  zoom: number | null
  title: string
  mediaRef: React.MutableRefObject<HTMLElement | null>
}) {
  const fitted = useMemo(
    () => fitInto(item, box.width, box.height),
    [item, box.width, box.height],
  )
  const size = zoom === null ? fitted : zoomedSize(item, zoom)
  const wanted = pictureFor(item, size.width, size.height, pixelRatio())
  const [shown, setShown] = useState(() => tilePicture(item.id) ?? wanted)

  // Upgrade to the sub-size that fits, once it has loaded (no flash).
  useEffect(() => {
    if (!wanted || wanted === shown) return
    let cancelled = false
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
      if (!cancelled) setShown(wanted)
    }
    image.src = wanted
    return () => {
      cancelled = true
    }
  }, [wanted, shown])

  const style: CSSProperties = { width: size.width, height: size.height }
  const setRef = (element: HTMLElement | null) => {
    mediaRef.current = element
  }

  if (item.kind === 'video') {
    return (
      // biome-ignore lint/a11y/useMediaCaption: WordPress media carry no caption tracks
      <video
        ref={setRef}
        className={classes.media}
        style={style}
        src={item.url}
        poster={shown ?? undefined}
        controls
        preload='metadata'
        aria-label={title}
      />
    )
  }
  if ((item.kind === 'image' || item.kind === 'svg') && shown) {
    return (
      <img
        ref={setRef}
        className={classes.media}
        style={style}
        src={shown}
        alt={item.alt || title}
        draggable={false}
        data-checker={item.kind === 'svg' ? '' : undefined}
      />
    )
  }
  if (item.kind === 'document' && shown) {
    return (
      <a
        ref={setRef}
        href={item.url}
        target='_blank'
        rel='noopener noreferrer'
        aria-label={`Open ${title}`}
      >
        <img
          className={classes.media}
          style={style}
          src={shown}
          alt=''
          draggable={false}
        />
      </a>
    )
  }
  const Icon =
    CARD_ICONS[item.kind as keyof typeof CARD_ICONS] ?? CARD_ICONS.other
  return (
    <div ref={setRef} className={classes.card}>
      <Icon size={56} stroke={1} aria-hidden />
      <span className={classes.cardTitle}>{title}</span>
      {item.kind === 'audio' ? (
        // biome-ignore lint/a11y/useMediaCaption: WordPress media carry no caption tracks
        <audio src={item.url} controls preload='none' aria-label={title} />
      ) : (
        <a href={libraryApi.downloadUrl(item.id)}>Download</a>
      )}
    </div>
  )
}
