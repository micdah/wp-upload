// The small part of the inspector's state that the static entry (rail and
// the `A` / `E` commands) shares with the lazily loaded panel. Keep it tiny:
// it is in the initial chunk, the panel and its autosave store are not.
//
// - a pending focus request: `A` (or Save & next) asks for a field, which
//   the panel focuses once it has rendered it;
// - the one item the panel shows, so `A` knows its kind when the collection
//   doesn't (a selected item the filters hide);
// - whether the Edit panel has unsaved edits (the rail's accent dot), and
//   the Edit panel's body: the editor feature (track B1) registers it, until
//   then the inspector shows its own stub;
// - the logout reset: register() can't import the panel's autosave store, so
//   the panel joins the reset through onPanelReset, and a session counter
//   lets a save that settles after a logout leave everything alone.

import type { ComponentType } from 'react'
import { createStore, useStore } from 'zustand'
import type { MediaKind } from '../../../../../shared/library-api'

/** The autosaving text fields of one item. */
export type FieldName = 'title' | 'alt' | 'caption' | 'description'

export interface FocusRequest {
  /** The item whose field to focus; null: the batch panel's field. */
  id: number | null
  field: FieldName
}

/** What the Edit tab shows; the editor feature (B1) provides the real one. */
export type EditPanelComponent = ComponentType<{ ids: readonly number[] }>

export interface BridgeState {
  focusRequest: FocusRequest | null
  shown: { id: number; kind: MediaKind } | null
  /** The Edit panel has edits that aren't saved (the rail's accent dot). */
  editUnsaved: boolean
  editPanel: EditPanelComponent | null
  requestFocus(request: FocusRequest | null): void
  setShown(shown: BridgeState['shown']): void
}

export const bridgeStore = createStore<BridgeState>()((set, get) => ({
  focusRequest: null,
  shown: null,
  editUnsaved: false,
  editPanel: null,
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

/**
 * The editor feature (B1) reports unsaved edits, so the rail's Edit tab
 * shows its accent dot and the panel header says "Unsaved changes".
 */
export function setEditUnsaved(unsaved: boolean): void {
  if (bridgeStore.getState().editUnsaved !== unsaved) {
    bridgeStore.setState({ editUnsaved: unsaved })
  }
}

/**
 * The editor feature (B1) puts its Edit panel in the inspector's Edit tab.
 * Returns the unregister function.
 */
export function registerEditPanel(component: EditPanelComponent): () => void {
  bridgeStore.setState({ editPanel: component })
  return () => {
    if (bridgeStore.getState().editPanel === component) {
      bridgeStore.setState({ editPanel: null })
    }
  }
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
  bridgeStore.setState({ focusRequest: null, shown: null, editUnsaved: false })
  for (const reset of [...panelResets]) {
    reset()
  }
}
