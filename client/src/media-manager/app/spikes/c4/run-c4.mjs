// Spike C4 runner: drives the harness (index.html) with real keyboard events
// in Chromium, Firefox and WebKit, checks each scenario and prints a matrix.
//
//   node run-c4.mjs [chromium firefox webkit] [--only=S1,S4] [--trace]
//
// Needs the Vite dev server on C4_URL (default port 5372). Each scenario runs
// against core's dispatcher and the patched one (`?patched=1`).

import { chromium, firefox, webkit } from 'playwright'

const BASE_URL =
  process.env.C4_URL ??
  'http://localhost:5372/src/media-manager/app/spikes/c4/index.html'
const ENGINES = { chromium, firefox, webkit }
const VARIANTS = ['core', 'patched']
// Longest Mantine transition here is 200 ms (Modal, Drawer).
const SETTLE_MS = 400

const args = process.argv.slice(2)
const engineNames = args.filter((arg) => arg in ENGINES)
const onlyArg = args.find((arg) => arg.startsWith('--only='))
const only = onlyArg ? onlyArg.slice('--only='.length).split(',') : null
const showTrace = args.includes('--trace')

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------

async function openHarness(page, variant) {
  const url = variant === 'patched' ? `${BASE_URL}?patched=1` : BASE_URL
  await page.goto(url)
  await page.waitForFunction(() => window.__c4?.ready === true)
}

function readState(page) {
  return page.evaluate(() => window.__c4.state())
}

function readLog(page) {
  return page.evaluate(() => window.__log)
}

function settle(page) {
  return page.waitForTimeout(SETTLE_MS)
}

/** One line per log entry that explains a key press. */
function summarise(entries) {
  return entries
    .filter((entry) => entry.src !== 'dom' && entry.src !== 'cap')
    .map((entry) => `${entry.src}: ${entry.msg}`)
}

/**
 * A scenario's recorder: `press` sends a real key and keeps the log lines it
 * caused; `expect` compares a value and records mismatches.
 */
function createRecorder(page) {
  const recorder = {
    failures: [],
    traces: [],
    notes: [],
    async press(key, label = key) {
      const before = (await readLog(page)).length
      await page.keyboard.press(key)
      await settle(page)
      const entries = (await readLog(page)).slice(before)
      recorder.traces.push({ label, lines: summarise(entries) })
      return entries
    },
    async expectState(label, expected) {
      const state = await readState(page)
      for (const [field, value] of Object.entries(expected)) {
        if (state[field] !== value) {
          recorder.failures.push(
            `${label}: ${field} = ${JSON.stringify(state[field])}, expected ${JSON.stringify(value)}`,
          )
        }
      }
      return state
    },
    expect(label, actual, expected) {
      if (actual !== expected) {
        recorder.failures.push(
          `${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`,
        )
      }
    },
    note(text) {
      recorder.notes.push(text)
    },
  }
  return recorder
}

function decisions(entries) {
  return entries
    .filter((entry) => entry.src === 'decide')
    .map((entry) => entry.msg.split(' | ')[0])
}

function commands(entries) {
  return entries
    .filter((entry) => entry.src === 'cmd')
    .map((entry) => entry.msg)
}

