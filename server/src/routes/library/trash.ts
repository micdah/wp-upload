import { Router } from 'express'
import { notImplemented } from './notImplemented.ts'

// Stub from the M0 scaffold, owned by track S2
// (docs/media-manager/implementation-plan.md §7). Implement these routes
// as specified in docs/media-manager/contracts/server-api.md.
export const trashRouter = Router()

trashRouter.get('/trash', notImplemented)
trashRouter.post('/trash/restore', notImplemented)
trashRouter.post('/trash/empty', notImplemented)
