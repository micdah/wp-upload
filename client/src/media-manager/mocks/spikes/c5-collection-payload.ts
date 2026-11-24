// Spike C5: the 50k collection payload (implementation plan §10).
//
// Measures, for a generated library of 50k (and 100k) items:
// - the size of `GET collection` as JSON, gzip (level 6, what the
//   `compression` middleware uses) and brotli (quality 4, its default);
// - in Node: JSON.parse, the Uint32Array copy, the id → index map, and an
//   optimistic removal;
// - in Chromium (with `--browser`): fetch + parse on first load, and the ETag
//   revalidation path (If-None-Match → 304 → the cached body), counting what
//   the server saw.
//
// Run from the repo root (Node 24+ runs the TypeScript directly):
//   node client/src/media-manager/mocks/spikes/c5-collection-payload.ts --browser
// Results: docs/media-manager/tracks/spikes/C5.md.

import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { createRequire } from 'node:module'
import { performance } from 'node:perf_hooks'
import { brotliCompressSync, constants, gzipSync } from 'node:zlib'
import {
  type CollectionResponse,
  MEDIA_KINDS,
  ROW_STRIDE,
} from '../../../../../shared/library-api.ts'
import { generateDataset } from '../fake/generate.ts'
import type { FakeItem } from '../fake/types.ts'

const SIZES = [50_000, 100_000]
const RUNS = 15

type Sort = 'date-desc' | 'title-asc'

/** `GET collection` as the server would serialise it. */
function payload(items: readonly FakeItem[], sort: Sort): string {
  const ordered = [...items].sort((a, b) =>
    sort === 'date-desc'
      ? b.uploadedAt - a.uploadedAt || b.id - a.id
      : a.title.localeCompare(b.title) || a.id - b.id,
  )
  const rows: number[] = []
  for (const item of ordered) {
    rows.push(item.id, item.width, item.height, MEDIA_KINDS.indexOf(item.kind))
  }
  const response: CollectionResponse = {
    rev: '1795867200000',
    query: {
      folder: 'all',
      q: null,
      type: null,
      alt: null,
      size: null,
      orient: null,
      month: null,
      sort,
    },
    total: ordered.length,
    rows,
    indexComplete: true,
  }
  return JSON.stringify(response)
}

/** Median wall time of `run` in ms. */
function median(run: () => void, runs = RUNS): number {
  const times: number[] = []
  for (let index = 0; index < runs; index++) {
    const start = performance.now()
    run()
    times.push(performance.now() - start)
  }
  times.sort((a, b) => a - b)
  return times[Math.floor(times.length / 2)] ?? 0
}

function kb(bytes: number): string {
  return `${(bytes / 1024).toFixed(0)} kB`
}

function ms(value: number): string {
  return `${value.toFixed(1)} ms`
}

function measureSizes(json: string): Record<string, string> {
  const raw = Buffer.from(json)
  return {
    json: kb(raw.length),
    gzip6: kb(gzipSync(raw, { level: 6 }).length),
    brotli4: kb(
      brotliCompressSync(raw, {
        params: { [constants.BROTLI_PARAM_QUALITY]: 4 },
      }).length,
    ),
    brotli11: kb(
      brotliCompressSync(raw, {
        params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
      }).length,
    ),
  }
}

function measureNode(json: string): Record<string, string> {
  const parsed = JSON.parse(json) as CollectionResponse
  const rows = Uint32Array.from(parsed.rows)
  const removeIds = new Set<number>()
  for (let index = 0; index < 100; index++) {
    removeIds.add(rows[index * 50 * ROW_STRIDE] ?? 0)
  }
  return {
    parse: ms(median(() => JSON.parse(json))),
    toUint32Array: ms(median(() => Uint32Array.from(parsed.rows))),
    positionMap: ms(
      median(() => {
        const map = new Map<number, number>()
        for (let index = 0; index < parsed.total; index++) {
          map.set(rows[index * ROW_STRIDE] ?? 0, index)
        }
      }),
    ),
    remove100: ms(
      median(() => {
        const kept = new Uint32Array(rows.length)
        let length = 0
        for (let index = 0; index < parsed.total; index++) {
          const offset = index * ROW_STRIDE
          if (!removeIds.has(rows[offset] ?? 0)) {
            kept.set(
              rows.subarray(offset, offset + ROW_STRIDE),
              length * ROW_STRIDE,
            )
            length++
          }
        }
      }),
    ),
  }
}

