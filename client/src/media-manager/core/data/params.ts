// The collection query (server-api.md §6) as the client holds it.
//
// URL values (interaction-spec §1) go in as loose strings; out comes a
// normalised `CollectionQuery`, the same shape the server echoes. It is the
// query key of `collection` and `facets`, so equivalent URLs share one cache
// entry, and it turns back into the query string with defaults left out.

import {
  ALT_FILTERS,
  type CollectionQuery,
  DEFAULT_SORT,
  FOLDER_PARAM_PATTERN,
  type FolderRef,
  LIMITS,
  MONTH_PATTERN,
  ORIENTATIONS,
  SIZE_FILTERS,
  SORT_KEYS,
  TYPE_FILTERS,
} from '../../../../../shared/library-api'
import type { Query } from './http'

/** What the URL state may hold; every field optional and untrusted. */
export interface CollectionParams {
  folder?: string | number | null
  q?: string | null
  type?: string | null
  alt?: string | null
  size?: string | null
  orient?: string | null
  month?: string | null
  sort?: string | null
}

/** The query every default collection request has. */
export const DEFAULT_COLLECTION_QUERY: CollectionQuery = {
  folder: 'all',
  q: null,
  type: null,
  alt: null,
  size: null,
  orient: null,
  month: null,
  sort: DEFAULT_SORT,
}

const folderPattern = new RegExp(FOLDER_PARAM_PATTERN)
const monthPattern = new RegExp(MONTH_PATTERN)

function oneOf<T extends string>(
  list: readonly T[],
  value: string | null | undefined,
): T | null {
  if (value === null || value === undefined) {
    return null
  }
  return (list as readonly string[]).includes(value) ? (value as T) : null
}

export function parseFolder(
  value: string | number | null | undefined,
): FolderRef {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 ? value : 'all'
  }
  if (value === null || value === undefined || !folderPattern.test(value)) {
    return 'all'
  }
  if (value === 'all' || value === 'trash') {
    return value
  }
  return Number(value)
}

/**
 * Search text as the server normalises it: trimmed, inner whitespace
 * collapsed, and cut to the length limit. Empty means no search.
 */
export function normaliseSearch(
  value: string | null | undefined,
): string | null {
  if (!value) {
    return null
  }
  const collapsed = value.trim().replace(/\s+/g, ' ')
  if (collapsed === '') {
    return null
  }
  return collapsed.slice(0, LIMITS.queryLength)
}

/**
 * Loose URL values → the canonical query. Invalid values fall back to their
 * default (a hand-edited URL shouldn't break the page). In the Trash every
 * other filter and the sort are ignored (server-api.md §6), so they are
 * dropped here too.
 */
export function normaliseCollectionQuery(
  params: CollectionParams | CollectionQuery = {},
): CollectionQuery {
  const folder = parseFolder(params.folder)
  if (folder === 'trash') {
    return { ...DEFAULT_COLLECTION_QUERY, folder }
  }
  const month =
    params.month && monthPattern.test(params.month) ? params.month : null
  return {
    folder,
    q: normaliseSearch(params.q),
    type: oneOf(TYPE_FILTERS, params.type),
    alt: oneOf(ALT_FILTERS, params.alt),
    size: oneOf(SIZE_FILTERS, params.size),
    orient: oneOf(ORIENTATIONS, params.orient),
    month,
    sort: oneOf(SORT_KEYS, params.sort) ?? DEFAULT_SORT,
  }
}

/** The request's query parameters: only what differs from the defaults. */
export function collectionSearchParams(query: CollectionQuery): Query {
  return {
    folder: query.folder === 'all' ? null : String(query.folder),
    q: query.q,
    type: query.type,
    alt: query.alt,
    size: query.size,
    orient: query.orient,
    month: query.month,
    sort: query.sort === DEFAULT_SORT ? null : query.sort,
  }
}

/** True when the query lists a single FileBird folder (or Uncategorized). */
export function isFolderQuery(
  query: CollectionQuery,
): query is CollectionQuery & {
  folder: number
} {
  return typeof query.folder === 'number'
}

/** True when any filter narrows the folder (search, type, alt, size, …). */
export function hasFilters(query: CollectionQuery): boolean {
  return (
    query.q !== null ||
    query.type !== null ||
    query.alt !== null ||
    query.size !== null ||
    query.orient !== null ||
    query.month !== null
  )
}
