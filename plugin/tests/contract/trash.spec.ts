// Contract tests for POST /media/trash, /media/delete, GET /trash, POST /trash/restore and
// /trash/empty (plugin-api.md §5.5–5.9), track P2.
//
// MEDIA_TRASH can only be switched from the host (`dev/run variant trash=on`), so the
// "trash on" tests run where the helpers can reach dev/run, and are skipped in the runner.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  EmptyTrashResponseSchema,
  PluginDeleteResponseSchema,
  PluginRestoreResponseSchema,
  TrashSummarySchema,
} from '../../../shared/library-api.schema.ts'
import { editor as editorClient, PLUGIN } from './support/http.ts'
import {
  author,
  type Credentials,
  canSwitchVariants,
  editor,
  type Json,
  makePng,
  plugin,
  rest,
  upload,
  variant,
  wpUrl,
} from './support/p2.ts'

// Uploads and image operations wait for WordPress to make every sub-size.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

const ready = wpUrl !== '' && editor.user !== ''
const switchable = ready && canSwitchVariants()

async function freshItem(
  name: string,
  as: Credentials = editor,
): Promise<number> {
  return (await upload(`${name}.png`, makePng(40, 30), 'image/png', as)).id
}

describe.skipIf(!ready)('Trash and delete', () => {
  it('GET /trash summarises the Trash', async () => {
    const reply = await plugin('GET', '/trash')
    expect(reply.status).toBe(200)
    TrashSummarySchema.parse(reply.json)
    expect(reply.json.days).toBeGreaterThanOrEqual(0)
  })

  it('POST /media/delete deletes permanently, with its files', async () => {
    const item = await upload('p2-delete.png', makePng(40, 30), 'image/png')
    const reply = await plugin('POST', '/media/delete', {
      body: { ids: [item.id, 999999] },
    })
    expect(reply.status).toBe(200)
    PluginDeleteResponseSchema.parse(reply.json)
    expect(reply.json.results[0]).toEqual({
      id: item.id,
      ok: true,
      trash: null,
    })
    expect(reply.json.results[1]).toMatchObject({
      ok: false,
      error: { code: 'wpu_not_found' },
    })
    expect((await fetch(item.source_url)).status).toBe(404)
    const again = await plugin('POST', '/media/delete', {
      body: { ids: [item.id] },
    })
    expect(again.json.results[0].error.code).toBe('wpu_not_found')
  })

  it.each([
    ['/media/trash', { ids: [] }],
    ['/media/delete', { ids: [0] }],
    ['/trash/restore', { ids: 'x' }],
    ['/media/delete', { ids: [1], extra: true }],
  ])('%s rejects %j with 400', async (route, body) => {
    const reply = await plugin('POST', route, { body })
    expect(reply.status).toBe(400)
    expect(reply.json.code).toBe('wpu_invalid_param')
  })

  it('reads ids as JSON integers only, and answers once per distinct id (§1.2, P-10)', async () => {
    for (const route of ['/media/trash', '/media/delete', '/trash/restore']) {
      for (const raw of ['{"ids":[1.0]}', '{"ids":[1.5]}', '{"ids":["1"]}']) {
        const reply = await editorClient.raw('POST', `${PLUGIN}${route}`, raw)
        expect(reply.status, `${route} ${raw}`).toBe(400)
        expect(reply.body).toMatchObject({
          code: 'wpu_invalid_param',
          data: { param: 'ids' },
        })
      }
    }
    const batch = await editorClient.raw(
      'POST',
      `${PLUGIN}/media/batch`,
      '{"items":[{"id":1.0,"set":{"caption":"x"}}]}',
    )
    expect(batch.status).toBe(400)
    expect(batch.body.data.param).toBe('items[0].id')

    const item = await freshItem('p2-delete-duplicates')
    const reply = await plugin('POST', '/media/delete', {
      body: { ids: [item, 999999, item, 999999] },
    })
    expect(reply.status).toBe(200)
    expect(reply.json.results.map((result: Json) => result.id)).toEqual([
      item,
      999999,
    ])
    expect(reply.json.results[0]).toEqual({ id: item, ok: true, trash: null })
  })

  it('rejects more than 100 ids with wpu_too_many_items', async () => {
    const reply = await plugin('POST', '/media/delete', {
      body: { ids: Array.from({ length: 101 }, (_, i) => i + 1) },
    })
    expect(reply.json).toMatchObject({
      code: 'wpu_too_many_items',
      data: { max: 100 },
    })
  })

  it('POST /trash/empty validates budgetMs', async () => {
    const reply = await plugin('POST', '/trash/empty', {
      body: { budgetMs: 50 },
    })
    expect(reply.status).toBe(400)
    expect(reply.json.data.param).toBe('budgetMs')
  })

  describe.skipIf(author === null)('as the Author', () => {
    it('can’t delete other users’ items, item by item', async () => {
      const others = await freshItem('p2-delete-others')
      const own = await freshItem('p2-delete-own', author as Credentials)
      const reply = await plugin('POST', '/media/delete', {
        as: author,
        body: { ids: [others, own] },
      })
      expect(reply.status).toBe(200)
      expect(reply.json.results[0]).toMatchObject({
        ok: false,
        error: { code: 'wpu_forbidden' },
      })
      expect(reply.json.results[1]).toEqual({ id: own, ok: true, trash: null })
    })
  })
})

describe.skipIf(!ready)('Trash with MEDIA_TRASH off (the default)', () => {
  it('POST /media/trash answers 409 wpu_trash_disabled', async () => {
    const summary = await plugin('GET', '/trash')
    if (summary.json.enabled) return // The stack runs with trash=on; covered below.
    const reply = await plugin('POST', '/media/trash', { body: { ids: [1] } })
    expect(reply.status).toBe(409)
    expect(reply.json.code).toBe('wpu_trash_disabled')
  })
})

