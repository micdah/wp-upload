// The `wpu` field on /wp/v2/media (plugin-api.md §7).
import { afterAll, describe, expect, it } from 'vitest'
import { WpuFieldSchema } from '../../../shared/library-api.schema.ts'
import { MEDIA_KINDS } from '../../../shared/library-api.ts'
import { WPU_FIELD_PROVIDERS } from '../../../shared/plugin-api.ts'
import { anonymous, editor } from './support/http.ts'
import {
  collection,
  folderTree,
  hydrate,
  info,
  parse,
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

describe('the wpu field', () => {
  it('has every key, in order, and validates for a full page', async () => {
    const reply = await editor.get('/wp/v2/media', {
      per_page: 100,
      _fields: 'id,wpu',
    })
    expect(reply.status).toBe(200)
    expect(reply.body.length).toBe(100)
    for (const item of reply.body) {
      expect(Object.keys(item.wpu)).toEqual(Object.keys(WPU_FIELD_PROVIDERS))
      parse(WpuFieldSchema, item.wpu)
    }
  })

  it('matches the collection rows exactly (kind, width, height)', async () => {
    const rows = toRows((await collection()).rows)
    const items = await hydrate(rows.map((row) => row.id))
    for (const row of rows) {
      const wpu = items.get(row.id)?.wpu
      expect([row.id, wpu?.kind, wpu?.width, wpu?.height]).toEqual([
        row.id,
        MEDIA_KINDS[row.kind],
        row.width,
        row.height,
      ])
    }
  })

  it('reports folder, perms, raw text and author', async () => {
    const tree = await folderTree()
    const folder = tree.folders.find((candidate) => candidate.count > 0)
    expect(folder).toBeDefined()
    const inFolder = toRows(
      (await collection({ folder: folder?.id ?? 0 })).rows,
    ).map((row) => row.id)
    const reply = await editor.get('/wp/v2/media', {
      include: inFolder.join(','),
      context: 'edit',
      _fields: 'id,title,caption,description,author,wpu',
    })
    expect(reply.status).toBe(200)
    for (const item of reply.body) {
      expect(item.wpu.folder).toBe(folder?.id)
      expect(item.wpu.perms).toEqual({ edit: true, delete: true })
      expect(item.wpu.raw.caption).toBe(item.caption.raw)
      expect(item.wpu.raw.description).toBe(item.description.raw)
      expect(item.wpu.author.id).toBe(item.author)
      expect(item.wpu.author.name).not.toBe('')
      expect(item.wpu.trashedAt).toBeNull()
    }
  })

  it('decodes HTML entities in the raw title', async () => {
    const [id] = toRows((await collection()).rows).map((row) => row.id)
    const before = await editor.get(`/wp/v2/media/${id}`, { context: 'edit' })
    const title = before.body.title.raw as string
    try {
      expect(
        (
          await editor.post(`/wp/v2/media/${id}`, {
            title: 'Tom & Jerry "quoted"',
          })
        ).status,
      ).toBe(200)
      const after = await editor.get(`/wp/v2/media/${id}`, {
        _fields: 'id,wpu',
      })
      expect(after.body.wpu.raw.title).toBe('Tom & Jerry "quoted"')
    } finally {
      await editor.post(`/wp/v2/media/${id}`, { title })
    }
  })

  it('reports the original of a big image that WordPress scaled', async () => {
    const reply = await editor.get('/wp/v2/media', {
      per_page: 100,
      _fields: 'id,source_url,wpu',
      search: 'scaled',
    })
    const all = await hydrate(
      toRows((await collection()).rows).map((row) => row.id),
    )
    const scaled = [...all.values()].filter(
      (item) => item.wpu.original !== null,
    )
    expect(
      scaled.length,
      JSON.stringify(reply.body).slice(0, 200),
    ).toBeGreaterThan(0)
    // Not every item with an original was scaled: an EXIF-rotated upload
    // (`-rotated`, no scaling) or a replaced file can be smaller (CR-P2-5).
    for (const item of scaled) {
      const original = item.wpu.original
      expect(original?.filename).not.toMatch(/-scaled\./)
      expect(original?.width).toBeGreaterThanOrEqual(item.wpu.width)
    }
    // The seed's big images are scaled to the 2560 px threshold.
    expect(
      scaled.some((item) => Math.max(item.wpu.width, item.wpu.height) === 2560),
    ).toBe(true)
  })

  it('reports duration for audio and video, sizes for every file', async () => {
    const rows = toRows((await collection()).rows)
    const media = rows.filter((row) => row.kind === 2 || row.kind === 3)
    expect(media.length).toBeGreaterThan(0)
    const items = await hydrate(media.map((row) => row.id))
    for (const row of media) {
      expect(items.get(row.id)?.wpu.duration).toBeGreaterThan(0)
    }
    const video = rows.filter((row) => row.kind === 2)
    expect(video.every((row) => row.width > 0 && row.height > 0)).toBe(true)
  })

  it('works for a single item and is skipped unless _fields asks for it', async () => {
    const [id] = toRows((await collection()).rows).map((row) => row.id)
    const single = await editor.get(`/wp/v2/media/${id}`, { _fields: 'id,wpu' })
    expect(single.status).toBe(200)
    parse(WpuFieldSchema, single.body.wpu)
    const without = await editor.get(`/wp/v2/media/${id}`, { _fields: 'id' })
    expect(Object.keys(without.body)).toEqual(['id'])
  })

  it('stubs the P2 keys until P2 lands', async () => {
    const { features } = await info()
    const reply = await editor.get('/wp/v2/media', {
      per_page: 5,
      _fields: 'id,wpu',
    })
    if (!features.includes('usage')) {
      for (const item of reply.body) {
        expect(item.wpu.usageCount).toBeNull()
      }
    }
    if (!features.includes('image-edit')) {
      for (const item of reply.body) {
        expect([
          item.wpu.edited,
          item.wpu.editedAt,
          item.wpu.undoable,
          item.wpu.restorable,
        ]).toEqual([false, null, false, false])
      }
    }
  })

  it('is null for users without upload_files', async () => {
    const reply = await anonymous.get('/wp/v2/media', {
      per_page: 3,
      _fields: 'id,wpu',
    })
    expect(reply.status).toBe(200)
    expect(reply.body.length).toBeGreaterThan(0)
    for (const item of reply.body) {
      expect(item.wpu).toBeNull()
    }
  })

  it.skipIf(!authorAvailable)(
    'reports an Author’s perms per item',
    async () => {
      await asAuthor(async (author) => {
        const { user } = await info(author)
        const items = await hydrate(
          toRows((await collection({}, author)).rows).map((row) => row.id),
          author,
        )
        let own = 0
        let others = 0
        for (const item of items.values()) {
          const mine = item.author === user.id
          expect(item.wpu.perms).toEqual({ edit: mine, delete: mine })
          if (mine) {
            own++
          } else {
            others++
          }
        }
        expect(others).toBeGreaterThan(0)
        expect(own + others).toBe(items.size)
      })
    },
  )
})

describe.skipIf(!variantsAvailable)(
  `the wpu field with variants (${SKIP_REASON})`,
  () => {
    afterAll(() => resetVariant())

    it('has folder null without FileBird', async () => {
      setVariant({ filebird: 'off' })
      const reply = await editor.get('/wp/v2/media', {
        per_page: 20,
        _fields: 'id,wpu',
      })
      for (const item of reply.body) {
        expect(item.wpu.folder).toBeNull()
      }
    })

    it('reports the user’s own folder (0 without one) in per-user mode', async () => {
      setVariant({ filebird: 'on', peruser: 'on' })
      const tree = await folderTree()
      const reply = await editor.get('/wp/v2/media', {
        per_page: 50,
        _fields: 'id,wpu',
      })
      const own = new Set(tree.folders.map((folder) => folder.id))
      for (const item of reply.body) {
        expect(item.wpu.folder === 0 || own.has(item.wpu.folder)).toBe(true)
      }
    })
  },
)
