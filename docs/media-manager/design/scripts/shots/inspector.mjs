// Screenshots and interaction checks for the inspector & editing area
// (Info / Usage / Edit panels, autosave, Save & next, the image editor).
// Run alone with: screenshots.mjs --only inspector

const SAMPLE = 1003 // image in Blog / 2026, has alt, used in 2 posts, attached
const OTHERS_UPLOAD = 1003 // uploaded by Jonas Holm → read-only for the Author

async function clickTile(page, id) {
  await page.locator(`#grid .tile[data-id="${id}"]`).click()
  await page.mouse.move(5, 5)
}

async function firstTileIds(page, count) {
  return page.$$eval(
    '#grid .tile',
    (tiles, n) => tiles.slice(0, n).map((tile) => Number(tile.dataset.id)),
    count,
  )
}

async function selectSeveral(page) {
  const tiles = page.locator('#grid .tile')
  await tiles.nth(0).click()
  for (const index of [1, 3, 5]) {
    await tiles.nth(index).click({ modifiers: ['Control'] })
  }
  await page.mouse.move(5, 5)
}

// Opens the editor on the sample image and drags the bottom-right corner,
// holding the mouse so the thirds grid and live size show.
async function openEditorAndDrag(page, { release = false } = {}) {
  await clickTile(page, SAMPLE)
  await page.keyboard.press('e')
  await page.waitForSelector('#image-editor .crop')
  await page.waitForTimeout(400)
  await page.locator('[data-insp="ed-ratio"][data-ratio="16:9"]').click()
  await page.waitForTimeout(250)
  const handle = await page.locator('.crop__handle--se').boundingBox()
  const x = handle.x + handle.width / 2
  const y = handle.y + handle.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x - 120, y - 60, { steps: 6 })
  if (release) await page.mouse.up()
}

function themed(name, query, prepare, extra = {}) {
  return ['dark', 'light'].map((theme) => ({
    name: `inspector-${name}-${theme}`,
    query: `theme=${theme}${query ? `&${query}` : ''}`,
    prepare,
    ...extra,
  }))
}

