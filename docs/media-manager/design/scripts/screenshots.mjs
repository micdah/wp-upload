// Regenerates the design screenshots and runs interaction checks against the
// prototype in headless Chromium.
//
// Playwright isn't a repo dependency. Point NODE_PATH at a node_modules that
// has it, e.g.:
//   NODE_PATH=/path/to/pw/node_modules node docs/media-manager/design/scripts/screenshots.mjs
//
// Options:
//   --set <name>     shot set to take: core (default)
//   --only <text>    only shots whose name contains <text>
//   --no-checks      skip the interaction checks

import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startServer } from './serve.mjs'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const designDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
)
const outputDir = path.join(designDir, 'screenshots')

const args = process.argv.slice(2)
const option = (name) => {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}
const setName = option('--set') ?? 'core'
const onlyFilter = option('--only')
const runChecks = !args.includes('--no-checks')

const DESKTOP = { width: 1440, height: 900 }
const SAMPLE_ITEM = 1003

// --- Shot definitions ------------------------------------------------------
// prepare(page) runs after load and before the screenshot.

async function selectSome(page) {
  const tiles = page.locator('#grid .tile')
  await tiles.nth(1).click()
  await tiles.nth(4).click({ modifiers: ['Control'] })
  await tiles.nth(6).click({ modifiers: ['Control'] })
  await page.mouse.move(5, 5)
}

async function selectOne(page) {
  await page.locator('#grid .tile').nth(2).click()
  await page.mouse.move(5, 5)
}

function coreShots() {
  const shots = []
  for (const theme of ['dark', 'light']) {
    shots.push(
      {
        name: `grid-${theme}`,
        query: `theme=${theme}&folder=6`,
        prepare: selectOne,
      },
      {
        name: `multiselect-${theme}`,
        query: `theme=${theme}`,
        prepare: selectSome,
      },
      {
        name: `detail-${theme}`,
        query: `theme=${theme}&item=${SAMPLE_ITEM}`,
      },
      {
        name: `system-${theme}`,
        path: 'system.html',
        query: `theme=${theme}`,
        fullPage: true,
        // Very tall page: 1× keeps the file small; the page itself is live.
        scale: 1,
      },
    )
  }
  return shots
}

// Stage 2's direction screenshots are kept in screenshots/direction-*.jpg for
// the record; the skins they show were retired after the pick.
const SETS = {
  core: coreShots,
}

// Feature areas add their own shots and checks in scripts/shots/<area>.mjs:
//   export const shots = [{ name, query, path?, prepare?, viewport?, … }]
//   export async function checks(browser, baseUrl, { openPage, assert, DESKTOP })
async function loadAreaModules() {
  const shotsDir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'shots',
  )
  if (!fs.existsSync(shotsDir)) return []
  const files = fs.readdirSync(shotsDir).filter((file) => file.endsWith('.mjs'))
  return Promise.all(
    files.sort().map((file) => import(path.join(shotsDir, file))),
  )
}

// --- Helpers -----------------------------------------------------------------

async function waitForImages(page) {
  // Grid content (tiles, skeleton or an empty state) or the system page.
  await page.waitForFunction(
    () =>
      document.querySelector('#grid')?.children.length ||
      document.querySelector('.system-main')?.children.length,
  )
  await page.waitForLoadState('networkidle')
  await page.evaluate(async () => {
    const images = [...document.images].filter((img) => img.loading !== 'lazy')
    await Promise.all(
      images.map((img) =>
        img.complete
          ? null
          : new Promise((resolve) => {
              img.onload = resolve
              img.onerror = resolve
            }),
      ),
    )
  })
  await page.waitForTimeout(400)
}

async function openPage(context, baseUrl, query, pagePath = '') {
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  // Only the prototype's own errors count; external resources (photos,
  // fonts) can fail on a flaky network without it being a design bug.
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const source = message.location()?.url ?? ''
    const external = source && !source.startsWith(baseUrl)
    if (external || message.text().includes('picsum')) return
    errors.push(message.text())
  })
  await page.goto(`${baseUrl}/prototype/${pagePath}?chrome=0&${query}`)
  await waitForImages(page)
  return { page, errors }
}

// Long pages: scroll to the bottom and back so every image is loaded and
// decoded before a full-page capture (off-screen decodes are deferred).
async function scrollThrough(page) {
  const height = await page.evaluate(() => document.body.scrollHeight)
  for (let y = 0; y < height; y += 700) {
    await page.evaluate((top) => window.scrollTo(0, top), y)
    await page.waitForTimeout(120)
  }
  await page.waitForLoadState('networkidle')
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(300)
}

function assert(condition, message) {
  if (!condition) throw new Error(`Check failed: ${message}`)
  console.log(`  ✓ ${message}`)
}

// --- Interaction checks -----------------------------------------------------------

