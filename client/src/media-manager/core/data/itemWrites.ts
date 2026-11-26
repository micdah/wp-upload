// Our own item writes versus item reads that overlap them (the M3 race).
//
// `optimistic()` cancels the item reads in flight when a write starts, but a
// read can still overlap the write: one that starts while the PATCH is on
// its way (an invalidation, a chunk scrolling in, a rev poll's refetch), or
// one whose cancel came too late. The server may answer such a read from
// its state *before* the write (WordPress serves requests in parallel), and
// when that answer arrives after the write's response, seeding it would put
// the old values back over the saved ones: "Title saved", yet the old title
// shows again.
//
// So every write of item fields records itself here, per item and per
// QueryClient, on a logical clock:
//
// - `beginItemWrite(ids)` when the write starts; the returned `end()` as soon
//   as its response (or error) arrives, before its result is applied;
// - an item read notes `itemReadClock()` when it is sent, and on arrival
//   asks `isStaleItemRead(id, sentAt)` per item: true while a write of that
//   item is in flight, or when one ended after the read was sent. Such an
//   item keeps what the cache holds (the write's result, or its optimistic
//   value with its own response still to come).
//
// A read sent after the write ended applies as usual, so changes made
// elsewhere still arrive with the next refetch.

import type { QueryClient } from '@tanstack/react-query'

interface WriteState {
  clock: number
  /** writes in flight per item id */
  inFlight: Map<number, number>
  /** the clock when the last write of each item ended */
  endedAt: Map<number, number>
}

const states = new WeakMap<QueryClient, WriteState>()

function stateOf(queryClient: QueryClient): WriteState {
  let state = states.get(queryClient)
  if (!state) {
    state = { clock: 0, inFlight: new Map(), endedAt: new Map() }
    states.set(queryClient, state)
  }
  return state
}

/**
 * Records that a write of these items' fields has started. Call the returned
 * function once its response or error arrives (before applying it); calling
 * it again does nothing.
 */
export function beginItemWrite(
  queryClient: QueryClient,
  ids: readonly number[],
): () => void {
  const state = stateOf(queryClient)
  const unique = [...new Set(ids)]
  state.clock += 1
  for (const id of unique) {
    state.inFlight.set(id, (state.inFlight.get(id) ?? 0) + 1)
  }
  let ended = false
  return () => {
    if (ended) {
      return
    }
    ended = true
    state.clock += 1
    for (const id of unique) {
      const count = (state.inFlight.get(id) ?? 1) - 1
      if (count > 0) {
        state.inFlight.set(id, count)
      } else {
        state.inFlight.delete(id)
      }
      state.endedAt.set(id, state.clock)
    }
  }
}

/** The clock to note when an item read is sent. */
export function itemReadClock(queryClient: QueryClient): number {
  return stateOf(queryClient).clock
}

/**
 * Whether a read of `id` sent at `sentAt` may predate one of our writes:
 * a write of it is in flight, or one ended after the read was sent.
 */
export function isStaleItemRead(
  queryClient: QueryClient,
  id: number,
  sentAt: number,
): boolean {
  const state = stateOf(queryClient)
  if ((state.inFlight.get(id) ?? 0) > 0) {
    return true
  }
  return (state.endedAt.get(id) ?? Number.NEGATIVE_INFINITY) > sentAt
}
