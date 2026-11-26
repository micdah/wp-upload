// What the stage shows for each kind of item (interaction-spec §5, screens
// S5–S6, prototype detail.js `stageMedia`):
//
// - image: the picture, fitted, upgraded to the sub-size that fits;
// - SVG: the same, on a checkerboard;
// - video: the poster with a play button and the player bar;
// - audio: a card with the title, duration and the player bar;
// - PDF: the first-page preview as a paper sheet, "page 1 of N", Open PDF
//   and Download;
// - other documents, archives and anything else: a card with Download.
//
// The element in `mediaRef` is the morph's target on the stage (spike C2),
// so it is the box that matches the tile's picture: the image, the video
// frame, the sheet or the card.

import { Button } from '@mantine/core'
import {
  type CSSProperties,
  type MutableRefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type {
  LibraryItemFull,
  LibraryItemTile,
} from '../../../../../shared/library-api'
import { centerApi } from '../../core/collection/centerApi'
import {
  pickSource,
  pictureFor,
  withVersion,
} from '../../core/collection/renditions'
import { libraryApi } from '../../core/data/api'
import {
  ArchiveIcon,
  AudioIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FileIcon,
  PdfIcon,
  PlayIcon,
} from '../../core/ui/icons'
import { fitInto, type Size, zoomedSize } from './fit'
import { cardMeta, fileTypeLabel, formatBytes, formatDuration } from './format'
import classes from './Media.module.css'
import { PlayerBar, useDeferredPreload, useMediaPlayer } from './Player'

export type AnyItem = LibraryItemTile | LibraryItemFull

export function pixelRatio(): number {
  return window.devicePixelRatio || 1
}

/** Kinds the stage can zoom (interaction-spec §5: images and SVG). */
export function canZoom(item: AnyItem | null): boolean {
  return item?.kind === 'image' || item?.kind === 'svg'
}

export function isPdf(item: AnyItem): boolean {
  return item.kind === 'document' && item.mime === 'application/pdf'
}

/**
 * The picture the grid most likely shows for this item already: its tile's
 * loaded image, so the stage has something sharp-enough at once.
 */
function tilePicture(id: number): string | null {
  const image = centerApi.tileElement(id)?.querySelector('img')
  return image?.complete && image.currentSrc ? image.currentSrc : null
}

/**
 * The picture on screen: what the grid already shows at first, then
 * `wanted` once it has loaded off-screen (no flash, no blank).
 */
function useUpgradedPicture(id: number, wanted: string | null): string | null {
  const [shown, setShown] = useState(() => tilePicture(id) ?? wanted)
  useEffect(() => {
    if (!wanted || wanted === shown) return
    if (!shown) {
      setShown(wanted)
      return
    }
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
  return shown
}

/** A PDF's preview at a size: its preview renditions, else its cover. */
function sheetPictureFor(item: AnyItem, size: Size): string | null {
  const source = pickSource(item.srcset, size.width, size.height, pixelRatio())
  if (source) {
    return withVersion(source.url, item.modifiedAt)
  }
  return pictureFor(item, size.width, size.height, pixelRatio())
}

type MediaRef = MutableRefObject<HTMLElement | null>

export interface StageMediaProps {
  item: AnyItem
  /** The stage's inner box (padding excluded). */
  box: Size
  /** The zoom factor, or null for Fit (only images and SVG zoom). */
  zoom: number | null
  title: string
  mediaRef: MediaRef
}

/** The size the item is shown at on the stage, for the morph and zoom. */
export function stageSizeOf(
  item: AnyItem,
  box: Size,
  zoom: number | null,
): Size {
  return zoom === null
    ? fitInto(item, box.width, box.height)
    : zoomedSize(item, zoom)
}

export function StageMedia(props: StageMediaProps) {
  const { item } = props
  if (item.kind === 'image' || item.kind === 'svg') {
    return <PictureMedia {...props} />
  }
  if (item.kind === 'video') {
    return <VideoMedia {...props} />
  }
  if (item.kind === 'audio') {
    return <AudioMedia {...props} />
  }
  if (isPdf(item)) {
    return <PdfMedia {...props} />
  }
  return <FileCard {...props} />
}

function refSetter(mediaRef: MediaRef) {
  return (element: HTMLElement | null) => {
    mediaRef.current = element
  }
}

function PictureMedia({ item, box, zoom, title, mediaRef }: StageMediaProps) {
  const size = useMemo(() => stageSizeOf(item, box, zoom), [item, box, zoom])
  const wanted = pictureFor(item, size.width, size.height, pixelRatio())
  const shown = useUpgradedPicture(item.id, wanted)
  if (!shown) {
    return (
      <FileCard
        item={item}
        box={box}
        zoom={zoom}
        title={title}
        mediaRef={mediaRef}
      />
    )
  }
  return (
    <img
      ref={refSetter(mediaRef)}
      className={classes.picture}
      style={{ width: size.width, height: size.height }}
      src={shown}
      alt={item.alt || title}
      draggable={false}
      data-checker={item.kind === 'svg' ? '' : undefined}
      data-mm-stage-media=''
    />
  )
}

function VideoMedia({ item, box, title, mediaRef }: StageMediaProps) {
  const size = useMemo(() => fitInto(item, box.width, box.height), [item, box])
  const wanted = pictureFor(item, size.width, size.height, pixelRatio())
  const poster = useUpgradedPicture(item.id, wanted)
  const videoRef = useRef<HTMLVideoElement>(null)
  const player = useMediaPlayer(videoRef, item.duration)
  const preload = useDeferredPreload()
  const style: CSSProperties = { width: size.width, height: size.height }
  return (
    <div
      ref={refSetter(mediaRef)}
      className={classes.video}
      style={style}
      data-playing={player.playing ? '' : undefined}
      data-mm-stage-media=''
    >
      {/* biome-ignore lint/a11y/useMediaCaption: WordPress media carry no caption tracks */}
      <video
        ref={videoRef}
        className={classes.videoElement}
        src={item.url}
        poster={poster ?? undefined}
        preload={preload}
        playsInline
        aria-label={title}
        onClick={player.toggle}
      />
      {!player.playing && !player.failed && (
        <span className={classes.playOverlay} aria-hidden>
          <PlayIcon size={28} />
        </span>
      )}
      <PlayerBar player={player} label={title} overlay />
    </div>
  )
}

function AudioMedia({ item, title, mediaRef }: StageMediaProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const player = useMediaPlayer(audioRef, item.duration)
  const preload = useDeferredPreload()
  const cover = item.poster
    ? withVersion(item.poster.url, item.modifiedAt)
    : null
  return (
    <div
      ref={refSetter(mediaRef)}
      className={`${classes.card} ${classes.audio}`}
      data-mm-stage-media=''
    >
      {cover ? (
        <img className={classes.cover} src={cover} alt='' draggable={false} />
      ) : (
        <AudioIcon size={48} stroke={1} aria-hidden />
      )}
      <strong className={classes.cardTitle}>{item.filename}</strong>
      <span className={classes.cardMeta}>
        {cardMeta([
          'Audio',
          player.duration !== null && formatDuration(player.duration),
          item.filesize !== null && formatBytes(item.filesize),
        ])}
      </span>
      {/* biome-ignore lint/a11y/useMediaCaption: WordPress media carry no caption tracks */}
      <audio ref={audioRef} src={item.url} preload={preload} />
      <PlayerBar player={player} label={title} />
    </div>
  )
}

/** The A4-ish page a PDF preview of unknown size is shown as. */
const PAGE = { width: 1000, height: 1414 }
/** Room the PDF's meta column takes beside the sheet (or below it). */
const PDF_META_WIDTH = 300
const PDF_META_HEIGHT = 150
const PDF_SHEET_MAX_WIDTH = 520

function PdfMedia({ item, box, title, mediaRef }: StageMediaProps) {
  const beside = box.width >= 640
  const room = beside
    ? { width: box.width - PDF_META_WIDTH, height: box.height }
    : { width: box.width, height: box.height - PDF_META_HEIGHT }
  const page =
    item.width > 0 && item.height > 0
      ? { width: item.width, height: item.height }
      : PAGE
  const size = fitInto(
    { kind: 'document', ...page },
    Math.min(room.width, PDF_SHEET_MAX_WIDTH),
    room.height,
  )
  const preview = useUpgradedPicture(item.id, sheetPictureFor(item, size))
  return (
    <div className={classes.pdf} data-beside={beside ? '' : undefined}>
      <div
        ref={refSetter(mediaRef)}
        className={classes.sheet}
        style={{ width: size.width, height: size.height }}
        data-mm-stage-media=''
      >
        {preview ? (
          <img src={preview} alt={`First page of ${title}`} draggable={false} />
        ) : (
          <SheetLines />
        )}
      </div>
      <div className={classes.pdfMeta}>
        <strong className={classes.cardTitle}>{item.filename}</strong>
        <span className={classes.cardMeta}>
          {cardMeta([
            'PDF',
            item.pages !== null && `page 1 of ${item.pages}`,
            item.filesize !== null && formatBytes(item.filesize),
          ])}
        </span>
        <span className={classes.actions}>
          <Button
            component='a'
            href={item.url}
            target='_blank'
            rel='noopener noreferrer'
            variant='default'
            leftSection={<ExternalLinkIcon size={16} aria-hidden />}
          >
            Open PDF
          </Button>
          <DownloadButton id={item.id} />
        </span>
      </div>
    </div>
  )
}

/** A blank page with text lines, when the PDF has no preview image. */
function SheetLines() {
  return (
    <span className={classes.sheetLines} aria-hidden>
      <span className={classes.sheetTitle} />
      {Array.from({ length: 9 }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed decorative lines
        <span key={index} className={classes.sheetLine} />
      ))}
    </span>
  )
}

const CARD_ICONS = {
  document: PdfIcon,
  archive: ArchiveIcon,
} as const

function FileCard({ item, mediaRef }: StageMediaProps) {
  const Icon = CARD_ICONS[item.kind as keyof typeof CARD_ICONS] ?? FileIcon
  return (
    <div
      ref={refSetter(mediaRef)}
      className={classes.card}
      data-mm-stage-media=''
    >
      <Icon size={56} stroke={1} aria-hidden />
      <strong className={classes.cardTitle}>{item.filename}</strong>
      <span className={classes.cardMeta}>
        {cardMeta([
          fileTypeLabel(item.kind, item.filename),
          item.filesize !== null && formatBytes(item.filesize),
        ])}
      </span>
      <span className={classes.actions}>
        <DownloadButton id={item.id} />
      </span>
    </div>
  )
}

function DownloadButton({ id }: { id: number }) {
  return (
    <Button
      component='a'
      href={libraryApi.downloadUrl(id)}
      variant='subtle'
      color='gray'
      leftSection={<DownloadIcon size={16} aria-hidden />}
    >
      Download
    </Button>
  )
}
