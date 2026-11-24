// Spike C2 runner: drives the harness (index.html in this directory) in
// Chromium, Firefox and WebKit and prints one line per engine x strategy x
// scenario. Needs Vite serving client/ on port 5371 (see C2.md).
//
//   node run-c2.mjs [chromium] [firefox] [webkit]
//
// Writes results-<engine>.json and mid-transition screenshots to
// test-results/spikes/c2/ at the repository root.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, firefox, webkit } from 'playwright'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '../../../../../../test-results/spikes/c2')
const BASE =
  process.env.C2_URL ??
  'http://localhost:5371/src/media-manager/app/spikes/c2/index.html'
const OPEN_ID = 5
const STEPS = 2000
const STRATEGIES = ['a', 'a2', 'b']
const ENGINES = { chromium, firefox, webkit }

// Each scenario: how the page is prepared, and how detail is left.
const SCENARIOS = {
  far: { query: '', reduced: false, noApi: false, immediate: false },
  immediate: { query: '', reduced: false, noApi: false, immediate: true },
  reduced: { query: '', reduced: true, noApi: false, immediate: false },
  noapi: { query: '', reduced: false, noApi: true, immediate: false },
  cv: { query: '&cv=1', reduced: false, noApi: false, immediate: false },
  // The same with C2's proposed morph (morph-proposed.ts).
  'far-p': {
    query: '&morph=proposed',
    reduced: false,
    noApi: false,
    immediate: false,
  },
  'reduced-p': {
    query: '&morph=proposed',
    reduced: true,
    noApi: false,
    immediate: false,
  },
  'noapi-p': {
    query: '&morph=proposed',
    reduced: false,
    noApi: true,
    immediate: false,
  },
}

function settle(page) {
  return page.evaluate(
    () =>
      new Promise((done) => {
        requestAnimationFrame(() => requestAnimationFrame(() => done()))
      }),
  )
}

// Opens a fresh page for one run; collects console errors and page errors.
async function preparePage(browser, strategy, scenario) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: scenario.reduced ? 'reduce' : 'no-preference',
  })
  const page = await context.newPage()
  const errors = []
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text())
    }
  })
  page.on('pageerror', (error) => {
    errors.push(String(error))
  })
  if (scenario.noApi) {
    await page.addInitScript(() => {
      delete Document.prototype.startViewTransition
    })
  }
  await page.goto(`${BASE}?strategy=${strategy}${scenario.query}`)
  await page.waitForFunction(
    (id) => window.c2?.ready && document.querySelector(`[data-id="${id}"]`),
    OPEN_ID,
  )
  await settle(page)
  return { context, page, errors }
}

async function openAndStep(page, scenario) {
  const opened = await page.evaluate((id) => window.c2.open(id), OPEN_ID)
  await settle(page)
  if (scenario.immediate) {
    return { opened, stepMs: null }
  }
  const stepMs = await page.evaluate((count) => window.c2.step(count), STEPS)
  await settle(page)
  await page.waitForTimeout(100)
  return { opened, stepMs }
}

async function leave(page, scenario) {
  if (scenario.immediate) {
    return page.evaluate((count) => window.c2.stepAndClose(count), STEPS)
  }
  return page.evaluate(() => window.c2.close())
}

async function runScenario(browser, strategy, name) {
  const scenario = SCENARIOS[name]
  const { context, page, errors } = await preparePage(
    browser,
    strategy,
    scenario,
  )
  try {
    const { opened, stepMs } = await openAndStep(page, scenario)
    const closed = await leave(page, scenario)
    await page.waitForTimeout(50)
    const after = await page.evaluate(() => window.c2.state())
    return { strategy, scenario: name, opened, stepMs, closed, after, errors }
  } catch (error) {
    return { strategy, scenario: name, failure: String(error), errors }
  } finally {
    await context.close()
  }
}