async function interactionChecks(browser, baseUrl) {
  console.log('Interaction checks')
  const context = await browser.newContext({ viewport: DESKTOP })
  const { page, errors } = await openPage(context, baseUrl, 'theme=dark')

  await page.locator('#grid .tile').first().click()
  await page.keyboard.press('ArrowRight')
  const focusedId = await page.evaluate(
    () => document.activeElement?.dataset.id,
  )
  assert(focusedId, 'arrow keys move focus between tiles')

  await page.keyboard.press('Enter')
  await page.waitForSelector('#detail:not([hidden]) .stage__media')
  assert(
    page.url().includes(`item=${focusedId}`),
    'Enter opens detail mode and puts ?item= in the URL',
  )

  await page.keyboard.press('ArrowRight')
  assert(
    !page.url().includes(`item=${focusedId}`),
    '→ steps to the next item in detail mode',
  )

  await page.goBack()
  await page.waitForSelector('#detail[hidden]', { state: 'attached' })
  assert(
    !page.url().includes('item='),
    'Back returns from detail mode to the grid',
  )

  await page.keyboard.press('f')
  assert(
    (await page.getAttribute('#app', 'data-folders')) === 'closed',
    'F toggles the folder column',
  )
  await page.keyboard.press('i')
  assert(
    (await page.getAttribute('#app', 'data-inspector')) === 'closed',
    'I toggles the inspector',
  )

  const deepLink = await openPage(context, baseUrl, `item=${SAMPLE_ITEM}`)
  assert(
    await deepLink.page.isVisible('#detail .stage__media'),
    '?item= deep link opens detail mode',
  )

  assert(errors.length === 0, `no page errors (${errors.join('; ')})`)
  await context.close()

  for (const theme of ['dark', 'light']) {
    await hoverContrastCheck(browser, baseUrl, theme)
  }
}

// Hovers every text-bearing control on the design-system page and checks the
// text against the background actually painted behind it (WCAG AA 4.5:1).
async function hoverContrastCheck(browser, baseUrl, theme) {
  const context = await browser.newContext({ viewport: DESKTOP })
  const { page } = await openPage(
    context,
    baseUrl,
    `theme=${theme}`,
    'system.html',
  )
  const controls = page.locator(
    '.system-main :is(.btn, .chip, .menu__item):visible',
  )
  const count = await controls.count()
  const failures = []
  for (let index = 0; index < count; index++) {
    const control = controls.nth(index)
    if (await control.isDisabled()) continue
    await control.hover()
    await page.waitForTimeout(140)
    const result = await control.evaluate((element) => {
      const parse = (value) => value.match(/[\d.]+/g).map(Number)
      const luminance = ([r, g, b]) => {
        const channel = (c) => {
          const v = c / 255
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
        }
        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
      }
      // Composite the background layers from the page down to the element.
      const layers = []
      for (let node = element; node; node = node.parentElement) {
        const [r, g, b, a = 1] = parse(getComputedStyle(node).backgroundColor)
        if (a > 0) layers.unshift([r, g, b, a])
        if (a >= 1) break
      }
      let colour = [255, 255, 255]
      for (const [r, g, b, a] of layers) {
        colour = [r, g, b].map((c, i) => c * a + colour[i] * (1 - a))
      }
      const [tr, tg, tb, ta = 1] = parse(getComputedStyle(element).color)
      const text = [tr, tg, tb].map((c, i) => c * ta + colour[i] * (1 - ta))
      const [light, dark] = [luminance(text), luminance(colour)].sort(
        (x, y) => y - x,
      )
      return {
        label: element.textContent.trim().replace(/\s+/g, ' ').slice(0, 40),
        ratio: (light + 0.05) / (dark + 0.05),
      }
    })
    if (result.ratio < 4.5) {
      failures.push(`"${result.label}" ${result.ratio.toFixed(2)}`)
    }
  }
  assert(
    failures.length === 0,
    `hover contrast ≥ 4.5 for ${count} controls (${theme}) ${failures.join('; ')}`,
  )
  await context.close()
}

// --- Main ----------------------------------------------------------------------------

async function takeShots(browser, baseUrl, shots) {
  fs.mkdirSync(outputDir, { recursive: true })
  for (const shot of shots) {
    const context = await browser.newContext({
      viewport: shot.viewport ?? DESKTOP,
      // 1× keeps ~150 review screenshots small enough for git.
      deviceScaleFactor: shot.scale ?? 1,
      colorScheme: shot.query.includes('theme=light') ? 'light' : 'dark',
      reducedMotion: shot.reducedMotion ? 'reduce' : 'no-preference',
    })
    const { page, errors } = await openPage(
      context,
      baseUrl,
      shot.query,
      shot.path,
    )
    if (shot.prepare) await shot.prepare(page)
    if (shot.fullPage) await scrollThrough(page)
    await page.waitForTimeout(300)
    const file = path.join(outputDir, `${shot.name}.jpg`)
    await page.screenshot({
      path: file,
      type: 'jpeg',
      quality: 82,
      fullPage: Boolean(shot.fullPage),
    })
    console.log(
      `  ${shot.name}.jpg${errors.length ? ` (errors: ${errors})` : ''}`,
    )
    await context.close()
  }
}

async function main() {
  const { server, url } = await startServer(0)
  const browser = await chromium.launch()
  const areas = await loadAreaModules()
  try {
    if (runChecks) {
      await interactionChecks(browser, url)
      for (const area of areas) {
        await area.checks?.(browser, url, { openPage, assert, DESKTOP })
      }
    }
    const allShots = [
      ...SETS[setName](),
      ...areas.flatMap((area) => area.shots ?? []),
    ]
    const shots = allShots.filter(
      (shot) => !onlyFilter || shot.name.includes(onlyFilter),
    )
    console.log(`Screenshots (${shots.length})`)
    await takeShots(browser, url, shots)
  } finally {
    await browser.close()
    server.close()
  }
}

await main()
