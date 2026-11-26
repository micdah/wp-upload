import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'
import { msw } from 'msw/vite'
import { defineConfig } from 'vitest/config'

// Client tests (plan §8), in two projects:
//
// - `unit`: pure modules in Node (`*.spec.ts`). Fast, no DOM.
// - `browser`: components in real Chromium through Vitest browser mode
//   (`*.browser.spec.ts(x)`), because jsdom has no layout. Inside the
//   dev/run runner, Playwright's browsers come from the image.
//
// Both start MSW (test/setup/*.ts), and any request to the app's own API
// that no handler answers fails the test. `npm run test -w client` runs both;
// `vitest run --project unit` (or `browser`) runs one.

const setupDir = './src/media-manager/test/setup'

export default defineConfig({
  test: {
    passWithNoTests: true,
    projects: [
      {
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.spec.ts'],
          exclude: ['src/**/*.browser.spec.{ts,tsx}'],
          setupFiles: [`${setupDir}/unit.ts`],
        },
      },
      {
        // msw/vite in worker-only mode serves mockServiceWorker.js from the
        // msw package during tests, so the worker file never has to live in
        // client/public (where it would reach the production build).
        plugins: [react(), msw({ mode: 'worker-only' })],
        // Re-bundle dependencies on every run. With a warm cache, a test that
        // imports a dependency the cache doesn't have yet makes Vite
        // re-optimise and reload mid-run, which fails that test file. The
        // runner keeps node_modules (and the cache) in a volume, so CI would
        // hit it too. react-dom/client is only discovered late (through
        // testing-library), which reloaded a test mid-run in most full runs:
        // pre-bundle it up front.
        optimizeDeps: { force: true, include: ['react-dom/client'] },
        test: {
          name: 'browser',
          include: ['src/**/*.browser.spec.{ts,tsx}'],
          setupFiles: [`${setupDir}/browser.ts`],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
            viewport: { width: 1280, height: 800 },
            screenshotFailures: false,
          },
        },
      },
    ],
  },
})
