// The `perf` suite (implementation plan §9, spike X4). Run by `dev/run test perf` inside the
// runner, against the test stack restored to the `large` seed (50k attachments, 300 folders,
// 5k posts). Never shipped.
//
// It times requests to WordPress over the stack's TLS proxy, as the app makes them:
// - with the companion plugin (wp-upload/v1 with the `collection` feature): /collection,
//   /facets and the Uncategorized query (folder=0), checked against the budget
//   (p95 <= 300 ms at 50k); a run over budget fails, except in report-only mode
//   (WPU_PERF_REPORT_ONLY=true, the `[perf]` CI job, D46), which records it and exits 0;
// - always, as a baseline: core REST /wp/v2/media (a page of 100, and a search) and FileBird's
//   folder tree with its own count queries (filebird/v1/get-folders). The baseline never
//   fails the suite.
//
// FileBird's Uncategorized and folder lists can't be requested over core REST (its `fbv`
// variable only reaches WP_Query from the media library), so `dev/run` times them in-process
// first (dev/wordpress/perf/filebird-queries.php) and this report includes that file.
//
// Each request runs WARMUP_RUNS times untimed, then RUNS times one after another. Results go
// to $WPU_SUITE_RESULTS_DIR/perf.json and perf.md.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import {
  BUDGET_P95_MS,
  budgetFailures,
  exitCodeFor,
  reportOnlyFrom,
} from './budget.mjs'

const RUNS = Number(process.env.WPU_PERF_RUNS ?? 20)
const WARMUP_RUNS = 2
const REPORT_ONLY = reportOnlyFrom(process.env)
const MAINTENANCE_TIMEOUT_MS = 15 * 60 * 1000
const IN_PROCESS_FILE = 'filebird-in-process.json'

const wordpressUrl = requiredEnv('WPU_WP_URL').replace(/\/$/, '')
const resultsDir = requiredEnv('WPU_SUITE_RESULTS_DIR')
const authorization = `Basic ${Buffer.from(
  `${requiredEnv('WPU_APP_USER')}:${requiredEnv('WPU_APP_PASSWORD')}`,
).toString('base64')}`

function requiredEnv(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} isn't set; run this through 'dev/run test perf'.`)
  }
  return value
}

async function request(route, init = {}) {
  const started = performance.now()
  const response = await fetch(`${wordpressUrl}/wp-json${route}`, {
    ...init,
    headers: {
      authorization,
      'accept-encoding': 'gzip',
      ...(init.headers ?? {}),
    },
  })
  const body = await response.text()
  return {
    status: response.status,
    ms: performance.now() - started,
    body,
    total: response.headers.get('x-wp-total'),
  }
}

async function getJson(route) {
  const response = await request(route)
  if (response.status !== 200) {
    return { status: response.status, data: null }
  }
  return { status: 200, data: JSON.parse(response.body) }
}

function percentile(sortedValues, fraction) {
  const index = Math.ceil(fraction * sortedValues.length) - 1
  return sortedValues[Math.min(sortedValues.length - 1, Math.max(0, index))]
}

async function measure(name, route, budgeted) {
  for (let run = 0; run < WARMUP_RUNS; run++) {
    await request(route)
  }
  const timings = []
  let last = null
  for (let run = 0; run < RUNS; run++) {
    last = await request(route)
    if (last.status !== 200) {
      throw new Error(
        `${name}: ${route} answered ${last.status}: ${last.body.slice(0, 300)}`,
      )
    }
    timings.push(last.ms)
  }
  const sorted = [...timings].sort((a, b) => a - b)
  const round = (value) => Math.round(value * 10) / 10
  const result = {
    name,
    route,
    budgeted,
    runs: RUNS,
    p50: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    max: round(sorted[sorted.length - 1]),
    mean: round(
      timings.reduce((sum, value) => sum + value, 0) / timings.length,
    ),
    bytes: Buffer.byteLength(last.body),
    gzipBytes: gzipSync(last.body).length,
    total: last.total,
  }
  console.log(
    `${name.padEnd(36)} p50 ${String(result.p50).padStart(7)} ms  p95 ${String(result.p95).padStart(7)} ms  max ${String(result.max).padStart(7)} ms  ${result.gzipBytes} B gzip`,
  )
  return result
}

// The plugin's index must be complete, or /collection measures a backfill (contract §5.21).
async function finishCompanionMaintenance() {
  const deadline = Date.now() + MAINTENANCE_TIMEOUT_MS
  let steps = 0
  while (Date.now() < deadline) {
    const response = await request('/wp-upload/v1/maintenance/step', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ budgetMs: 20000 }),
    })
    if (response.status !== 200) {
      console.log(
        `maintenance step answered ${response.status}; measuring anyway`,
      )
      return steps
    }
    steps++
    const step = JSON.parse(response.body)
    if (!step.more) {
      return steps
    }
  }
  throw new Error('The companion index was not ready within 15 minutes.')
}

// The FileBird folder with the most items, for the single-folder queries: from the in-process
// run when there is one, else from FileBird's own per-folder counts.
function biggestFolderId(inProcess, getFoldersResponse) {
  if (inProcess?.folderId) {
    return inProcess.folderId
  }
  const counts = getFoldersResponse?.attachmentsCount
  let best = null
  if (counts && typeof counts === 'object') {
    for (const [id, count] of Object.entries(counts.display ?? counts)) {
      if (Number(id) > 0 && (best === null || Number(count) > best.count)) {
        best = { id: Number(id), count: Number(count) }
      }
    }
  }
  if (best) {
    return best.id
  }
  return getFoldersResponse?.tree?.[0]?.id ?? null
}

