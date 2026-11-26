// centerApi: how code outside the grid and detail reaches into them, without
// importing them. The grid registers revealItem, tileElement, heroElement and
// focusTile; detail registers stageElement and nudgeStage. The morph
// (core/ui/morph) and commands use it: e.g. leaving detail first reveals the
// tile you return to, which a virtualised grid may not have rendered (spike
// C2).

export interface CenterApi {
  /**
   * Scrolls the grid so the item's tile is rendered and visible, and
   * resolves with the tile element (null if it isn't in the grid).
   *
   * It must do its DOM work synchronously and resolve without waiting for a
   * frame, a scroll event or a ResizeObserver: the morph calls it while the
   * browser holds the old snapshot, and Chromium and Firefox run no frames
   * then (spike C2). If the tile is fully in view, return it. Otherwise
   * render the target rows with flushSync (a rangeExtractor that adds the
   * pinned rows), set the scroller's scrollTop directly, and return the
   * mounted tile. While detail is open the grid also follows the current
   * item, so on exit the tile is normally mounted already.
   */
  revealItem(id: number): Promise<HTMLElement | null>
  /** The tile element if it is rendered now, else null. */
  tileElement(id: number): HTMLElement | null
  /**
   * The element the morph names on the grid side: the tile's picture (or
   * the tile itself without one), and only while the tile is fully inside
   * the grid's viewport. A half-hidden hero would paint over the toolbar,
   * because view-transition pseudos aren't clipped (spike C2). Else null.
   */
  heroElement(id: number): HTMLElement | null
  /** Moves keyboard focus to the item's tile (roving tabindex). */
  focusTile(id: number): void
  /** The detail stage's main image/media element, for the morph. */
  stageElement(): HTMLElement | null
  /**
   * Plays the stage's "no further" nudge: detail stepping stops at both
   * ends of the collection (D34).
   */
  nudgeStage(direction: 1 | -1): void
}

type Part = Partial<CenterApi>

const parts: Part[] = []

function find<K extends keyof CenterApi>(name: K): CenterApi[K] | null {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const fn = parts[index]?.[name]
    if (fn) {
      return fn as CenterApi[K]
    }
  }
  return null
}

/**
 * Registers some of the handlers (the newest registration wins per handler).
 * Returns the unregister function; call it on unmount.
 */
export function registerCenter(part: Part): () => void {
  parts.push(part)
  return () => {
    const index = parts.indexOf(part)
    if (index !== -1) {
      parts.splice(index, 1)
    }
  }
}

export const centerApi: CenterApi = {
  revealItem(id) {
    return find('revealItem')?.(id) ?? Promise.resolve(null)
  },
  tileElement(id) {
    return find('tileElement')?.(id) ?? null
  },
  heroElement(id) {
    return find('heroElement')?.(id) ?? null
  },
  focusTile(id) {
    find('focusTile')?.(id)
  },
  stageElement() {
    return find('stageElement')?.() ?? null
  },
  nudgeStage(direction) {
    find('nudgeStage')?.(direction)
  },
}
