// Selection model: an ID set plus an anchor (for Shift ranges) and a focused
// item (keyboard position). Focus and selection are deliberately separate.

import { collection, state, update } from './store.js'
import { announce } from './util.js'

function commit(selection, extra = {}) {
  update({ selection, ...extra }, ['selection', ...Object.keys(extra)])
}

export function selectOnly(id) {
  commit(new Set([id]), { anchor: id, focus: id })
}

export function toggle(id) {
  const selection = new Set(state.selection)
  if (selection.has(id)) selection.delete(id)
  else selection.add(id)
  commit(selection, { anchor: id, focus: id })
  announce(`${selection.size} selected`)
}

// Selects from the anchor to `id` (inclusive) in collection order.
export function rangeTo(id, { additive = false } = {}) {
  const items = collection()
  const anchor = state.anchor ?? id
  const from = items.findIndex((item) => item.id === anchor)
  const to = items.findIndex((item) => item.id === id)
  if (from === -1 || to === -1) {
    selectOnly(id)
    return
  }
  const [start, end] = from < to ? [from, to] : [to, from]
  const selection = additive ? new Set(state.selection) : new Set()
  for (const item of items.slice(start, end + 1)) selection.add(item.id)
  commit(selection, { focus: id })
  announce(`${selection.size} selected`)
}

export function selectAll() {
  const selection = new Set(collection().map((item) => item.id))
  commit(selection)
  announce(`All ${selection.size} items selected`)
}

export function clearSelection() {
  if (state.selection.size === 0) return
  commit(new Set(), { anchor: null })
  announce('Selection cleared')
}

// Items the inspector and bulk actions act on: the selection, or the
// focused item when nothing is selected.
export function targetItems() {
  const items = collection()
  if (state.selection.size > 0) {
    return items.filter((item) => state.selection.has(item.id))
  }
  return items.filter((item) => item.id === state.focus)
}
