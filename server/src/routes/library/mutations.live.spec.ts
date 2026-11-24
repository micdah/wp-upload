import { deflateSync } from 'node:zlib'
import request from 'supertest'
import { afterAll, describe, expect, it } from 'vitest'
import {
  BatchResponseSchema,
  DeleteResponseSchema,
  FolderTreeSchema,
  ImageJobSchema,
  JobAcceptedSchema,
  PostsResponseSchema,
  RegenerateJobSchema,
  RestoreResponseSchema,
  TrashSummarySchema,
  UploadCheckResponseSchema,
  UploadJobSchema,
  UsageResponseSchema,
} from '../../../../shared/library-api.schema.ts'
import type {
  JobLookup,
  LibraryItemTile,
  PluginFeature,
} from '../../../../shared/library-api.ts'
import type { PluginInfo } from '../../../../shared/plugin-api.ts'
import { jobsSettled } from '../../lib/library/jobs.ts'
import { pluginClient, wpCall, wpGet } from '../../lib/library/pluginClient.ts'
import { libraryApp, resetLibrary } from '../../lib/library/specSupport.ts'
import { maintenanceIdle } from './bootstrap.ts'
import { fileAxios } from './download.ts'

// Track S2's routes end to end against the live stack (dev/run test
// server-live), through libraryRouter. Every route sits behind the plugin
// guard, so each test skips itself until the companion plugin's `/info`
// answers (tracks P1/P2); `posts` and `items/:id/download` need nothing else,
// the rest also need their feature. Items a test uploads are deleted again
// through core REST.

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
  return feature === 'wpu' || info.features.includes(feature)
}

const app = libraryApp()
const created: number[] = []

afterAll(async () => {
  await jobsSettled()
  for (const id of created) {
    await wpCall({
      method: 'DELETE',
      path: `/wp-json/wp/v2/media/${id}`,
      params: { force: 'true' },
      timeoutMs: 30_000,
    }).catch(() => {})
  }
  await maintenanceIdle()
  await settleIndexes()
  await resetLibrary()
})

/**
 * Lets the plugin's indexes catch up with what this spec changed, so the
 * next live spec doesn't see the rev move under it (e.g. between a read and
 * its If-None-Match).
 */
