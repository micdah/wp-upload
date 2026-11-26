// The `VITE_MOCK` build: the real app plus the mock backend
// (src/media-manager/mocks), for e2e-mock and for working without WordPress.
//
//   npx vite --config vite.mock.config.ts          # dev server with mocks
//   npx vite build --config vite.mock.config.ts    # → dev/.build/mock-dist/
//
// It extends vite.config.ts (base './', so it works under any path, e.g. the
// test-mode proxy's /wp-upload-mock/) and changes three things:
// - index.html loads mocks/entry.ts, which starts MSW and then src/main.tsx;
// - MSW's worker script is served in dev and emitted into this build only,
//   never into client/public (so the production build can't contain it);
// - the output goes to dev/.build/mock-dist/ (M0 D handoff, CR-6).

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, mergeConfig, type Plugin } from 'vite'
import baseConfig from './vite.config'

const APP_ENTRY = '/src/main.tsx'
const MOCK_ENTRY = '/src/media-manager/mocks/entry.ts'
const WORKER_FILE = 'mockServiceWorker.js'

// Swaps the app entry for the mock entry in index.html.
function mockEntry(): Plugin {
  return {
    name: 'wpu-mock-entry',
    // Before Vite resolves the entry; the build calls it again afterwards.
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        if (html.includes(MOCK_ENTRY)) {
          return html
        }
        if (!html.includes(APP_ENTRY)) {
          throw new Error(`index.html no longer loads ${APP_ENTRY}`)
        }
        return html.replace(APP_ENTRY, MOCK_ENTRY)
      },
    },
  }
}

// Serves MSW's worker script in dev and emits it next to index.html in the
// build, from the installed msw package (so it always matches its version).
function mockServiceWorker(): Plugin {
  const require = createRequire(import.meta.url)
  const workerScript = () =>
    readFileSync(require.resolve(`msw/${WORKER_FILE}`), 'utf8')
  return {
    name: 'wpu-mock-service-worker',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = new URL(request.url ?? '/', 'http://localhost').pathname
        if (!path.endsWith(`/${WORKER_FILE}`)) {
          next()
          return
        }
        response.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'no-cache',
        })
        response.end(workerScript())
      })
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: WORKER_FILE,
        source: workerScript(),
      })
    },
  }
}

/** The repository root: relative paths in the env are resolved against it. */
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

// Optional HTTPS for the dev server, so another device on the network can
// open the mock (service workers need a secure context). Both paths are PEM
// files, absolute or relative to the repository root (npm runs this from
// client/, so a path relative to the working directory would be wrong);
// client/scripts/mock-lan-cert.sh makes them from the dev CA.
function devServerHttps() {
  const cert = process.env.WPU_MOCK_HTTPS_CERT
  const key = process.env.WPU_MOCK_HTTPS_KEY
  if (!cert || !key) {
    return undefined
  }
  return {
    cert: readFileSync(path.resolve(REPO_ROOT, cert)),
    key: readFileSync(path.resolve(REPO_ROOT, key)),
  }
}

export default mergeConfig(
  baseConfig,
  defineConfig({
    server: { https: devServerHttps() },
    define: {
      'import.meta.env.VITE_MOCK': JSON.stringify('1'),
    },
    plugins: [mockEntry(), mockServiceWorker()],
    build: {
      outDir: fileURLToPath(
        new URL('../dev/.build/mock-dist', import.meta.url),
      ),
      emptyOutDir: true,
    },
  }),
)
