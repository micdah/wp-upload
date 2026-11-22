// Reports, per theme:
//   - neutrality: OKLCH chroma of the surfaces that surround images
//     (≈ 0 means achromatic; > 0.02 is a visible tint)
//   - WCAG contrast ratios of the key text / UI pairs
// Prints a Markdown table. Uses Playwright like screenshots.mjs:
//   NODE_PATH=/path/to/node_modules node docs/media-manager/design/scripts/token-report.mjs

import { createRequire } from 'node:module'
import { startServer } from './serve.mjs'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const THEMES = ['dark', 'light']

// Surfaces that touch imagery must be neutral.
const NEUTRAL_TOKENS = [
  '--surface-stage',
  '--surface-tile',
  '--surface-app',
  '--surface-filmstrip',
]

// [foreground, background, minimum ratio] — 4.5 for text, 3 for UI edges.
const CONTRAST_PAIRS = [
  ['--text-1', '--surface-panel', 4.5],
  ['--text-2', '--surface-panel', 4.5],
  ['--text-3', '--surface-panel', 4.5],
  ['--text-3', '--surface-app', 4.5],
  ['--text-3', '--surface-overlay', 4.5],
  ['--text-accent', '--surface-panel', 4.5],
  ['--text-on-accent', '--accent', 4.5],
  // The check glyph on a selected tile is a graphic, so 3:1 applies.
  ['--text-on-select', '--select-ring', 3],
  ['--text-on-warn', '--warn-fill', 4.5],
  ['--text-on-danger', '--danger-fill', 4.5],
  ['--text-on-danger', '--danger-fill-hover', 4.5],
  ['--text-on-accent', '--accent-hover', 4.5],
  ['--warn', '--surface-panel', 4.5],
  ['--danger', '--surface-panel', 4.5],
  ['--ok', '--surface-panel', 4.5],
  ['--focus-ring', '--surface-app', 3],
  ['--focus-ring', '--surface-panel', 3],
  ['--select-ring', '--surface-tile', 3],
  ['--line-input', '--surface-input', 3],
  ['--line-input', '--surface-panel', 3],
]

// Resolves every token to an opaque sRGB colour by painting it in the page
// (handles rgb(), hex, color-mix… and alpha over the given backdrop).
async function resolveColours(page, tokens) {
  return page.evaluate((names) => {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true })
    const styles = getComputedStyle(document.documentElement)
    const backdrop = styles.getPropertyValue('--surface-app').trim()
    const result = {}
    for (const name of names) {
      const value = styles.getPropertyValue(name).trim()
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = backdrop
      context.fillRect(0, 0, 1, 1)
      context.fillStyle = value
      context.fillRect(0, 0, 1, 1)
      const [r, g, b] = context.getImageData(0, 0, 1, 1).data
      result[name] = { value, rgb: [r, g, b] }
    }
    return result
  }, tokens)
}

function linear(channel) {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function luminance([r, g, b]) {
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

// OKLCH chroma of an sRGB colour (Björn Ottosson's OKLab).
function chroma([r, g, b]) {
  const [lr, lg, lb] = [linear(r), linear(g), linear(b)]
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return Math.hypot(a, bb)
}

async function main() {
  const { server, url } = await startServer(0)
  const browser = await chromium.launch()
  const tokens = [
    ...new Set([
      ...NEUTRAL_TOKENS,
      ...CONTRAST_PAIRS.flatMap(([f, b]) => [f, b]),
    ]),
  ]
  const lines = ['| Pair | Minimum | Dark | Light |', '|---|---|---|---|']
  const results = {}
  try {
    for (const theme of THEMES) {
      const page = await browser.newPage()
      await page.goto(`${url}/prototype/?chrome=0&theme=${theme}`)
      await page.waitForSelector('.tile')
      results[theme] = await resolveColours(page, tokens)
      await page.close()
    }
  } finally {
    await browser.close()
    server.close()
  }
  let failures = 0
  for (const name of NEUTRAL_TOKENS) {
    const values = THEMES.map((theme) =>
      chroma(results[theme][name].rgb).toFixed(3),
    )
    lines.push(`| \`${name}\` chroma | ≤ 0.010 | ${values.join(' | ')} |`)
    if (values.some((value) => Number(value) > 0.01)) failures++
  }
  for (const [fg, bg, minimum] of CONTRAST_PAIRS) {
    const ratios = THEMES.map((theme) =>
      contrast(results[theme][fg].rgb, results[theme][bg].rgb),
    )
    if (ratios.some((ratio) => ratio < minimum)) failures++
    const cells = ratios.map(
      (ratio) => `${ratio.toFixed(2)}${ratio < minimum ? ' ✗' : ''}`,
    )
    lines.push(`| \`${fg}\` on \`${bg}\` | ${minimum} | ${cells.join(' | ')} |`)
  }
  lines.push('', failures ? `${failures} failing rows` : 'All rows pass.')
  console.log(lines.join('\n'))
}

await main()
