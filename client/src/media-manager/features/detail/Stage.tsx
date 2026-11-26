// The stage (interaction-spec §5): the item fitted with 40 px side and 16 px
// vertical padding, Prev/Next on hover (always on touch screens), and:
//
// - zoom (images and SVG): the zoomed picture scrolls inside the stage,
//   keeping the point at the centre as the level changes; drag to pan with
//   the grab cursor; a trackpad pans natively. Zoom resets to Fit when you
//   step or leave (core sync);
// - touch: swipe to step and pinch to zoom (useStageGestures);
// - the end-of-collection nudge (D34), and a short slide-in after a swipe.
//
// Structure: a frame (holds the step buttons, never scrolls) around the
// scroller (scrolls when zoomed) around the slot (moves with a swipe, keyed
// by item) around the media (the morph's target, StageMedia.tsx).

import { ActionIcon, Button } from '@mantine/core'
import {
  type AnimationEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { registerCenter } from '../../core/collection/centerApi'
import { useItem } from '../../core/collection/hooks'
import { pictureFor } from '../../core/collection/renditions'
import { runCommand } from '../../core/commands/registry'
import { coreStore, useCore } from '../../core/state'
import type { ZoomLevel } from '../../core/state/store'
import {
  BackIcon,
  MissingIcon,
  NextIcon,
  PreviousIcon,
} from '../../core/ui/icons'
import { noSelectProps } from '../../core/ui/noSelect'
import { urlStore } from '../../core/url/useUrlState'
import classes from './Detail.module.css'
import { fitInto, scaleOf } from './fit'
import mediaClasses from './Media.module.css'
import { type AnyItem, canZoom, pixelRatio, StageMedia } from './StageMedia'
import { type StepTarget, useStageGestures } from './useStageGestures'

export interface StageProps {
  id: number
  item: AnyItem | null
  /** The server says the item doesn't exist (or isn't visible). */
  missing: boolean
  title: string
  /** Neighbour ids to preload, when known. */
  previous: number | null
  next: number | null
  /** What each step button and swipe reaches. */
  targets: { previous: StepTarget; next: StepTarget }
}

/**
 * The stage's inner box, kept current by a ResizeObserver. Its padding
 * (Detail.module.css) is the interaction spec's 40 px at the sides and 16 px
 * top and bottom, less on a phone.
 */
function useStageBox(ref: RefObject<HTMLElement | null>) {
  const [box, setBox] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () =>
      setBox((current) => {
        const style = getComputedStyle(element)
        const padX =
          Number.parseFloat(style.paddingLeft) +
          Number.parseFloat(style.paddingRight)
        const padY =
          Number.parseFloat(style.paddingTop) +
          Number.parseFloat(style.paddingBottom)
        const width = Math.max(0, element.clientWidth - padX)
        const height = Math.max(0, element.clientHeight - padY)
        return current.width === width && current.height === height
          ? current
          : { width, height }
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

/**
 * Keeps the same point of a zoomed picture at the stage's centre when the
 * zoom level changes; entering zoom starts at the picture's centre, or at
 * the point a pinch was made around.
 */
function useZoomScroll(
  scrollRef: RefObject<HTMLElement | null>,
  mediaRef: RefObject<HTMLElement | null>,
  zoomKey: string | null,
) {
  const centre = useRef<{ x: number; y: number } | null>(null)
  const pending = useRef<{ x: number; y: number } | null>(null)

  useLayoutEffect(() => {
    const scroller = scrollRef.current
    const media = mediaRef.current
    if (zoomKey === null || !scroller || !media) {
      centre.current = null
      return
    }
    const point = pending.current ?? centre.current ?? { x: 0.5, y: 0.5 }
    pending.current = null
    scroller.scrollLeft =
      media.offsetLeft + point.x * media.offsetWidth - scroller.clientWidth / 2
    scroller.scrollTop =
      media.offsetTop + point.y * media.offsetHeight - scroller.clientHeight / 2
    centre.current = point
  }, [scrollRef, mediaRef, zoomKey])

  const onScroll = useCallback(() => {
    const scroller = scrollRef.current
    const media = mediaRef.current
    if (zoomKey === null || !scroller || !media || media.offsetWidth === 0) {
      return
    }
    centre.current = {
      x:
        (scroller.scrollLeft + scroller.clientWidth / 2 - media.offsetLeft) /
        media.offsetWidth,
      y:
        (scroller.scrollTop + scroller.clientHeight / 2 - media.offsetTop) /
        Math.max(1, media.offsetHeight),
    }
  }, [scrollRef, mediaRef, zoomKey])

  const zoomAround = useCallback((point: { x: number; y: number }) => {
    pending.current = point
  }, [])

  return { onScroll, zoomAround }
}

export function Stage({
  id,
  item,
  missing,
  title,
  previous,
  next,
  targets,
}: StageProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const slotRef = useRef<HTMLDivElement>(null)
  const mediaRef = useRef<HTMLElement | null>(null)
  const box = useStageBox(scrollRef)
  const zoom = useCore((state) => state.zoom)
  const zoomed = zoom !== 'fit' && canZoom(item)
  const factor = zoomed ? (zoom as number) : null
  const [nudge, setNudge] = useState<1 | -1 | null>(null)
  const [enter, setEnter] = useState<{ id: number; from: 1 | -1 } | null>(null)

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

  const { onScroll, zoomAround } = useZoomScroll(
    scrollRef,
    mediaRef,
    zoomed ? `${id}:${zoom}` : null,
  )

  const targetsRef = useRef(targets)
  targetsRef.current = targets
  const { panning, handlers } = useStageGestures({
    scrollRef,
    slotRef,
    mediaRef,
    zoomed,
    zoomable: canZoom(item),
    scales: () => {
      if (!item) return { now: 1, fit: 1 }
      const fit = scaleOf(item, fitInto(item, box.width, box.height))
      return { now: factor ?? fit, fit }
    },
    stepTarget: (direction) =>
      direction === 1 ? targetsRef.current.next : targetsRef.current.previous,
    onSwipe: (direction) => {
      const target =
        direction === 1 ? targetsRef.current.next : targetsRef.current.previous
      runCommand('detail.step', { direction })
      if (target === 'item') {
        // The new item slides in from the side the finger came from.
        const shown = urlStore().get().item
        if (shown !== null && shown !== id) {
          setEnter({ id: shown, from: direction })
        }
      }
    },
    onPinch: (level: ZoomLevel, centre) => {
      // Only a new level re-centres; a pinch that settles where it started
      // must leave no point behind for a later zoom key.
      if (level !== coreStore.getState().zoom) {
        zoomAround(centre)
        coreStore.getState().setZoom(level)
      }
    },
  })

  const onSlotAnimationEnd = (event: AnimationEvent) => {
    if (event.animationName.includes('nudge')) setNudge(null)
    else setEnter(null)
  }

  return (
    <div
      className={classes.frame}
      {...noSelectProps}
      data-nudge={nudge ?? undefined}
    >
      <div
        ref={scrollRef}
        className={classes.stage}
        data-mm-stage=''
        data-zoomed={zoomed ? '' : undefined}
        data-panning={panning ? '' : undefined}
        onScroll={onScroll}
        {...handlers}
      >
        <div
          ref={slotRef}
          key={id}
          className={classes.slot}
          data-enter={
            enter?.id === id
              ? enter.from === 1
                ? 'next'
                : 'previous'
              : undefined
          }
          onAnimationEnd={onSlotAnimationEnd}
        >
          {item && box.width > 0 && (
            <StageMedia
              item={item}
              box={box}
              zoom={factor}
              title={title}
              mediaRef={mediaRef}
            />
          )}
          {!item && missing && <MissingCard />}
        </div>
      </div>
      {/* At an end of the collection the button hides; an item outside the
          view with nowhere to step from has none. */}
      <StepButton direction={-1} target={targets.previous} />
      <StepButton direction={1} target={targets.next} />
    </div>
  )
}

function MissingCard() {
  return (
    <div className={mediaClasses.card}>
      <MissingIcon size={48} stroke={1} aria-hidden />
      <strong className={mediaClasses.cardTitle}>Item not found</strong>
      <span className={mediaClasses.cardMeta}>
        It was deleted, or you can’t see it.
      </span>
      <span className={mediaClasses.actions}>
        <Button
          variant='default'
          leftSection={<BackIcon size={16} aria-hidden />}
          onClick={() => runCommand('detail.close')}
        >
          Back to grid
        </Button>
      </span>
    </div>
  )
}

function StepButton({
  direction,
  target,
}: {
  direction: 1 | -1
  target: StepTarget
}) {
  const label = direction === 1 ? 'Next item' : 'Previous item'
  const disabled = target !== 'item'
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
