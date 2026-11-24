// The collection query of server-api.md §6 over fake records: parameter
// validation (400 `invalid_request` with `details.param`), filters (AND),
// search (every term a substring of some text field), the eight sorts with
// the id tiebreaker, the Trash order, and the facet counts of §7.4.

import {
  ALT_FILTERS,
  type CollectionQuery,
  DEFAULT_SORT,
  type FacetCounts,
  FOLDER_PARAM_PATTERN,
  IMAGE_LIKE_KINDS,
  LIMITS,
  type MediaKind,
  MONTH_PATTERN,
  type MonthCount,
  ORIENTATION_RATIO,
  ORIENTATIONS,
  SIZE_FILTER_BYTES,
  SIZE_FILTERS,
  SORT_KEYS,
  type SortKey,
  TYPE_FILTER_KINDS,
  TYPE_FILTERS,
  type TypeFilter,
} from '../../../../../shared/library-api.ts'
import { invalidRequest } from './errors.ts'
import type { FakeItem } from './types.ts'

export const COLLECTION_PARAMS = [
  'folder',
  'q',
  'type',
  'alt',
  'size',
  'orient',
  'month',
  'sort',
] as const

/** Search allows at most this many terms. */
export const MAX_SEARCH_TERMS = 10

const folderPattern = new RegExp(FOLDER_PARAM_PATTERN)
const monthPattern = new RegExp(MONTH_PATTERN)

/** Rejects any parameter not in `allowed` (server-api.md §1: typos surface). */
export function rejectUnknownParams(
  search: URLSearchParams,
  allowed: readonly string[],
): void {
  for (const name of search.keys()) {
    if (!allowed.includes(name)) {
      throw invalidRequest(name, `Unknown parameter "${name}".`)
    }
  }
}

function listParam<T extends string>(
  search: URLSearchParams,
  name: string,
  list: readonly T[],
): T | null {
  const value = search.get(name)
  if (value === null || value === '') {
    return null
  }
  if (!(list as readonly string[]).includes(value)) {
    throw invalidRequest(name)
  }
  return value as T
}

/** Normalises search text like the server: trim, collapse whitespace. */
export function normaliseQ(value: string | null): string | null {
  if (value === null) {
    return null
  }
  const collapsed = value.trim().replace(/\s+/g, ' ')
  return collapsed === '' ? null : collapsed
}

/** The §6 parameters → the normalised echo, or 400. */
export function parseCollectionQuery(search: URLSearchParams): CollectionQuery {
  rejectUnknownParams(search, COLLECTION_PARAMS)
  const folderValue = search.get('folder')
  let folder: CollectionQuery['folder'] = 'all'
  if (folderValue !== null && folderValue !== '') {
    if (!folderPattern.test(folderValue)) {
      throw invalidRequest('folder')
    }
    folder =
      folderValue === 'all' || folderValue === 'trash'
        ? folderValue
        : Number(folderValue)
  }
  const q = normaliseQ(search.get('q'))
  if (q !== null) {
    if (q.length > LIMITS.queryLength) {
      throw invalidRequest(
        'q',
        `Search is limited to ${LIMITS.queryLength} characters.`,
      )
    }
    if (q.split(' ').length > MAX_SEARCH_TERMS) {
      throw invalidRequest(
        'q',
        `Search is limited to ${MAX_SEARCH_TERMS} words.`,
      )
    }
  }
  const month = search.get('month') || null
  if (month !== null && !monthPattern.test(month)) {
    throw invalidRequest('month')
  }
  const query: CollectionQuery = {
    folder,
    q,
    type: listParam(search, 'type', TYPE_FILTERS),
    alt: listParam(search, 'alt', ALT_FILTERS),
    size: listParam(search, 'size', SIZE_FILTERS),
    orient: listParam(search, 'orient', ORIENTATIONS),
    month,
    sort: listParam(search, 'sort', SORT_KEYS) ?? DEFAULT_SORT,
  }
  if (folder === 'trash') {
    // Every other filter and the sort are ignored in the Trash.
    return {
      folder,
      q: null,
      type: null,
      alt: null,
      size: null,
      orient: null,
      month: null,
      sort: DEFAULT_SORT,
    }
  }
  return query
}

