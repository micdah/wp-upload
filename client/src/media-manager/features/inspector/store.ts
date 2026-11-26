// The autosave state of the inspector's fields, outside React, so it
// survives the panel re-rendering and remounting (selection changes,
// refetches, rev polls):
//
// - field entries (drafts and autosave states);
// - which field keys are on screen now (a failed save of a field that isn't
//   gets a toast instead);
// - the progress of batch commits (several items, inspector.md §2).
//
// Field keys: `<item id>:<field>` for one item, `batch:<ids key>:<field>`
// for several (batch.ts).
//
// Part of the lazy panel chunk; bridge.ts holds what the static entry needs.

import { createStore, useStore } from 'zustand'
import type { Entry, FieldEntry } from './autosave'
import type { FieldName } from './bridge'

export type { FieldName } from './bridge'

export function fieldKey(id: number, field: FieldName): string {
  return `${id}:${field}`
}

/** A batch commit's progress (client-chunked, D24). */
export interface BatchProgress {
  done: number
  total: number
}

export interface InspectorState {
  fields: Readonly<Record<string, FieldEntry>>
  mounted: Readonly<Record<string, number>>
  /** Running batch commits, by field key. */
  progress: Readonly<Record<string, BatchProgress>>
  /**
   * Batch Description: Replace or Append. One value for the panel, read by
   * the toggle and by every commit, so what shows is what is sent, also
   * after the selection changes.
   */
  descriptionMode: 'replace' | 'append'
}

export interface InspectorActions {
  /** Replaces a field's entry with `update(entry)` (undefined = clean). */
  updateField(key: string, update: (entry: Entry) => Entry): void
  /** A field rendered; returns its unmount. */
  mountField(key: string): () => void
  /** A batch commit's progress; null once it is done. */
  setProgress(key: string, progress: BatchProgress | null): void
}

export type InspectorStore = InspectorState & InspectorActions

export const inspectorStore = createStore<InspectorStore>()((set, get) => ({
  fields: {},
  mounted: {},
  progress: {},
  descriptionMode: 'replace',
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
  setProgress(key, progress) {
    const next = { ...get().progress }
    if (progress === null) {
      delete next[key]
    } else {
      next[key] = progress
    }
    set({ progress: next })
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
