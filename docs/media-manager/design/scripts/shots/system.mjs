// Screenshots and interaction checks for the system feature (Agent C):
// upload, delete/trash, system states, shortcuts and palette, tablet/phone.
// Run only these with e.g. `--only system-upload`, `--only system-phone`.

const PHONE = { width: 390, height: 844 }
const TABLET = { width: 820, height: 1100 }
const SPRING_CAMPAIGN = 7

// --- Helpers that run in the page ------------------------------------------------------

// Builds real File objects (Picsum JPEGs padded to realistic sizes, plus a
// PDF and a rejected .exe) and dispatches a file drag over the grid.
async function dragFiles(page, specs) {
  await page.evaluate(async (fileSpecs) => {
    const transfer = new DataTransfer()
    for (const spec of fileSpecs) {
      let parts = [new Uint8Array(spec.size ?? 2048)]
      if (spec.picsum) {
        try {
          const response = await fetch(spec.picsum)
          const blob = await response.blob()
          // Trailing bytes after a JPEG's end marker are ignored by decoders.
          parts = [blob, new Uint8Array(Math.max(0, spec.size - blob.size))]
        } catch {
          // Offline: the file still uploads, with a placeholder tile.
        }
      }
      transfer.items.add(new File(parts, spec.name, { type: spec.type }))
    }
    window.__mmTransfer = transfer
    const target = document.querySelector('#grid')
    for (const type of ['dragenter', 'dragover']) {
      target.dispatchEvent(
        new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          dataTransfer: transfer,
        }),
      )
    }
  }, specs)
  await page.waitForSelector('.mm-drop:not([hidden])')
}

async function dropFiles(page) {
  await page.evaluate(() => {
    document.querySelector('#grid').dispatchEvent(
      new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: window.__mmTransfer,
      }),
    )
  })
  await page.waitForSelector('.mm-tray:not([hidden])')
  await page.waitForTimeout(300)
}

const UPLOAD_FILES = [
  {
    name: 'spring-hero-wide.jpg',
    type: 'image/jpeg',
    picsum: 'https://picsum.photos/id/1043/1200/800',
    size: 3_400_000,
  },
  {
    name: 'market-stall-detail.jpg',
    type: 'image/jpeg',
    picsum: 'https://picsum.photos/id/1080/800/1200',
    size: 2_100_000,
  },
  {
    name: 'blossom-close-up.jpg',
    type: 'image/jpeg',
    picsum: 'https://picsum.photos/id/306/1200/800',
    size: 4_800_000,
  },
  {
    name: 'team-picnic.jpg',
    type: 'image/jpeg',
    picsum: 'https://picsum.photos/id/1059/1200/900',
    size: 2_700_000,
  },
  { name: 'spring-menu-2026.pdf', type: 'application/pdf', size: 840_000 },
  {
    name: 'campaign-setup.exe',
    type: 'application/x-msdownload',
    size: 12_000_000,
  },
]

// Drops the files with the simulation clock frozen, then steps it, so every
// in-between state is repeatable.
async function uploadTo(page, stepMs) {
  await page.evaluate(() => window.__mmUpload.freeze())
  await dragFiles(page, UPLOAD_FILES)
  await dropFiles(page)
  await page.evaluate((ms) => window.__mmUpload.step(ms), stepMs)
  await page.mouse.move(5, 5)
  await page.waitForTimeout(250)
}

async function clickTile(page, id, modifiers = []) {
  await page.locator(`#grid .tile[data-id="${id}"]`).click({ modifiers })
}

// --- Shots ----------------------------------------------------------------------------

function themed(name, query, rest = {}) {
  return ['dark', 'light'].map((theme) => ({
    name: `system-${name}-${theme}`,
    query: `theme=${theme}${query ? `&${query}` : ''}`,
    ...rest,
  }))
}

