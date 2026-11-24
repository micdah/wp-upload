import { describe, expect, it } from 'vitest'
import {
  clearSelection,
  EMPTY_SELECTION,
  hiddenSelectedCount,
  moveFocus,
  pruneSelection,
  rangeTo,
  type SelectionState,
  selectAll,
  selectOnly,
  targetIds,
  toggle,
} from './selection'

const order = [10, 11, 12, 13, 14, 15]

function ids(state: SelectionState): number[] {
  return [...state.selection].sort((a, b) => a - b)
}

describe('selection rules', () => {
  it('click selects only that item and focuses it', () => {
    const state = selectOnly(toggle(EMPTY_SELECTION, 10), 12)
    expect(ids(state)).toEqual([12])
    expect(state).toMatchObject({ anchor: 12, focus: 12 })
  })

  it('toggle adds and removes, moving anchor and focus', () => {
    let state = toggle(EMPTY_SELECTION, 11)
    state = toggle(state, 13)
    expect(ids(state)).toEqual([11, 13])
    state = toggle(state, 11)
    expect(ids(state)).toEqual([13])
    expect(state).toMatchObject({ anchor: 11, focus: 11 })
  })

  it('shift-range selects from the anchor in collection order, both directions', () => {
    const start = selectOnly(EMPTY_SELECTION, 12)
    expect(ids(rangeTo(start, order, 14))).toEqual([12, 13, 14])
    expect(ids(rangeTo(start, order, 10))).toEqual([10, 11, 12])
    // The anchor stays, so a second shift-click re-ranges from it.
    const ranged = rangeTo(rangeTo(start, order, 14), order, 11)
    expect(ids(ranged)).toEqual([11, 12])
    expect(ranged).toMatchObject({ anchor: 12, focus: 11 })
  })

  it('additive range keeps the existing selection', () => {
    const start = toggle(selectOnly(EMPTY_SELECTION, 10), 13)
    expect(ids(rangeTo(start, order, 15, true))).toEqual([10, 13, 14, 15])
  })

  it('range without an anchor starts at the focused item', () => {
    const state = { ...EMPTY_SELECTION, focus: 11 }
    const ranged = rangeTo(state, order, 13)
    expect(ids(ranged)).toEqual([11, 12, 13])
    expect(ranged).toMatchObject({ anchor: 11, focus: 13 })
  })

  it('range without a usable anchor selects only the target', () => {
    const state = { ...EMPTY_SELECTION, anchor: 99 }
    expect(ids(rangeTo(state, order, 12))).toEqual([12])
  })

  it('select all and clear', () => {
    const all = selectAll(selectOnly(EMPTY_SELECTION, 12), order)
    expect(ids(all)).toEqual(order)
    expect(all.focus).toBe(12)
    const cleared = clearSelection(all)
    expect(cleared.selection.size).toBe(0)
    expect(cleared).toMatchObject({ anchor: null, focus: 12 })
    expect(clearSelection(cleared)).toBe(cleared)
  })

  it('arrow modes: select, focus-only and extend', () => {
    const start = selectOnly(EMPTY_SELECTION, 11)
    expect(ids(moveFocus(start, 12, 'select'))).toEqual([12])
    const focusOnly = moveFocus(start, 12, 'focus-only')
    expect(ids(focusOnly)).toEqual([11])
    expect(focusOnly.focus).toBe(12)
    expect(ids(moveFocus(start, 13, 'extend', order))).toEqual([11, 12, 13])
  })

  it('targets: selection in collection order, else the focused item', () => {
    const state = toggle(toggle(EMPTY_SELECTION, 14), 10)
    expect(targetIds(state, order)).toEqual([10, 14])
    expect(targetIds({ ...EMPTY_SELECTION, focus: 13 }, order)).toEqual([13])
    expect(targetIds(EMPTY_SELECTION, order)).toEqual([])
  })

  it('hidden selected items stay selected and are counted', () => {
    const state = toggle(toggle(EMPTY_SELECTION, 10), 99)
    expect(hiddenSelectedCount(state, order)).toBe(1)
    expect(targetIds(state, order)).toEqual([10, 99])
  })

  it('prune drops removed ids, and is identity when nothing changes', () => {
    const state = toggle(toggle(EMPTY_SELECTION, 10), 11)
    const pruned = pruneSelection(state, new Set([11]))
    expect(ids(pruned)).toEqual([10])
    expect(pruned).toMatchObject({ anchor: null, focus: null })
    expect(pruneSelection(pruned, new Set([42]))).toBe(pruned)
  })
})