export function isImageLike(kind: MediaKind): boolean {
  return (IMAGE_LIKE_KINDS as readonly string[]).includes(kind)
}

const TYPE_OF_KIND = new Map<string, TypeFilter>()
for (const type of TYPE_FILTERS) {
  for (const kind of TYPE_FILTER_KINDS[type]) {
    TYPE_OF_KIND.set(kind, type)
  }
}

export function typeOf(kind: MediaKind): TypeFilter {
  return TYPE_OF_KIND.get(kind) ?? 'document'
}

/** Months repeat a lot; formatting a Date per item is the slow part. */
const MONTH_MS = new Map<number, string>()
const HOUR_MS = 3_600_000

export function monthOf(ms: number): string {
  const hour = Math.floor(ms / HOUR_MS)
  let month = MONTH_MS.get(hour)
  if (month === undefined) {
    month = new Date(hour * HOUR_MS).toISOString().slice(0, 7)
    MONTH_MS.set(hour, month)
  }
  return month
}

function orientationOf(item: FakeItem): string | null {
  if (item.width === 0 || item.height === 0) {
    return null
  }
  const ratio = item.width / item.height
  if (ratio > ORIENTATION_RATIO.landscapeAbove) {
    return 'landscape'
  }
  if (ratio < ORIENTATION_RATIO.portraitBelow) {
    return 'portrait'
  }
  return 'square'
}

/** The text a search term may match (server-api.md §6 "Search"), lowercased. */
export function searchText(item: FakeItem, path: string): string {
  return [
    item.title,
    item.caption,
    item.description,
    item.alt,
    item.filename,
    path,
    ...(item.exif?.keywords ?? []),
  ]
    .join('\n')
    .toLowerCase()
}

export interface MatchContext {
  /** `searchText` of an item (the library caches it) */
  textOf: (item: FakeItem) => string
}

/** Does the item pass every filter of the query (folder excluded)? */
export function matchesFilters(
  item: FakeItem,
  query: CollectionQuery,
  context: MatchContext,
): boolean {
  if (query.type !== null && typeOf(item.kind) !== query.type) {
    return false
  }
  if (
    query.alt === 'missing' &&
    !(isImageLike(item.kind) && item.alt.trim() === '')
  ) {
    return false
  }
  if (query.size !== null) {
    if (
      item.filesize === null ||
      item.filesize <= SIZE_FILTER_BYTES[query.size]
    ) {
      return false
    }
  }
  if (query.orient !== null && orientationOf(item) !== query.orient) {
    return false
  }
  if (query.month !== null && monthOf(item.uploadedAt) !== query.month) {
    return false
  }
  if (query.q !== null) {
    const text = context.textOf(item)
    for (const term of query.q.toLowerCase().split(' ')) {
      if (!text.includes(term)) {
        return false
      }
    }
  }
  return true
}

/** Does the item belong to the folder part of the query? */
export function inFolder(
  item: FakeItem,
  folder: CollectionQuery['folder'],
): boolean {
  if (folder === 'trash') {
    return item.status === 'trash'
  }
  if (item.status === 'trash') {
    return false
  }
  return folder === 'all' || item.folder === folder
}

type Compare = (a: FakeItem, b: FakeItem) => number

const byIdAsc: Compare = (a, b) => a.id - b.id
const byIdDesc: Compare = (a, b) => b.id - a.id

function text(a: string, b: string): number {
  const left = a.toLowerCase()
  const right = b.toLowerCase()
  return left < right ? -1 : left > right ? 1 : 0
}

/** Unknown (null or 0) values sort last in both directions. */
function unknownLast(
  a: number | null,
  b: number | null,
  direction: 1 | -1,
): number {
  const aUnknown = a === null || a === 0
  const bUnknown = b === null || b === 0
  if (aUnknown || bUnknown) {
    return aUnknown === bUnknown ? 0 : aUnknown ? 1 : -1
  }
  return (a - b) * direction
}

