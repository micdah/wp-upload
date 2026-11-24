import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The library modules import each other in a loop (cache → pluginClient →
// errors → wpUpload). That is only safe while no module touches a binding of
// another one at load time before it is initialised. Which module loads first
// decides the order, so each one is loaded as the entry of a fresh Node
// process: the live specs start from pluginClient.ts, the server from
// index.ts. (A cycle through wpUpload.ts once threw "Cannot access
// 'revObserver' before initialization" when pluginClient.ts came first.)

const serverDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
)

const ENTRIES = [
  'src/lib/library/pluginClient.ts',
  'src/lib/library/cache.ts',
  'src/lib/library/errors.ts',
  'src/lib/library/jobs.ts',
  'src/lib/wpUpload.ts',
  'src/routes/library/index.ts',
  'src/app.ts',
]

describe('library module load order', () => {
  it.each(ENTRIES)('loads with %s as the entry module', (entry) => {
    const output = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `await import(${JSON.stringify(`./${entry}`)}); console.log('loaded')`,
      ],
      {
        cwd: serverDir,
        encoding: 'utf8',
        env: {
          ...process.env,
          WP_URL: 'https://example.invalid',
          WP_USERNAME: 'module-order',
          WP_APP_PASSWORD: 'module-order',
          AUTH_USERNAME: 'module-order',
          AUTH_PASSWORD: 'module-order',
        },
      },
    )
    expect(output.trim()).toBe('loaded')
  })
})