export const shots = [
  // Upload
  ...themed('upload-drop', `folder=${SPRING_CAMPAIGN}`, {
    prepare: (page) => dragFiles(page, UPLOAD_FILES.slice(0, 2)),
  }),
  ...themed('upload-progress', `folder=${SPRING_CAMPAIGN}`, {
    prepare: (page) => uploadTo(page, 1300),
  }),
  ...themed('upload-processing', `folder=${SPRING_CAMPAIGN}`, {
    prepare: (page) => uploadTo(page, 4200),
  }),
  ...themed('upload-error', `folder=${SPRING_CAMPAIGN}`, {
    prepare: (page) => uploadTo(page, 14000),
  }),
  // Delete and trash
  ...themed('delete-remove-folder', `folder=${SPRING_CAMPAIGN}`, {
    prepare: async (page) => {
      await clickTile(page, 1079)
      await clickTile(page, 1070, ['Control'])
      await page.keyboard.press('Delete')
      await page.mouse.move(5, 5)
    },
  }),
  ...themed('delete-folder-menu', `folder=${SPRING_CAMPAIGN}`, {
    prepare: async (page) => {
      await clickTile(page, 1079)
      await clickTile(page, 1070, ['Control'])
      await page.locator('.selection-bar [data-mm-action="delete"]').click()
    },
  }),
  ...themed('delete-confirm', '', {
    prepare: async (page) => {
      await clickTile(page, 1084)
      await clickTile(page, 1083, ['Control'])
      await clickTile(page, 1079, ['Control'])
      await page.keyboard.press('Delete')
      await page.waitForSelector('.mm-confirm')
    },
  }),
  ...themed('delete-trash-toast', 'scenario=trash', {
    prepare: async (page) => {
      await clickTile(page, 1085)
      await page.keyboard.press('Delete')
      await page.mouse.move(5, 5)
    },
  }),
  ...themed('delete-trash-view', 'scenario=trash', {
    prepare: async (page) => {
      await page.locator('[data-mm-trash]').click()
      await page.locator('.mm-trash .tile').nth(1).click()
      await page.waitForTimeout(300)
      await page.mouse.move(5, 5)
    },
  }),
  // System states
  ...themed('states-no-plugin', 'scenario=no-plugin'),
  ...themed('states-offline', 'scenario=offline'),
  ...themed('states-author', 'scenario=author', {
    prepare: async (page) => {
      await clickTile(page, 1084)
      await page.mouse.move(5, 5)
    },
  }),
  ...themed('states-loading', 'scenario=loading'),
  ...themed('states-empty', 'scenario=empty'),
  // Shortcuts and palette
  ...themed('shortcuts-sheet', '', {
    prepare: async (page) => {
      await page.locator('#grid .tile').first().click()
      await page.keyboard.press('?')
      await page.waitForSelector('.mm-sheet')
    },
  }),
  ...themed('shortcuts-palette', '', {
    prepare: async (page) => {
      await page.keyboard.press('Control+k')
      await page.keyboard.type('spri')
      await page.keyboard.press('ArrowDown')
      await page.waitForTimeout(400)
    },
  }),
  // Tablet and phone
  ...themed('tablet-grid', '', { viewport: TABLET }),
  ...themed('tablet-inspector', 'folder=12', {
    viewport: TABLET,
    prepare: async (page) => {
      await page.locator('#grid .tile').nth(1).click()
      await page.locator('[data-panel="inspector"]').click()
    },
  }),
  ...themed('phone-grid', '', { viewport: PHONE }),
  ...themed('phone-folders', '', {
    viewport: PHONE,
    prepare: (page) => page.locator('[data-panel="folders"]').click(),
  }),
  ...themed('phone-selection', '', {
    viewport: PHONE,
    prepare: async (page) => {
      await page.locator('#grid .tile').nth(0).click()
      await page
        .locator('#grid .tile')
        .nth(2)
        .click({ modifiers: ['Control'] })
      await page
        .locator('#grid .tile')
        .nth(3)
        .click({ modifiers: ['Control'] })
    },
  }),
  ...themed('phone-detail', 'item=1003', { viewport: PHONE }),
  ...themed('phone-info', 'item=1003', {
    viewport: PHONE,
    prepare: (page) => page.locator('.mm-detail-info').click(),
  }),
]

