import { Router } from 'express'
import type { RevResponse } from '../../../../shared/library-api.ts'
import {
  currentRevState,
  knownPluginInfo,
  sendNoStore,
} from '../../lib/library/cache.ts'
import { asyncRoute, queryParams } from '../../lib/library/errors.ts'
import { TIMEOUTS } from '../../lib/library/pluginClient.ts'
import { triggerMaintenance } from './bootstrap.ts'

// GET rev (server-api.md §7.2): cheap change detection. Shares the server's
// 2-second `/rev` refresh, so many polling clients cost one plugin call.

export const revRouter = Router()

revRouter.get(
  '/rev',
  asyncRoute(async (req, res) => {
    queryParams(req, [])
    const state = await currentRevState({ timeoutMs: TIMEOUTS.rev })
    const index = state.index ?? knownPluginInfo()?.info.index
    if (!index) {
      throw new Error('The plugin answered /rev without its index state.')
    }
    triggerMaintenance(index, 'rev')
    const body: RevResponse = { rev: state.rev, index }
    sendNoStore(res, body, { rev: state.rev })
  }),
)
