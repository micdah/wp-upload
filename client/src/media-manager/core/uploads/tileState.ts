// The tile upload state (interaction-spec §13.1, system.md §9 request 1):
// tiles, the detail stage and the inspector render an upload in progress
// natively from this, instead of the prototype's DOM patching.
//
// Keys are item ids once WordPress has created the item, or the upload
// feature's own temporary keys (strings) before that. The upload feature
// writes; every view reads with useTileUploadState(key).

import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

export const UPLOAD_PHASES = [
  'queued',
  'uploading',
  'processing',
  'error',
] as const
export type UploadPhase = (typeof UPLOAD_PHASES)[number]

export interface TileUploadState {
  phase: UploadPhase
  /** 0–1 while uploading; null when unknown or not uploading. */
  progress: number | null
  /** What went wrong, when `phase` is `error`. */
  error: string | null
  /** An object URL of the local file, shown until the real thumbnail exists. */
  previewUrl: string | null
}

export type TileKey = number | string

interface TileUploadStore {
  tiles: ReadonlyMap<TileKey, TileUploadState>
}

export const tileUploadStore = createStore<TileUploadStore>(() => ({
  tiles: new Map(),
}))

/** Sets (or, with null, clears) the upload state of one tile. */
export function setTileUploadState(
  key: TileKey,
  state: TileUploadState | null,
): void {
  const tiles = new Map(tileUploadStore.getState().tiles)
  if (state === null) {
    tiles.delete(key)
  } else {
    tiles.set(key, state)
  }
  tileUploadStore.setState({ tiles })
}

/** Moves a tile's state from a temporary key to the created item's id. */
export function rekeyTileUploadState(from: TileKey, to: TileKey): void {
  const tiles = new Map(tileUploadStore.getState().tiles)
  const state = tiles.get(from)
  if (state === undefined) {
    return
  }
  tiles.delete(from)
  tiles.set(to, state)
  tileUploadStore.setState({ tiles })
}

export function getTileUploadState(key: TileKey): TileUploadState | null {
  return tileUploadStore.getState().tiles.get(key) ?? null
}

/** The upload state of one tile, or null when it isn't uploading. */
export function useTileUploadState(
  key: TileKey | null,
): TileUploadState | null {
  return useStore(tileUploadStore, (state) =>
    key === null ? null : (state.tiles.get(key) ?? null),
  )
}
