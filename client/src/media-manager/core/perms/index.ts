// can() / partition() / useCan() over the live app context (core store).

import { useRef } from 'react'
import { useStore } from 'zustand'
import { type CoreState, coreStore } from '../state'
import {
  type CanResult,
  evaluate,
  type Partition,
  type PermAction,
  type PermContext,
  type PermItem,
  partitionWith,
} from './can'

export * from './can'

function contextOf(state: CoreState): PermContext {
  return {
    bootstrap: state.bootstrap,
    online: state.connectivity.state === 'online',
  }
}

/** Whether `action` is allowed now, optionally on one item. */
export function can(action: PermAction, item?: PermItem): CanResult {
  return evaluate(contextOf(coreStore.getState()), action, item)
}

/** Splits items by whether `action` may touch them (mixed Author selections). */
export function partition<T extends PermItem>(
  action: PermAction,
  items: readonly T[],
): Partition<T> {
  return partitionWith(contextOf(coreStore.getState()), action, items)
}

function sameResult(a: CanResult, b: CanResult): boolean {
  if (a.ok || b.ok) {
    return a.ok === b.ok
  }
  return a.code === b.code && a.reason === b.reason
}

/** can() as a hook: re-renders when the answer changes. */
export function useCan(action: PermAction, item?: PermItem): CanResult {
  const last = useRef<CanResult | null>(null)
  return useStore(coreStore, (state) => {
    const next = evaluate(contextOf(state), action, item)
    if (last.current && sameResult(last.current, next)) {
      return last.current
    }
    last.current = next
    return next
  })
}
