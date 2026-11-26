import { describe, expect, it } from 'vitest'
import { collectionAll } from '../../../../../shared/fixtures/collection'
import { parseCollection } from '../data/collection'
import { EMPTY_ROWS, neighbourOf, queryKeyOf, rowsOf, stepFrom } from './rows'

describe('rowsOf', () => {
  it('reads the stride-4 fixture rows in order, over the snapshot', () => {
    const snapshot = parseCollection(collectionAll)
    const rows = rowsOf(snapshot)
    expect(rows.snapshot).toBe(snapshot)
    expect(rows.length).toBe(collectionAll.total)
    expect(rows.ids.slice(0, 3)).toEqual([1029, 1090, 1092])
    expect(rows.idAt(0)).toBe(1029)
    expect(rows.widthAt(0)).toBe(2560)
    expect(rows.heightAt(0)).toBe(1207)
    expect(rows.kindAt(1)).toBe('audio')
    expect(rows.kindAt(2)).toBe('archive')
    expect(rows.kindAt(3)).toBe('svg')
    expect(rows.indexOf(1000)).toBe(rows.length - 1)
    expect(rows.indexOf(42)).toBe(-1)
    expect(rows.has(1091)).toBe(true)
  })

  it('is one view per snapshot, with one ids array', () => {
    const snapshot = parseCollection(collectionAll)
    expect(rowsOf(snapshot)).toBe(rowsOf(snapshot))
    expect(rowsOf(snapshot).ids).toBe(rowsOf(snapshot).ids)
  })

  it('reads unknown kind codes as other', () => {
    const rows = rowsOf(
      parseCollection({ ...collectionAll, total: 1, rows: [5, 10, 10, 99] }),
    )
    expect(rows.kindAt(0)).toBe('other')
  })

  it('finds neighbours, with no wrap-around (D34)', () => {
    const rows = rowsOf(parseCollection(collectionAll))
    expect(neighbourOf(rows, 1029, 1)).toBe(1090)
    expect(neighbourOf(rows, 1029, -1)).toBeNull()
    expect(neighbourOf(rows, 1000, 1)).toBeNull()
    expect(neighbourOf(rows, 42, 1)).toBeNull()
  })

  it('has an empty view', () => {
    expect(EMPTY_ROWS.length).toBe(0)
    expect(EMPTY_ROWS.ids).toEqual([])
  })
})

describe('stepFrom (detail stepping, D34)', () => {
  const key = queryKeyOf({ folder: 'all', alt: 'missing' })
  const rows = rowsOf(
    parseCollection({
      ...collectionAll,
      total: 4,
      rows: [1, 10, 10, 0, 2, 10, 10, 0, 3, 10, 10, 0, 4, 10, 10, 0],
    }),
  )

  it('steps to the neighbour and reports both ends', () => {
    expect(stepFrom(rows, 2, 1, null, key)).toEqual({ next: 3 })
    expect(stepFrom(rows, 2, -1, null, key)).toEqual({ next: 1 })
    expect(stepFrom(rows, 1, -1, null, key)).toEqual({ edge: true })
    expect(stepFrom(rows, 4, 1, null, key)).toEqual({ edge: true })
  })

  it('steps from the old place of an item that left the view', () => {
    // Item 3 (index 2) was saved out of a Missing-alt view.
    const after = rowsOf(
      parseCollection({
        ...collectionAll,
        total: 3,
        rows: [1, 10, 10, 0, 2, 10, 10, 0, 4, 10, 10, 0],
      }),
    )
    const last = { id: 3, index: 2, query: key }
    expect(stepFrom(after, 3, 1, last, key)).toEqual({ next: 4 })
    expect(stepFrom(after, 3, -1, last, key)).toEqual({ next: 2 })
  })

  it('has nowhere to go for an item never seen in this query', () => {
    expect(stepFrom(rows, 42, 1, null, key)).toBeNull()
    const elsewhere = { id: 42, index: 1, query: queryKeyOf({ folder: 6 }) }
    expect(stepFrom(rows, 42, 1, elsewhere, key)).toBeNull()
  })
})
