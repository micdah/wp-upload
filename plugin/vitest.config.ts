// Contract tests of the companion plugin over HTTP (plugin-api.md §2.4),
// against a running stack: `dev/run test plugin-contract` (test mode, the
// built plugin) or, from the host, `npx vitest run --config plugin/vitest.config.ts`
// against this worktree's `dev/run up dev` stack. See tests/contract/support/env.ts.
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const pluginRoot = fileURLToPath(new URL('.', import.meta.url))
const resultsDir = process.env.WPU_SUITE_RESULTS_DIR

export default defineConfig({
  root: pluginRoot,
  test: {
    include: ['tests/contract/**/*.spec.ts'],
    globalSetup: ['tests/contract/support/global-setup.ts'],
    // One WordPress, shared state and variants: never run files in parallel.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 60_000,
    hookTimeout: 120_000,
    reporters: resultsDir ? ['default', 'junit'] : ['default'],
    outputFile: resultsDir
      ? { junit: join(resultsDir, 'plugin-contract.junit.xml') }
      : undefined,
  },
})