export const SORTS: Record<SortKey, Compare> = {
  'date-desc': (a, b) => b.uploadedAt - a.uploadedAt || byIdDesc(a, b),
  'date-asc': (a, b) => a.uploadedAt - b.uploadedAt || byIdAsc(a, b),
  'title-asc': (a, b) => text(a.title, b.title) || byIdAsc(a, b),
  'name-asc': (a, b) => text(a.filename, b.filename) || byIdAsc(a, b),
  'size-desc': (a, b) =>
    unknownLast(a.filesize, b.filesize, -1) || byIdDesc(a, b),
  'size-asc': (a, b) => unknownLast(a.filesize, b.filesize, 1) || byIdAsc(a, b),
  'dimensions-desc': (a, b) =>
    unknownLast(a.width * a.height, b.width * b.height, -1) || byIdDesc(a, b),
  'type-asc': (a, b) =>
    text(a.mime, b.mime) || b.uploadedAt - a.uploadedAt || byIdDesc(a, b),
}

/** The Trash: newest trash first, then id desc. */
export const TRASH_ORDER: Compare = (a, b) =>
  (b.trashedAt ?? 0) - (a.trashedAt ?? 0) || byIdDesc(a, b)

/** Text sorts compare lowercased keys; computing them once is much faster. */
const TEXT_KEYS: Partial<Record<SortKey, (item: FakeItem) => string>> = {
  'title-asc': (item) => item.title.toLowerCase(),
  'name-asc': (item) => item.filename.toLowerCase(),
}

/** Sorts in place: the Trash order, or one of the eight sorts. */
export function sortItems(items: FakeItem[], query: CollectionQuery): void {
  if (query.folder === 'trash') {
    items.sort(TRASH_ORDER)
    return
  }
  const keyOf = TEXT_KEYS[query.sort]
  if (!keyOf) {
    items.sort(SORTS[query.sort])
    return
  }
  const keys = new Map<FakeItem, string>()
  for (const item of items) {
    keys.set(item, keyOf(item))
  }
  items.sort((a, b) => {
    const left = keys.get(a) ?? ''
    const right = keys.get(b) ?? ''
    return left < right ? -1 : left > right ? 1 : byIdAsc(a, b)
  })
}

/** The items of a query, in order (or unordered, for counting). */
export function runQuery(
  items: Iterable<FakeItem>,
  query: CollectionQuery,
  context: MatchContext,
  options: { sorted?: boolean } = {},
): FakeItem[] {
  const result: FakeItem[] = []
  for (const item of items) {
    if (inFolder(item, query.folder) && matchesFilters(item, query, context)) {
      result.push(item)
    }
  }
  if (options.sorted ?? true) {
    sortItems(result, query)
  }
  return result
}

/** `FacetCounts` over a list of items, for a viewer. */
export function facetCounts(
  items: readonly FakeItem[],
  canEdit: (item: FakeItem) => boolean,
): FacetCounts {
  const counts: FacetCounts = {
    total: items.length,
    bytes: 0,
    types: { image: 0, video: 0, audio: 0, document: 0 },
    missingAlt: 0,
    unused: 0,
    editable: 0,
  }
  for (const item of items) {
    counts.bytes += item.filesize ?? 0
    counts.types[typeOf(item.kind)]++
    if (isImageLike(item.kind) && item.alt.trim() === '') {
      counts.missingAlt++
    }
    if (item.usage.length === 0) {
      counts.unused++
    }
    if (canEdit(item)) {
      counts.editable++
    }
  }
  return counts
}

/** Months with items, newest first. */
export function monthCounts(items: readonly FakeItem[]): MonthCount[] {
  const counts = new Map<string, number>()
  for (const item of items) {
    const month = monthOf(item.uploadedAt)
    counts.set(month, (counts.get(month) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([month, count]) => ({ month, count }))
}
