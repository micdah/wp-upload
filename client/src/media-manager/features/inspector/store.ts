// The autosave state of the inspector's fields, outside React, so it
// survives the panel re-rendering and remounting (selection changes,
// refetches, rev polls):
//
// - field entries (drafts and autosave states), keyed `<item id>:<field>`;
// - which field keys are on screen now (a failed save of a field that isn't
//   gets a toast instead).
//
// Part of the lazy panel chunk; bridge.ts holds what the static entry needs.

import { createStore, useStore } from 'zustand'
import type { Entry, FieldEntry } from './autosave'
import type { FieldName } from './bridge'

export type { FieldName } from './bridge'

export function fieldKey(id: number, field: FieldName): string {
  return `${id}:${field}`
}

export interface InspectorState {
  fields: Readonly<Record<string, FieldEntry>>
  mounted: Readonly<Record<string, number>>
}

export interface InspectorActions {
  /** Replaces a field's entry with `update(entry)` (undefined = clean). */
  updateField(key: string, update: (entry: Entry) => Entry): void
  /** A field rendered; returns its unmount. */
  mountField(key: string): () => void
}

export type InspectorStore = InspectorState & InspectorActions

export const inspectorStore = createStore<InspectorStore>()((set, get) => ({
  fields: {},
  mounted: {},
  updateField(key, update) {
    const fields = get().fields
    const before = fields[key]
    const after = update(before)
    if (after === before) {
      return
    }
    const next = { ...fields }
    if (after === undefined) {
      delete next[key]
    } else {
      next[key] = after
    }
    set({ fields: next })
  },
  mountField(key) {
    const count = (get().mounted[key] ?? 0) + 1
    set({ mounted: { ...get().mounted, [key]: count } })
    return () => {
      const mounted = { ...get().mounted }
      const left = (mounted[key] ?? 1) - 1
      if (left > 0) {
        mounted[key] = left
      } else {
        delete mounted[key]
      }
      set({ mounted })
    }
  },
}))

export function useInspector<T>(selector: (state: InspectorStore) => T): T {
  return useStore(inspectorStore, selector)
}

export function fieldEntry(key: string): Entry {
  return inspectorStore.getState().fields[key]
}

export function isFieldMounted(key: string): boolean {
  return (inspectorStore.getState().mounted[key] ?? 0) > 0
}
