import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

// Playwright for the media manager (implementation plan §5, §8). Run it through
// `dev/run test e2e-mock` or `dev/run test e2e-live`: they start the test stack,
// build what the project needs and set the env below inside the runner.
//
// - mock: the VITE_MOCK build, served by the test proxy under /wp-upload-mock/
//   (WPU_MOCK_URL). No WordPress involved.
// - live: the production image under /wp-upload/ behind the prefix-stripping
//   proxy, against the stack's WordPress (WPU_APP_URL). This is where the
//   "deployable under any path" rule is tested on every run.
//
// Chromium for now: the runner trusts the stack's dev CA in Chromium's NSS
// database, not yet in Firefox's or WebKit's (open question in the D handoff).
// One exception: mock/keyboard.webkit.spec.ts runs the slice's keyboard flow
// in WebKit (iPad and desktop) inside the mock project, so `dev/run test
// e2e-mock` covers it. It sets `browserName: 'webkit'` itself and accepts the
// proxy's certificate, as it needs nothing else from the stack.
//
// Results go to WPU_SUITE_RESULTS_DIR (test-results/<suite>/ on the host).
// Traces are off by default; pass `-- --trace on` to dev/run to record them.

const resultsDir =
  process.env.WPU_SUITE_RESULTS_DIR ??
  path.resolve(import.meta.dirname, '../test-results/e2e')

const mockUrl = process.env.WPU_MOCK_URL
const liveUrl = process.env.WPU_APP_URL

export default defineConfig({
  testDir: '.',
  outputDir: path.join(resultsDir, 'artifacts'),
  forbidOnly: process.env.CI === 'true',
  // A flaky e2e test is a bug to fix, not to retry away.
  retries: 0,
  // Tests in one file run in order. Live specs share one WordPress and its
  // stack-wide variants, so `dev/run test e2e-live` also passes --workers=1.
  fullyParallel: false,
  reporter: [
    ['list'],
    ['junit', { outputFile: path.join(resultsDir, 'junit.xml') }],
    [
      'html',
      { outputFolder: path.join(resultsDir, 'html-report'), open: 'never' },
    ],
  ],
  use: {
    trace: 'off',
    screenshot: 'only-on-failure',
    // The dev CA is trusted inside the runner (NSS database), so certificate
    // errors are real errors.
    ignoreHTTPSErrors: false,
    timezoneId: 'UTC',
    locale: 'en-US',
  },
  projects: [
    {
      name: 'mock',
      testDir: './mock',
      use: { ...devices['Desktop Chrome'], baseURL: mockUrl },
    },
    {
      name: 'live',
      testDir: './live',
      use: { ...devices['Desktop Chrome'], baseURL: liveUrl },
    },
  ],
})
