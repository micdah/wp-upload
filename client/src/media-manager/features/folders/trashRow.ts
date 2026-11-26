// The Trash row's integration point for track B3 (system.md §2 "Trash
// view"): the column shows a Trash row under Uncategorized whenever the
// bootstrap says the Trash is on, and opens `?folder=trash`. Its count is
// whatever B3 reports here (null shows none).

import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

export const trashRowStore = createStore<{ count: number | null }>(() => ({
  count: null,
}))

/** B3 sets the number of items in the Trash (null: unknown). */
export function setTrashRowCount(count: number | null): void {
  trashRowStore.setState({ count })
}

export function useTrashRowCount(): number | null {
  return useStore(trashRowStore, (state) => state.count)
}