interface ServerStats {
  full: number
  notModified: number
}

/** Serves payloads like the server: gzip, `private, no-cache`, weak ETag, 304. */
function startServer(
  payloads: Map<string, string>,
  stats: ServerStats,
): Promise<Server> {
  const bodies = new Map<string, { gzip: Buffer; etag: string }>()
  for (const [path, json] of payloads) {
    const hash = createHash('sha1').update(json).digest('hex').slice(0, 12)
    bodies.set(path, {
      gzip: gzipSync(Buffer.from(json), { level: 6 }),
      etag: `W/"1795867200000-${hash}"`,
    })
  }
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://x').pathname
    if (path === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html' })
      response.end('<!doctype html><title>C5</title>')
      return
    }
    const body = bodies.get(path)
    if (!body) {
      response.writeHead(404)
      response.end()
      return
    }
    const headers = {
      'Cache-Control': 'private, no-cache',
      ETag: body.etag,
      Vary: 'Accept-Encoding',
    }
    if (request.headers['if-none-match'] === body.etag) {
      stats.notModified++
      response.writeHead(304, headers)
      response.end()
      return
    }
    stats.full++
    response.writeHead(200, {
      ...headers,
      'Content-Type': 'application/json',
      'Content-Encoding': 'gzip',
      'Content-Length': String(body.gzip.length),
    })
    response.end(body.gzip)
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server))
  })
}

/** Runs in the page: fetch, read, parse, convert, index — timed separately. */
async function browserLoad(path: string) {
  const stride = 4
  const start = performance.now()
  const response = await fetch(path)
  const fetched = performance.now()
  const text = await response.text()
  const read = performance.now()
  const parsed = JSON.parse(text) as { total: number; rows: number[] }
  const parsedAt = performance.now()
  const rows = Uint32Array.from(parsed.rows)
  const converted = performance.now()
  const map = new Map<number, number>()
  for (let index = 0; index < parsed.total; index++) {
    map.set(rows[index * stride] ?? 0, index)
  }
  const indexed = performance.now()
  return {
    status: response.status,
    fetch: fetched - start,
    read: read - fetched,
    parse: parsedAt - read,
    toUint32Array: converted - parsedAt,
    positionMap: indexed - converted,
    total: indexed - start,
  }
}

async function measureBrowser(payloads: Map<string, string>) {
  const require = createRequire(
    new URL('../../../../package.json', import.meta.url),
  )
  const { chromium } = require('playwright') as typeof import('playwright')
  const stats: ServerStats = { full: 0, notModified: 0 }
  const server = await startServer(payloads, stats)
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${port}/`)
  const results: Record<string, unknown> = {}
  for (const path of payloads.keys()) {
    const before = { ...stats }
    const loads = []
    for (let run = 0; run < 6; run++) {
      loads.push(await page.evaluate(browserLoad, path))
    }
    results[path] = {
      first: loads[0],
      revalidatedMedian: loads.slice(1).sort((a, b) => a.total - b.total)[2],
      server: {
        full: stats.full - before.full,
        notModified: stats.notModified - before.notModified,
      },
    }
  }
  await browser.close()
  server.close()
  return results
}

async function main(): Promise<void> {
  const withBrowser = process.argv.includes('--browser')
  const payloads = new Map<string, string>()
  const report: Record<string, unknown> = {}
  for (const size of SIZES) {
    const start = performance.now()
    const { items } = generateDataset({ items: size })
    const generated = performance.now() - start
    for (const sort of ['date-desc', 'title-asc'] as const) {
      const json = payload(items, sort)
      payloads.set(`/collection-${size}-${sort}`, json)
      report[`${size} ${sort}`] = {
        generate: ms(generated),
        sizes: measureSizes(json),
        node: measureNode(json),
      }
    }
  }
  console.log(JSON.stringify(report, null, 2))
  if (withBrowser) {
    console.log(JSON.stringify(await measureBrowser(payloads), null, 2))
  }
}

await main()