function readInProcessResults() {
  const file = path.join(resultsDir, IN_PROCESS_FILE)
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
}

function markdownReport(results, inProcess, plugin, folderId, failures) {
  const lines = [
    '# perf (large seed)',
    '',
    `${RUNS} timed runs per request after ${WARMUP_RUNS} warm-up runs, sequential, through the test proxy (TLS).`,
    REPORT_ONLY
      ? 'Report-only run (D46): the budget is recorded, not enforced.'
      : 'The budget is enforced: a run over it fails.',
    `Companion plugin: ${plugin ? `version ${plugin.version}, api ${plugin.api}` : 'not available (baseline only)'}. Folder used: ${folderId ?? 'none'}.`,
    '',
    '| Request | Route | p50 ms | p95 ms | max ms | gzip bytes | X-WP-Total | Budget |',
    '|---|---|---|---|---|---|---|---|',
  ]
  for (const result of results) {
    const budget = result.budgeted
      ? result.p95 <= BUDGET_P95_MS
        ? `ok (p95 <= ${BUDGET_P95_MS})`
        : `**over** (p95 > ${BUDGET_P95_MS})`
      : 'baseline'
    lines.push(
      `| ${result.name} | \`${result.route}\` | ${result.p50} | ${result.p95} | ${result.max} | ${result.gzipBytes} | ${result.total ?? ''} | ${budget} |`,
    )
  }
  if (inProcess) {
    lines.push(
      '',
      `FileBird's own queries, in-process through wp-cli (no HTTP; ${IN_PROCESS_FILE}):`,
      '',
      '| Query | p50 ms | p95 ms | max ms | rows |',
      '|---|---|---|---|---|',
    )
    for (const result of inProcess.results) {
      lines.push(
        `| ${result.name} | ${result.p50} | ${result.p95} | ${result.max} | ${result.rows} |`,
      )
    }
  }
  if (failures.length) {
    lines.push(
      '',
      REPORT_ONLY ? '**Over budget (report-only):**' : '**Over budget:**',
      ...failures.map((failure) => `- ${failure}`),
    )
  }
  return `${lines.join('\n')}\n`
}

async function main() {
  mkdirSync(resultsDir, { recursive: true })
  const results = []
  const failures = []

  const info = await getJson('/wp-upload/v1/info')
  const plugin =
    info.status === 200 && info.data?.features?.includes('collection')
      ? info.data
      : null

  const inProcess = readInProcessResults()
  const folders = await getJson('/filebird/v1/get-folders')
  const folderId = biggestFolderId(inProcess, folders.data)

  if (plugin) {
    if (plugin.features.includes('maintenance')) {
      const steps = await finishCompanionMaintenance()
      console.log(`companion index ready after ${steps} maintenance step(s)`)
    }
    results.push(
      await measure(
        'plugin collection (all)',
        '/wp-upload/v1/collection',
        true,
      ),
    )
    results.push(
      await measure(
        'plugin collection (Uncategorized)',
        '/wp-upload/v1/collection?folder=0',
        true,
      ),
    )
    if (plugin.features.includes('facets')) {
      results.push(
        await measure('plugin facets (all)', '/wp-upload/v1/facets', true),
      )
      results.push(
        await measure(
          'plugin facets (Uncategorized)',
          '/wp-upload/v1/facets?folder=0',
          true,
        ),
      )
    }
    if (folderId) {
      results.push(
        await measure(
          'plugin collection (one folder)',
          `/wp-upload/v1/collection?folder=${folderId}`,
          false,
        ),
      )
    }
    results.push(
      await measure(
        'plugin collection (search)',
        '/wp-upload/v1/collection?q=harbour',
        false,
      ),
    )
  } else {
    console.log(
      'The companion plugin (wp-upload/v1 with the collection feature) is not available: baseline only.',
    )
  }

  results.push(
    await measure('core media (all, 100)', '/wp/v2/media?per_page=100', false),
  )
  results.push(
    await measure(
      'core media (search)',
      '/wp/v2/media?per_page=100&search=harbour',
      false,
    ),
  )
  if (folders.status === 200) {
    results.push(
      await measure(
        'FileBird get-folders (tree + counts)',
        '/filebird/v1/get-folders',
        false,
      ),
    )
  }

  failures.push(...budgetFailures(results))

  writeFileSync(
    path.join(resultsDir, 'perf.json'),
    `${JSON.stringify({ runs: RUNS, reportOnly: REPORT_ONLY, plugin, folderId, results, inProcess, failures }, null, 2)}\n`,
  )
  writeFileSync(
    path.join(resultsDir, 'perf.md'),
    markdownReport(results, inProcess, plugin, folderId, failures),
  )
  console.log(`\nReport: ${path.join(resultsDir, 'perf.md')}`)
  if (failures.length) {
    const label = REPORT_ONLY
      ? 'Over budget (report-only, not failing)'
      : 'Over budget'
    console.error(`${label}:\n- ${failures.join('\n- ')}`)
  }
  process.exitCode = exitCodeFor(failures, REPORT_ONLY)
}

await main()