// --- Checks ------------------------------------------------------------------------------

async function tileCount(page) {
  return page.locator('#grid .tile').count()
}

export async function checks(browser, baseUrl, { openPage, assert, DESKTOP }) {
  console.log('System checks')
  const context = await browser.newContext({ viewport: DESKTOP })
  const { page, errors } = await openPage(context, baseUrl, 'theme=dark')

  // Shortcut sheet lists every binding group, including other features'.
  await page.locator('#grid .tile').first().click()
  const tileId = await page.evaluate(() => document.activeElement.dataset.id)
  await page.keyboard.press('?')
  await page.waitForSelector('.mm-sheet')
  const groups = await page
    .locator('.mm-sheet .section__title')
    .allTextContents()
  const expected = await page.evaluate(async () => {
    const { BINDINGS } = await import('./js/keymap.js')
    return [...new Set(BINDINGS.map((binding) => binding.group))]
  })
  assert(
    expected.every((group) => groups.includes(group)),
    `? opens the shortcut sheet with every keymap group (${expected.join(', ')})`,
  )
  await page.keyboard.press('f')
  assert(
    (await page.getAttribute('#app', 'data-folders')) === 'open',
    'keys pressed inside the sheet do not reach the global keymap',
  )
  await page.keyboard.press('Escape')
  await page.waitForSelector('.mm-sheet', { state: 'detached' })
  assert(
    (await page.locator('.mm-sheet').count()) === 0 &&
      (await page.evaluate(() => document.activeElement.dataset.id)) === tileId,
    'Esc closes the sheet and returns focus to the tile',
  )

  // Command palette: fuzzy filter, arrows, Enter runs.
  await page.keyboard.press('Control+k')
  await page.waitForSelector('.mm-palette')
  await page.keyboard.type('missing alt')
  const first = await page
    .locator('.mm-palette__item[aria-selected="true"] .mm-palette__label')
    .textContent()
  assert(/missing alt/i.test(first), `Ctrl+K palette filters ("${first}")`)
  await page.keyboard.press('Enter')
  await page.waitForFunction(() => location.search.includes('alt=missing'))
  assert(true, 'Enter runs the palette command (missing-alt filter on)')
  await page.keyboard.press('Control+k')
  await page.keyboard.type('xqzv')
  assert(
    (await page.locator('.mm-palette__empty').count()) === 1,
    'palette shows an empty result for no matches',
  )
  await page.keyboard.press('Escape')

  // Delete in a folder removes from the folder; Ctrl+Z undoes it.
  const folderPage = await openPage(
    context,
    baseUrl,
    `folder=${SPRING_CAMPAIGN}`,
  )
  const before = await tileCount(folderPage.page)
  await clickTile(folderPage.page, 1079)
  await folderPage.page.keyboard.press('Delete')
  await folderPage.page.waitForSelector('.toast .toast__action')
  assert(
    (await tileCount(folderPage.page)) === before - 1,
    'Delete in a folder removes the item from the folder with an undo toast',
  )
  await folderPage.page.keyboard.press('Control+z')
  await folderPage.page.waitForTimeout(200)
  assert(
    (await tileCount(folderPage.page)) === before,
    'Ctrl+Z triggers the toast’s Undo',
  )

  // Shift+Delete asks before deleting permanently (no MEDIA_TRASH).
  await clickTile(folderPage.page, 1084)
  await folderPage.page.keyboard.press('Shift+Delete')
  await folderPage.page.waitForSelector('.mm-confirm')
  assert(
    (await folderPage.page.locator('.mm-usage__list li').count()) > 0,
    'Shift+Delete opens the permanent-delete confirm with where-used',
  )
  await folderPage.page.keyboard.press('Escape')
  await folderPage.page.waitForSelector('.mm-confirm', { state: 'detached' })
  assert(
    (await tileCount(folderPage.page)) === before &&
      (await folderPage.page.locator('.mm-confirm').count()) === 0,
    'Esc cancels the confirm and keeps the item',
  )

  // File drag shows the overlay naming the folder; U opens the picker.
  await dragFiles(folderPage.page, [{ name: 'a.jpg', type: 'image/jpeg' }])
  const overlay = await folderPage.page.locator('.mm-drop').textContent()
  assert(
    overlay.includes('Spring campaign'),
    'dragging files shows the drop overlay naming the folder',
  )
  await dropFiles(folderPage.page)
  await folderPage.page.waitForSelector('#grid .tile[data-id^="-"]')
  assert(
    (await tileCount(folderPage.page)) === before + 1,
    'dropped files appear as new tiles in the folder',
  )
  // The file chooser event is only reliable on the sole page of a context,
  // so this check gets a fresh one.
  const pickerContext = await browser.newContext({ viewport: DESKTOP })
  const pickerPage = await openPage(pickerContext, baseUrl, 'folder=7')
  await pickerPage.page.locator('#grid .tile').first().click()
  const [chooser] = await Promise.all([
    pickerPage.page.waitForEvent('filechooser', { timeout: 10000 }),
    pickerPage.page.keyboard.press('u'),
  ])
  assert(chooser.isMultiple(), 'U opens a multi-file picker')
  await pickerContext.close()

  // Trash: Delete moves to Trash, the Trash view restores.
  const trashPage = await openPage(context, baseUrl, 'scenario=trash')
  const trashBefore = await trashPage.page
    .locator('[data-mm-trash] .tree__count')
    .textContent()
  await clickTile(trashPage.page, 1085)
  await trashPage.page.keyboard.press('Delete')
  await trashPage.page.waitForSelector('.toast')
  const trashAfter = await trashPage.page
    .locator('[data-mm-trash] .tree__count')
    .textContent()
  assert(
    Number(trashAfter) === Number(trashBefore) + 1 &&
      (await trashPage.page.locator('#grid .tile[data-id="1085"]').count()) ===
        0,
    'with MEDIA_TRASH, Delete moves the item to Trash',
  )
  await trashPage.page.locator('[data-mm-trash]').click()
  await trashPage.page.locator('.mm-trash .tile[data-id="1085"]').click()
  await trashPage.page.locator('[data-trash="restore"]').click()
  await trashPage.page.keyboard.press('Escape')
  assert(
    (await trashPage.page.locator('#grid .tile[data-id="1085"]').count()) === 1,
    'Restore in the Trash view puts the item back',
  )
  await trashPage.page
    .locator(`.tree__row[data-folder="${SPRING_CAMPAIGN}"]`)
    .click()
  assert(
    (await trashPage.page.locator('[data-mm-trash]').count()) === 1,
    'the Trash row survives folder tree re-renders',
  )

  // Phone: swipe steps between items in detail mode.
  const phone = await browser.newContext({ viewport: PHONE })
  const phonePage = await openPage(phone, baseUrl, 'item=1003')
  const box = await phonePage.page.locator('#detail .stage').boundingBox()
  const y = box.y + box.height / 2
  await phonePage.page.mouse.move(box.x + box.width - 40, y)
  await phonePage.page.mouse.down()
  await phonePage.page.mouse.move(box.x + 60, y, { steps: 8 })
  await phonePage.page.mouse.up()
  await phonePage.page.waitForTimeout(500)
  assert(
    !phonePage.page.url().includes('item=1003'),
    'swiping left on the phone detail stage shows the next item',
  )

  const allErrors = [
    ...errors,
    ...folderPage.errors,
    ...trashPage.errors,
    ...phonePage.errors,
  ]
  assert(allErrors.length === 0, `no page errors (${allErrors.join('; ')})`)
  await phone.close()
  await context.close()
}