export const shots = [
  // Nothing selected: folder summary with alt coverage.
  ...themed('summary', '', async (page) => {
    await page.mouse.move(5, 5)
  }),
  // One item: preview, fields, start of the file details.
  ...themed('single', 'folder=6', (page) => clickTile(page, SAMPLE)),
  // One item, scrolled to File / Camera / Sizes with Sizes expanded.
  ...themed('file', 'folder=6', async (page) => {
    await clickTile(page, SAMPLE)
    await page.locator('[data-section="sizes"] summary').click()
    await page
      .locator('[data-section="file"]')
      .evaluate((element) => element.scrollIntoView({ block: 'start' }))
    await page.mouse.move(5, 5)
  }),
  // Alt-text pass: Missing alt filter, alt field focused with a draft.
  ...themed('alt-pass', 'alt=missing', async (page) => {
    const [first] = await firstTileIds(page, 1)
    await clickTile(page, first)
    await page.keyboard.press('a')
    await page.keyboard.type('Morning light over a quiet harbour')
  }),
  // Save & next in detail mode: Enter saved and moved on, field kept focus.
  ...themed('save-next', 'alt=missing', async (page) => {
    const [first] = await firstTileIds(page, 1)
    await clickTile(page, first)
    await page.keyboard.press('Enter')
    await page.waitForSelector('#detail:not([hidden]) .stage__media')
    await page.waitForTimeout(400)
    await page.keyboard.press('a')
    await page.keyboard.type('Morning light over a quiet harbour')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(150)
    await page.keyboard.type('Two people')
  }),
  // Autosave states: Not saved · Retry, Saved ✓, Unsaved.
  ...themed('autosave', 'folder=6', async (page) => {
    await clickTile(page, SAMPLE)
    await page.evaluate(() => window.mmInspector.failNextSave())
    await page.locator('#insp-caption').fill('Studio portrait, natural light')
    await page.keyboard.press('Control+Enter')
    await page.waitForTimeout(550)
    await page.locator('#insp-title').fill('Spring campaign — hero')
    await page.keyboard.press('Control+Enter')
    await page.waitForTimeout(550)
    await page.locator('#insp-description').click()
    await page.keyboard.type('Shot for the spring campaign landing page.')
  }),
  // Several items: Mixed placeholders, append/replace, alt-text nudge.
  ...themed('batch', '', selectSeveral),
  // Several items after applying a caption: Saved + "Updated … · Undo" toast.
  ...themed('batch-applied', '', async (page) => {
    await selectSeveral(page)
    await page.locator('#insp-caption').fill('Photo: Unsplash')
    await page.keyboard.press('Control+Enter')
    await page.waitForTimeout(800)
  }),
  // Usage: used in 2 posts (one as featured image), attached to a page.
  ...themed('usage', 'folder=6', async (page) => {
    await clickTile(page, SAMPLE)
    await page.locator('[data-tab="usage"]').click()
    await page.mouse.move(5, 5)
  }),
  // Image editor: 16:9 crop being dragged over the centre.
  ...themed('edit', 'folder=6', (page) => openEditorAndDrag(page)),
  // Image editor saving.
  ...themed('edit-saving', 'folder=6', async (page) => {
    await openEditorAndDrag(page, { release: true })
    await page.locator('.tool[data-dir="1"]').click()
    await page.waitForTimeout(300)
    await page.locator('[data-ed="save"]').click()
    await page.waitForTimeout(500)
  }),
  // Edit panel for a PDF: no crop, but replace and regenerate preview.
  ...themed('edit-pdf', 'folder=16', async (page) => {
    await clickTile(page, 1089)
    await page.keyboard.press('e')
  }),
  // Edit panel with several items: one at a time, batch regenerate.
  ...themed('edit-multi', '', async (page) => {
    await selectSeveral(page)
    await page.keyboard.press('e')
  }),
  // Attach picker (Usage panel) filtered by typing.
  ...themed('attach', 'folder=6', async (page) => {
    await clickTile(page, SAMPLE)
    await page.locator('[data-tab="usage"]').click()
    await page.locator('[data-insp="attach"]').click()
    await page.keyboard.type('s')
  }),
  // Author role: someone else's upload is view-only.
  ...themed('author', 'scenario=author&folder=6', (page) =>
    clickTile(page, OTHERS_UPLOAD),
  ),
]

// --- Checks ---------------------------------------------------------------------------------

async function item(page, id) {
  return page.evaluate(async (itemId) => {
    const { library } = await import('./js/data.js')
    const { alt, caption, title, width, height } = library.byId.get(itemId)
    return { alt, caption, title, width, height }
  }, id)
}

