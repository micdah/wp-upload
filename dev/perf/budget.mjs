// The perf budget (implementation plan §9) and what a run over it does (D46). Kept apart from
// measure.mjs so `node --test 'dev/perf/*.test.mjs'` can check it without a stack. Never shipped.

export const BUDGET_P95_MS = 300
export const BUDGET_COLLECTION_GZIP_BYTES = 250_000

/** The budget lines a run broke: a budgeted request's p95, or the collection payload. */
export function budgetFailures(results) {
  const failures = []
  for (const result of results) {
    if (result.budgeted && result.p95 > BUDGET_P95_MS) {
      failures.push(
        `${result.name}: p95 ${result.p95} ms > ${BUDGET_P95_MS} ms`,
      )
    }
  }
  const collection = results.find(
    (result) => result.route === '/wp-upload/v1/collection',
  )
  if (collection && collection.gzipBytes > BUDGET_COLLECTION_GZIP_BYTES) {
    failures.push(
      `collection payload ${collection.gzipBytes} B gzip > ${BUDGET_COLLECTION_GZIP_BYTES} B`,
    )
  }
  return failures
}

/**
 * D46: local runs enforce the budget (this machine is the reference), so a run over it fails.
 * The `[perf]` CI job is report-only (`WPU_PERF_REPORT_ONLY=true`): GitHub's runners are
 * slower, so it records and uploads the numbers and never fails on the budget.
 */
export function reportOnlyFrom(env) {
  return env.WPU_PERF_REPORT_ONLY === 'true'
}

/** The process exit code for a finished run. */
export function exitCodeFor(failures, reportOnly) {
  return failures.length > 0 && !reportOnly ? 1 : 0
}
