// The stage's player bar for video and audio (interaction-spec §5, prototype
// detail.js `playerBar`): play/pause, the time, a scrubber and the duration,
// over a native <video>/<audio> without its own controls.
//
// Keys (spike C4): the play button is a native button, so Enter and Space
// activate it and ←/→ keep stepping between items. The scrubber is a native
// range under [data-mm-local-keys], so the app keymap leaves its keys alone:
// arrows, Home/End and Page Up/Down seek. Esc there leaves the scrubber (like
// a field) for the detail region, and the next Esc leaves detail; Space there
// plays and pauses too. Space anywhere else in detail mode plays and pauses
// through detail.play-toggle and the player registered while it is mounted.

import { ActionIcon } from '@mantine/core'
import {
  type CSSProperties,
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useState,
} from 'react'
import { PauseIcon, PlayIcon } from '../../core/ui/icons'
import { registerPlayer } from './commands'
import { formatDuration, spokenDuration } from './format'
import classes from './Media.module.css'

export interface MediaPlayer {
  playing: boolean
  /** seconds */
  time: number
  /** seconds: the element's once it knows, else the item's; null if unknown */
  duration: number | null
  /** The file can't be played here (format, network, a mock file). */
  failed: boolean
  toggle(): void
  seek(seconds: number): void
}

function knownDuration(value: number): number | null {
  return Number.isFinite(value) && value > 0 ? value : null
}

/** How long an item stays on stage before its media file starts loading. */
export const PRELOAD_DELAY_MS = 400

/**
 * The `preload` a stage <video>/<audio> gets: nothing at first, then its
 * metadata (duration, first frame) once the item has stayed on stage a
 * moment. Stepping quickly through a run of videos then downloads none of
 * them, and no request is cut off half-way by the next step.
 */
export function useDeferredPreload(): 'none' | 'metadata' {
  const [preload, setPreload] = useState<'none' | 'metadata'>('none')
  useEffect(() => {
    const timer = setTimeout(() => setPreload('metadata'), PRELOAD_DELAY_MS)
    return () => clearTimeout(timer)
  }, [])
  return preload
}

/**
 * Follows a media element's state and offers play/pause and seeking. While
 * mounted, it is the player Space toggles.
 */
export function useMediaPlayer(
  mediaRef: RefObject<HTMLMediaElement | null>,
  durationHint: number | null,
): MediaPlayer {
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [elementDuration, setElementDuration] = useState<number | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const media = mediaRef.current
    if (!media) return
    const sync = () => {
      setPlaying(!media.paused && !media.ended)
      setTime(media.currentTime)
      setElementDuration(knownDuration(media.duration))
    }
    const fail = () => {
      setFailed(true)
      setPlaying(false)
    }
    const events = [
      'play',
      'playing',
      'pause',
      'ended',
      'timeupdate',
      'seeked',
      'durationchange',
      'loadedmetadata',
    ] as const
    for (const name of events) media.addEventListener(name, sync)
    media.addEventListener('error', fail)
    if (media.error) fail()
    sync()
    return () => {
      for (const name of events) media.removeEventListener(name, sync)
      media.removeEventListener('error', fail)
    }
  }, [mediaRef])

  const toggle = useCallback(() => {
    const media = mediaRef.current
    if (!media || failed) return
    if (media.paused || media.ended) {
      media.play().catch((error: unknown) => {
        // A pause right after play() rejects with AbortError, and a browser
        // that wants a user gesture first with NotAllowedError: the file
        // itself is fine, so it stays playable.
        if (
          error instanceof DOMException &&
          (error.name === 'AbortError' || error.name === 'NotAllowedError')
        ) {
          return
        }
        setFailed(true)
      })
    } else {
      media.pause()
    }
  }, [mediaRef, failed])

  const seek = useCallback(
    (seconds: number) => {
      const media = mediaRef.current
      if (media && Number.isFinite(seconds)) {
        media.currentTime = Math.max(0, seconds)
        setTime(media.currentTime)
      }
    },
    [mediaRef],
  )

  // Space plays and pauses this one, unless it can't play at all.
  useEffect(
    () => (failed ? undefined : registerPlayer({ toggle })),
    [toggle, failed],
  )

  return {
    playing,
    time,
    duration: elementDuration ?? knownDuration(durationHint ?? Number.NaN),
    failed,
    toggle,
    seek,
  }
}

/**
 * The scrubber's own keys besides the native ones: Esc leaves it for the
 * detail region, like a field; Space plays and pauses, as everywhere else
 * in detail mode (the keymap leaves [data-mm-local-keys] alone, and a range
 * ignores Space).
 */
function scrubberKeys(
  event: KeyboardEvent<HTMLInputElement>,
  player: MediaPlayer,
): void {
  if (event.key === ' ') {
    event.preventDefault()
    player.toggle()
    return
  }
  if (event.key !== 'Escape') return
  event.preventDefault()
  const region = event.currentTarget.closest<HTMLElement>('[data-mm-detail]')
  region?.focus({ preventScroll: true })
}

export function PlayerBar({
  player,
  label,
  overlay = false,
}: {
  player: MediaPlayer
  /** What the controls are for ("Play podcast-episode-12"). */
  label: string
  /** Sits over a video (white on a dark glass pill). */
  overlay?: boolean
}) {
  const { playing, time, duration, failed } = player
  const max = duration ?? 0
  const progress = max > 0 ? Math.min(1, time / max) : 0
  const style = { '--progress': `${progress * 100}%` } as CSSProperties
  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of player controls, not a form fieldset
    <div
      className={classes.player}
      role='group'
      aria-label={`Player: ${label}`}
      data-overlay={overlay ? '' : undefined}
      data-mm-player=''
    >
      <ActionIcon
        className={classes.playButton}
        variant='transparent'
        size='lg'
        radius='xl'
        aria-label={playing ? 'Pause' : 'Play'}
        disabled={failed}
        onClick={(event) => {
          // Not the video's own click (which toggles too).
          event.stopPropagation()
          player.toggle()
        }}
      >
        {playing ? <PauseIcon size={18} /> : <PlayIcon size={18} />}
      </ActionIcon>
      {failed ? (
        <span className={classes.playerNote}>Can’t play this file here</span>
      ) : (
        <>
          <span className={classes.time} aria-hidden>
            {formatDuration(time)}
          </span>
          <input
            className={classes.scrubber}
            style={style}
            type='range'
            min={0}
            max={max}
            step={max > 0 && max < 60 ? 0.1 : 1}
            value={Math.min(time, max)}
            disabled={max <= 0}
            aria-label='Seek'
            aria-valuetext={`${spokenDuration(time)} of ${spokenDuration(max)}`}
            data-mm-local-keys=''
            onKeyDown={(event) => scrubberKeys(event, player)}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => player.seek(Number(event.target.value))}
          />
          <span className={classes.time} aria-hidden>
            {duration === null ? '–:––' : formatDuration(duration)}
          </span>
        </>
      )}
    </div>
  )
}
