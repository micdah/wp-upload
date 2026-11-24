// Toolbar slots: features put their toolbar controls (breadcrumb, search,
// sort, layout, density, Upload, …) into the shell's toolbar from their
// register(), without editing the shell.
//
//     registerToolbarItem({ id: 'upload', slot: 'end', order: 10, Component: UploadButton })

import { type ComponentType, useSyncExternalStore } from 'react'

/** start: after the brand (breadcrumb); center: search and view controls; end: actions. */
export type ToolbarSlot = 'start' | 'center' | 'end'

export interface ToolbarItem {
  id: string
  slot: ToolbarSlot
  /** Lower comes first. */
  order: number
  Component: ComponentType
}

let items: readonly ToolbarItem[] = []
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

/** Adds a toolbar control; returns its unregister function. Ids are unique. */
export function registerToolbarItem(item: ToolbarItem): () => void {
  if (items.some((existing) => existing.id === item.id)) {
    throw new Error(`Toolbar item "${item.id}" is already registered`)
  }
  items = [...items, item].sort((a, b) => a.order - b.order)
  emit()
  return () => {
    items = items.filter((existing) => existing !== item)
    emit()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useToolbarItems(slot: ToolbarSlot): ToolbarItem[] {
  const all = useSyncExternalStore(
    subscribe,
    () => items,
    () => items,
  )
  return all.filter((item) => item.slot === slot)
}
