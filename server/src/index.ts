import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { env } from './config/env.ts'
import { checkConnection } from './config/wpClient.ts'
import { basicAuth } from './middleware/basicAuth.ts'
import { errorHandler } from './middleware/errorHandler.ts'
import { mediaRouter } from './routes/media.ts'
import { statusRouter } from './routes/status.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const clientDist = path.resolve(__dirname, '../../client/dist')

const app = express()
app.set('trust proxy', env.trustProxy)

app.get('/healthz', (_req, res) => res.status(200).send('ok'))

app.use(basicAuth)

app.use('/api', mediaRouter)
app.use('/api', statusRouter)

if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist))
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')))
}

app.use(errorHandler)

await checkConnection()

app.listen(env.port, env.host, () => {
  console.log(`Server listening on http://${env.host}:${env.port}`)
})
