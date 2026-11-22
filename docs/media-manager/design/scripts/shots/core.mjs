// Core screens: filters and sorting, quick peek, detail zoom and media
// types, empty and loading states. Loaded by scripts/screenshots.mjs.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const media = JSON.parse(
  fs.readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../prototype/data/media.json',
    ),
    'utf8',
  ),
)
const firstOfKind = (kind) => media.find((item) => item.kind === kind).id
const LANDSCAPE = media.find(
  (item) => item.kind === 'image' && item.width > item.height * 1.3,
).id

async function focusFirstTile(page) {
  await page.locator('#grid .tile').first().click()
  await page.mouse.move(5, 5)
}

function themed(shot) {
  return ['dark', 'light'].map((theme) => ({
    ...shot,
    name: `${shot.name}-${theme}`,
    query: `theme=${theme}${shot.query ? `&${shot.query}` : ''}`,
  }))
}

export const shots = [
  ...themed({
    name: 'core-filter-menu',
    query: 'folder=all',
    prepare: async (page) => {
      await page.click('[data-action="add-filter"]')
    },
  }),
  ...themed({
    name: 'core-sort-menu',
    prepare: async (page) => {
      await page.click('[data-action="sort"]')
    },
  }),
  ...themed({
    name: 'core-filters-active',
    query: 'orient=portrait&size=gt1',
  }),
  ...themed({
    name: 'core-peek',
    prepare: async (page) => {
      await focusFirstTile(page)
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press(' ')
      await page.waitForSelector('.peek img')
      await page.waitForTimeout(500)
    },
  }),
  ...themed({
    name: 'core-detail-zoom',
    query: `item=${LANDSCAPE}`,
    prepare: async (page) => {
      await page.keyboard.press('z')
      await page.waitForTimeout(800)
    },
  }),
  ...themed({
    name: 'core-detail-video',
    query: `item=${firstOfKind('video')}`,
  }),
  ...themed({
    name: 'core-detail-audio',
    query: `item=${firstOfKind('audio')}`,
  }),
  ...themed({
    name: 'core-detail-pdf',
    query: `item=${firstOfKind('document')}`,
  }),
  ...themed({ name: 'core-empty-folder', query: 'folder=3' }),
  ...themed({ name: 'core-no-results', query: 'q=zzzz' }),
  ...themed({ name: 'core-loading', query: 'scenario=loading' }),
  ...themed({ name: 'core-empty-library', query: 'scenario=empty' }),
  ...themed({ name: 'core-square-layout', query: 'layout=square&density=1' }),
]

export async function checks(browser, baseUrl, { openPage, assert, DESKTOP }) {
  const context = await browser.newContext({ viewport: DESKTOP })
  const { page, errors } = await openPage(context, baseUrl, 'theme=dark')

  await focusFirstTile(page)
  await page.keyboard.press(' ')
  assert(await page.isVisible('.peek'), 'Space opens quick peek')
  await page.keyboard.press('ArrowRight')
  assert(await page.isVisible('.peek'), 'peek follows arrow-key focus')
  await page.keyboard.press('Escape')
  assert(!(await page.isVisible('.peek')), 'Esc closes quick peek')

  await page.click('[data-action="add-filter"]')
  await page.locator('.menu__item', { hasText: 'Portrait' }).click()
  assert(page.url().includes('orient=portrait'), 'filter menu sets ?orient=')
  await page.click('[data-clear="orientation"]')
  assert(!page.url().includes('orient='), 'removable chip clears the filter')

  const detail = await openPage(context, baseUrl, `item=${LANDSCAPE}`)
  await detail.page.keyboard.press('z')
  assert(
    (await detail.page.textContent('.detail__zoom-label')).trim() === '100%',
    'Z zooms detail to 100 %',
  )
  await detail.page.keyboard.press('z')
  assert(
    (await detail.page.textContent('.detail__zoom-label')).trim() === 'Fit',
    'Z again returns to fit',
  )

  assert(errors.length === 0, `no page errors in core checks (${errors})`)
  await context.close()
}