async function setMode(page, mode) {
  await page.evaluate((next) => window.__c4.setMode(next), mode)
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

/** Esc closes what is open, then the next Esc closes detail mode. */
async function escThenLeaveDetail(r, label, afterFirst) {
  const first = await r.press('Escape', `${label}: Esc 1`)
  r.expect(`${label} Esc 1 commands`, commands(first).join(','), '')
  await r.expectState(`${label} after Esc 1`, { mode: 'detail', ...afterFirst })
  const second = await r.press('Escape', `${label}: Esc 2`)
  r.expect(
    `${label} Esc 2 commands`,
    commands(second).join(','),
    'detail.close',
  )
}

/**
 * Esc closes a modal; then `f` is pressed every ~10 ms until it runs, to
 * time when app keys come back (exit transition). Returns the log lines.
 */
async function escThenTimeAppKeys(page, r) {
  const before = (await readLog(page)).length
  await page.keyboard.press('Escape')
  const started = Date.now()
  while (Date.now() - started < 1500) {
    await page.keyboard.press('f')
    const log = (await readLog(page)).slice(before)
    if (commands(log).some((cmd) => cmd.startsWith('panels'))) {
      break
    }
    await page.waitForTimeout(10)
  }
  await settle(page)
  const entries = (await readLog(page)).slice(before)
  const escTime = entries.find(
    (entry) => entry.src === 'cap' && entry.msg.startsWith('Escape'),
  )?.t
  const gone = entries.find(
    (entry) => entry.src === 'dom' && entry.msg.includes('"modal":0'),
  )?.t
  const firstRun = entries.find(
    (entry) => entry.src === 'cmd' && entry.msg.startsWith('panels'),
  )?.t
  const ignored = entries.filter(
    (entry) => entry.src === 'decide' && entry.msg.startsWith('f ignore'),
  )
  const rel = (time) =>
    time === undefined ? 'never' : `+${Math.round(time - escTime)}ms`
  r.note(
    `after Esc: modal leaves DOM ${rel(gone)}; f ignored ${ignored.length}x (last ${rel(ignored.at(-1)?.t)}); first f runs ${rel(firstRun)}`,
  )
  r.traces.push({ label: 'Esc, then f…', lines: summarise(entries) })
  r.expect(
    'Esc: commands besides f',
    commands(entries)
      .filter((cmd) => !cmd.startsWith('panels'))
      .join(','),
    '',
  )
  return entries
}

const SCENARIOS = [
  {
    id: 'S1',
    title: 'Menu opened by click, Esc in detail',
    async run(page, r) {
      await page.click('[data-c4=menu-btn]')
      await settle(page)
      const state = await r.expectState('opened', { menu: 1 })
      r.note(`focus while open: ${state.active}`)
      await escThenLeaveDetail(r, 'menu', {
        menu: 0,
        active: 'button#menu-btn',
      })
    },
  },
  ...['Enter', ' '].map((key) => ({
    id: `S2${key === ' ' ? 'Space' : key}`,
    title: `Menu opened with ${key === ' ' ? 'Space' : key} (detail)`,
    async run(page, r) {
      await page.focus('[data-c4=menu-btn]')
      const open = await r.press(key, `open with ${key}`)
      r.expect('open: commands', commands(open).join(','), '')
      const state = await r.expectState('opened', { menu: 1 })
      r.note(`focus while open: ${state.active}`)
      await escThenLeaveDetail(r, 'menu', {
        menu: 0,
        active: 'button#menu-btn',
      })
    },
  })),
  {
    id: 'S2ArrowDown',
    title: 'ArrowDown on a focused menu button (info: Mantine opens no menu)',
    async run(page, r) {
      for (const mode of ['detail', 'grid']) {
        await setMode(page, mode)
        await page.focus('[data-c4=menu-btn]')
        const entries = await r.press('ArrowDown', `ArrowDown in ${mode}`)
        const state = await readState(page)
        r.note(
          `${mode}: menu open=${state.menu}, ${decisions(entries).join(', ')}`,
        )
        await page.keyboard.press('Escape')
        await settle(page)
      }
    },
  },
  ...['Enter', ' '].map((key) => ({
    id: `S2g${key === ' ' ? 'Space' : key}`,
    title: `Grid mode: ${key === ' ' ? 'Space' : key} on a focused menu button`,
    async run(page, r) {
      await setMode(page, 'grid')
      await page.focus('[data-c4=menu-btn]')
      const open = await r.press(key, `open with ${key}`)
      r.note(`decision: ${decisions(open).join(', ')}`)
      r.expect('open: app commands', commands(open).join(','), '')
      await r.expectState('opened', { menu: 1, mode: 'grid' })
    },
  })),
  {
    id: 'S3',
    title: 'Menu trigger=hover, Esc in detail',
    async run(page, r) {
      await page.focus('[data-c4=neutral]')
      await page.hover('[data-c4=hover-btn]')
      await settle(page)
      const state = await r.expectState('opened', { menu: 1 })
      r.note(`focus while open: ${state.active}`)
      await escThenLeaveDetail(r, 'hover menu', { menu: 0 })
    },
  },
  {
    id: 'S4',
    title: 'confirm() Modal: f paused, Esc closes modal only',
    async run(page, r) {
      await page.click('[data-c4=confirm-btn]')
      await settle(page)
      const state = await r.expectState('opened', { modal: 1 })
      r.note(`focus while open: ${state.active}`)
      const f = await r.press('f', 'f while open')
      r.expect('f while open: commands', commands(f).join(','), '')
      const entries = await escThenTimeAppKeys(page, r)
      r.expect(
        'confirm resolved',
        entries.some((entry) => entry.msg === 'resolved false'),
        true,
      )
      const after = await r.expectState('after Esc', {
        modal: 0,
        mode: 'detail',
        // interaction-spec §10: dialogs restore focus.
        active: 'button#confirm-btn',
      })
      r.note(`focus after close: ${after.active}`)
      const leave = await r.press('Escape', 'Esc 2')
      r.expect('Esc 2 commands', commands(leave).join(','), 'detail.close')
    },
  },
  {
    id: 'S5a',
    title: 'Select dropdown open, Esc x3',
    async run(page, r) {
      await page.click('[data-c4=select]')
      await settle(page)
      await r.expectState('opened', { listbox: 1, active: 'input#select' })
      await r.press('Escape', 'Esc 1')
      await r.expectState('after Esc 1', {
        listbox: 0,
        mode: 'detail',
        active: 'input#select',
      })
      const blur = await r.press('Escape', 'Esc 2')
      r.expect('Esc 2 decision', decisions(blur).join(','), 'Escape blur')
      await r.expectState('after Esc 2', { mode: 'detail', active: 'body' })
      const leave = await r.press('Escape', 'Esc 3')
      r.expect('Esc 3 commands', commands(leave).join(','), 'detail.close')
    },
  },
  {
    id: 'S5b',
    title: 'Autocomplete typing + dropdown, Esc x3',
    async run(page, r) {
      await page.click('[data-c4=auto]')
      const typed = await r.press('a', 'type a')
      r.expect('type a: commands', commands(typed).join(','), '')
      await r.expectState('opened', { listbox: 1, active: 'input#auto' })
      await r.press('Escape', 'Esc 1')
      await r.expectState('after Esc 1', {
        listbox: 0,
        mode: 'detail',
        active: 'input#auto',
      })
      const blur = await r.press('Escape', 'Esc 2')
      r.expect('Esc 2 decision', decisions(blur).join(','), 'Escape blur')
      const leave = await r.press('Escape', 'Esc 3')
      r.expect('Esc 3 commands', commands(leave).join(','), 'detail.close')
    },
  },
  {
    id: 'S6a',
    title: 'Own layer (peek), grid: Esc closes peek, not selection.clear',
    async run(page, r) {
      await setMode(page, 'grid')
      await page.click('[data-c4=peek-btn]')
      await settle(page)
      await r.expectState('opened', { peek: true, layers: 'peek' })
      const esc = await r.press('Escape', 'Esc 1')
      r.expect('Esc 1 commands', commands(esc).join(','), '')
      await r.expectState('after Esc 1', { peek: false, mode: 'grid' })
      const clear = await r.press('Escape', 'Esc 2')
      r.expect('Esc 2 commands', commands(clear).join(','), 'selection.clear')
    },
  },
  {
    id: 'S6b',
    title: 'Menu inside own layer, detail: Esc x3',
    async run(page, r) {
      await page.click('[data-c4=peek-btn]')
      await settle(page)
      await page.click('[data-c4=peek-menu-btn]')
      await settle(page)
      await r.expectState('opened', { peek: true, menu: 1 })
      const first = await r.press('Escape', 'Esc 1')
      r.expect('Esc 1 commands', commands(first).join(','), '')
      await r.expectState('after Esc 1', {
        menu: 0,
        peek: true,
        mode: 'detail',
      })
      const second = await r.press('Escape', 'Esc 2')
      r.expect('Esc 2 commands', commands(second).join(','), '')
      await r.expectState('after Esc 2', { peek: false, mode: 'detail' })
      const third = await r.press('Escape', 'Esc 3')
      r.expect('Esc 3 commands', commands(third).join(','), 'detail.close')
    },
  },
  {
    id: 'S7',
    title: 'Text field: f types, Esc blurs, Esc leaves detail',
    async run(page, r) {
      await page.click('[data-c4=text]')
      const typed = await r.press('f', 'type f')
      r.expect('type f: commands', commands(typed).join(','), '')
      await r.expectState('typed', { textValue: 'f', folders: true })
      const blur = await r.press('Escape', 'Esc 1')
      r.expect('Esc 1 decision', decisions(blur).join(','), 'Escape blur')
      await r.expectState('after Esc 1', { mode: 'detail', active: 'body' })
      const leave = await r.press('Escape', 'Esc 2')
      r.expect('Esc 2 commands', commands(leave).join(','), 'detail.close')
    },
  },
  {
    id: 'S8',
    title: '[data-mm-local-keys]: arrows not dispatched',
    async run(page, r) {
      await page.focus('[data-c4=local]')
      const local = await r.press('ArrowRight', 'ArrowRight in region')
      r.expect('in region: commands', commands(local).join(','), '')
      r.expect(
        'in region: decision',
        decisions(local).join(','),
        'ArrowRight ignore(local)',
      )
      await page.focus('[data-c4=neutral]')
      const control = await r.press('ArrowRight', 'ArrowRight on a button')
      r.expect(
        'control: commands',
        commands(control).join(','),
        'detail.step 1',
      )
    },
  },
  {
    id: 'S9',
    title: 'Drawer: f paused, Esc closes drawer only',
    async run(page, r) {
      await page.click('[data-c4=drawer-btn]')
      await settle(page)
      const state = await r.expectState('opened', { modal: 1 })
      r.note(`focus while open: ${state.active}`)
      const f = await r.press('f', 'f while open')
      r.expect('f: commands', commands(f).join(','), '')
      await escThenTimeAppKeys(page, r)
      const after = await r.expectState('after Esc', {
        modal: 0,
        mode: 'detail',
        active: 'button#drawer-btn',
      })
      r.note(`focus after close: ${after.active}`)
      const leave = await r.press('Escape', 'Esc 2')
      r.expect('Esc 2 commands', commands(leave).join(','), 'detail.close')
    },
  },
  {
    id: 'S10a',
    title: 'Plain Popover, focus on target: Esc',
    async run(page, r) {
      await page.click('[data-c4=pop-btn]')
      await settle(page)
      const state = await r.expectState('opened', { popover: 1 })
      r.note(`focus while open: ${state.active}`)
      const esc = await r.press('Escape', 'Esc 1')
      r.expect('Esc 1 commands', commands(esc).join(','), '')
      await r.expectState('after Esc 1', { popover: 0, mode: 'detail' })
    },
  },
  {
    id: 'S10b',
    title: 'Plain Popover, focus inside dropdown: Esc',
    async run(page, r) {
      await page.click('[data-c4=pop-btn]')
      await settle(page)
      await page.focus('[data-c4=pop-inner]')
      const esc = await r.press('Escape', 'Esc 1')
      r.expect('Esc 1 commands', commands(esc).join(','), '')
      const after = await r.expectState('after Esc 1', {
        popover: 0,
        mode: 'detail',
      })
      r.note(`focus after close: ${after.active}`)
    },
  },
  {
    id: 'S11a',
    title: 'Popover + useKeyLayer, focus on target: Esc',
    async run(page, r) {
      await page.click('[data-c4=lpop-btn]')
      await settle(page)
      await r.expectState('opened', { popover: 1, layers: 'lpop' })
      const esc = await r.press('Escape', 'Esc 1')
      r.expect('Esc 1 commands', commands(esc).join(','), '')
      await r.expectState('after Esc 1', { popover: 0, mode: 'detail' })
      const leave = await r.press('Escape', 'Esc 2')
      r.expect('Esc 2 commands', commands(leave).join(','), 'detail.close')
    },
  },
  {
    id: 'S11b',
    title: 'Popover + useKeyLayer, focus inside dropdown: Esc',
    async run(page, r) {
      await page.click('[data-c4=lpop-btn]')
      await settle(page)
      await page.focus('[data-c4=lpop-inner]')
      const esc = await r.press('Escape', 'Esc 1')
      r.expect('Esc 1 commands', commands(esc).join(','), '')
      const after = await r.expectState('after Esc 1', {
        popover: 0,
        mode: 'detail',
      })
      r.note(`focus after close: ${after.active}`)
      const leave = await r.press('Escape', 'Esc 2')
      r.expect('Esc 2 commands', commands(leave).join(','), 'detail.close')
    },
  },
]

// ---------------------------------------------------------------------------
// Run and report
// ---------------------------------------------------------------------------

async function runEngine(name) {
  const results = {}
  let browser
  try {
    browser = await ENGINES[name].launch()
  } catch (error) {
    console.log(`!! ${name} failed to launch: ${error.message.split('\n')[0]}`)
    return null
  }
  const version = browser.version()
  for (const variant of VARIANTS) {
    for (const scenario of SCENARIOS) {
      if (only && !only.includes(scenario.id)) {
        continue
      }
      const context = await browser.newContext()
      context.setDefaultTimeout(5000)
      const page = await context.newPage()
      const recorder = createRecorder(page)
      page.on('pageerror', (error) => {
        recorder.failures.push(`page error: ${error.message}`)
      })
      try {
        await openHarness(page, variant)
        await scenario.run(page, recorder)
      } catch (error) {
        const lines = error.message.split('\n')
        recorder.failures.push(`threw: ${lines.slice(0, 8).join(' / ')}`)
      }
      results[`${scenario.id}/${variant}`] = recorder
      await context.close()
    }
  }
  await browser.close()
  return { version, results }
}

function printReport(engineResults) {
  const engines = Object.keys(engineResults)
  console.log('\n== Matrix (PASS = behaves as interaction-spec §5/§8 expects)')
  const header = [
    'scenario',
    ...engines.flatMap((e) => VARIANTS.map((v) => `${e}/${v}`)),
  ]
  console.log(header.join(' | '))
  for (const scenario of SCENARIOS) {
    if (only && !only.includes(scenario.id)) {
      continue
    }
    const cells = engines.flatMap((engine) =>
      VARIANTS.map((variant) => {
        const result =
          engineResults[engine]?.results[`${scenario.id}/${variant}`]
        if (!result) {
          return 'n/a'
        }
        return result.failures.length === 0 ? 'PASS' : 'FAIL'
      }),
    )
    console.log([`${scenario.id} ${scenario.title}`, ...cells].join(' | '))
  }
  for (const engine of engines) {
    console.log(`\n== ${engine} ${engineResults[engine].version}`)
    for (const [key, result] of Object.entries(engineResults[engine].results)) {
      const status = result.failures.length === 0 ? 'PASS' : 'FAIL'
      console.log(`-- ${key}: ${status}`)
      for (const failure of result.failures) {
        console.log(`   x ${failure}`)
      }
      for (const note of result.notes) {
        console.log(`   * ${note}`)
      }
      if (showTrace || result.failures.length > 0) {
        for (const trace of result.traces) {
          console.log(`   [${trace.label}]`)
          for (const line of trace.lines) {
            console.log(`      ${line}`)
          }
        }
      }
    }
  }
}

async function main() {
  const names = engineNames.length > 0 ? engineNames : Object.keys(ENGINES)
  const engineResults = {}
  for (const name of names) {
    const result = await runEngine(name)
    if (result) {
      engineResults[name] = result
    }
  }
  printReport(engineResults)
}

await main()
