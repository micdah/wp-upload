// How code outside the tree component (actions, menus) reaches its rows: the
// tree registers these while mounted. A virtualised row may not be rendered,
// so `revealRow` scrolls it into the rendered range first.

import type { RowRef } from './store'

export interface TreeApi {
  /** The row's element if it is rendered now. */
  rowElement(row: RowRef): HTMLElement | null
  /** Scrolls the row into view (rendering it); false if it isn't in the tree. */
  revealRow(row: RowRef): boolean
}

let current: TreeApi | null = null

export function registerTreeApi(api: TreeApi): () => void {
  current = api
  return () => {
    if (current === api) {
      current = null
    }
  }
}

export function treeApi(): TreeApi | null {
  return current
}

/**
 * Moves DOM focus to a row right now, if it is rendered (a dialog opened
 * next then returns focus there). Returns whether it did.
 */
export function focusRowNow(row: RowRef): boolean {
  const element = current?.rowElement(row) ?? null
  if (!element) {
    return false
  }
  element.focus({ preventScroll: true })
  return true
}
