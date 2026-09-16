import { app } from './app.ts'
import { env } from './config/env.ts'
import { sampleOnce, startServerLoadSampler } from './config/serverLoad.ts'
import { checkConnection } from './config/wpClient.ts'

await checkConnection()
await sampleOnce()
startServerLoadSampler()

app.listen(env.port, env.host, () => {
  console.log(`Server listening on http://${env.host}:${env.port}`)
})
