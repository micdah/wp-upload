// Runs once before the contract tests: the stack must answer, the plugin
// must be there, the variants start from their defaults, and the media index
// must be ready and maintenance drained (a freshly restored snapshot, or the
// `oldest` and `mu-plugin` runs, start with an empty index).
import { editor, PLUGIN } from './http.ts'
import { drainMaintenance, ensureMediaIndexReady } from './library.ts'
import { resetVariant, variantsAvailable } from './variants.ts'

export default async function setup(): Promise<void> {
  if (variantsAvailable) {
    resetVariant()
  }
  const reply = await editor.get(`${PLUGIN}/info`)
  if (reply.status !== 200) {
    throw new Error(
      `GET ${PLUGIN}/info answered ${reply.status}: ${JSON.stringify(reply.body).slice(0, 300)}. Is the companion plugin active?`,
    )
  }
  await ensureMediaIndexReady()
  await drainMaintenance()
}
