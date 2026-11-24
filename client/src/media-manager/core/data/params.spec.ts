import { describe, expect, it } from 'vitest'
import { libraryKeys } from './keys'
import {
  collectionSearchParams,
  DEFAULT_COLLECTION_QUERY,
  normaliseCollectionQuery,
} from './params'

describe('normaliseCollectionQuery', () => {
  it('fills defaults and keeps valid values', () => {
    expect(normaliseCollectionQuery({})).toEqual(DEFAULT_COLLECTION_QUERY)
    expect(
      normaliseCollectionQuery({
        folder: '12',
        q: '  sunny   beach ',
        type: 'image',
        alt: 'missing',
        size: 'gt5',
        orient: 'portrait',
        month: '2025-06',
        sort: 'size-desc',
      }),
    ).toEqual({
      folder: 12,
      q: 'sunny beach',
      type: 'image',
      alt: 'missing',
      size: 'gt5',
      orient: 'portrait',
      month: '2025-06',
      sort: 'size-desc',
    })
  })

  it('drops invalid values instead of failing', () => {
    expect(
      normaliseCollectionQuery({
        folder: '-3',
        type: 'pictures',
        month: '2025-13',
        sort: 'random',
        q: '   ',
      }),
    ).toEqual(DEFAULT_COLLECTION_QUERY)
  })

  it('ignores filters and sort in the Trash', () => {
    expect(
      normaliseCollectionQuery({ folder: 'trash', q: 'x', sort: 'title-asc' }),
    ).toEqual({ ...DEFAULT_COLLECTION_QUERY, folder: 'trash' })
  })

  it('makes equivalent URLs share one query key', () => {
    const a = normaliseCollectionQuery({ folder: 'all', q: 'a  b' })
    const b = normaliseCollectionQuery({ q: ' a b', sort: 'date-desc' })
    expect(JSON.stringify(libraryKeys.collection(a))).toBe(
      JSON.stringify(libraryKeys.collection(b)),
    )
  })
})

describe('collectionSearchParams', () => {
  it('leaves out defaults', () => {
    expect(collectionSearchParams(DEFAULT_COLLECTION_QUERY)).toEqual({
      folder: null,
      q: null,
      type: null,
      alt: null,
      size: null,
      orient: null,
      month: null,
      sort: null,
    })
    expect(
      collectionSearchParams(
        normaliseCollectionQuery({ folder: '0', sort: 'name-asc' }),
      ),
    ).toMatchObject({ folder: '0', sort: 'name-asc' })
  })
})
