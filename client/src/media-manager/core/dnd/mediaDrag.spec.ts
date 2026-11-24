import { describe, expect, it } from 'vitest'
import { dragIdsFor, isMediaDragData, MEDIA_DRAG_TYPE } from './mediaDrag'

describe('media drag payload', () => {
  const order = [1, 2, 3, 4, 5]

  it('drags only the tile when it is not selected', () => {
    expect(dragIdsFor(4, new Set([1, 2]), order)).toEqual([4])
  })

  it('drags the whole selection, in collection order, from a selected tile', () => {
    expect(dragIdsFor(2, new Set([5, 2, 1]), order)).toEqual([1, 2, 5])
  })

  it('recognises its own payload only', () => {
    expect(
      isMediaDragData({ type: MEDIA_DRAG_TYPE, ids: [1], sourceId: 1 }),
    ).toBe(true)
    expect(isMediaDragData({ type: 'folder', ids: [1] })).toBe(false)
    expect(isMediaDragData({ type: MEDIA_DRAG_TYPE })).toBe(false)
  })
})