// Pauses the exit (or entry) transition half-way and screenshots it.
async function screenshotMid(
  browser,
  engine,
  strategy,
  phase,
  prepare,
  pauseAt = 130,
) {
  const { context, page } = await preparePage(browser, strategy, SCENARIOS.far)
  try {
    if (phase === 'exit') {
      await openAndStep(page, SCENARIOS.far)
    } else {
      await prepare?.(page)
    }
    await page.evaluate((at) => window.c2.setPauseAt(at), pauseAt)
    const running =
      phase === 'exit'
        ? page.evaluate(() => window.c2.close())
        : page.evaluate((id) => window.c2.open(id), OPEN_ID)
    await page
      .waitForFunction(() => window.c2.isPaused(), null, {
        polling: 50,
        timeout: 3000,
      })
      .catch(() => {})
    const path = `${OUT}/${engine}-${strategy}-${phase}-mid.png`
    const pausedAtShot = await page.evaluate(() => window.c2.isPaused())
    await page.screenshot({ path })
    await page.evaluate(() => window.c2.resume())
    await running
    return `${path} (paused when shot: ${pausedAtShot})`
  } catch (error) {
    return `failed: ${error}`
  } finally {
    await context.close()
  }
}

// Scrolls the grid so the opened tile's row is half hidden under the top
// edge of the scroll container: does the hero escape the clip?
async function halfHidden(page) {
  await page.evaluate(() => {
    const scroller = window.c2.scroller()
    if (scroller) {
      scroller.scrollTop = 70
    }
  })
  await settle(page)
}

function summarise(engine, result) {
  if (result.failure) {
    return `${engine} ${result.strategy} ${result.scenario}: FAILED ${result.failure}`
  }
  const closed = result.closed
  const transition = closed.transition
  const columns = [
    engine.padEnd(8),
    result.strategy.padEnd(2),
    result.scenario.padEnd(9),
    `openHero=${result.opened.transition?.heroAnimated ?? '-'}`,
    `exitHero=${transition?.heroAnimated ?? '-'}`,
    `root=${transition?.rootAnimated ?? '-'}`,
    `updateDone=${transition?.updateDoneMs ?? '-'}ms`,
    `finished=${transition?.finishedMs ?? '-'}ms`,
    `close=${closed.ms}ms`,
    `to=${closed.reveal.toMs ?? '-'}ms`,
    `rafFrames=${closed.reveal.frames}`,
    `timerTicks=${closed.reveal.timeouts}`,
    `tile=${closed.tile}`,
    `step=${result.stepMs ?? '-'}ms`,
    `errors=${result.errors.length}`,
    transition?.readyError ? `readyError=${transition.readyError}` : '',
  ]
  return columns.join(' ')
}

async function runEngine(engine) {
  const browser = await ENGINES[engine].launch()
  const results = { engine, version: browser.version(), runs: [], shots: [] }
  try {
    for (const strategy of STRATEGIES) {
      for (const name of Object.keys(SCENARIOS)) {
        const result = await runScenario(browser, strategy, name)
        results.runs.push(result)
        console.log(summarise(engine, result))
      }
      results.shots.push(await screenshotMid(browser, engine, strategy, 'exit'))
    }
    results.shots.push(
      await screenshotMid(
        browser,
        engine,
        'a2',
        'enter-clipped',
        halfHidden,
        30,
      ),
    )
    results.shots.push(await screenshotMid(browser, engine, 'a2', 'enter'))
  } finally {
    await browser.close()
  }
  writeFileSync(
    `${OUT}/results-${engine}.json`,
    JSON.stringify(results, null, 2),
  )
  console.log(`${engine} ${results.version}: screenshots`, results.shots)
}

async function main() {
  mkdirSync(OUT, { recursive: true })
  const wanted = process.argv.slice(2)
  const engines = wanted.length > 0 ? wanted : Object.keys(ENGINES)
  for (const engine of engines) {
    try {
      await runEngine(engine)
    } catch (error) {
      console.log(`${engine}: could not run: ${error}`)
    }
  }
}

await main()
