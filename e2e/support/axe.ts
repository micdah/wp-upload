import AxeBuilder from '@axe-core/playwright'
import type { Page, TestInfo } from '@playwright/test'
import { expect } from './fixtures.ts'

// Axe for the e2e suites (implementation plan §8: "axe on every screen in both
// themes"). Typical use:
//
//   for (const colorScheme of COLOR_SCHEMES) {
//     await expectNoAxeViolations(page, testInfo, { colorScheme })
//   }
//
// The full results are attached to the test report as JSON either way.

export const COLOR_SCHEMES = ['light', 'dark'] as const
export type ColorScheme = (typeof COLOR_SCHEMES)[number]

// WCAG 2.0, 2.1 and 2.2 rules at levels A and AA.
export const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

export type AxeOptions = {
  colorScheme?: ColorScheme
  // CSS selectors to leave out, e.g. a third-party widget a track can't fix.
  exclude?: string[]
  // Axe rule ids to skip, each with a reason in the calling spec.
  disableRules?: string[]
}

export function makeAxeBuilder(page: Page, options: AxeOptions = {}) {
  let builder = new AxeBuilder({ page }).withTags(AXE_TAGS)
  for (const selector of options.exclude ?? []) {
    builder = builder.exclude(selector)
  }
  if (options.disableRules?.length) {
    builder = builder.disableRules(options.disableRules)
  }
  return builder
}

// Switches the page to the colour scheme (prefers-color-scheme), runs axe and
// fails on any violation. The app follows the system scheme by default, so the
// emulated media query selects the theme.
export async function expectNoAxeViolations(
  page: Page,
  testInfo: TestInfo,
  options: AxeOptions = {},
): Promise<void> {
  const colorScheme = options.colorScheme ?? 'light'
  await page.emulateMedia({ colorScheme })
  const results = await makeAxeBuilder(page, options).analyze()
  await testInfo.attach(`axe-${colorScheme}.json`, {
    body: JSON.stringify(results, null, 2),
    contentType: 'application/json',
  })
  const summary = results.violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact,
    targets: violation.nodes.map((node) => node.target.join(' ')),
  }))
  expect(summary, `axe violations (${colorScheme})`).toEqual([])
}
