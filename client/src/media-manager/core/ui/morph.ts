// The grid <-> detail shared-element morph (interaction-spec §5, plan §3):
// document.startViewTransition plus flushSync, naming only the one element
// involved. Reduced motion keeps the root cross-fade without the hero.
// Without the API the update just happens.
//
// `to` is always called, with or without a hero: it is also how the caller
// reveals the tile you return to in a virtualised grid (centerApi.revealItem),
// and that reveal must happen under reduced motion and without the API too.
// `to` must not wait for a frame or a scroll event: while the update
// callback is pending, Chromium and Firefox run neither, so such a wait only
// freezes the screen until the timeout. See spike C2 (tracks/spikes/C2.md).

import { flushSync } from 'react-dom'

export const MORPH_NAME = 'mm-hero'

/**
 * How long `to` may take before the morph gives up on the hero (ms). The
 * screen shows the old snapshot meanwhile, and Chromium and Firefox run no
 * frames then, so waiting longer buys nothing (spike C2).
 */
export const MORPH_TARGET_TIMEOUT_MS = 150

export interface MorphOptions {
  /** The element the morph starts from (named in the old snapshot). */
  from?: () => Element | null
  /**
   * The element it ends at, after the update has rendered. Always called,
   * also without a hero, so it may reveal the element. Resolve without
   * waiting for rAF or scroll events.
   */
  to?: () => Element | null | Promise<Element | null>
}

interface ViewTransitionLike {
  finished: Promise<void>
}

/** What morph() needs from the browser; tests pass a fake. */
export interface MorphEnvironment {
  startViewTransition:
    | ((update: () => Promise<void>) => ViewTransitionLike)
    | null
  reducedMotion(): boolean
  /** Renders a React state change synchronously (react-dom's flushSync). */
  flush(update: () => void): void
  timeoutMs: number
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function setName(element: Element | null | undefined, name: string): void {
  const style = (element as { style?: CSSStyleDeclaration } | null)?.style
  if (style) {
    style.viewTransitionName = name
  }
}

function withTimeout<T>(
  value: T | Promise<T>,
  fallback: T,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    Promise.resolve(value),
    new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(fallback), timeoutMs)
    }),
  ]).finally(() => clearTimeout(timer))
}

function browserEnvironment(): MorphEnvironment {
  const doc = document as Document & {
    startViewTransition?: (update: () => Promise<void>) => ViewTransitionLike
  }
  return {
    startViewTransition:
      typeof doc.startViewTransition === 'function'
        ? (update) => doc.startViewTransition?.(update) as ViewTransitionLike
        : null,
    reducedMotion: prefersReducedMotion,
    flush: (update) => flushSync(update),
    timeoutMs: MORPH_TARGET_TIMEOUT_MS,
  }
}

/** morph() over an explicit environment (tests). */
export async function morphWith(
  env: MorphEnvironment,
  update: () => void,
  options: MorphOptions = {},
): Promise<void> {
  if (env.startViewTransition === null) {
    env.flush(update)
    await withTimeout(options.to?.() ?? null, null, env.timeoutMs)
    return
  }
  const withHero = !env.reducedMotion()
  const from = withHero ? (options.from?.() ?? null) : null
  setName(from, MORPH_NAME)
  let target: Element | null = null
  const transition = env.startViewTransition(async () => {
    setName(from, '')
    env.flush(update)
    if (!options.to) {
      return
    }
    const element = await withTimeout(options.to(), null, env.timeoutMs)
    if (withHero) {
      target = element
      setName(target, MORPH_NAME)
    }
  })
  try {
    await transition.finished
  } catch {
    // Skipped (another transition started) or the update threw; the DOM is
    // already in its final state either way.
  } finally {
    setName(target, '')
  }
}

/**
 * Runs `update` (a React state change) inside a view transition. Resolves
 * when the transition has finished (or once `to` has run, without the API).
 */
export function morph(
  update: () => void,
  options: MorphOptions = {},
): Promise<void> {
  return morphWith(browserEnvironment(), update, options)
}
