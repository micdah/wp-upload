import { type Request, type Response, Router } from 'express'
import { LIMITS, type UsageResponse } from '../../../../shared/library-api.ts'
import { serveCachedRead } from '../../lib/library/cache.ts'
import {
  asyncRoute,
  objectBody,
  parseIdArray,
  parseIdList,
  queryParams,
  rejectUnknownFields,
} from '../../lib/library/errors.ts'
import { pluginClient } from '../../lib/library/pluginClient.ts'
import { requireFeature } from './bootstrap.ts'

// GET usage (server-api.md §7.9): where items are used. `POST usage` with
// `{ids}` is the same read for proxies that limit URL length, as the
// plugin's own `POST /usage` (plugin-api.md §5.10). Both are cached per rev
// and id list (§3.2).

export const usageRouter = Router()

usageRouter.use('/usage', requireFeature('usage'))

function serveUsage(req: Request, res: Response, ids: number[]) {
  return serveCachedRead<UsageResponse>(
    req,
    res,
    'usage',
    `ids=${ids.join(',')}`,
    () => pluginClient.usage(ids),
  )
}

usageRouter.get(
  '/usage',
  asyncRoute(async (req, res) => {
    const raw = queryParams(req, ['ids'])
    const ids = parseIdList(raw.ids, 'ids', LIMITS.usageIds)
    await serveUsage(req, res, ids)
  }),
)

usageRouter.post(
  '/usage',
  asyncRoute(async (req, res) => {
    queryParams(req, [])
    const body = objectBody(req)
    rejectUnknownFields(body, ['ids'])
    const ids = parseIdArray(body.ids, 'ids', LIMITS.usageIds)
    await serveUsage(req, res, ids)
  }),
)
