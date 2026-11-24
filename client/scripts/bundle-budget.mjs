#!/usr/bin/env node
// Bundle budget for the media manager (plan §9 and §8 "Bundle and URL guards").
//
// Builds the client in memory with the real vite.config.ts and checks:
//
//   1. The initial media-manager chunk — MediaManagerApp's chunk plus every
//      chunk and stylesheet it loads statically, minus what the entry already
//      loaded — is at most 150 kB gzip. The editor, palette, sheet, trash and
//      onboarding are meant to be nested lazy chunks, so they don't count.
//   2. No media-manager module is in the entry chunk (or anything the entry
//      loads statically): the old upload page must not pay for it.
//   3. The entry chunk grows by at most 5 kB gzip over the M0 baseline.
//   4. No mock code (MSW, client/src/media-manager/mocks) is in the build.
//
// Usage (from client/):
//   node scripts/bundle-budget.mjs          a report; exit code 1 on a breach
//   node scripts/bundle-budget.mjs --json   the same as JSON, for tests
//
// The unit test client/src/media-manager/test/bundle-budget.spec.ts runs it,
// so `npm run test -w client` (and `dev/run test unit`) enforce it.
//
// Sizes are gzip at zlib's default level, as Vite's build report prints them,
// in kB of 1000 bytes. Font files are reported but not counted: browsers
// fetch them on first use, per unicode-range subset.

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { build } from 'vite'

const KB = 1000

/** Plan §9: the initial media-manager chunk, JS plus CSS. */
const MEDIA_MANAGER_INITIAL_BUDGET = 150 * KB

/** Plan §9 / F3 brief: how much the entry chunk may grow over the baseline. */
const ENTRY_GROWTH_BUDGET = 5 * KB

/**
 * Gzip size of the entry chunk (JS and CSS the entry loads statically) at
 * the M0 scaffold (feature/media-manager @ e09ac4f), measured by this script.
 * Raise it only on purpose, with the reason in the commit message.
 */
const ENTRY_BASELINE = 69_101

/** The media manager's lazy entry module, relative to client/. */
const MEDIA_MANAGER_ENTRY = 'src/media-manager/app/MediaManagerApp.tsx'

/** Source paths that must never reach the entry chunk. */
const MEDIA_MANAGER_SOURCE = 'src/media-manager/'

/** Modules that must never be in a production build. */
const MOCK_MODULE_PATTERNS = [
  '/node_modules/msw/',
  '/node_modules/@mswjs/',
  '/src/media-manager/mocks/',
]

const clientDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)

// Builds the production bundle in memory (nothing is written to dist/) and
// returns Rollup's output: chunks with their module ids, and assets.
async function buildInMemory() {
  // Vite keeps an inherited NODE_ENV (Vitest sets `test`), which would
  // bundle React's development build and measure the wrong thing.
  process.env.NODE_ENV = 'production'
  const result = await build({
    root: clientDir,
    mode: 'production',
    logLevel: 'warn',
    build: { write: false },
  })
  const outputs = Array.isArray(result) ? result : [result]
  return outputs.flatMap((output) => output.output)
}

function gzipBytes(source) {
  return gzipSync(typeof source === 'string' ? Buffer.from(source) : source)
    .length
}

// Index the output by file name, so chunk imports (which are file names) can
// be followed.
function indexOutput(output) {
  const byFileName = new Map()
  for (const item of output) {
    byFileName.set(item.fileName, item)
  }
  return byFileName
}

// The chunk and every chunk it imports statically, transitively: what the
// browser must load before the chunk's code can run.
function staticClosure(startChunk, byFileName) {
  const seen = new Set()
  const pending = [startChunk.fileName]
  while (pending.length > 0) {
    const fileName = pending.pop()
    if (seen.has(fileName)) {
      continue
    }
    seen.add(fileName)
    const chunk = byFileName.get(fileName)
    for (const imported of chunk?.imports ?? []) {
      pending.push(imported)
    }
  }
  return seen
}

// The stylesheets Vite attaches to a set of chunks (loaded with them).
function cssOf(chunkFileNames, byFileName) {
  const css = new Set()
  for (const fileName of chunkFileNames) {
    const chunk = byFileName.get(fileName)
    for (const cssFile of chunk?.viteMetadata?.importedCss ?? []) {
      css.add(cssFile)
    }
  }
  return css
}

function sizeOf(fileNames, byFileName) {
  let total = 0
  for (const fileName of fileNames) {
    const item = byFileName.get(fileName)
    total += gzipBytes(item.type === 'chunk' ? item.code : item.source)
  }
  return total
}

function relativeModuleId(moduleId) {
  return path.relative(clientDir, moduleId).split(path.sep).join('/')
}

function findEntryChunk(output) {
  const entries = output.filter((item) => item.type === 'chunk' && item.isEntry)
  if (entries.length !== 1) {
    throw new Error(`Expected one entry chunk, found ${entries.length}`)
  }
  return entries[0]
}

function findMediaManagerChunk(output) {
  return output.find(
    (item) =>
      item.type === 'chunk' &&
      item.isDynamicEntry &&
      item.facadeModuleId &&
      relativeModuleId(item.facadeModuleId) === MEDIA_MANAGER_ENTRY,
  )
}

