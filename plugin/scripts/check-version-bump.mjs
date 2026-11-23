#!/usr/bin/env node
// Fails when shipped plugin source changed since a base commit without a
// WPU_VERSION bump (implementation plan §2.6). Only files under
// plugin/wp-upload-companion/ count: tests, scripts and the changelog don't
// ship, so they never force a release.
//
// Usage: node plugin/scripts/check-version-bump.mjs --base <commit>
// Run by `dev/run test version-bump` in the orchestrator's post-merge gate
// and in CI; tracks never run it, because only the orchestrator bumps.
import { execFileSync } from 'node:child_process'

const SHIPPED_SOURCE = 'plugin/wp-upload-companion/'
const ENTRY_FILE = 'plugin/wp-upload-companion/wp-upload-companion.php'
const VERSION_PATTERN = /^const WPU_VERSION = '([^']+)';$/m

function readBaseCommit(argv) {
  const index = argv.indexOf('--base')
  const baseCommit = index === -1 ? undefined : argv[index + 1]
  if (!baseCommit) {
    console.error('Usage: check-version-bump.mjs --base <commit>')
    process.exit(2)
  }
  return baseCommit
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' })
}

// The entry file's WPU_VERSION at a commit, or null when the file doesn't
// exist there yet (the plugin's first commit counts as a bump).
function versionAt(commit) {
  let source
  try {
    source = git('show', `${commit}:${ENTRY_FILE}`)
  } catch {
    return null
  }
  const match = source.match(VERSION_PATTERN)
  if (!match) {
    throw new Error(`${ENTRY_FILE} at ${commit} has no WPU_VERSION constant`)
  }
  return match[1]
}

function changedShippedFiles(baseCommit) {
  return git('diff', '--name-only', baseCommit, 'HEAD', '--', SHIPPED_SOURCE)
    .split('\n')
    .filter((line) => line !== '')
}

const baseCommit = readBaseCommit(process.argv.slice(2))
const changedFiles = changedShippedFiles(baseCommit)
if (changedFiles.length === 0) {
  console.log('No shipped plugin source changed; no version bump needed.')
  process.exit(0)
}

const baseVersion = versionAt(baseCommit)
const headVersion = versionAt('HEAD')
if (baseVersion === null) {
  console.log(`Plugin added at version ${headVersion}.`)
  process.exit(0)
}
if (baseVersion === headVersion) {
  console.error(
    `Shipped plugin source changed but WPU_VERSION is still ${headVersion}.`,
  )
  console.error('Changed files:')
  for (const file of changedFiles) {
    console.error(`  ${file}`)
  }
  console.error(`Bump WPU_VERSION and the header Version in ${ENTRY_FILE}.`)
  process.exit(1)
}
console.log(`WPU_VERSION bumped: ${baseVersion} -> ${headVersion}.`)
