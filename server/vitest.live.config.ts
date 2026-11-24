import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Live server specs (`src/**/*.live.spec.ts`) against a real WordPress with
// the companion plugin: `dev/run test server-live` runs them in the runner
// against the `test` stack; on the host they use the `dev` stack.
//
// - In the runner, `dev/run` provides WPU_WP_URL, WPU_APP_USER and
//   WPU_APP_PASSWORD (docs/media-manager/tracks/D-handoff.md §5).
// - On the host, `dev/run up dev` writes dev/.env.wp.
//
// The default config (vitest.config.ts) must not run these: they need
// WordPress, and ci.yml runs `npm run test -w server` without one. Each live
// spec also skips itself unless WPU_LIVE is set, which only this config does.

const here = path.dirname(fileURLToPath(import.meta.url))

function readEnvFile(file: string): Record<string, string> {
  if (!fs.existsSync(file)) return {}
  const values: Record<string, string> = {}
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (match?.[1]) values[match[1]] = match[2]?.replace(/^'(.*)'$/, '$1') ?? ''
  }
  return values
}

function liveEnv(): Record<string, string> {
  const fromRunner = {
    url: process.env.WPU_WP_URL,
    user: process.env.WPU_APP_USER,
    password: process.env.WPU_APP_PASSWORD,
  }
  const devFile = readEnvFile(path.resolve(here, '../dev/.env.wp'))
  const url = fromRunner.url || devFile.WP_URL
  const user = fromRunner.user || devFile.WP_USERNAME
  const password = fromRunner.password || devFile.WP_APP_PASSWORD
  if (!url || !user || !password) {
    throw new Error(
      'No WordPress for the live specs: run `dev/run test server-live`, or ' +
        '`dev/run up dev && dev/run seed small` before running this config.',
    )
  }
  return {
    WPU_LIVE: '1',
    WP_URL: url,
    WP_USERNAME: user,
    WP_APP_PASSWORD: password,
    AUTH_USERNAME: 'live-spec',
    AUTH_PASSWORD: 'live-spec-password',
  }
}

export default defineConfig({
  test: {
    include: ['src/**/*.live.spec.ts'],
    environment: 'node',
    env: liveEnv(),
    setupFiles: ['./vitest.setup.ts'],
    restoreMocks: true,
    // One WordPress, and module state (caches, the plugin check): run the
    // files one after another.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
