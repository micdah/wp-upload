import request from 'supertest'
import { afterAll, describe, expect, it } from 'vitest'
import {
  BootstrapSchema,
  CollectionResponseSchema,
  FacetsSchema,
  FolderTreeSchema,
  ItemPatchResponseSchema,
  ItemsFullResponseSchema,
  ItemsTileResponseSchema,
  RevResponseSchema,
} from '../../../../shared/library-api.schema.ts'
import {
  type PluginFeature,
  ROW_STRIDE,
} from '../../../../shared/library-api.ts'
import type { PluginInfo } from '../../../../shared/plugin-api.ts'
import { pluginClient } from '../../lib/library/pluginClient.ts'
import { libraryApp, resetLibrary } from '../../lib/library/specSupport.ts'
import { maintenanceIdle } from './bootstrap.ts'

// The S1 routes end to end against the live stack (dev/run test
// server-live), through libraryRouter. Routes that need the companion plugin
// skip themselves until its `/info` answers and lists the feature (track P1
// builds them in parallel); bootstrap runs either way.

const live = process.env.WPU_LIVE === '1'

async function probePlugin(): Promise<PluginInfo | null> {
  if (!live) return null
  try {
    return await pluginClient.info()
  } catch {
    return null
  }
}

const info = await probePlugin()
await resetLibrary()

function has(feature: PluginFeature | 'wpu'): boolean {
  if (!info) return false
  // The wpu field has no feature name: every compatible plugin has it.
  return feature === 'wpu' || info.features.includes(feature)
}

const app = libraryApp()

/**
 * Waits for the server's maintenance loop to stop, at most `ms`. Against a
 * plugin whose usage index is still the stub, `more` never turns false and
 * the loop keeps running, so this must not wait forever.
 */
async function maintenanceIdleOrTimeout(ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms)
  })
  await Promise.race([maintenanceIdle(), timeout])
  clearTimeout(timer)
}

afterAll(async () => {
  await maintenanceIdle()
  await resetLibrary()
})

describe.skipIf(!live)('library routes, live', () => {
  it('bootstrap always answers 200 with a valid Bootstrap', async () => {
    const res = await request(app).get('/bootstrap')
    expect(res.status).toBe(200)
    const body = BootstrapSchema.parse(res.body)
    if (info) {
      expect(body.wp.state).toBe('ok')
      expect(['ok', 'update-available']).toContain(body.plugin?.state)
      expect(body.site?.user.roles.length).toBeGreaterThan(0)
      expect(body.rev).toMatch(/^\d+$/)
    }
  })

  it.skipIf(!info)('rev answers the plugin’s rev, no-store', async () => {
    const res = await request(app).get('/rev')
    expect(res.status).toBe(200)
    RevResponseSchema.parse(res.body)
    expect(res.headers['cache-control']).toBe('no-store')
  })

  it.skipIf(!has('collection'))(
    'collection answers valid rows and 304 for its ETag',
    async () => {
      // The maintenance loop the first bootstrap started (server-api.md
      // §9.2) can still be indexing, and a step that changes data moves the
      // rev, so the ETag (which carries the rev) legitimately changes
      // between two requests. A 200 is accepted only with a different ETag;
      // then the loop is given time to finish and the pair is repeated. A
      // broken ETag (200 with the same ETag) fails at once.
      await maintenanceIdleOrTimeout(10_000)
      for (let attempt = 0; attempt < 10; attempt++) {
        const res = await request(app).get('/collection')
        expect(res.status).toBe(200)
        const body = CollectionResponseSchema.parse(res.body)
        expect(body.rows.length).toBe(body.total * ROW_STRIDE)
        expect(body.total).toBeGreaterThan(0)

        const again = await request(app)
          .get('/collection')
          .set('If-None-Match', res.headers.etag ?? '')
        if (again.status === 304) return
        expect(again.status).toBe(200)
        expect(again.headers.etag).not.toBe(res.headers.etag)
        await maintenanceIdleOrTimeout(5_000)
      }
      throw new Error('The library rev kept moving; no stable ETag to test')
    },
  )

  it.skipIf(!has('collection'))(
    'collection filters and search are accepted',
    async () => {
      const res = await request(app).get(
        '/collection?type=image&sort=size-desc&q=a',
      )
      expect(res.status).toBe(200)
      expect(res.body.query).toMatchObject({
        type: 'image',
        sort: 'size-desc',
        q: 'a',
      })
    },
  )

  it.skipIf(!has('facets'))('facets answers valid counts', async () => {
    const res = await request(app).get('/facets')
    expect(res.status).toBe(200)
    FacetsSchema.parse(res.body)
  })

  it.skipIf(!has('folders'))('folders answers the FileBird tree', async () => {
    const res = await request(app).get('/folders')
    expect(res.status).toBe(200)
    const tree = FolderTreeSchema.parse(res.body)
    expect(tree.folders.length).toBeGreaterThan(0)
  })

  it.skipIf(!has('collection'))(
    'items hydrates the first 100 collection rows with nothing missing',
    async () => {
      const collection = await request(app).get('/collection')
      const rows: number[] = collection.body.rows
      const ids: number[] = []
      for (let i = 0; i < rows.length && ids.length < 100; i += ROW_STRIDE) {
        ids.push(rows[i] as number)
      }
      const res = await request(app).get(`/items?ids=${ids.join(',')}`)
      expect(res.status).toBe(200)
      const body = ItemsTileResponseSchema.parse(res.body)
      expect(body.missing).toEqual([])
      expect(body.items.map((item) => item.id)).toEqual(ids)
      // Rows and items agree on the dimensions (server-api.md §7.3).
      for (let i = 0; i < ids.length; i++) {
        const item = body.items[i]
        expect([item?.width, item?.height]).toEqual([
          rows[i * ROW_STRIDE + 1],
          rows[i * ROW_STRIDE + 2],
        ])
      }

      const full = await request(app).get(
        `/items?ids=${ids.slice(0, 10).join(',')}&view=full`,
      )
      expect(full.status).toBe(200)
      ItemsFullResponseSchema.parse(full.body)
    },
  )

  it.skipIf(!has('media-batch'))(
    'PATCH items/:id saves alt text and reports the previous value',
    async () => {
      const collection = await request(app).get('/collection?type=image')
      const id = collection.body.rows[0] as number
      const before = await request(app).get(`/items?ids=${id}`)
      const previousAlt: string = before.body.items[0].alt

      const res = await request(app)
        .patch(`/items/${id}`)
        .send({ alt: 'Live spec alt text' })
      expect(res.status).toBe(200)
      const body = ItemPatchResponseSchema.parse(res.body)
      expect(body.previous).toEqual({ alt: previousAlt })
      expect(body.item.alt).toBe('Live spec alt text')

      // The new rev reaches reads at once: no stale cache entry.
      const after = await request(app).get(`/items?ids=${id}`)
      expect(after.body.items[0].alt).toBe('Live spec alt text')

      await request(app).patch(`/items/${id}`).send({ alt: previousAlt })
    },
  )
})
