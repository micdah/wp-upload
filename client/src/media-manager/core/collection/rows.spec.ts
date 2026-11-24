import { describe, expect, it } from 'vitest'
import { collectionAll } from '../../../../../shared/fixtures/collection'
import { decodeRows, neighbourOf } from './rows'

describe('decodeRows', () => {
  it('decodes the stride-4 fixture rows in order', () => {
    const rows = decodeRows(collectionAll.rows)
    expect(rows.length).toBe(collectionAll.total)
    expect(rows.ids.slice(0, 3)).toEqual([1029, 1090, 1092])
    expect(rows.widths[0]).toBe(2560)
    expect(rows.heights[0]).toBe(1207)
    expect(rows.kindAt(1)).toBe('audio')
    expect(rows.kindAt(2)).toBe('archive')
    expect(rows.kindAt(3)).toBe('svg')
    expect(rows.indexOf(1000)).toBe(rows.length - 1)
    expect(rows.indexOf(42)).toBe(-1)
    expect(rows.has(1091)).toBe(true)
  })

  it('reads unknown kind codes as other', () => {
    const rows = decodeRows([5, 10, 10, 99])
    expect(rows.kindAt(0)).toBe('other')
  })

  it('finds neighbours, with no wrap-around', () => {
    const rows = decodeRows(collectionAll.rows)
    expect(neighbourOf(rows, 1029, 1)).toBe(1090)
    expect(neighbourOf(rows, 1029, -1)).toBeNull()
    expect(neighbourOf(rows, 1000, 1)).toBeNull()
    expect(neighbourOf(rows, 42, 1)).toBeNull()
  })
})
