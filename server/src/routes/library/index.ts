import compression from 'compression'
import express, { type Request, type Response, Router } from 'express'
import { LIMITS } from '../../../../shared/library-api.ts'
import { libraryErrorHandler } from '../../lib/library/errors.ts'
import { batchRouter } from './batch.ts'
import { bootstrapRouter, requireUsablePlugin } from './bootstrap.ts'
import { collectionRouter } from './collection.ts'
import { deleteRouter } from './delete.ts'
import { downloadRouter } from './download.ts'
import { facetsRouter } from './facets.ts'
import { foldersRouter } from './folders.ts'
import { imagesRouter } from './images.ts'
import { itemsRouter } from './items.ts'
import { jobsRouter } from './jobs.ts'
import { pluginDownloadRouter } from './pluginDownload.ts'
import { postsRouter } from './posts.ts'
import { revRouter } from './rev.ts'
import { trashRouter } from './trash.ts'
import { uploadRouter } from './upload.ts'
import { usageRouter } from './usage.ts'

// All media-manager API routes, mounted at /api/library by app.ts (behind
// requireSession). Each area lives in its own router file with a single
// owning track (implementation-plan §2.5, §7). Routers with literal
// /items/<word> paths are mounted before itemsRouter so `/items/:id` never
// shadows them.
export const libraryRouter = Router()

// Files that are already compressed (downloads) and the upload routes are
// left alone (server-api.md §3.4).
function shouldCompress(req: Request, res: Response): boolean {
  if (/\/download$/.test(req.path) || req.path.startsWith('/upload')) {
    return false
  }
  return compression.filter(req, res)
}

libraryRouter.use(compression({ threshold: 1024, filter: shouldCompress }))
libraryRouter.use(express.json({ limit: LIMITS.jsonBodyBytes }))

// Always answer, whatever state the plugin is in (server-api.md §9.4).
libraryRouter.use(bootstrapRouter)
libraryRouter.use(pluginDownloadRouter)

// Every other route needs a plugin the app can use.
libraryRouter.use(requireUsablePlugin)

libraryRouter.use(revRouter)
libraryRouter.use(collectionRouter)
libraryRouter.use(facetsRouter)
libraryRouter.use(batchRouter)
libraryRouter.use(deleteRouter)
libraryRouter.use(imagesRouter)
libraryRouter.use(downloadRouter)
libraryRouter.use(itemsRouter)
libraryRouter.use(foldersRouter)
libraryRouter.use(jobsRouter)
libraryRouter.use(trashRouter)
libraryRouter.use(usageRouter)
libraryRouter.use(uploadRouter)
libraryRouter.use(postsRouter)

libraryRouter.use(libraryErrorHandler)
