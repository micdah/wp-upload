import { Router } from 'express'
import {
  type EmptyTrashResponse,
  LIMITS,
  type RestoreItemResult,
  type RestoreResponse,
  type TrashSummary,
} from '../../../../shared/library-api.ts'
import { sendNoStore, serveCachedRead } from '../../lib/library/cache.ts'
import {
  asyncRoute,
  invalidRequest,
  objectBody,
  parseIdArray,
  queryParams,
  rejectUnknownFields,
} from '../../lib/library/errors.ts'
import { pluginClient, sendUntilDone } from '../../lib/library/pluginClient.ts'
import { requireFeature } from './bootstrap.ts'

// The Trash (server-api.md §7.14). The routes work whether or not trash is
// enabled: items trashed before MEDIA_TRASH was turned off can still be
// restored or deleted.

export const trashRouter = Router()

trashRouter.use('/trash', requireFeature('trash'))

trashRouter.get(
  '/trash',
  asyncRoute(async (req, res) => {
    queryParams(req, [])
    await serveCachedRead<TrashSummary>(req, res, 'trash', '', () =>
      pluginClient.trash(),
    )
  }),
)

trashRouter.post(
  '/trash/restore',
  asyncRoute(async (req, res) => {
    queryParams(req, [])
    const body = objectBody(req)
    rejectUnknownFields(body, ['ids'])
    const ids = parseIdArray(body.ids, 'ids', LIMITS.deleteIds)
    const { rev, results } = await sendUntilDone<number, RestoreItemResult>(
      ids,
      (id) => id,
      (pending) => pluginClient.trashRestore({ ids: pending }),
    )
    const answer: RestoreResponse = { rev, results }
    sendNoStore(res, answer, { rev })
  }),
)

/** No body, or an empty JSON object (server-api.md §7.14). */
function requireEmptyBody(body: unknown): void {
  if (body === undefined || body === null) return
  if (typeof body !== 'object' || Array.isArray(body)) {
    throw invalidRequest('body', 'Send no body, or an empty JSON object.')
  }
  rejectUnknownFields(body as Record<string, unknown>, [])
}

trashRouter.post(
  '/trash/empty',
  asyncRoute(async (req, res) => {
    queryParams(req, [])
    requireEmptyBody(req.body)
    // One step of about 10 s (the plugin's default budget); the client calls
    // again while `remaining > 0`.
    const step = await pluginClient.trashEmpty({})
    const answer: EmptyTrashResponse = {
      rev: step.rev,
      deleted: step.deleted,
      remaining: step.remaining,
      skipped: step.skipped,
    }
    sendNoStore(res, answer, { rev: step.rev })
  }),
)
