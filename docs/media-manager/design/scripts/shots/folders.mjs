// Screenshots and interaction checks for the "Folders & organising" area
// (folder column, folder CRUD, drag and drop, Move to…, Pro colours,
// per-user notice). Loaded by ../screenshots.mjs; run only these with
//   node docs/media-manager/design/scripts/screenshots.mjs --only folders

const row = (id) => `#folders .tree__row[data-folder="${id}"]`

// Native drag and drop can't be driven by the mouse in headless Chromium, so
// the drag is dispatched as DragEvents with a shared DataTransfer.
async function simulateDrag(
  page,
  sourceSelector,
  targetSelector,
  { drop = false, offsetY = 0.5 } = {},
) {
  await page.evaluate(
    ({ sourceSelector, targetSelector, drop, offsetY }) => {
      const source = document.querySelector(sourceSelector)
      const target = document.querySelector(targetSelector)
      const dataTransfer = new DataTransfer()
      const from = source.getBoundingClientRect()
      const to = target.getBoundingClientRect()
      const fire = (element, type, x, y) =>
        element.dispatchEvent(
          new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            dataTransfer,
            clientX: x,
            clientY: y,
          }),
        )
      fire(source, 'dragstart', from.x + 20, from.y + 20)
      const x = to.x + to.width * 0.45
      const y = to.y + to.height * offsetY
      fire(target, 'dragenter', x, y)
      fire(target, 'dragover', x, y)
      if (drop) {
        fire(target, 'drop', x, y)
        fire(source, 'dragend', x, y)
      }
    },
    { sourceSelector, targetSelector, drop, offsetY },
  )
}

async function selectThree(page) {
  const tiles = page.locator('#grid .tile')
  await tiles.nth(0).click()
  await tiles.nth(2).click({ modifiers: ['Control'] })
  await tiles.nth(3).click({ modifiers: ['Control'] })
}

async function rest(page) {
  await page.mouse.move(700, 880)
}

// --- Shots ---------------------------------------------------------------------

const prepares = {
  tree: async (page) => {
    await page.locator(row(4)).hover()
  },
  'context-menu': async (page) => {
    await page.locator(row(4)).click({ button: 'right' })
    await page.locator('#popover-menu .menu__item').nth(1).hover()
  },
  rename: async (page) => {
    await page.locator(`${row(6)} .tree__name`).dblclick()
    await page.keyboard.type('2026 – Spring/Summer')
    await rest(page)
  },
  new: async (page) => {
    await page.locator(row(8)).click()
    await page.keyboard.press('n')
    await page.keyboard.type('Speakers')
    await rest(page)
  },
  'drop-target': async (page) => {
    await selectThree(page)
    await simulateDrag(page, '#grid .tile[aria-selected="true"]', row(15))
  },
  'moved-toast': async (page) => {
    await selectThree(page)
    await simulateDrag(page, '#grid .tile[aria-selected="true"]', row(15), {
      drop: true,
    })
    await rest(page)
  },
  'folder-reorder': async (page) => {
    await simulateDrag(page, row(14), row(11), { offsetY: 0.1 })
  },
  'move-dialog': async (page) => {
    await selectThree(page)
    await page.keyboard.press('m')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await rest(page)
  },
  'move-search': async (page) => {
    await selectThree(page)
    await page.keyboard.press('m')
    await page.keyboard.type('20')
    await rest(page)
  },
  'delete-confirm': async (page) => {
    await page.locator(row(4)).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Delete folder' }).click()
  },
  search: async (page) => {
    await page.locator('[name="folder-search"]').fill('20')
    await rest(page)
  },
  'pro-colours': async (page) => {
    await page.locator(row(8)).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Colour…' }).click()
  },
  'pro-options': async (page) => {
    await page.locator('#folders [data-action="options"]').click()
  },
}

const SHOTS = [
  ['tree', 'folder=7'],
  ['context-menu', ''],
  ['rename', 'folder=6'],
  ['new', ''],
  ['drop-target', ''],
  ['moved-toast', ''],
  ['folder-reorder', ''],
  ['move-dialog', 'folder=7'],
  ['move-search', 'folder=7'],
  ['delete-confirm', ''],
  ['search', ''],
  ['pro-colours', 'scenario=pro'],
  ['pro-options', 'scenario=pro'],
  ['per-user', 'scenario=per-user'],
  ['no-filebird', 'scenario=no-filebird'],
]

export const shots = SHOTS.flatMap(([name, query]) =>
  ['dark', 'light'].map((theme) => ({
    name: `folders-${name}-${theme}`,
    query: `theme=${theme}${query ? `&${query}` : ''}`,
    prepare: prepares[name],
  })),
)

// --- Checks --------------------------------------------------------------------

async function count(page, id) {
  return Number(await page.locator(`${row(id)} .tree__count`).textContent())
}

async function lastToast(page) {
  return page.locator('.toast .toast__text').last().textContent()
}

async function treeKeyboardChecks(page, assert) {
  await page.locator(row('all')).focus()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  assert(page.url().includes('folder=1'), 'tree: ↓ ↓ Enter opens “Brand”')
  await page.keyboard.press('ArrowRight')
  assert(
    (await page.getAttribute(row(1), 'aria-expanded')) === 'true',
    'tree: → expands a folder',
  )
  await page.keyboard.press('ArrowRight')
  assert(
    (await page.evaluate(() => document.activeElement.dataset.folder)) === '2',
    'tree: → on an open folder moves to its first child',
  )
  await page.keyboard.press('ArrowLeft')
  assert(
    (await page.evaluate(() => document.activeElement.dataset.folder)) === '1',
    'tree: ← moves to the parent',
  )
}

