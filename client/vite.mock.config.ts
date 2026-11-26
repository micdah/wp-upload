// The `VITE_MOCK` build: the real app plus the mock backend
// (src/media-manager/mocks), for e2e-mock and for working without WordPress.
//
//   npx vite --config vite.mock.config.ts          # dev server with mocks
//   npx vite build --config vite.mock.config.ts    # → dev/.build/mock-dist/
//
// It extends vite.config.ts (base './', so it works under any path, e.g. the
// test-mode proxy's /wp-upload-mock/) and changes four things:
// - index.html loads mocks/entry.ts, which starts MSW and then src/main.tsx;
// - the mock's service worker (mocks/serviceWorker.js as mock-sw.js) and
//   MSW's worker script are served in dev and emitted into this build only,
//   never into client/public (so the production build can't contain them);
// - the dev server never proxies `api/` or `session` to a real server: a
//   request the service worker didn't answer gets a 503 that says so (and
//   tells the watchdog, mocks/watchdog.ts, to restart the worker);
// - the output goes to dev/.build/mock-dist/ (M0 D handoff, CR-6).

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, mergeConfig, type Plugin, type UserConfig } from 'vite'
import {
  isBackendPath,
  MSW_SCRIPT,
  UNHANDLED_HEADER,
  WORKER_SCRIPT,
} from './src/media-manager/mocks/watchdog'
import baseConfig from './vite.config'

const APP_ENTRY = '/src/main.tsx'
const MOCK_ENTRY = '/src/media-manager/mocks/entry.ts'
const WORKER_SOURCE = new URL(
  './src/media-manager/mocks/serviceWorker.js',
  import.meta.url,
)

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

// Serves the two worker scripts in dev and emits them next to index.html in
// the build: the mock's own (mocks/serviceWorker.js) and MSW's, from the
// installed msw package (so it always matches its version).
function mockServiceWorker(): Plugin {
  const require = createRequire(import.meta.url)
  const scripts: Record<string, () => string> = {
    [WORKER_SCRIPT]: () => readFileSync(WORKER_SOURCE, 'utf8'),
    [MSW_SCRIPT]: () =>
      readFileSync(require.resolve(`msw/${MSW_SCRIPT}`), 'utf8'),
  }
  return {
    name: 'wpu-mock-service-worker',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = new URL(request.url ?? '/', 'http://localhost').pathname
        const script = Object.entries(scripts).find(([name]) =>
          path.endsWith(`/${name}`),
        )
        if (!script) {
          next()
          return
        }
        response.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'no-cache',
        })
        response.end(script[1]())
      })
    },
    generateBundle() {
      for (const [fileName, source] of Object.entries(scripts)) {
        this.emitFile({ type: 'asset', fileName, source: source() })
      }
    },
  }
}

// Mock mode has no server behind it. An `api/` or `session` request that
// reaches the dev server slipped past the service worker; answer it here
// (before Vite's own middlewares) instead of proxying it anywhere.
function unhandledBackendRequests(): Plugin {
  return {
    name: 'wpu-mock-unhandled-backend',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = new URL(request.url ?? '/', 'http://localhost').pathname
        if (!isBackendPath(path)) {
          next()
          return
        }
        server.config.logger.warn(
          `[mock] ${request.method} ${request.url} reached the dev server: the mock service worker did not answer it`,
          { timestamp: true },
        )
        response.writeHead(503, {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          [UNHANDLED_HEADER]: '1',
        })
        response.end(
          JSON.stringify({
            code: 'mock_worker_bypassed',
            message:
              'The mock service worker did not answer this request, so it reached the Vite dev server, which has no backend in mock mode.',
          }),
        )
      })
    },
  }
}

// vite.config.ts proxies `api/` and `session` to the real server; mock mode
// must never do that (mergeConfig can only add keys, so drop it first).
function withoutBackendProxy(config: UserConfig): UserConfig {
  const { proxy: _proxy, ...server } = config.server ?? {}
  return { ...config, server }
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
  withoutBackendProxy(baseConfig),
  defineConfig({
    server: { https: devServerHttps() },
    define: {
      'import.meta.env.VITE_MOCK': JSON.stringify('1'),
    },
    plugins: [mockEntry(), mockServiceWorker(), unhandledBackendRequests()],
    build: {
      outDir: fileURLToPath(
        new URL('../dev/.build/mock-dist', import.meta.url),
      ),
      emptyOutDir: true,
    },
  }),
)
