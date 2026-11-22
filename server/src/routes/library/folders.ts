import { Router } from 'express'
import { notImplemented } from './notImplemented.ts'

// Stub from the M0 scaffold, owned by track S1
// (docs/media-manager/implementation-plan.md §7). Implement these routes
// as specified in docs/media-manager/contracts/server-api.md.
export const foldersRouter = Router()

foldersRouter.get('/folders', notImplemented)
foldersRouter.post('/folders', notImplemented)
foldersRouter.post('/folders/assign', notImplemented)
foldersRouter.patch('/folders/:id', notImplemented)
foldersRouter.delete('/folders/:id', notImplemented)
