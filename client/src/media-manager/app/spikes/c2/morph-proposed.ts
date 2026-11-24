// SPIKE C2 COPY of core/ui/morph.ts with the changes C2 proposes (see
// docs/media-manager/tracks/spikes/C2.md): `to` is always called, also under
// reduced motion and without the API, because it carries the reveal; and the
// timeout is 150 ms. The harness uses it with ?morph=proposed.

import { flushSync } from 'react-dom'

export const MORPH_NAME = 'mm-hero'

/**
 * How long `to` may take before the morph gives up on the hero (ms). The
 * screen is frozen on the old snapshot meanwhile, and in Chromium and
 * Firefox no frame (rAF, scroll event) runs, so waiting longer buys nothing.
 */
const TARGET_TIMEOUT_MS = 150

export interface MorphOptions {
  /** The element the morph starts from (named in the old snapshot). */
  from?: () => Element | null
  /**
   * The element it ends at, after the update has rendered. Always called,
   * also without a hero (reduced motion, no API), so it may reveal it too.
   * Must not wait for rAF or scroll events (they don't run while it is
   * pending in Chromium and Firefox).
   */
  to?: () => Element | null | Promise<Element | null>
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (update: () => Promise<void> | void) => {
    finished: Promise<void>
    ready: Promise<void>
    updateCallbackDone: Promise<void>
  }
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function setName(element: Element | null | undefined, name: string): void {
  if (element instanceof HTMLElement || element instanceof SVGElement) {
    element.style.viewTransitionName = name
  }
}

function withTimeout<T>(value: T | Promise<T>, fallback: T): Promise<T> {
  return Promise.race([
    Promise.resolve(value),
    new Promise<T>((resolve) =>
      setTimeout(() => resolve(fallback), TARGET_TIMEOUT_MS),
    ),
  ])
}

export async function morph(
  update: () => void,
  options: MorphOptions = {},
): Promise<void> {
  const doc = document as ViewTransitionDocument
  if (typeof doc.startViewTransition !== 'function') {
    flushSync(update)
    await options.to?.()
    return
  }
  const withHero = !prefersReducedMotion()
  const from = withHero ? (options.from?.() ?? null) : null
  setName(from, MORPH_NAME)
  let target: Element | null = null
  const transition = doc.startViewTransition(async () => {
    setName(from, '')
    flushSync(update)
    if (options.to) {
      const element = await withTimeout(options.to(), null)
      if (withHero) {
        target = element
        setName(target, MORPH_NAME)
      }
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
