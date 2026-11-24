// GET /facets (plugin-api.md §5.3, server-api.md §7.4).
import { afterAll, describe, expect, it } from 'vitest'
import { anonymous, editor, PLUGIN } from './support/http.ts'
import {
  collection,
  expectError,
  facets,
  folderTree,
  hydrate,
  info,
  type Query,
  toRows,
} from './support/library.ts'
import {
  asAuthor,
  authorAvailable,
  resetVariant,
  SKIP_REASON,
  setVariant,
  variantsAvailable,
} from './support/variants.ts'

/** Counts of /collection rows, computed on the test side. */
async function expectedCounts(query: Query) {
  const rows = toRows((await collection(query)).rows)
  const items = await hydrate(rows.map((row) => row.id))
  const kinds = rows.map((row) => row.kind)
  return {
    total: rows.length,
    bytes: rows.reduce(
      (sum, row) => sum + (items.get(row.id)?.wpu.filesize ?? 0),
      0,
    ),
    types: {
      image: kinds.filter((kind) => kind <= 1).length,
      video: kinds.filter((kind) => kind === 2).length,
      audio: kinds.filter((kind) => kind === 3).length,
      document: kinds.filter((kind) => kind >= 4).length,
    },
    missingAlt: rows.filter(
      (row) =>
        row.kind <= 1 && (items.get(row.id)?.alt_text ?? '').trim() === '',
    ).length,
  }
}

describe('GET /facets', () => {
  const queries: Query[] = [
    {},
    { type: 'image' },
    { alt: 'missing' },
    { folder: 0 },
    { folder: 0, alt: 'missing' },
    { orient: 'landscape', size: 'gt1' },
    { q: 'a' },
    { month: '2024-05' },
  ]

  for (const query of queries) {
    it(`describes exactly the collection for ${JSON.stringify(query)}`, async () => {
      const body = await facets(query)
      const expected = await expectedCounts(query)
      expect(body.view).toMatchObject(expected)
      expect(body.view.editable).toBe(body.view.total)
      expect(body.query).toEqual((await collection(query)).query)
    })
  }

  it('describes the folder alone (no other filter) in `folder` and `months`', async () => {
    const tree = await folderTree()
    const folderId = tree.folders[0]?.id ?? 0
    const filtered = await facets({
      folder: folderId,
      type: 'image',
      alt: 'missing',
    })
    const plain = await facets({ folder: folderId })
    expect(filtered.folder).toEqual(plain.view)
    expect(plain.folder).toEqual(plain.view)
    expect(plain.view.total).toBe(tree.folders[0]?.count)
    const monthTotal = plain.months.reduce((sum, month) => sum + month.count, 0)
    expect(monthTotal).toBe(plain.folder.total)
    const months = plain.months.map((month) => month.month)
    expect([...months].sort().reverse()).toEqual(months)
  })

  it('counts every month of All files, newest first', async () => {
    const body = await facets()
    expect(body.months.reduce((sum, month) => sum + month.count, 0)).toBe(
      body.folder.total,
    )
    for (const month of body.months.slice(0, 3)) {
      expect((await collection({ month: month.month })).total).toBe(month.count)
    }
  })

  it('describes the Trash in view and folder, with no months', async () => {
    const body = await facets({ folder: 'trash' })
    expect(body.months).toEqual([])
    expect(body.folder).toEqual(body.view)
    expect(body.view.total).toBe((await collection({ folder: 'trash' })).total)
  })

  it('reports usage as incomplete and every item unused while the usage index is a stub', async () => {
    const { features } = await info()
    const body = await facets()
    expect(body.indexComplete).toBe(true)
    if (!features.includes('usage')) {
      expect(body.usageComplete).toBe(false)
      expect(body.view.unused).toBe(body.view.total)
    } else {
      expect(body.view.unused).toBeLessThanOrEqual(body.view.total)
    }
  })

  it('accepts and ignores sort; validates like /collection', async () => {
    const sorted = await facets({ sort: 'title-asc' })
    expect(sorted.view).toEqual((await facets()).view)
    expectError(
      await editor.get(`${PLUGIN}/facets`, { type: 'photo' }),
      400,
      'wpu_invalid_param',
    )
    expectError(
      await editor.get(`${PLUGIN}/facets`, { folder: 999999 }),
      404,
      'wpu_folder_not_found',
    )
    expectError(await anonymous.get(`${PLUGIN}/facets`), 403, 'wpu_forbidden')
  })

  it.skipIf(!authorAvailable)(
    'counts an Author’s own items as editable',
    async () => {
      await asAuthor(async (author) => {
        const { user } = await info(author)
        const body = await facets({}, author)
        const rows = toRows((await collection({}, author)).rows)
        const items = await hydrate(
          rows.map((row) => row.id),
          author,
        )
        const own = rows.filter(
          (row) => items.get(row.id)?.author === user.id,
        ).length
        expect(body.view.total).toBe(rows.length)
        expect(body.view.editable).toBe(own)
      })
    },
  )
})

describe.skipIf(!variantsAvailable)(
  `GET /facets without FileBird (${SKIP_REASON})`,
  () => {
    afterAll(() => resetVariant())

    it('answers 409 for folder filters, and works for All files', async () => {
      setVariant({ filebird: 'off' })
      expectError(
        await editor.get(`${PLUGIN}/facets`, { folder: 0 }),
        409,
        'wpu_filebird_inactive',
      )
      expect((await facets()).view.total).toBeGreaterThan(0)
    })
  },
)
