import { describe, expect, it } from 'vitest'
import type { MediaKind } from '../../../../../shared/library-api'
import { beginSave, edit } from './autosave'
import {
  appendSucceeded,
  applicableIds,
  batchFieldKey,
  batchKey,
  sharedValue,
} from './batch'

describe('batchKey', () => {
  it('is stable for the same ids', () => {
    expect(batchKey([1001, 1002, 1003])).toBe(batchKey([1001, 1002, 1003]))
  })

  it('differs for other ids or another count, not for another order', () => {
    const key = batchKey([1001, 1002, 1003])
    expect(batchKey([1001, 1002, 1004])).not.toBe(key)
    // A filter that hides some of the selection only reorders it.
    expect(batchKey([1003, 1002, 1001])).toBe(key)
    expect(batchKey([1001, 1002])).not.toBe(key)
    expect(batchKey([1001, 1002, 1003, 1003])).not.toBe(key)
  })

  it('starts with the count', () => {
    expect(batchKey([5, 6, 7, 8])).toMatch(/^4-[0-9a-z]+$/)
    expect(batchKey([])).toMatch(/^0-/)
  })

  it('makes the field key', () => {
    expect(batchFieldKey('2-abc', 'caption')).toBe('batch:2-abc:caption')
  })
})

describe('sharedValue', () => {
  const values: Record<number, string | undefined> = {
    1: 'Same',
    2: 'Same',
    3: 'Other',
    4: '',
    5: undefined,
  }
  const valueFor = (id: number) => values[id]

  it('gives the one value every item has', () => {
    expect(sharedValue([1, 2], valueFor)).toEqual({
      current: 'Same',
      mixed: false,
      distinct: 1,
      partial: false,
    })
  })

  it('treats an empty value as a value', () => {
    expect(sharedValue([4], valueFor)).toEqual({
      current: '',
      mixed: false,
      distinct: 1,
      partial: false,
    })
  })

  it('is Mixed with the number of different values', () => {
    expect(sharedValue([1, 2, 3, 4], valueFor)).toEqual({
      current: '',
      mixed: true,
      distinct: 3,
      partial: false,
    })
  })

  it('is a partial Mixed when some values are unknown', () => {
    // One known value plus an unknown one may well differ.
    expect(sharedValue([1, 5], valueFor)).toEqual({
      current: '',
      mixed: true,
      distinct: 1,
      partial: true,
    })
    expect(sharedValue([5], valueFor)).toEqual({
      current: '',
      mixed: true,
      distinct: 0,
      partial: true,
    })
  })

  it('is empty and not Mixed for no items', () => {
    expect(sharedValue([], valueFor)).toEqual({
      current: '',
      mixed: false,
      distinct: 0,
      partial: false,
    })
  })
})

describe('applicableIds', () => {
  const kinds: Record<number, MediaKind | null> = {
    1: 'image',
    2: 'svg',
    3: 'video',
    4: 'document',
    5: null,
  }
  const kindOf = (id: number) => kinds[id] ?? null

  it('keeps image-like items for alt text, in order', () => {
    expect(applicableIds([3, 2, 5, 1, 4], 'alt', kindOf)).toEqual([2, 1])
  })

  it('keeps every item for the other fields', () => {
    const ids = [3, 2, 5, 1, 4]
    for (const field of ['title', 'caption', 'description'] as const) {
      const result = applicableIds(ids, field, kindOf)
      expect(result).toEqual(ids)
      expect(result).not.toBe(ids)
    }
  })
})

describe('appendSucceeded', () => {
  function sending(text: string) {
    const begin = beginSave(edit(undefined, text, ''), '')
    if (begin.kind !== 'send') {
      throw new Error('expected a send')
    }
    return begin.entry
  }

  it('is a plain success when nothing was typed meanwhile', () => {
    expect(appendSucceeded(sending('One.'), 'One.')?.phase).toBe('saved')
  })

  it('keeps only what was typed after the appended text', () => {
    const typedOn = edit(sending('One.'), 'One. Two.', '')
    const after = appendSucceeded(typedOn, 'One.')
    expect(after?.phase).toBe('dirty')
    expect(after?.draft).toBe('Two.')
  })

  it('keeps a rewritten draft whole', () => {
    const rewritten = edit(sending('One.'), 'Something else', '')
    expect(appendSucceeded(rewritten, 'One.')?.draft).toBe('Something else')
  })
})
