import { Router } from 'express'
import { batchRouter } from './batch.ts'
import { bootstrapRouter } from './bootstrap.ts'
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
// owning track (implementation-plan §2.5, §7), so tracks never edit this
// file. Routers with literal /items/<word> paths are mounted before
// itemsRouter so `/items/:id` never shadows them.
export const libraryRouter = Router()

libraryRouter.use(bootstrapRouter)
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
libraryRouter.use(pluginDownloadRouter)
