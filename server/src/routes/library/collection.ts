import { type Request, Router } from 'express'
import {
  ALT_FILTERS,
  DEFAULT_SORT,
  FOLDER_PARAM_PATTERN,
  LIMITS,
  MONTH_PATTERN,
  ORIENTATIONS,
  SIZE_FILTERS,
  SORT_KEYS,
  TYPE_FILTERS,
} from '../../../../shared/library-api.ts'
import { serveCachedRead } from '../../lib/library/cache.ts'
import {
  asyncRoute,
  characters,
  invalidRequest,
  queryParams,
} from '../../lib/library/errors.ts'
import {
  type CollectionParams,
  pluginClient,
} from '../../lib/library/pluginClient.ts'
import { requireFeature } from './bootstrap.ts'

// GET collection (server-api.md §7.3) and the collection query of §6, which
// GET facets shares.

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

/** More search terms than this → 400 (server-api.md §6). */
export const MAX_SEARCH_TERMS = 10

const folderPattern = new RegExp(FOLDER_PARAM_PATTERN)
const monthPattern = new RegExp(MONTH_PATTERN)

function oneOf(
  params: Record<string, string>,
  name: string,
  allowed: readonly string[],
): string | undefined {
  const value = params[name]
  if (value === undefined) return undefined
  if (!allowed.includes(value)) {
    throw invalidRequest(name, `${name} must be one of: ${allowed.join(', ')}.`)
  }
  return value
}

export interface ParsedCollectionQuery {
  /** what the plugin gets: validated, normalised, defaults left out */
  params: CollectionParams
  /** a stable string of `params`, for cache keys and ETags */
  key: string
}

/**
 * Validates and normalises the collection query (server-api.md §6). Unknown
 * parameters and invalid values are 400 `invalid_request`. `folder=trash`
 * ignores every other filter and the sort, so they're dropped here too.
 */
export function parseCollectionQuery(req: Request): ParsedCollectionQuery {
  const raw = queryParams(req, COLLECTION_PARAMS)
  const params: CollectionParams = {}

  if (raw.folder !== undefined) {
    if (!folderPattern.test(raw.folder)) {
      throw invalidRequest(
        'folder',
        'folder must be all, trash, 0 or a folder id.',
      )
    }
    if (raw.folder !== 'all') params.folder = raw.folder
  }

  if (raw.q !== undefined) {
    const q = raw.q.trim().replace(/\s+/g, ' ')
    if (characters(q) > LIMITS.queryLength) {
      throw invalidRequest('q', `q: at most ${LIMITS.queryLength} characters.`)
    }
    if (q !== '' && q.split(' ').length > MAX_SEARCH_TERMS) {
      throw invalidRequest('q', `q: at most ${MAX_SEARCH_TERMS} search terms.`)
    }
    if (q !== '') params.q = q
  }

  const type = oneOf(raw, 'type', TYPE_FILTERS)
  if (type) params.type = type
  const alt = oneOf(raw, 'alt', ALT_FILTERS)
  if (alt) params.alt = alt
  const size = oneOf(raw, 'size', SIZE_FILTERS)
  if (size) params.size = size
  const orient = oneOf(raw, 'orient', ORIENTATIONS)
  if (orient) params.orient = orient

  if (raw.month !== undefined) {
    if (!monthPattern.test(raw.month)) {
      throw invalidRequest('month', 'month must be YYYY-MM.')
    }
    params.month = raw.month
  }

  const sort = oneOf(raw, 'sort', SORT_KEYS)
  if (sort && sort !== DEFAULT_SORT) params.sort = sort

  const normalised: CollectionParams =
    params.folder === 'trash' ? { folder: 'trash' } : params
  return { params: normalised, key: queryKey(normalised) }
}

function queryKey(params: CollectionParams): string {
  return COLLECTION_PARAMS.filter((name) => params[name] !== undefined)
    .map((name) => `${name}=${encodeURIComponent(params[name] ?? '')}`)
    .join('&')
}

export const collectionRouter = Router()

collectionRouter.get(
  '/collection',
  requireFeature('collection'),
  asyncRoute(async (req, res) => {
    const { params, key } = parseCollectionQuery(req)
    await serveCachedRead(req, res, 'collection', key, () =>
      pluginClient.collection(params),
    )
  }),
)