// Runs every check and returns the measurements plus a list of breaches.
export async function checkBundleBudget() {
  const output = await buildInMemory()
  const byFileName = indexOutput(output)
  const violations = []

  const entryChunk = findEntryChunk(output)
  const entryChunks = staticClosure(entryChunk, byFileName)
  const entryFiles = new Set([
    ...entryChunks,
    ...cssOf(entryChunks, byFileName),
  ])
  const entryBytes = sizeOf(entryFiles, byFileName)
  if (entryBytes > ENTRY_BASELINE + ENTRY_GROWTH_BUDGET) {
    violations.push(
      `The entry chunk is ${format(entryBytes)} gzip, more than ${format(ENTRY_GROWTH_BUDGET)} over its baseline of ${format(ENTRY_BASELINE)}.`,
    )
  }

  const mediaManagerInEntry = [...entryChunks].flatMap((fileName) =>
    byFileName
      .get(fileName)
      .moduleIds.map(relativeModuleId)
      .filter((moduleId) => moduleId.startsWith(MEDIA_MANAGER_SOURCE)),
  )
  if (mediaManagerInEntry.length > 0) {
    violations.push(
      `Media-manager code is in the entry chunk: ${mediaManagerInEntry.join(', ')}`,
    )
  }

  const mediaManagerChunk = findMediaManagerChunk(output)
  let mediaManagerFiles = new Set()
  let mediaManagerBytes = 0
  if (!mediaManagerChunk) {
    violations.push(
      `No lazy chunk has ${MEDIA_MANAGER_ENTRY} as its entry; is it still loaded with import()?`,
    )
  } else {
    const closure = staticClosure(mediaManagerChunk, byFileName)
    const ownChunks = [...closure].filter(
      (fileName) => !entryFiles.has(fileName),
    )
    const ownCss = [...cssOf(ownChunks, byFileName)].filter(
      (fileName) => !entryFiles.has(fileName),
    )
    mediaManagerFiles = new Set([...ownChunks, ...ownCss])
    mediaManagerBytes = sizeOf(mediaManagerFiles, byFileName)
    if (mediaManagerBytes > MEDIA_MANAGER_INITIAL_BUDGET) {
      violations.push(
        `The initial media-manager chunk is ${format(mediaManagerBytes)} gzip, over its budget of ${format(MEDIA_MANAGER_INITIAL_BUDGET)}.`,
      )
    }
  }

  const mockModules = output
    .filter((item) => item.type === 'chunk')
    .flatMap((chunk) => chunk.moduleIds)
    .filter((moduleId) =>
      MOCK_MODULE_PATTERNS.some((pattern) => moduleId.includes(pattern)),
    )
    .map(relativeModuleId)
  if (mockModules.length > 0) {
    violations.push(
      `Mock code is in the production build: ${mockModules.join(', ')}`,
    )
  }

  const fontFiles = output.filter(
    (item) => item.type === 'asset' && /\.woff2?$/.test(item.fileName),
  )

  return {
    ok: violations.length === 0,
    violations,
    entry: {
      bytes: entryBytes,
      baseline: ENTRY_BASELINE,
      budget: ENTRY_BASELINE + ENTRY_GROWTH_BUDGET,
      files: [...entryFiles],
    },
    mediaManager: {
      bytes: mediaManagerBytes,
      budget: MEDIA_MANAGER_INITIAL_BUDGET,
      files: [...mediaManagerFiles].map((fileName) => ({
        fileName,
        bytes: sizeOf([fileName], byFileName),
      })),
      lazyChunks: (mediaManagerChunk?.dynamicImports ?? []).map((fileName) => ({
        fileName,
        bytes: sizeOf([fileName], byFileName),
      })),
    },
    fonts: {
      files: fontFiles.length,
      bytes: fontFiles.reduce((total, font) => total + font.source.length, 0),
    },
  }
}

function format(bytes) {
  return `${(bytes / KB).toFixed(2)} kB`
}

function printReport(report) {
  const lines = [
    'Bundle budget (gzip)',
    `  entry chunk            ${format(report.entry.bytes)}  (budget ${format(report.entry.budget)}, baseline ${format(report.entry.baseline)})`,
    `  initial media manager  ${format(report.mediaManager.bytes)}  (budget ${format(report.mediaManager.budget)})`,
  ]
  for (const file of report.mediaManager.files) {
    lines.push(`    ${file.fileName}  ${format(file.bytes)}`)
  }
  for (const file of report.mediaManager.lazyChunks) {
    lines.push(`    lazy: ${file.fileName}  ${format(file.bytes)}`)
  }
  lines.push(
    `  fonts (not counted)    ${report.fonts.files} files, ${format(report.fonts.bytes)}`,
  )
  if (report.ok) {
    lines.push('Within budget.')
  } else {
    lines.push('Over budget:')
    for (const violation of report.violations) {
      lines.push(`  - ${violation}`)
    }
  }
  console.log(lines.join('\n'))
}

// Runs the checks when called as a script (not when imported).
async function main() {
  const report = await checkBundleBudget()
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report))
  } else {
    printReport(report)
  }
  if (!report.ok) {
    process.exitCode = 1
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
