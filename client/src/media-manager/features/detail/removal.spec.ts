import { describe, expect, it } from 'vitest'
import { rowsOf } from '../../core/collection/rows'
import type { CollectionSnapshot } from '../../core/data/collection'
import { successorIn, wasRemoved } from './removal'

function rowsWith(ids: readonly number[]) {
  const rows = new Uint32Array(ids.length * 4)
  ids.forEach((id, index) => {
    rows[index * 4] = id
  })
  const snapshot: CollectionSnapshot = {
    rev: '1',
    query: {
      folder: 'all',
      q: null,
      type: null,
      alt: null,
      size: null,
      orient: null,
      month: null,
      sort: 'date-desc',
    },
    total: ids.length,
    rows,
    indexComplete: true,
  }
  return rowsOf(snapshot)
}

const kept = { folder: 3, trash: null }

describe('wasRemoved', () => {
  it('counts deleted, missing and trashed items', () => {
    expect(wasRemoved(null, true, 'all')).toBe(true)
    expect(wasRemoved({ folder: 3, trash: {} }, false, 'all')).toBe(true)
  })

  it('counts an item that left the folder on view (remove from folder, move)', () => {
    expect(wasRemoved({ folder: 0, trash: null }, false, 3)).toBe(true)
    expect(wasRemoved({ folder: 7, trash: null }, false, 0)).toBe(true)
    expect(wasRemoved(kept, false, 3)).toBe(false)
  })

  it('counts an item restored out of the Trash view', () => {
    expect(wasRemoved(kept, false, 'trash')).toBe(true)
    expect(wasRemoved({ folder: 3, trash: {} }, false, 'trash')).toBe(false)
  })

  it('doesn’t count an item that only stopped matching a filter', () => {
    // E.g. its alt text was saved under Missing alt: it stays on stage.
    expect(wasRemoved(kept, false, 'all')).toBe(false)
    // Without FileBird there is no folder to leave.
    expect(wasRemoved({ folder: null, trash: null }, false, 3)).toBe(false)
    // Still loading.
    expect(wasRemoved(null, false, 'all')).toBe(false)
  })
})

describe('successorIn', () => {
  const before = rowsWith([1, 2, 3, 4, 5, 6])

  it('is the item that took its place', () => {
    expect(
      successorIn(rowsWith([1, 2, 4, 5, 6]), { index: 2, rows: before }),
    ).toBe(4)
  })

  it('skips the others removed with it (a batch delete)', () => {
    // 3 on stage; 2, 3 and 4 deleted together.
    expect(successorIn(rowsWith([1, 5, 6]), { index: 2, rows: before })).toBe(5)
  })

  it('is the one before it at the end', () => {
    expect(
      successorIn(rowsWith([1, 2, 3, 4, 5]), { index: 5, rows: before }),
    ).toBe(5)
  })

  it('is null when the view is empty', () => {
    expect(successorIn(rowsWith([]), { index: 0, rows: before })).toBeNull()
  })
})
