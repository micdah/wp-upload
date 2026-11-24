// Read routes: bootstrap, rev, collection, facets, items, usage, posts,
// folders (GET) and trash (GET). server-api.md §7.1–7.5, 7.9–7.11, 7.14.

import { LIMITS } from '../../../../../shared/library-api'
import * as S from '../../../../../shared/library-api.schema'
import { bootstrapFor } from '../context'
import { invalidRequest } from '../fake/errors'
import { COLLECTION_PARAMS, parseCollectionQuery } from '../fake/query'
import { idsParam, json } from '../respond'
import { libraryRoute } from './define'

const POSTS_DEFAULT_LIMIT = 10

export const readRoutes = [
  libraryRoute({
    method: 'get',
    path: 'bootstrap',
    guard: 'bootstrap',
    handle: ({ mock }) => json(S.BootstrapSchema, bootstrapFor(mock)),
  }),

  libraryRoute({
    method: 'get',
    path: 'rev',
    handle: ({ library }) =>
      json(S.RevResponseSchema, library.revResponse(), { rev: library.rev }),
  }),

  libraryRoute({
    method: 'get',
    path: 'collection',
    query: COLLECTION_PARAMS,
    handle: ({ library, search, request }) => {
      const body = library.collection(parseCollectionQuery(search))
      return json(S.CollectionResponseSchema, body, {
        rev: body.rev,
        cache: 'etag',
        request,
      })
    },
  }),

  libraryRoute({
    method: 'get',
    path: 'facets',
    query: COLLECTION_PARAMS,
    handle: ({ library, search, request }) => {
      const body = library.facets(parseCollectionQuery(search))
      return json(S.FacetsSchema, body, {
        rev: body.rev,
        cache: 'etag',
        request,
      })
    },
  }),

  libraryRoute({
    method: 'get',
    path: 'items',
    query: ['ids', 'view'],
    handle: ({ library, search, request }) => {
      const ids = idsParam(search, LIMITS.itemIds)
      const view = search.get('view') || 'tile'
      if (view === 'full') {
        const body = library.items(ids, 'full')
        return json(S.ItemsFullResponseSchema, body, {
          rev: body.rev,
          cache: 'etag',
          request,
        })
      }
      if (view !== 'tile') {
        throw invalidRequest('view')
      }
      const body = library.items(ids, 'tile')
      return json(S.ItemsTileResponseSchema, body, {
        rev: body.rev,
        cache: 'etag',
        request,
      })
    },
  }),

  libraryRoute({
    method: 'get',
    path: 'usage',
    query: ['ids'],
    handle: ({ library, search, request }) => {
      const body = library.usage(idsParam(search, LIMITS.usageIds))
      return json(S.UsageResponseSchema, body, {
        rev: body.rev,
        cache: 'etag',
        request,
      })
    },
  }),

  libraryRoute({
    method: 'get',
    path: 'posts',
    query: ['search', 'limit'],
    handle: ({ library, search }) => {
      const text = search.get('search') ?? ''
      if (text.length > LIMITS.queryLength) {
        throw invalidRequest('search')
      }
      const rawLimit = search.get('limit')
      let limit = POSTS_DEFAULT_LIMIT
      if (rawLimit !== null && rawLimit !== '') {
        limit = Number(rawLimit)
        if (
          !Number.isInteger(limit) ||
          limit < 1 ||
          limit > LIMITS.postsLimit
        ) {
          throw invalidRequest('limit')
        }
      }
      return json(S.PostsResponseSchema, library.posts(text, limit))
    },
  }),

  libraryRoute({
    method: 'get',
    path: 'folders',
    handle: ({ library, request }) => {
      const body = library.folderTree()
      return json(S.FolderTreeSchema, body, {
        rev: body.rev,
        cache: 'etag',
        request,
      })
    },
  }),

  libraryRoute({
    method: 'get',
    path: 'trash',
    handle: ({ library, request }) => {
      const body = library.trashSummary()
      return json(S.TrashSummarySchema, body, {
        rev: body.rev,
        cache: 'etag',
        request,
      })
    },
  }),
]
