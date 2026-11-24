// The app's core store and its React hook.
//
//     const focus = useCore((state) => state.focus)
//     const { selectOnly } = coreStore.getState()
//
// Selectors that build objects or arrays must use `useShallow` (zustand/shallow)
// or select primitives, or the component re-renders on every store change.

import { useStore } from 'zustand'
import { type CoreStore, createCoreStore } from './store'

export type { SelectionState } from './selection'
export * as selectionRules from './selection'
export * from './store'
export { installCoreSync } from './sync'

export const coreStore = createCoreStore()

export function useCore<T>(selector: (state: CoreStore) => T): T {
  return useStore(coreStore, selector)
}
