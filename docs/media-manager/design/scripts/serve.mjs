// Tiny static file server for the design prototype. ES modules and the SVG
// sprite need http(s), not file://, so open the prototype through this.
//
// Usage: node docs/media-manager/design/scripts/serve.mjs [--port 4321] [--host 127.0.0.1]
// Then open http://localhost:4321/prototype/
//
// It binds to 127.0.0.1 by default. To open the prototype from another device
// (e.g. when it runs on a remote machine), pass --host 0.0.0.0 and allow the
// port in your firewall. It only serves the design folder, read-only.

import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const designDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
function option(name) {
  const index = process.argv.indexOf(name)
  return index === -1 ? undefined : process.argv[index + 1]
}
const port = Number(option('--port') ?? process.env.PORT ?? 4321)
const host = option('--host') ?? process.env.HOST ?? '127.0.0.1'

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.md': 'text/markdown; charset=utf-8',
}

// Resolves a URL path inside the design folder, refusing anything outside it.
// A folder requested without its trailing slash gets a redirect, because the
// prototype's relative URLs (css/…, js/…) only resolve from inside the folder.
function resolveRequest(url) {
  const [rawPath, query = ''] = url.split('?')
  let decoded
  try {
    decoded = decodeURIComponent(rawPath)
  } catch {
    return {}
  }
  let filePath = path.normalize(path.join(designDir, decoded))
  if (filePath !== designDir && !filePath.startsWith(designDir + path.sep)) {
    return {}
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    if (!rawPath.endsWith('/')) {
      return { redirect: `${rawPath}/${query ? `?${query}` : ''}` }
    }
    filePath = path.join(filePath, 'index.html')
  }
  return fs.existsSync(filePath) ? { filePath } : {}
}

function handleRequest(request, response) {
  if (request.url === '/') {
    response.writeHead(302, { Location: '/prototype/' })
    response.end()
    return
  }
  const { filePath, redirect } = resolveRequest(request.url)
  if (redirect) {
    response.writeHead(301, { Location: redirect })
    response.end()
    return
  }
  if (!filePath) {
    response.writeHead(404, { 'Content-Type': 'text/plain' })
    response.end('Not found')
    return
  }
  const type =
    CONTENT_TYPES[path.extname(filePath)] ?? 'application/octet-stream'
  response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' })
  fs.createReadStream(filePath).pipe(response)
}

// Starts the server; resolves with its base URL. Used by screenshots.mjs too.
export function startServer(listenPort = port, listenHost = '127.0.0.1') {
  const server = http.createServer(handleRequest)
  return new Promise((resolve) => {
    server.listen(listenPort, listenHost, () => {
      const { port: actualPort } = server.address()
      resolve({ server, url: `http://localhost:${actualPort}` })
    })
  })
}

const runDirectly = process.argv[1] === fileURLToPath(import.meta.url)
if (runDirectly) {
  await startServer(port, host)
  const shownHost = host === '0.0.0.0' ? '<this-machine>' : host
  console.log(`Design prototype: http://${shownHost}:${port}/prototype/`)
}
