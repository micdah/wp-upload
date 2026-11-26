// The small part of the inspector's state that the static entry (rail and
// the `A` command) shares with the lazily loaded panel. Keep it tiny: it is
// in the initial chunk, the panel and its autosave store are not.
//
// - a pending focus request: `A` asks for the alt field, which the panel
//   focuses once it has rendered it;
// - the one item the panel shows, so `A` knows its kind when the collection
//   doesn't (a selected item the filters hide);
// - the logout reset: register() can't import the panel's autosave store, so
//   the panel joins the reset through onPanelReset, and a session counter
//   lets a save that settles after a logout leave everything alone.

import { createStore, useStore } from 'zustand'
import type { MediaKind } from '../../../../../shared/library-api'

export type FieldName = 'title' | 'alt'

export interface FocusRequest {
  id: number
  field: FieldName
}

export interface BridgeState {
  focusRequest: FocusRequest | null
  shown: { id: number; kind: MediaKind } | null
  requestFocus(request: FocusRequest | null): void
  setShown(shown: BridgeState['shown']): void
}

export const bridgeStore = createStore<BridgeState>()((set, get) => ({
  focusRequest: null,
  shown: null,
  requestFocus(request) {
    set({ focusRequest: request })
  },
  setShown(shown) {
    const before = get().shown
    if (before?.id === shown?.id && before?.kind === shown?.kind) {
      return
    }
    set({ shown })
  },
}))

export function useBridge<T>(selector: (state: BridgeState) => T): T {
  return useStore(bridgeStore, selector)
}

let session = 0
const panelResets = new Set<() => void>()

/** The current login session; work compares it before and after an await. */
export function inspectorSession(): number {
  return session
}

/** The lazy panel's own state (drafts, timers) joins the logout reset. */
export function onPanelReset(reset: () => void): () => void {
  panelResets.add(reset)
  return () => {
    panelResets.delete(reset)
  }
}

/** A logout (core's onSessionReset): drop the bridge's and panel's state. */
export function resetInspectorSession(): void {
  session += 1
  bridgeStore.setState({ focusRequest: null, shown: null })
  for (const reset of [...panelResets]) {
    reset()
  }
}
