import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { env } from './config/env.ts'
import { errorHandler } from './middleware/errorHandler.ts'
import { requireSession } from './middleware/requireSession.ts'
import { sameOriginOnly } from './middleware/sameOriginOnly.ts'
import { foldersRouter } from './routes/folders.ts'
import { libraryRouter } from './routes/library/index.ts'
import { mediaRouter } from './routes/media.ts'
import { serverLoadRouter } from './routes/serverLoad.ts'
import { sessionRouter } from './routes/session.ts'
import { statusRouter } from './routes/status.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const clientDist = path.resolve(__dirname, '../../client/dist')

export const app = express()
app.set('trust proxy', env.trustProxy)

app.get('/healthz', (_req, res) => res.status(200).send('ok'))

app.use(sameOriginOnly)

// Login, logout and "who am I". Public, and at the app root rather than
// under /api so the session cookie's default path is the mount path (see
// lib/session.ts).
app.use(sessionRouter)

// The client bundle, index.html and favicons hold no secrets, so they're
// public: the page shell loads without a session and shows its own login
// form. That also keeps browsers from ever having to authenticate
// subresource requests themselves.
const hasClientBuild = fs.existsSync(clientDist)
if (hasClientBuild) app.use(express.static(clientDist))

app.use('/api', requireSession)

// The media manager's API (docs/media-manager/contracts/server-api.md).
app.use('/api/library', libraryRouter)

app.use('/api', mediaRouter)
app.use('/api', foldersRouter)
app.use('/api', statusRouter)
app.use('/api', serverLoadRouter)

app.use('/api', (_req, res) => {
  res.status(404).json({
    code: 'not_found',
    message: 'The requested API endpoint does not exist.',
  })
})

if (hasClientBuild) {
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')))
}

app.use(errorHandler)
