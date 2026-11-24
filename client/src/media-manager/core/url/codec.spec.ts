import { describe, expect, it } from 'vitest'
import {
  collectionQueryOf,
  collectionSearch,
  DEFAULT_URL_STATE,
  parseUrlState,
  serializeUrlState,
} from './codec'

describe('parseUrlState', () => {
  it('reads defaults from an empty search', () => {
    expect(parseUrlState('')).toEqual(DEFAULT_URL_STATE)
  })

  it('reads every parameter', () => {
    const state = parseUrlState(
      '?view=library&folder=12&q=beach%20house&type=image&alt=missing&size=gt5&orient=portrait&month=2026-03&sort=title-asc&layout=square&density=4&item=1029',
    )
    expect(state).toEqual({
      folder: 12,
      q: 'beach house',
      type: 'image',
      alt: 'missing',
      size: 'gt5',
      orient: 'portrait',
      month: '2026-03',
      sort: 'title-asc',
      layout: 'square',
      density: 4,
      item: 1029,
      view: 'library',
    })
  })

  it.each([
    ['folder=0', { folder: 0 }],
    ['folder=trash', { folder: 'trash' }],
    ['folder=all', { folder: 'all' }],
    ['folder=-3', { folder: 'all' }],
    ['folder=012', { folder: 'all' }],
    ['folder=abc', { folder: 'all' }],
    ['type=pdf', { type: null }],
    ['alt=present', { alt: null }],
    ['size=gt2', { size: null }],
    ['orient=round', { orient: null }],
    ['month=2026-13', { month: null }],
    ['month=26-01', { month: null }],
    ['sort=random', { sort: 'date-desc' }],
    ['layout=masonry', { layout: 'justified' }],
    ['density=7', { density: 2 }],
    ['density=1.5', { density: 2 }],
    ['item=0', { item: null }],
    ['item=x', { item: null }],
    ['q=%20%20', { q: null }],
    ['q=%20a%20%20b%20', { q: 'a b' }],
  ])('is lenient: %s', (search, expected) => {
    expect(parseUrlState(`?${search}`)).toMatchObject(expected)
  })
})

describe('serializeUrlState', () => {
  it('leaves out defaults', () => {
    expect(serializeUrlState(DEFAULT_URL_STATE)).toBe('')
  })

  it('writes owned params in a fixed order and keeps foreign ones', () => {
    const state = {
      ...DEFAULT_URL_STATE,
      view: 'library',
      folder: 0 as const,
      sort: 'size-asc' as const,
      item: 5,
    }
    expect(
      serializeUrlState(state, '?mock-scenario=pro&item=3&view=library'),
    ).toBe('?view=library&folder=0&sort=size-asc&item=5&mock-scenario=pro')
  })

  it('round-trips', () => {
    const search =
      '?view=library&folder=12&q=beach+house&type=image&alt=missing&size=gt5&orient=portrait&month=2026-03&sort=title-asc&layout=square&density=4&item=1029'
    expect(serializeUrlState(parseUrlState(search))).toBe(search)
  })

  it('writes density 0 (not a default)', () => {
    expect(serializeUrlState({ ...DEFAULT_URL_STATE, density: 0 })).toBe(
      '?density=0',
    )
  })
})

describe('collection query', () => {
  it('drops client-only state and defaults', () => {
    const state = parseUrlState(
      '?view=library&folder=0&alt=missing&layout=square&item=4',
    )
    const query = collectionQueryOf(state)
    expect(query).toEqual({
      folder: 0,
      q: null,
      type: null,
      alt: 'missing',
      size: null,
      orient: null,
      month: null,
      sort: 'date-desc',
    })
    expect(collectionSearch(query)).toBe('folder=0&alt=missing')
  })
})
