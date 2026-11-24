// The URL codec: query parameters <-> UrlState (interaction-spec §1).
//
// All state that matters for sharing or Back/Forward lives in query
// parameters, never in path segments, so the app works under any sub-path.
// Parsing is lenient: an invalid value reads as its default, so a hand-edited
// or stale link still opens the app. Writing leaves out defaults and keeps
// every parameter this module doesn't know (e.g. `mock-scenario`).

import {
  ALT_FILTERS,
  type AltFilter,
  type CollectionQuery,
  DEFAULT_SORT,
  type FolderRef,
  MONTH_PATTERN,
  ORIENTATIONS,
  type Orientation,
  SIZE_FILTERS,
  type SizeFilter,
  SORT_KEYS,
  type SortKey,
  TYPE_FILTERS,
  type TypeFilter,
} from '../../../../../shared/library-api'

export const LAYOUTS = ['justified', 'square'] as const
export type Layout = (typeof LAYOUTS)[number]

/** Density steps: 120 / 160 / 200 / 260 / 340 px row height or cell size. */
export const DENSITY_SIZES = [120, 160, 200, 260, 340] as const
export type Density = 0 | 1 | 2 | 3 | 4
export const MAX_DENSITY: Density = 4

export interface UrlState {
  folder: FolderRef
  q: string | null
  type: TypeFilter | null
  alt: AltFilter | null
  size: SizeFilter | null
  orient: Orientation | null
  month: string | null
  sort: SortKey
  layout: Layout
  density: Density
  /** The open item: present means detail mode. */
  item: number | null
  /**
   * `?view=library` selects the media manager over the old upload page until
   * M5 (implementation plan §4). Carried through every write untouched.
   */
  view: string | null
}

export const DEFAULT_URL_STATE: UrlState = Object.freeze({
  folder: 'all',
  q: null,
  type: null,
  alt: null,
  size: null,
  orient: null,
  month: null,
  sort: DEFAULT_SORT,
  layout: 'justified',
  density: 2,
  item: null,
  view: null,
})

/** The parameters this codec owns, in the order they are written. */
export const URL_PARAMS = [
  'view',
  'folder',
  'q',
  'type',
  'alt',
  'size',
  'orient',
  'month',
  'sort',
  'layout',
  'density',
  'item',
] as const satisfies readonly (keyof UrlState)[]

const MONTH_REGEX = new RegExp(MONTH_PATTERN)
const POSITIVE_INT = /^[1-9][0-9]{0,15}$/

function oneOf<T extends string>(
  list: readonly T[],
  value: string | null,
): T | null {
  if (value === null) {
    return null
  }
  return (list as readonly string[]).includes(value) ? (value as T) : null
}

function parseFolder(value: string | null): FolderRef {
  if (value === 'trash') {
    return 'trash'
  }
  if (value === '0') {
    return 0
  }
  if (value !== null && POSITIVE_INT.test(value)) {
    return Number(value)
  }
  return 'all'
}

/** Search text: whitespace collapsed and trimmed; empty reads as absent. */
export function normaliseQuery(value: string | null): string | null {
  if (value === null) {
    return null
  }
  const collapsed = value.replace(/\s+/g, ' ').trim()
  return collapsed === '' ? null : collapsed
}

function parseDensity(value: string | null): Density {
  if (value !== null && /^[0-4]$/.test(value)) {
    return Number(value) as Density
  }
  return DEFAULT_URL_STATE.density
}

function parseItem(value: string | null): number | null {
  if (value !== null && POSITIVE_INT.test(value)) {
    return Number(value)
  }
  return null
}

export function parseUrlState(search: string): UrlState {
  const params = new URLSearchParams(search)
  const month = params.get('month')
  return {
    folder: parseFolder(params.get('folder')),
    q: normaliseQuery(params.get('q')),
    type: oneOf(TYPE_FILTERS, params.get('type')),
    alt: oneOf(ALT_FILTERS, params.get('alt')),
    size: oneOf(SIZE_FILTERS, params.get('size')),
    orient: oneOf(ORIENTATIONS, params.get('orient')),
    month: month !== null && MONTH_REGEX.test(month) ? month : null,
    sort: oneOf(SORT_KEYS, params.get('sort')) ?? DEFAULT_SORT,
    layout: oneOf(LAYOUTS, params.get('layout')) ?? DEFAULT_URL_STATE.layout,
    density: parseDensity(params.get('density')),
    item: parseItem(params.get('item')),
    view: params.get('view'),
  }
}

function paramValue(state: UrlState, name: keyof UrlState): string | null {
  const value = state[name]
  if (value === null || value === DEFAULT_URL_STATE[name]) {
    return null
  }
  return String(value)
}

/**
 * Writes `state` over `currentSearch`: owned parameters are rewritten in a
 * fixed order (defaults left out), foreign ones are kept as they were.
 * Returns the search string with a leading `?`, or '' when empty.
 */
export function serializeUrlState(state: UrlState, currentSearch = ''): string {
  const current = new URLSearchParams(currentSearch)
  const params = new URLSearchParams()
  for (const name of URL_PARAMS) {
    const value = paramValue(state, name)
    if (value !== null) {
      params.set(name, value)
    }
  }
  const owned = new Set<string>(URL_PARAMS)
  for (const [name, value] of current) {
    if (!owned.has(name)) {
      params.append(name, value)
    }
  }
  const query = params.toString()
  return query === '' ? '' : `?${query}`
}

/** The parameters that define the collection (what the server is asked). */
export function collectionQueryOf(state: UrlState): CollectionQuery {
  return {
    folder: state.folder,
    q: state.q,
    type: state.type,
    alt: state.alt,
    size: state.size,
    orient: state.orient,
    month: state.month,
    sort: state.sort,
  }
}

/**
 * `collection`/`facets` query string for a query, defaults left out
 * (server-api.md §6: the client passes URL values straight through).
 */
export function collectionSearch(query: CollectionQuery): string {
  const params = new URLSearchParams()
  if (query.folder !== 'all') {
    params.set('folder', String(query.folder))
  }
  const optional = ['q', 'type', 'alt', 'size', 'orient', 'month'] as const
  for (const name of optional) {
    const value = query[name]
    if (value !== null) {
      params.set(name, value)
    }
  }
  if (query.sort !== DEFAULT_SORT) {
    params.set('sort', query.sort)
  }
  return params.toString()
}

/** True when the two states describe the same collection (same order). */
export function sameCollection(a: UrlState, b: UrlState): boolean {
  return (
    a.folder === b.folder &&
    a.q === b.q &&
    a.type === b.type &&
    a.alt === b.alt &&
    a.size === b.size &&
    a.orient === b.orient &&
    a.month === b.month &&
    a.sort === b.sort
  )
}

/** Any extra filter (not folder, not sort) is active. */
export function hasActiveFilters(state: UrlState): boolean {
  return (
    state.q !== null ||
    state.type !== null ||
    state.alt !== null ||
    state.size !== null ||
    state.orient !== null ||
    state.month !== null
  )
}
