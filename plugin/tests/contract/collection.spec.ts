// GET /collection (plugin-api.md §5.2, server-api.md §6).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MEDIA_KINDS } from '../../../shared/library-api.ts'
import { anonymous, editor, PLUGIN } from './support/http.ts'
import {
  collection,
  ensureMediaIndexReady,
  expectError,
  folderTree,
  hydrate,
  ids,
  type Row,
  toRows,
} from './support/library.ts'
import {
  asAuthor,
  authorAvailable,
  resetVariant,
  SKIP_REASON,
  setVariant,
  variantsAvailable,
  WP_EVAL_SKIP_REASON,
  wpEval,
  wpEvalAvailable,
} from './support/variants.ts'

const IMAGE_LIKE = [0, 1]

function isPermutation(a: number[], b: number[]): boolean {
  return (
    a.length === b.length &&
    [...a].sort((x, y) => x - y).join() === [...b].sort((x, y) => x - y).join()
  )
}

describe('GET /collection', () => {
  let all: Row[]

  beforeAll(async () => {
    all = toRows((await collection()).rows)
  })

  it('lists every attachment once, echoing the normalised query', async () => {
    const body = await collection()
    expect(body.query).toEqual({
      folder: 'all',
      q: null,
      type: null,
      alt: null,
      size: null,
      orient: null,
      month: null,
      sort: 'date-desc',
    })
    expect(body.indexComplete).toBe(true)
    expect(body.total).toBeGreaterThan(0)
    expect(new Set(all.map((row) => row.id)).size).toBe(body.total)

    const core = await editor.get('/wp/v2/media', {
      per_page: 1,
      status: 'inherit,private',
    })
    expect(Number(core.headers.get('x-wp-total'))).toBe(body.total)
  })

  it('reports the same kind and size as the wpu field', async () => {
    const items = await hydrate(all.map((row) => row.id))
    expect(items.size).toBe(all.length)
    for (const row of all) {
      const wpu = items.get(row.id)?.wpu
      expect({
        id: row.id,
        kind: MEDIA_KINDS[row.kind],
        width: row.width,
        height: row.height,
      }).toEqual({
        id: row.id,
        kind: wpu?.kind,
        width: wpu?.width,
        height: wpu?.height,
      })
    }
  })

  it('sorts date-desc by upload date, newest first; date-asc is its reverse', async () => {
    const items = await hydrate(all.map((row) => row.id))
    const dates = all.map((row) => items.get(row.id)?.date ?? '')
    expect([...dates].sort().reverse()).toEqual(dates)
    const ascending = await ids({ sort: 'date-asc' })
    expect(ascending).toEqual([...all.map((row) => row.id)].reverse())
  })

  it('sorts by size and dimensions, unknown last, ties by id', async () => {
    const items = await hydrate(all.map((row) => row.id))
    const bySize = await ids({ sort: 'size-desc' })
    const sizes = bySize.map((id) => items.get(id)?.wpu.filesize ?? null)
    for (let index = 1; index < sizes.length; index++) {
      const previous = sizes[index - 1]
      const current = sizes[index]
      if (previous === null) {
        expect(current).toBeNull()
      } else if (
        current !== null &&
        current !== undefined &&
        previous !== undefined
      ) {
        expect(previous).toBeGreaterThanOrEqual(current)
        if (previous === current) {
          expect(bySize[index - 1]).toBeGreaterThan(bySize[index] ?? 0)
        }
      }
    }
    const ascending = await ids({ sort: 'size-asc' })
    const ascendingSizes = ascending.map(
      (id) => items.get(id)?.wpu.filesize ?? null,
    )
    const known = ascendingSizes.filter((size) => size !== null)
    expect([...known].sort((a, b) => a - b)).toEqual(known)

    const byDimensions = toRows(
      (await collection({ sort: 'dimensions-desc' })).rows,
    )
    const pixels = byDimensions.map((row) => row.width * row.height)
    const firstZero = pixels.indexOf(0)
    const nonZero = firstZero === -1 ? pixels : pixels.slice(0, firstZero)
    expect([...nonZero].sort((a, b) => b - a)).toEqual(nonZero)
    if (firstZero !== -1) {
      expect(pixels.slice(firstZero).every((value) => value === 0)).toBe(true)
    }
  })

  it('sorts by type (MIME), then newest first', async () => {
    const items = await hydrate(all.map((row) => row.id))
    const byType = await ids({ sort: 'type-asc' })
    const mimes = byType.map((id) => items.get(id)?.mime_type ?? '')
    expect([...mimes].sort()).toEqual(mimes)
  })

  it('orders title-asc and name-asc as permutations of the collection', async () => {
    const everything = all.map((row) => row.id)
    expect(isPermutation(await ids({ sort: 'title-asc' }), everything)).toBe(
      true,
    )
    expect(isPermutation(await ids({ sort: 'name-asc' }), everything)).toBe(
      true,
    )
  })

  it('filters by type', async () => {
    const images = toRows((await collection({ type: 'image' })).rows)
    expect(images.length).toBeGreaterThan(0)
    expect(images.every((row) => IMAGE_LIKE.includes(row.kind))).toBe(true)
    const video = toRows((await collection({ type: 'video' })).rows)
    expect(video.every((row) => row.kind === 2)).toBe(true)
    const audio = toRows((await collection({ type: 'audio' })).rows)
    expect(audio.every((row) => row.kind === 3)).toBe(true)
    const documents = toRows((await collection({ type: 'document' })).rows)
    expect(documents.every((row) => row.kind >= 4)).toBe(true)
    expect(images.length + video.length + audio.length + documents.length).toBe(
      all.length,
    )
  })

  it('filters missing alt text (image-like items only)', async () => {
    const missing = toRows((await collection({ alt: 'missing' })).rows)
    expect(missing.length).toBeGreaterThan(0)
    const items = await hydrate(missing.map((row) => row.id))
    for (const row of missing) {
      expect(IMAGE_LIKE).toContain(row.kind)
      expect(items.get(row.id)?.alt_text.trim()).toBe('')
    }
  })

  it('filters by file size', async () => {
    const items = await hydrate(all.map((row) => row.id))
    for (const [size, bytes] of [
      ['gt1', 1_000_000],
      ['gt5', 5_000_000],
    ] as const) {
      const expected = all
        .filter((row) => (items.get(row.id)?.wpu.filesize ?? 0) > bytes)
        .map((row) => row.id)
      expect(isPermutation(await ids({ size }), expected)).toBe(true)
    }
  })

  it('filters by orientation with integer arithmetic; 0 × 0 never matches', async () => {
    const landscape = toRows((await collection({ orient: 'landscape' })).rows)
    const portrait = toRows((await collection({ orient: 'portrait' })).rows)
    const square = toRows((await collection({ orient: 'square' })).rows)
    expect(
      landscape.every(
        (row) => row.width * 10 > row.height * 11 && row.height > 0,
      ),
    ).toBe(true)
    expect(
      portrait.every((row) => row.width * 10 < row.height * 9 && row.width > 0),
    ).toBe(true)
    expect(
      square.every(
        (row) =>
          row.width > 0 &&
          row.height > 0 &&
          row.width * 10 <= row.height * 11 &&
          row.width * 10 >= row.height * 9,
      ),
    ).toBe(true)
    const known = all.filter((row) => row.width > 0 && row.height > 0).length
    expect(landscape.length + portrait.length + square.length).toBe(known)
  })

  it('filters by upload month (site time)', async () => {
    const items = await hydrate(all.map((row) => row.id))
    const month = (items.get(all[0]?.id ?? 0)?.date ?? '').slice(0, 7)
    const expected = all
      .filter((row) => items.get(row.id)?.date.startsWith(month))
      .map((row) => row.id)
    expect(await ids({ month })).toEqual(expected)
  })

  it('searches title, file name and alt text; every term must match', async () => {
    const items = await hydrate(all.map((row) => row.id))
    const sample = items.get(all[0]?.id ?? 0)
    const title = sample?.title.rendered ?? ''
    const [firstWord] = title.split(/\s+/)
    expect(firstWord).toBeTruthy()
    const byTitle = await ids({ q: firstWord?.toUpperCase() ?? '' })
    expect(byTitle).toContain(sample?.id)

    const both = await ids({ q: `${firstWord} zzzz-no-such-term` })
    expect(both).toEqual([])

    const withAlt = [...items.values()].find(
      (item) => item.alt_text.trim().split(/\s+/).length > 1,
    )
    if (withAlt) {
      const altWord = withAlt.alt_text.trim().split(/\s+/).pop() ?? ''
      expect(await ids({ q: altWord })).toContain(withAlt.id)
    }

    // LIKE wildcards are escaped: they match only themselves.
    expect((await ids({ q: '%' })).length).toBeLessThan(all.length)
    expect((await ids({ q: '_' })).length).toBeLessThan(all.length)
  })

  it('combines filters with AND', async () => {
    const images = new Set(await ids({ type: 'image' }))
    const landscape = new Set(await ids({ orient: 'landscape' }))
    const both = await ids({ type: 'image', orient: 'landscape' })
    expect(both.every((id) => images.has(id) && landscape.has(id))).toBe(true)
    expect(both.length).toBe(
      [...images].filter((id) => landscape.has(id)).length,
    )
  })

  it('treats empty values as absent and ignores unknown parameters', async () => {
    const body = await collection({
      q: '',
      type: '',
      unknownParam: 'x',
      _locale: 'user',
    })
    expect(body.total).toBe(all.length)
    expect(body.query.q).toBeNull()
  })

  it('rejects invalid parameters with 400 wpu_invalid_param and data.param', async () => {
    const cases: Record<string, string>[] = [
      { folder: 'abc' },
      { folder: '-1' },
      { folder: '01' },
      { type: 'photo' },
      { alt: 'present' },
      { size: 'gt2' },
      { orient: 'round' },
      { month: '2024-13' },
      { sort: 'random' },
      { q: 'x'.repeat(201) },
      { q: 'a b c d e f g h i j k' },
    ]
    for (const query of cases) {
      const reply = await editor.get(`${PLUGIN}/collection`, query)
      expectError(reply, 400, 'wpu_invalid_param')
      expect(reply.body.data.param).toBe(Object.keys(query)[0])
    }
    const reply = await editor.get(`${PLUGIN}/collection?type[]=image`)
    expectError(reply, 400, 'wpu_invalid_param')
  })

  it('accepts a 200-character query with 10 terms', async () => {
    const ten = 'a b c d e f g h i j'
    expect((await collection({ q: ten })).query.q).toBe(ten)
    expect((await collection({ q: 'y'.repeat(200) })).total).toBe(0)
    expect((await collection({ q: '  two   spaces ' })).query.q).toBe(
      'two spaces',
    )
  })

  it('answers 404 wpu_folder_not_found for an unknown folder', async () => {
    const reply = await editor.get(`${PLUGIN}/collection`, { folder: 999999 })
    expectError(reply, 404, 'wpu_folder_not_found')
    expect(reply.body.data.folder).toBe(999999)
  })

  it('lists one folder (not its subfolders) and Uncategorized', async () => {
    const tree = await folderTree()
    const items = await hydrate(all.map((row) => row.id))
    const parent = tree.folders.find((folder) =>
      tree.folders.some((child) => child.parent === folder.id),
    )
    expect(parent).toBeDefined()
    for (const folder of tree.folders) {
      const body = await collection({ folder: folder.id })
      expect(body.query.folder).toBe(folder.id)
      expect(body.total).toBe(folder.count)
      for (const row of toRows(body.rows)) {
        expect(items.get(row.id)?.wpu.folder).toBe(folder.id)
      }
    }
    const uncategorized = await collection({ folder: 0 })
    expect(uncategorized.query.folder).toBe(0)
    expect(uncategorized.total).toBe(tree.counts.uncategorized)
    for (const row of toRows(uncategorized.rows)) {
      expect(items.get(row.id)?.wpu.folder).toBe(0)
    }
  })

  it('ignores filters and sort in the Trash', async () => {
    const body = await collection({
      folder: 'trash',
      q: 'x',
      type: 'image',
      sort: 'title-asc',
    })
    expect(body.query).toEqual({
      folder: 'trash',
      q: null,
      type: null,
      alt: null,
      size: null,
      orient: null,
      month: null,
      sort: 'date-desc',
    })
  })

  it('answers 403 wpu_forbidden without credentials', async () => {
    expectError(
      await anonymous.get(`${PLUGIN}/collection`),
      403,
      'wpu_forbidden',
    )
  })

  it.skipIf(!authorAvailable)(
    'shows an Author only what core lets them read',
    async () => {
      await asAuthor(async (author) => {
        const visible = await ids({}, author)
        expect(visible.length).toBeGreaterThan(0)
        expect(visible.length).toBeLessThanOrEqual(all.length)
        const hydrated = await hydrate(visible, author)
        expect([...visible].filter((id) => !hydrated.has(id))).toEqual([])

        const hidden = all
          .map((row) => row.id)
          .filter((id) => !visible.includes(id))
        for (const id of hidden.slice(0, 10)) {
          const reply = await author.get(`/wp/v2/media/${id}`)
          expect(
            reply.status,
            `item ${id} is hidden from the collection but readable`,
          ).not.toBe(200)
        }
      })
    },
  )
})

