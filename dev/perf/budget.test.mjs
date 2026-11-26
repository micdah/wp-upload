// node --test 'dev/perf/*.test.mjs' (run by `dev/run test unit`): the perf budget and D46's report-only mode.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BUDGET_COLLECTION_GZIP_BYTES,
  BUDGET_P95_MS,
  budgetFailures,
  exitCodeFor,
  reportOnlyFrom,
} from './budget.mjs'

const fast = {
  name: 'plugin collection (all)',
  route: '/wp-upload/v1/collection',
  budgeted: true,
  p95: BUDGET_P95_MS,
  gzipBytes: BUDGET_COLLECTION_GZIP_BYTES,
}

test('a run within the budget has no failures and exits 0', () => {
  const failures = budgetFailures([fast])
  assert.deepEqual(failures, [])
  assert.equal(exitCodeFor(failures, false), 0)
})

test('a slow budgeted request or a large payload fails a local run', () => {
  const failures = budgetFailures([
    {
      ...fast,
      p95: BUDGET_P95_MS + 1,
      gzipBytes: BUDGET_COLLECTION_GZIP_BYTES + 1,
    },
    {
      ...fast,
      name: 'core media',
      route: '/wp/v2/media',
      budgeted: false,
      p95: 5000,
    },
  ])
  assert.equal(failures.length, 2)
  assert.match(failures[0], /p95 301 ms > 300 ms/)
  assert.match(failures[1], /collection payload/)
  assert.equal(exitCodeFor(failures, false), 1)
})

test('report-only (the [perf] CI job) records failures but exits 0', () => {
  const failures = budgetFailures([{ ...fast, p95: 900 }])
  assert.equal(failures.length, 1)
  assert.equal(exitCodeFor(failures, true), 0)
})

test('report-only is on only for WPU_PERF_REPORT_ONLY=true', () => {
  assert.equal(reportOnlyFrom({ WPU_PERF_REPORT_ONLY: 'true' }), true)
  assert.equal(reportOnlyFrom({ WPU_PERF_REPORT_ONLY: 'false' }), false)
  assert.equal(reportOnlyFrom({ WPU_PERF_REPORT_ONLY: '1' }), false)
  assert.equal(reportOnlyFrom({}), false)
})
