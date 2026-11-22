import { Router } from 'express'
import { notImplemented } from './notImplemented.ts'

// Stub from the M0 scaffold, owned by track S2
// (docs/media-manager/implementation-plan.md §7). Implement these routes
// as specified in docs/media-manager/contracts/server-api.md.
export const imagesRouter = Router()

imagesRouter.post('/items/:id/edit', notImplemented)
imagesRouter.post('/items/:id/edit/undo', notImplemented)
imagesRouter.post('/items/:id/restore', notImplemented)
imagesRouter.post('/items/:id/replace', notImplemented)
imagesRouter.post('/regenerate', notImplemented)
