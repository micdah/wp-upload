// The "just changed" flash (A1 brief, system.md §1 "Done"): the tile's accent
// ring flashes once, like the ring on the tile you return to from detail.
//
// A tile flashes when:
// - its upload finishes (the tile upload state goes away without an error);
// - its item changes while it is on screen (a save, a batch edit, an edit
//   made elsewhere that a rev poll brought in): the tile sees a new
//   `modifiedAt` (Tile.tsx);
// - someone calls flashTiles(ids), e.g. after a move or an Undo.
//
// Each flash gets a new token, so a tile that is flashing already starts
// again; the tile renders the flash as an element keyed by the token.

import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

/** How long a flash lasts (the return ring's 900 ms). */
export const FLASH_MS = 900

interface FlashState {
  tokens: ReadonlyMap<number, number>
}

const flashStore = createStore<FlashState>(() => ({ tokens: new Map() }))

let nextToken = 1
const timers = new Map<number, ReturnType<typeof setTimeout>>()

/** Flashes the tiles of these items once (those on screen show it). */
export function flashTiles(ids: Iterable<number>): void {
  const tokens = new Map(flashStore.getState().tokens)
  let changed = false
  for (const id of ids) {
    const token = nextToken++
    tokens.set(id, token)
    changed = true
    clearTimeout(timers.get(id))
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id)
        const current = flashStore.getState().tokens
        if (current.get(id) !== token) return
        const next = new Map(current)
        next.delete(id)
        flashStore.setState({ tokens: next })
      }, FLASH_MS),
    )
  }
  if (changed) {
    flashStore.setState({ tokens })
  }
}

/** The tile's current flash token, or null when it isn't flashing. */
export function useFlashToken(id: number): number | null {
  return useStore(flashStore, (state) => state.tokens.get(id) ?? null)
}

/** Stops every flash (tests, logout). */
export function resetFlashes(): void {
  for (const timer of timers.values()) clearTimeout(timer)
  timers.clear()
  flashStore.setState({ tokens: new Map() })
}
