// Wraps document.startViewTransition so the harness can see what the real
// morph() did: whether a transition ran, whether the hero group animated,
// and how long each phase took. Optionally pauses the animations half-way so
// Playwright can take a deterministic mid-transition screenshot.

interface Transition {
  finished: Promise<void>
  ready: Promise<void>
  updateCallbackDone: Promise<void>
}

type StartViewTransition = (update: () => Promise<void> | void) => Transition

export interface TransitionRecord {
  started: number
  updateDoneMs: number | null
  readyMs: number | null
  finishedMs: number | null
  readyError: string | null
  /** Pseudo-elements that had animations right after `ready`. */
  pseudos: string[]
  heroAnimated: boolean
  rootAnimated: boolean
}

export const records: TransitionRecord[] = []

/** Pause the animations at this time (ms) after `ready`; null = don't. */
let pauseAt: number | null = null
let paused: Animation[] = []

export function setPauseAt(value: number | null): void {
  pauseAt = value
}

export function isPaused(): boolean {
  return paused.length > 0
}

export function resume(): void {
  for (const animation of paused) {
    animation.play()
  }
  paused = []
}

function pseudoOf(animation: Animation): string {
  const effect = animation.effect
  if (effect instanceof KeyframeEffect) {
    return effect.pseudoElement ?? ''
  }
  return ''
}

function errorText(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error)
}

/** Installs the wrapper; returns false when the API is missing. */
export function instrumentViewTransitions(): boolean {
  // Our own narrow view of the API (lib.dom's overloads get in the way).
  const doc = document as unknown as {
    startViewTransition?: StartViewTransition
  }
  const native = doc.startViewTransition
  if (typeof native !== 'function') {
    return false
  }
  doc.startViewTransition = (update) => {
    const record: TransitionRecord = {
      started: performance.now(),
      updateDoneMs: null,
      readyMs: null,
      finishedMs: null,
      readyError: null,
      pseudos: [],
      heroAnimated: false,
      rootAnimated: false,
    }
    records.push(record)
    const since = () => Math.round(performance.now() - record.started)
    const transition = native.call(document, update)
    transition.updateCallbackDone.then(
      () => {
        record.updateDoneMs = since()
      },
      () => {
        record.updateDoneMs = since()
      },
    )
    transition.ready.then(
      () => {
        record.readyMs = since()
        const animations = document
          .getAnimations()
          .filter((animation) =>
            pseudoOf(animation).includes('view-transition'),
          )
        record.pseudos = [...new Set(animations.map(pseudoOf))]
        record.heroAnimated = record.pseudos.some((pseudo) =>
          pseudo.includes('view-transition-group(mm-hero)'),
        )
        record.rootAnimated = record.pseudos.some((pseudo) =>
          pseudo.includes('(root)'),
        )
        if (pauseAt !== null) {
          for (const animation of animations) {
            animation.pause()
            animation.currentTime = pauseAt
          }
          paused = animations
        }
      },
      (error: unknown) => {
        record.readyError = errorText(error)
      },
    )
    transition.finished.then(
      () => {
        record.finishedMs = since()
      },
      () => {
        record.finishedMs = since()
      },
    )
    return transition
  }
  return true
}
