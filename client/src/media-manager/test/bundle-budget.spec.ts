import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'

// Runs client/scripts/bundle-budget.mjs (an in-memory production build) so
// `npm run test -w client`, and with it `dev/run test unit`, enforce the
// bundle budget of plan §9. The script's header explains the checks.

const run = promisify(execFile)
const script = fileURLToPath(
  new URL('../../../scripts/bundle-budget.mjs', import.meta.url),
)
const clientDir = fileURLToPath(new URL('../../../', import.meta.url))

interface BudgetReport {
  ok: boolean
  violations: string[]
  entry: { bytes: number; budget: number; files: string[] }
  mediaManager: {
    bytes: number
    budget: number
    files: Array<{ fileName: string; bytes: number }>
  }
}

describe('the bundle budget', () => {
  it('keeps the media manager lazy, small and free of mocks', async () => {
    let stdout: string
    try {
      ;({ stdout } = await run(process.execPath, [script, '--json'], {
        cwd: clientDir,
        maxBuffer: 16 * 1024 * 1024,
      }))
    } catch (error) {
      // Exit code 1 (a breach) still prints the report on stdout.
      stdout = (error as { stdout?: string }).stdout ?? ''
      if (!stdout) throw error
    }
    const report = JSON.parse(
      stdout.trim().split('\n').at(-1) ?? '{}',
    ) as BudgetReport
    expect(report.violations).toEqual([])
    expect(report.ok).toBe(true)
    expect(report.mediaManager.files.length).toBeGreaterThan(0)
    expect(report.entry.bytes).toBeLessThanOrEqual(report.entry.budget)
  }, 120_000)
})