describe.skipIf(!switchable)('Trash with MEDIA_TRASH on (trash=on)', () => {
  beforeAll(() => variant('trash=on'))
  afterAll(() => variant('trash=off'))

  it('trashes, reports the trash state, and restores into the same folder', async () => {
    const id = await freshItem('p2-trash')
    const trashed = await plugin('POST', '/media/trash', {
      body: { ids: [id] },
    })
    expect(trashed.status).toBe(200)
    PluginDeleteResponseSchema.parse(trashed.json)
    const state = trashed.json.results[0].trash
    expect(state.daysLeft).toBe((await plugin('GET', '/trash')).json.days)
    expect(Date.parse(state.trashedAt)).toBeGreaterThan(Date.now() - 120_000)

    // Already trashed: succeeds with its existing state.
    const again = await plugin('POST', '/media/trash', { body: { ids: [id] } })
    expect(again.json.results[0]).toEqual({ id, ok: true, trash: state })

    const summary = await plugin('GET', '/trash')
    expect(summary.json).toMatchObject({ enabled: true })
    expect(summary.json.count).toBeGreaterThanOrEqual(1)

    const restored = await plugin('POST', '/trash/restore', {
      body: { ids: [id] },
    })
    PluginRestoreResponseSchema.parse(restored.json)
    expect(restored.json.results[0]).toMatchObject({ id, ok: true })
    const item = await rest(
      'GET',
      `/wp/v2/media/${id}?context=edit&_fields=status`,
    )
    expect(item.json.status).toBe('inherit')

    const notTrashed = await plugin('POST', '/trash/restore', {
      body: { ids: [id] },
    })
    expect(notTrashed.json.results[0]).toMatchObject({
      ok: false,
      error: { code: 'wpu_not_trashed' },
    })
  })

  it('restores a filed item into its FileBird folder (needs P1’s wpu.folder)', async () => {
    const list = await rest('GET', '/wp/v2/media?per_page=100&_fields=id,wpu')
    const filed = list.json.find((item: Json) => (item.wpu?.folder ?? 0) > 0)
    if (!filed) return // No wpu field on this branch yet, or nothing is filed.
    await plugin('POST', '/media/trash', { body: { ids: [filed.id] } })
    const restored = await plugin('POST', '/trash/restore', {
      body: { ids: [filed.id] },
    })
    expect(restored.json.results[0]).toEqual({
      id: filed.id,
      ok: true,
      folder: filed.wpu.folder,
    })
  })

  it('empties the Trash oldest first, within the budget', async () => {
    const ids = [await freshItem('p2-empty-1'), await freshItem('p2-empty-2')]
    await plugin('POST', '/media/trash', { body: { ids } })
    const reply = await plugin('POST', '/trash/empty', {
      body: { budgetMs: 20000 },
    })
    expect(reply.status).toBe(200)
    EmptyTrashResponseSchema.parse(reply.json)
    expect(reply.json.deleted).toBeGreaterThanOrEqual(2)
    expect(reply.json.remaining).toBe(0)
    const gone = await plugin('POST', '/trash/restore', { body: { ids } })
    expect(gone.json.results.map((r: Json) => r.error?.code)).toEqual([
      'wpu_not_found',
      'wpu_not_found',
    ])
  })

  describe.skipIf(author === null)('as the Author', () => {
    it('GET /trash counts only the items the Author sees in the Trash (§5.7, P-4)', async () => {
      const others = await freshItem('p2-trash-count-others')
      const own = await freshItem('p2-trash-count-own', author as Credentials)
      await plugin('POST', '/media/trash', { body: { ids: [others, own] } })
      try {
        const asAuthor = await plugin('GET', '/trash', { as: author })
        expect(asAuthor.status).toBe(200)
        TrashSummarySchema.parse(asAuthor.json)
        const authorTrash = await plugin('GET', '/collection?folder=trash', {
          as: author,
        })
        expect(authorTrash.status).toBe(200)
        expect(asAuthor.json.count).toBe(authorTrash.json.total)
        expect(asAuthor.json.count).toBeGreaterThanOrEqual(1)

        const asEditor = await plugin('GET', '/trash')
        const editorTrash = await plugin('GET', '/collection?folder=trash')
        expect(asEditor.json.count).toBe(editorTrash.json.total)
        expect(asEditor.json.count).toBeGreaterThan(asAuthor.json.count)
        expect(asEditor.json.bytes).toBeGreaterThan(asAuthor.json.bytes)
      } finally {
        await plugin('POST', '/media/delete', { body: { ids: [others, own] } })
      }
    })

    it('trashes own items only, and empty skips other users’ items', async () => {
      const others = await freshItem('p2-trash-others')
      const own = await freshItem('p2-trash-own', author as Credentials)
      const reply = await plugin('POST', '/media/trash', {
        as: author,
        body: { ids: [others, own] },
      })
      expect(reply.json.results[0]).toMatchObject({
        ok: false,
        error: { code: 'wpu_forbidden' },
      })
      expect(reply.json.results[1]).toMatchObject({ ok: true })

      await plugin('POST', '/media/trash', { body: { ids: [others] } })
      const emptied = await plugin('POST', '/trash/empty', {
        as: author,
        body: {},
      })
      expect(emptied.json.skipped).toBeGreaterThanOrEqual(1)
      expect(emptied.json.remaining).toBe(0)
      const left = await plugin('POST', '/trash/restore', {
        body: { ids: [others] },
      })
      expect(left.json.results[0]).toMatchObject({ ok: true })
    })
  })
})