export async function checks(browser, baseUrl, { openPage, assert, DESKTOP }) {
  console.log('Inspector checks')
  const context = await browser.newContext({ viewport: DESKTOP })
  const { page, errors } = await openPage(
    context,
    baseUrl,
    'theme=dark&alt=missing',
  )

  // Save & next in the grid.
  const [first, second] = await firstTileIds(page, 2)
  await clickTile(page, first)
  await page.keyboard.press('a')
  assert(
    await page.evaluate(() => document.activeElement?.id === 'insp-alt'),
    'A jumps to the alt-text field',
  )
  await page.keyboard.type('A test description')
  await page.keyboard.press('Enter')
  const afterNext = await page.evaluate(() => ({
    active: document.activeElement?.id,
    ids: document.querySelector('#inspector [data-ids]')?.dataset.ids,
  }))
  assert(
    afterNext.active === 'insp-alt' && Number(afterNext.ids) === second,
    'Enter in alt text saves and moves to the next item, keeping the alt field focused',
  )
  await page.waitForTimeout(600)
  assert(
    (await item(page, first)).alt === 'A test description',
    'Save & next saved the previous item’s alt text',
  )

  // Esc reverts an unsaved edit; the field keeps focus.
  await page.keyboard.type('draft')
  await page.keyboard.press('Escape')
  const reverted = await page.evaluate(() => ({
    value: document.getElementById('insp-alt')?.value,
    active: document.activeElement?.id,
  }))
  assert(
    reverted.value === '' && reverted.active === 'insp-alt',
    'Esc reverts an unsaved edit',
  )

  // Shift+Enter goes back (without the filter, so items stay in the view).
  await page.keyboard.press('Escape')
  const plain = await openPage(
    context,
    baseUrl,
    'theme=dark&folder=6&type=image',
  )
  const [one, two] = await firstTileIds(plain.page, 2)
  await clickTile(plain.page, two)
  await plain.page.keyboard.press('a')
  await plain.page.keyboard.press('Shift+Enter')
  assert(
    (await plain.page.evaluate(
      () => document.querySelector('#inspector [data-ids]')?.dataset.ids,
    )) === String(one) &&
      (await plain.page.evaluate(() => document.activeElement?.id)) ===
        'insp-alt',
    'Shift+Enter moves to the previous item, keeping the alt field focused',
  )

  // Batch edit applies to every selected item, and Undo restores them.
  const batch = await openPage(context, baseUrl, 'theme=dark&folder=all')
  await selectSeveral(batch.page)
  const ids = await batch.page.evaluate(() =>
    document
      .querySelector('#inspector [data-ids]')
      .dataset.ids.split(',')
      .map(Number),
  )
  assert(
    (await batch.page.textContent('#inspector .inspector__heading')).includes(
      'Editing 4 items',
    ),
    'several selected items show "Editing N items"',
  )
  await batch.page.locator('#insp-caption').fill('Batch caption')
  await batch.page.keyboard.press('Control+Enter')
  await batch.page.waitForTimeout(900)
  const captions = await Promise.all(ids.map((id) => item(batch.page, id)))
  assert(
    captions.every((entry) => entry.caption === 'Batch caption'),
    `batch edit applies the caption to all ${ids.length} items`,
  )
  await batch.page.locator('.toast__action').first().click()
  const undone = await Promise.all(ids.map((id) => item(batch.page, id)))
  assert(
    undone.every((entry) => entry.caption !== 'Batch caption'),
    'Undo in the toast restores every previous caption',
  )

  // Image editor: E opens the canvas, rotating swaps the output, Esc closes.
  const edit = await openPage(context, baseUrl, 'theme=dark&folder=6')
  await clickTile(edit.page, SAMPLE)
  const before = await item(edit.page, SAMPLE)
  await edit.page.keyboard.press('e')
  await edit.page.waitForSelector('#image-editor .crop')
  assert(
    await edit.page.evaluate(
      () => document.getElementById('grid-scroll').inert,
    ),
    'E opens the image editor over the centre and locks the grid behind it',
  )
  await edit.page.keyboard.press('Escape')
  assert(
    (await edit.page.$('#image-editor')) === null,
    'Esc closes an unchanged editor without asking',
  )
  await edit.page.keyboard.press('e')
  await edit.page.waitForSelector('#image-editor .crop')
  await edit.page.locator('.tool[data-dir="1"]').click()
  await edit.page.locator('[data-ed="save"]').click()
  await edit.page.waitForSelector('#image-editor', {
    state: 'detached',
    timeout: 5000,
  })
  const after = await item(edit.page, SAMPLE)
  assert(
    after.width === before.height && after.height === before.width,
    'rotating 90° and saving swaps the image’s dimensions in place',
  )

  // Author role: someone else's upload is read-only.
  const author = await openPage(
    context,
    baseUrl,
    'theme=dark&scenario=author&folder=6',
  )
  await clickTile(author.page, OTHERS_UPLOAD)
  assert(
    await author.page.evaluate(
      () =>
        document.getElementById('insp-title')?.readOnly &&
        !document.querySelector('#inspector [data-mm-action="delete"]'),
    ),
    'Author role: others’ uploads are read-only, without Delete',
  )

  const allErrors = [
    ...errors,
    ...plain.errors,
    ...batch.errors,
    ...edit.errors,
    ...author.errors,
  ]
  assert(
    allErrors.length === 0,
    `no inspector page errors (${allErrors.join('; ')})`,
  )
  await context.close()
}
