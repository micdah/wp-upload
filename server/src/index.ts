import { app } from './app.ts'
import { env } from './config/env.ts'
import { checkConnection } from './config/wpClient.ts'

await checkConnection()

app.listen(env.port, env.host, () => {
  console.log(`Server listening on http://${env.host}:${env.port}`)
})