async function settleIndexes(): Promise<void> {
  if (!has('maintenance')) return
  for (let round = 0; round < 20; round++) {
    const step = await pluginClient.maintenanceStep({ budgetMs: 5000 })
    if (!step.more && !step.locked) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A solid-colour RGB PNG of the given size (no image library needed). */
function png(width: number, height: number, rgb: [number, number, number]) {
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.from(Array.from({ length: width }, () => rgb).flat()),
  ])
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
  })
  const crc = (data: Buffer) => {
    let c = 0xffffffff
    for (const byte of data)
      c = (crcTable[(c ^ byte) & 0xff] as number) ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const sum = Buffer.alloc(4)
    sum.writeUInt32BE(crc(typed))
    return Buffer.concat([length, typed, sum])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 2, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Polls `route` until the job is final (or the timeout). */
async function finalJob(
  jobId: string,
  route: '/jobs' | '/upload/jobs' = '/jobs',
): Promise<JobLookup> {
  const deadline = Date.now() + 120_000
  for (;;) {
    const res = await request(app).get(`${route}?ids=${jobId}`)
    expect(res.status).toBe(200)
    const job = res.body.jobs[0] as JobLookup
    if (job.state === 'succeeded' || job.state === 'failed') return job
    if (job.state === 'not_found') throw new Error(`job ${jobId} vanished`)
    if (Date.now() > deadline) throw new Error(`job ${jobId} never finished`)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

/** Uploads a PNG through the app, returning the finished job. */
async function uploadPng(name: string, folder?: number) {
  let req = request(app).post('/upload')
  if (folder !== undefined) req = req.field('folder', String(folder))
  const res = await req.attach('file', png(320, 200, [200, 40, 40]), {
    filename: name,
    contentType: 'image/png',
  })
  expect(res.status).toBe(202)
  const { jobId } = JobAcceptedSchema.parse(res.body)
  const job = UploadJobSchema.parse(await finalJob(jobId, '/upload/jobs'))
  if (job.result) created.push(job.result.item.id)
  return job
}

/** An image to work on: uploaded by this run, so tests never touch seed data. */
let scratch: LibraryItemTile | null = null
async function scratchImage(): Promise<LibraryItemTile> {
  if (!scratch) {
    const job = await uploadPng('s2-live-scratch.png')
    expect(job.state, JSON.stringify(job.error)).toBe('succeeded')
    scratch = job.result?.item ?? null
  }
  return scratch as LibraryItemTile
}

async function currentModifiedAt(id: number): Promise<string> {
  const res = await request(app).get(`/items?ids=${id}&view=full`)
  return res.body.items[0].modifiedAt
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

describe.skipIf(!live)('S2 library routes, live', () => {
  it.skipIf(!info)(
    'posts lists published posts and searches them',
    async () => {
      const res = await request(app).get('/posts?limit=5')
      expect(res.status).toBe(200)
      const body = PostsResponseSchema.parse(res.body)
      expect(body.posts.length).toBeGreaterThan(0)
      expect(body.posts.length).toBeLessThanOrEqual(5)
      expect(body.posts.every((post) => post.status === 'publish')).toBe(true)

      const first = body.posts[0]?.title.split(' ')[0] ?? ''
      const search = await request(app).get(
        `/posts?search=${encodeURIComponent(first)}`,
      )
      expect(search.status).toBe(200)
      expect(search.body.posts.length).toBeGreaterThan(0)
    },
  )

  it.skipIf(!info)(
    'items/:id/download streams the file WordPress serves',
    async () => {
      const [image] = await wpGet<
        Array<{ id: number; source_url: string; mime_type: string }>
      >('/wp/v2/media', {
        media_type: 'image',
        per_page: 1,
        _fields: 'id,source_url,mime_type',
      })
      expect(image).toBeDefined()
      if (!image) return
      const res = await request(app)
        .get(`/items/${image.id}/download`)
        .buffer(true)
        .parse((response, done) => {
          const chunks: Buffer[] = []
          response.on('data', (chunk: Buffer) => chunks.push(chunk))
          response.on('end', () => done(null, Buffer.concat(chunks)))
        })
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toBe(image.mime_type)
      expect(res.headers['content-disposition']).toMatch(
        /^attachment; filename="/,
      )
      expect(res.headers['cache-control']).toBe('private, no-store')
      const direct = await fileAxios.get(image.source_url, {
        responseType: 'arraybuffer',
      })
      expect((res.body as Buffer).equals(Buffer.from(direct.data))).toBe(true)
    },
  )

  it.skipIf(!has('wpu'))(
    'upload files into a folder and upload/check finds the item',
    async () => {
      let folder: number | undefined
      if (has('folders') && info?.filebird?.active && !info.filebird.perUser) {
        const tree = FolderTreeSchema.parse(
          (await request(app).get('/folders')).body,
        )
        folder = tree.folders[0]?.id
      }
      const job = await uploadPng('s2-live-upload.png', folder)
      expect(job.state, JSON.stringify(job.error)).toBe('succeeded')
      expect(job.progress?.unit).toBe('bytes')
      expect(job.result?.item.kind).toBe('image')
      if (folder !== undefined) {
        expect(job.result?.folder).toEqual({
          id: folder,
          assigned: true,
          message: null,
        })
        expect(job.result?.item.folder).toBe(folder)
      }

      const check = await request(app).get(
        '/upload/check?filename=s2-live-upload.png',
      )
      expect(check.status).toBe(200)
      const body = UploadCheckResponseSchema.parse(check.body)
      expect(body.duplicate).toBe(true)
      expect(body.matches.map((match) => match.id)).toContain(
        job.result?.item.id,
      )
    },
  )

  it.skipIf(!has('media-batch'))(
    'items/batch changes metadata and Undo puts it back',
    async () => {
      const image = await scratchImage()
      const res = await request(app)
        .post('/items/batch')
        .send({ ids: [image.id], set: { caption: 'S2 live caption' } })
      expect(res.status).toBe(200)
      const body = BatchResponseSchema.parse(res.body)
      const result = body.results[0]
      expect(result?.ok).toBe(true)
      if (!result?.ok) return
      expect(result.item.caption).toBe('S2 live caption')

      const undo = await request(app)
        .post('/items/batch')
        .send({ items: [{ id: image.id, set: result.previous }] })
      expect(undo.status).toBe(200)
      expect(undo.body.results[0].item.caption).toBe('')
    },
  )

  it.skipIf(!has('usage'))('usage answers for any ids', async () => {
    const image = await scratchImage()
    const res = await request(app).get(`/usage?ids=${image.id},999999`)
    expect(res.status).toBe(200)
    const body = UsageResponseSchema.parse(res.body)
    expect(body.items.map((item) => item.id)).toEqual([image.id, 999999])
    expect(body.items[1]?.count).toBe(0)
  })

  it.skipIf(!has('trash'))('trash answers its summary', async () => {
    const res = await request(app).get('/trash')
    expect(res.status).toBe(200)
    TrashSummarySchema.parse(res.body)
  })

  it.skipIf(!has('image-edit'))(
    'edit rotates the image in place; undo and restore bring it back',
    async () => {
      const image = await scratchImage()
      const start = await request(app)
        .post(`/items/${image.id}/edit`)
        .send({
          ops: [{ op: 'rotate', angle: 90 }],
          applyTo: 'all',
          expectedModified: await currentModifiedAt(image.id),
        })
      expect(start.status).toBe(202)
      const edited = ImageJobSchema.parse(await finalJob(start.body.jobId))
      expect(edited.state, JSON.stringify(edited.error)).toBe('succeeded')
      expect([edited.result?.item.width, edited.result?.item.height]).toEqual([
        image.height,
        image.width,
      ])
      expect(edited.result?.item.url).toBe(image.url)
      expect(edited.result?.item.undoable).toBe(true)

      const stale = await request(app)
        .post(`/items/${image.id}/edit/undo`)
        .send({ expectedModified: '2000-01-01T00:00:00Z' })
      const staleJob = await finalJob(stale.body.jobId)
      expect(staleJob).toMatchObject({
        state: 'failed',
        error: { code: 'wpu_stale' },
      })

      const undo = await request(app)
        .post(`/items/${image.id}/edit/undo`)
        .send({ expectedModified: edited.result?.item.modifiedAt })
      const undone = ImageJobSchema.parse(await finalJob(undo.body.jobId))
      expect(undone.state, JSON.stringify(undone.error)).toBe('succeeded')
      expect(undone.result?.item.width).toBe(image.width)

      const restore = await request(app)
        .post(`/items/${image.id}/restore`)
        .send({ expectedModified: undone.result?.item.modifiedAt })
      const restored = await finalJob(restore.body.jobId)
      // Restoring needs an original backup: after the undo there may be
      // none left (wpu_not_edited), which is a correct answer too.
      if (restored.state === 'failed') {
        expect((restored as { error: { code: string } }).error.code).toBe(
          'wpu_not_edited',
        )
      }
    },
  )

  it.skipIf(!has('image-regenerate'))(
    'items/regenerate reports per-item results',
    async () => {
      const image = await scratchImage()
      const start = await request(app)
        .post('/items/regenerate')
        .send({ ids: [image.id, 999999] })
      expect(start.status).toBe(202)
      const job = RegenerateJobSchema.parse(await finalJob(start.body.jobId))
      expect(job.state, JSON.stringify(job.error)).toBe('succeeded')
      expect(job.progress).toEqual({ done: 2, total: 2, unit: 'items' })
      expect(job.result?.results[0]).toMatchObject({ id: image.id, ok: true })
      expect(job.result?.results[1]).toMatchObject({
        id: 999999,
        ok: false,
        error: { code: 'wpu_not_found' },
      })
    },
  )

  it.skipIf(!has('image-replace'))(
    'replace swaps the file and keeps the URL',
    async () => {
      const image = await scratchImage()
      const res = await request(app)
        .post(`/items/${image.id}/replace`)
        .field('expectedModified', await currentModifiedAt(image.id))
        .attach('file', png(160, 100, [40, 40, 200]), {
          filename: 'replacement.png',
          contentType: 'image/png',
        })
      expect(res.status).toBe(202)
      const job = ImageJobSchema.parse(await finalJob(res.body.jobId))
      expect(job.state, JSON.stringify(job.error)).toBe('succeeded')
      expect([job.result?.item.width, job.result?.item.height]).toEqual([
        160, 100,
      ])
      expect(job.result?.item.url).toBe(image.url)
    },
  )

  it.skipIf(!has('trash') || !has('wpu'))(
    'items/delete trashes or deletes, and trash/restore brings an item back',
    async () => {
      const job = await uploadPng('s2-live-delete.png')
      const id = job.result?.item.id as number
      if (info?.trash.enabled) {
        const trashed = await request(app)
          .post('/items/delete')
          .send({ ids: [id], mode: 'trash' })
        expect(trashed.status).toBe(200)
        const body = DeleteResponseSchema.parse(trashed.body)
        expect(body.results[0]).toMatchObject({ id, ok: true })

        const restored = await request(app)
          .post('/trash/restore')
          .send({ ids: [id] })
        expect(restored.status).toBe(200)
        expect(
          RestoreResponseSchema.parse(restored.body).results[0],
        ).toMatchObject({ id, ok: true })
      } else {
        const refused = await request(app)
          .post('/items/delete')
          .send({ ids: [id], mode: 'trash' })
        expect(refused.status).toBe(409)
        expect(refused.body.code).toBe('wpu_trash_disabled')
      }

      const deleted = await request(app)
        .post('/items/delete')
        .send({ ids: [id], mode: 'delete' })
      expect(deleted.status).toBe(200)
      expect(deleted.body.results[0]).toEqual({ id, ok: true, trash: null })
      const gone = await request(app).get(`/items?ids=${id}`)
      expect(gone.body.missing).toEqual([id])
    },
  )
})
