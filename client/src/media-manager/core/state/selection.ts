// The selection model as pure functions (interaction-spec §1–2): an id set
// plus an anchor for Shift ranges, and a separate focus (the keyboard
// position). Every function takes the current value and the collection order
// and returns the next value, so the rules are unit-tested without React.

export interface SelectionState {
  selection: ReadonlySet<number>
  /** Where Shift ranges start. */
  anchor: number | null
  /** The keyboard position; moves with or without selecting. */
  focus: number | null
}

export const EMPTY_SELECTION: SelectionState = Object.freeze({
  selection: new Set<number>(),
  anchor: null,
  focus: null,
})

/** Click: select only that item and focus it. */
export function selectOnly(_state: SelectionState, id: number): SelectionState {
  return { selection: new Set([id]), anchor: id, focus: id }
}

/** Ctrl/Cmd+click, the check circle, `X`: toggle one item. */
export function toggle(state: SelectionState, id: number): SelectionState {
  const selection = new Set(state.selection)
  if (selection.has(id)) {
    selection.delete(id)
  } else {
    selection.add(id)
  }
  return { selection, anchor: id, focus: id }
}

/**
 * Shift+click and Shift+arrows: select from the anchor to `id`, inclusive, in
 * collection order. `additive` (Ctrl/Cmd+Shift+click) keeps what was
 * selected. Without an anchor it ranges from the focus; without a usable
 * one it selects only `id`.
 */
export function rangeTo(
  state: SelectionState,
  order: readonly number[],
  id: number,
  additive = false,
): SelectionState {
  // No anchor yet (e.g. focus moved by keyboard without selecting): the
  // range starts at the focused item, as in a file manager.
  const anchor = state.anchor ?? state.focus ?? id
  const from = order.indexOf(anchor)
  const to = order.indexOf(id)
  if (from === -1 || to === -1) {
    return selectOnly(state, id)
  }
  const [start, end] = from < to ? [from, to] : [to, from]
  const selection = additive ? new Set(state.selection) : new Set<number>()
  for (let index = start; index <= end; index += 1) {
    selection.add(order[index] as number)
  }
  return { selection, anchor, focus: id }
}

/** Ctrl/Cmd+A: everything in the collection. Anchor and focus stay. */
export function selectAll(
  state: SelectionState,
  order: readonly number[],
): SelectionState {
  return { ...state, selection: new Set(order) }
}

/** Esc: clear the selection (focus stays, so the keyboard position survives). */
export function clearSelection(state: SelectionState): SelectionState {
  if (state.selection.size === 0 && state.anchor === null) {
    return state
  }
  return { selection: new Set(), anchor: null, focus: state.focus }
}

/** Plain arrows move focus *and* select; modifier arrows only move focus. */
export function moveFocus(
  state: SelectionState,
  id: number,
  mode: 'select' | 'focus-only' | 'extend',
  order: readonly number[] = [],
): SelectionState {
  if (mode === 'select') {
    return selectOnly(state, id)
  }
  if (mode === 'extend') {
    return rangeTo(state, order, id)
  }
  return { ...state, focus: id }
}

/** Changing folder clears the selection and focus (interaction-spec §1). */
export function resetForFolderChange(): SelectionState {
  return { selection: new Set(), anchor: null, focus: null }
}

/**
 * Items actions apply to: the selection (in collection order, then any
 * selected ids hidden by filters), or the focused item when nothing is
 * selected.
 */
export function targetIds(
  state: SelectionState,
  order: readonly number[],
): number[] {
  if (state.selection.size === 0) {
    return state.focus === null ? [] : [state.focus]
  }
  const visible = order.filter((id) => state.selection.has(id))
  if (visible.length === state.selection.size) {
    return visible
  }
  const seen = new Set(visible)
  const hidden = [...state.selection].filter((id) => !seen.has(id))
  return [...visible, ...hidden]
}

/** How many selected ids the current collection doesn't show. */
export function hiddenSelectedCount(
  state: SelectionState,
  order: readonly number[],
): number {
  if (state.selection.size === 0) {
    return 0
  }
  let visible = 0
  for (const id of order) {
    if (state.selection.has(id)) {
      visible += 1
    }
  }
  return state.selection.size - visible
}

/** Drops ids that no longer exist (deleted, moved out of a folder view). */
export function pruneSelection(
  state: SelectionState,
  removed: ReadonlySet<number>,
): SelectionState {
  let changed = false
  const selection = new Set<number>()
  for (const id of state.selection) {
    if (removed.has(id)) {
      changed = true
    } else {
      selection.add(id)
    }
  }
  const anchor =
    state.anchor !== null && removed.has(state.anchor) ? null : state.anchor
  const focus =
    state.focus !== null && removed.has(state.focus) ? null : state.focus
  if (!changed && anchor === state.anchor && focus === state.focus) {
    return state
  }
  return { selection, anchor, focus }
}
