import { Router } from 'express'
import {
  DELETE_MODES,
  type DeleteItemResult,
  type DeleteMode,
  type DeleteResponse,
  LIMITS,
} from '../../../../shared/library-api.ts'
import { sendNoStore } from '../../lib/library/cache.ts'
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

// POST items/delete (server-api.md §7.8): move to the Trash, or delete for
// good. 409 `wpu_trash_disabled` from the plugin fails the whole request.

export const deleteRouter = Router()

deleteRouter.post(
  '/items/delete',
  requireFeature('trash'),
  asyncRoute(async (req, res) => {
    queryParams(req, [])
    const body = objectBody(req)
    rejectUnknownFields(body, ['ids', 'mode'])
    const ids = parseIdArray(body.ids, 'ids', LIMITS.deleteIds)
    const mode = body.mode as DeleteMode
    if (!DELETE_MODES.includes(mode)) {
      throw invalidRequest('mode', 'mode must be trash or delete.')
    }

    const send =
      mode === 'trash'
        ? (pending: number[]) => pluginClient.mediaTrash({ ids: pending })
        : (pending: number[]) => pluginClient.mediaDelete({ ids: pending })
    const { rev, results } = await sendUntilDone<number, DeleteItemResult>(
      ids,
      (id) => id,
      send,
    )
    const answer: DeleteResponse = { rev, results }
    sendNoStore(res, answer, { rev })
  }),
)