describe('GET /collection with the Trash', () => {
  it.skipIf(!variantsAvailable)(
    'lists trashed items newest-trashed first, only there',
    async () => {
      setVariant({ trash: 'on' })
      const [first, second] = await ids()
      try {
        expect((await editor.del(`/wp/v2/media/${first}`)).status).toBe(200)
        await new Promise((resolve) => setTimeout(resolve, 1100))
        expect((await editor.del(`/wp/v2/media/${second}`)).status).toBe(200)

        const trash = toRows((await collection({ folder: 'trash' })).rows).map(
          (row) => row.id,
        )
        expect(trash.slice(0, 2)).toEqual([second, first])
        const live = await ids()
        expect(live).not.toContain(first)
        expect(live).not.toContain(second)
        const items = await hydrate([first ?? 0, second ?? 0], editor, 'trash')
        expect(items.get(first ?? 0)?.wpu.trashedAt).toMatch(/Z$/)
      } finally {
        // P2's restore route (feature `trash`), so this runs in the runner too.
        await editor.post(`${PLUGIN}/trash/restore`, { ids: [first, second] })
        resetVariant()
      }
      expect(await ids()).toEqual(expect.arrayContaining([first, second]))
    },
  )
})

describe.skipIf(!variantsAvailable)(
  `GET /collection with variants (${SKIP_REASON})`,
  () => {
    afterAll(() => resetVariant())

    it('answers 409 wpu_filebird_inactive for folder filters without FileBird', async () => {
      setVariant({ filebird: 'off' })
      expectError(
        await editor.get(`${PLUGIN}/collection`, { folder: 0 }),
        409,
        'wpu_filebird_inactive',
      )
      expectError(
        await editor.get(`${PLUGIN}/collection`, { folder: 1 }),
        409,
        'wpu_filebird_inactive',
      )
      expect((await collection({ folder: 'all' })).total).toBeGreaterThan(0)
      expect((await collection({ folder: 'trash' })).query.folder).toBe('trash')
    })

    it('serves folder filters from the user’s own tree in per-user mode', async () => {
      setVariant({ filebird: 'on', peruser: 'on' })
      const tree = await folderTree()
      expect(tree.mode.perUser).toBe(true)
      const everything = await collection()
      const uncategorized = await collection({ folder: 0 })
      expect(uncategorized.total).toBe(tree.counts.uncategorized)
      if (tree.folders.length === 0) {
        expect(uncategorized.total).toBe(everything.total)
      }
      // Shared-tree folders are not in this user's tree.
      setVariant({ peruser: 'off' })
      const shared = await folderTree()
      setVariant({ peruser: 'on' })
      const sharedId = shared.folders[0]?.id
      if (
        sharedId !== undefined &&
        !tree.folders.some((folder) => folder.id === sharedId)
      ) {
        expectError(
          await editor.get(`${PLUGIN}/collection`, { folder: sharedId }),
          404,
          'wpu_folder_not_found',
        )
      }
    })

    it.skipIf(!wpEvalAvailable)(
      `lists the same rows from wp_posts while the index is stale (${WP_EVAL_SKIP_REASON})`,
      async () => {
        setVariant({ peruser: 'off' })
        const queries: Record<string, string | number>[] = [
          {},
          { sort: 'date-asc' },
          { sort: 'type-asc' },
          { type: 'image', orient: 'portrait' },
          { folder: 0 },
          { folder: 2 },
          { month: '2024-05' },
          { size: 'gt1' },
        ]
        const before = await Promise.all(
          queries.map((query) => collection(query)),
        )
        wpEval('WpUpload\\Companion\\Index\\MediaIndex::mark_stale();')
        try {
          const info = await editor.get(`${PLUGIN}/rev`)
          expect(info.body.index.media.state).toBe('stale')
          for (const [index, query] of queries.entries()) {
            const during = await collection(query)
            expect(during.indexComplete).toBe(false)
            expect({ query, rows: during.rows }).toEqual({
              query,
              rows: before[index]?.rows,
            })
          }
        } finally {
          await ensureMediaIndexReady()
        }
        expect((await collection()).indexComplete).toBe(true)
      },
    )
  },
)