async function crudChecks(page, assert) {
  // Focus is on “Brand”, which already has a “Logos” subfolder.
  await page.keyboard.press('n')
  await page.keyboard.type('Logos')
  await page.keyboard.press('Enter')
  assert(
    (await page
      .locator('#folders .tree__name', { hasText: 'Logos (1)' })
      .count()) === 1,
    'N creates a subfolder; a duplicate name becomes “Logos (1)”',
  )
  await page.keyboard.press('r')
  await page.keyboard.press('Control+a')
  await page.keyboard.type('Wordmarks')
  await page.keyboard.press('Enter')
  assert(
    (await page
      .locator('#folders .tree__name', { hasText: 'Wordmarks' })
      .count()) === 1,
    'R renames the focused folder in place',
  )
  await page.locator('[name="folder-search"]').fill('spring')
  const names = await page.locator('#folders .tree__name').allTextContents()
  assert(
    names.join('|') === 'Blog|2026|Spring campaign',
    `folder search keeps ancestors of matches (${names.join(', ')})`,
  )
  await page.locator('[name="folder-search"]').fill('')
}

async function moveChecks(page, assert) {
  await page.locator(row('all')).click()
  const before = await count(page, 15)
  await page.locator('#grid .tile').first().click()
  await simulateDrag(page, '#grid .tile[aria-selected="true"]', row(15), {
    drop: true,
  })
  assert(
    (await count(page, 15)) === before + 1,
    'dropping a tile on a folder moves it and updates the count',
  )
  assert(
    (await lastToast(page)).includes('Moved 1 item to “Press kit”'),
    'a move shows “Moved 1 item to …”',
  )
  await page.locator('.toast__action').last().click()
  assert((await count(page, 15)) === before, 'Undo puts the item back')

  await page.locator('#grid .tile').nth(1).click()
  await page.keyboard.press('m')
  assert(await page.isVisible('.move-dialog'), 'M opens the Move to… dialog')
  await page.keyboard.type('Team')
  await page.keyboard.press('Enter')
  assert(
    (await lastToast(page)).includes('to “Team”'),
    'typing a folder name and Enter moves the selection there',
  )
}

async function folderDragChecks(page, assert) {
  await simulateDrag(page, row(14), row(1), { drop: true })
  assert(
    (await page.getAttribute(row(14), 'aria-level')) === '2',
    'dropping a folder on the middle of another nests it',
  )
  await page.locator('.toast__action').last().click()
  assert(
    (await page.getAttribute(row(14), 'aria-level')) === '1',
    'Undo returns the folder to where it was',
  )
  await simulateDrag(page, row(16), row(1), { drop: true, offsetY: 0.1 })
  const order = await page
    .locator('#folders .tree > li > .tree__row')
    .evaluateAll((rows) => rows.map((element) => element.dataset.folder))
  assert(
    order.indexOf('16') === order.indexOf('1') - 1,
    'dropping on the top edge of a folder reorders before it',
  )
}

async function deleteChecks(page, assert) {
  const uncategorized = await count(page, 0)
  let subtreeFiles = 0
  for (const id of [4, 5, 6, 7]) subtreeFiles += await count(page, id)
  await page.locator(row(4)).click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Delete folder' }).click()
  assert(
    (await page.locator('.dialog__text').textContent()).includes(
      'move to Uncategorized',
    ),
    'delete confirm explains that files move to Uncategorized',
  )
  await page.locator('[data-answer="yes"]').click()
  assert(
    (await page.locator(row(4)).count()) === 0 &&
      (await page.locator(row(7)).count()) === 0,
    'deleting a folder removes its whole subtree',
  )
  assert(
    (await count(page, 0)) === uncategorized + subtreeFiles,
    'files of the deleted subtree land in Uncategorized',
  )
}

async function scenarioChecks(context, baseUrl, openPage, assert) {
  const none = await openPage(context, baseUrl, 'scenario=no-filebird')
  const width = await none.page.evaluate(
    () => document.getElementById('folders').getBoundingClientRect().width,
  )
  assert(width === 0, 'no FileBird: no folder column')
  await none.page.locator('#grid .tile').first().click()
  await none.page.keyboard.press('f')
  assert(
    (await none.page.getAttribute('#app', 'data-folders')) === 'closed' &&
      (await none.page.isVisible('.toast')),
    'no FileBird: F explains instead of opening an empty column',
  )

  const perUser = await openPage(context, baseUrl, 'scenario=per-user')
  assert(
    (await perUser.page.isVisible('#folders .folders__notice')) &&
      (await perUser.page.isDisabled('#folders [data-mm-action="new-folder"]')),
    'per-user mode: notice shown, folder editing off',
  )

  const pro = await openPage(context, baseUrl, 'scenario=pro')
  assert(
    (await pro.page.locator(`${row(8)} .tree__color`).count()) === 1,
    'Pro: folder colours shown',
  )
  const normal = await openPage(context, baseUrl, '')
  assert(
    (await normal.page.locator('#folders .tree__color').count()) === 0,
    'without Pro: no folder colours',
  )
  return [none, perUser, pro, normal].flatMap((opened) => opened.errors)
}

export async function checks(browser, baseUrl, { openPage, assert, DESKTOP }) {
  console.log('Folder checks')
  const context = await browser.newContext({ viewport: DESKTOP })
  const { page, errors } = await openPage(context, baseUrl, 'theme=dark')
  await treeKeyboardChecks(page, assert)
  await crudChecks(page, assert)
  await moveChecks(page, assert)
  await folderDragChecks(page, assert)
  await deleteChecks(page, assert)
  const scenarioErrors = await scenarioChecks(
    context,
    baseUrl,
    openPage,
    assert,
  )
  const all = [...errors, ...scenarioErrors]
  assert(all.length === 0, `folders: no page errors (${all.join('; ')})`)
  await context.close()
}
