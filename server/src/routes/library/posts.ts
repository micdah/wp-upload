import { Router } from 'express'
import { LIMITS, type PostsResponse } from '../../../../shared/library-api.ts'
import { env } from '../../config/env.ts'
import { sendNoStore } from '../../lib/library/cache.ts'
import {
  asyncRoute,
  characters,
  invalidRequest,
  LibraryError,
  queryParams,
} from '../../lib/library/errors.ts'
import {
  SEARCH_FIELDS,
  searchResultToPostRef,
  type WpSearchResult,
} from '../../lib/library/normalise/posts.ts'
import { postTypes, wpGet } from '../../lib/library/pluginClient.ts'

// GET posts (server-api.md §7.10): the post picker for Attach / Change…,
// from core's `/wp/v2/search` (published posts of public types only, D21).

export const postsRouter = Router()

const DEFAULT_LIMIT = 10

function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_LIMIT
  const limit = /^[0-9]{1,3}$/.test(raw) ? Number(raw) : Number.NaN
  if (!(limit >= 1 && limit <= LIMITS.postsLimit)) {
    throw invalidRequest(
      'limit',
      `limit must be a whole number from 1 to ${LIMITS.postsLimit}.`,
    )
  }
  return limit
}

function parseSearch(raw: string | undefined): string | null {
  const search = raw?.trim().replace(/\s+/g, ' ') ?? ''
  if (characters(search) > LIMITS.queryLength) {
    throw invalidRequest(
      'search',
      `search: at most ${LIMITS.queryLength} characters.`,
    )
  }
  return search === '' ? null : search
}

postsRouter.get(
  '/posts',
  asyncRoute(async (req, res) => {
    const raw = queryParams(req, ['search', 'limit'])
    const search = parseSearch(raw.search)
    const limit = parseLimit(raw.limit)

    const [results, types] = await Promise.all([
      wpGet<unknown>('/wp/v2/search', {
        type: 'post',
        subtype: 'any',
        // Without a search term, core lists the most recent posts.
        search: search ?? undefined,
        per_page: limit,
        _fields: SEARCH_FIELDS,
      }),
      postTypes(),
    ])
    if (!Array.isArray(results)) {
      throw new LibraryError(
        502,
        'wp_unexpected_response',
        'WordPress answered the post search with an unexpected response.',
      )
    }
    const list = results as WpSearchResult[]
    const body: PostsResponse = {
      posts: list.map((result) =>
        searchResultToPostRef(result, types, env.wpUrl),
      ),
    }
    sendNoStore(res, body)
  }),
)
