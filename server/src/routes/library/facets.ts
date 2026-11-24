import { Router } from 'express'
import { serveCachedRead } from '../../lib/library/cache.ts'
import { asyncRoute } from '../../lib/library/errors.ts'
import { pluginClient } from '../../lib/library/pluginClient.ts'
import { requireFeature } from './bootstrap.ts'
import { parseCollectionQuery } from './collection.ts'

// GET facets (server-api.md §7.4): counts for the same query as collection.

export const facetsRouter = Router()

facetsRouter.get(
  '/facets',
  requireFeature('facets'),
  asyncRoute(async (req, res) => {
    const { params, key } = parseCollectionQuery(req)
    await serveCachedRead(req, res, 'facets', key, () =>
      pluginClient.facets(params),
    )
  }),
)
