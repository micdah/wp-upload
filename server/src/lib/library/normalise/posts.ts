import type { PostRef } from '../../../../../shared/library-api.ts'
import { capitalise, type PostTypeInfo } from '../pluginClient.ts'
import { decodeHtml, editPostUrl } from './items.ts'

// WordPress core search results → PostRef (server-api.md §7.10, §8.3).

/** One result of `GET /wp/v2/search?type=post` (`_fields` below). */
export interface WpSearchResult {
  id: number
  /** rendered title: may hold entities and inline tags */
  title?: string
  url?: string
  type?: string
  /** the post type's slug */
  subtype?: string
}

export const SEARCH_FIELDS = 'id,title,url,type,subtype'

/** Plain text from a rendered title. */
export function plainTitle(rendered: string | undefined): string {
  const text = decodeHtml((rendered ?? '').replace(/<[^>]*>/g, '')).trim()
  return text || '(no title)'
}

/**
 * A search result as a PostRef. Core search only finds published entries,
 * so `status` is always `publish` and `viewUrl` the result's URL. `editUrl`
 * is always built: search can't say whether the user may edit the post,
 * and WordPress checks when it is opened.
 */
export function searchResultToPostRef(
  result: WpSearchResult,
  types: Map<string, PostTypeInfo>,
  wpUrl: string,
): PostRef {
  const postType = result.subtype || 'post'
  return {
    postId: result.id,
    postType,
    postTypeLabel: types.get(postType)?.label ?? capitalise(postType),
    title: plainTitle(result.title),
    status: 'publish',
    editUrl: editPostUrl(wpUrl, result.id),
    viewUrl: result.url || null,
  }
}
