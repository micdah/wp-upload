import { test as base, expect, type Page } from '@playwright/test'

// The shared `test` for every e2e spec. Import it instead of Playwright's own:
//
//   import { test, expect } from '../support/fixtures.ts'
//
// It adds:
// - a console guard: any console error or uncaught page error fails the test.
//   A spec that expects one lists it with
//   `test.use({ allowedConsoleErrors: [/pattern/] })`;
// - `scriptUrls`: every JavaScript file the page has loaded so far, so a spec
//   can check which lazy chunks a view pulls in.

export type ConsoleProblem = { kind: 'console' | 'pageerror'; text: string }

type Fixtures = {
  allowedConsoleErrors: RegExp[]
  consoleProblems: ConsoleProblem[]
  scriptUrls: Set<string>
}

export const test = base.extend<Fixtures>({
  allowedConsoleErrors: [[], { option: true }],

  consoleProblems: [
    async ({ page, allowedConsoleErrors }, use) => {
      const problems: ConsoleProblem[] = []
      const isAllowed = (text: string) =>
        allowedConsoleErrors.some((pattern) => pattern.test(text))

      page.on('console', (message) => {
        if (message.type() === 'error' && !isAllowed(message.text())) {
          problems.push({ kind: 'console', text: describeConsole(message) })
        }
      })
      page.on('pageerror', (error) => {
        const text = error.stack ?? String(error)
        if (!isAllowed(text)) {
          problems.push({ kind: 'pageerror', text })
        }
      })

      await use(problems)

      expect(
        problems,
        'console errors or uncaught page errors during the test',
      ).toEqual([])
    },
    { auto: true },
  ],

  scriptUrls: async ({ page }, use) => {
    const urls = new Set<string>()
    page.on('response', (response) => {
      if (response.request().resourceType() === 'script') {
        urls.add(response.url())
      }
    })
    await use(urls)
  },
})

export { expect }

function describeConsole(message: {
  text(): string
  location(): { url: string; lineNumber: number }
}): string {
  const { url, lineNumber } = message.location()
  return url ? `${message.text()} (${url}:${lineNumber})` : message.text()
}

// Loads a page and waits until the network is quiet, so lazy chunks have
// arrived and their console output has been seen.
export async function openQuietly(page: Page, url: string): Promise<void> {
  await page.goto(url)
  await page.waitForLoadState('networkidle')
}
