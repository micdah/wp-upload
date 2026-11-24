import request from 'supertest'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from 'vitest'
import {
  fullItems,
  pluginInfo,
  pluginRestoreImage,
} from '../../../../shared/fixtures/index.ts'
import {
  ImageJobSchema,
  JobAcceptedSchema,
  RegenerateJobSchema,
} from '../../../../shared/library-api.schema.ts'
import type { PluginFeature } from '../../../../shared/library-api.ts'
import { env } from '../../config/env.ts'
import { jobsSettled, resetJobsForTests } from '../../lib/library/jobs.ts'
import {
  callsTo,
  type FakeHandler,
  fakeLibrary,
  libraryApp,
  networkError,
  plugin,
  resetLibrary,
  wpErrorResponse,
  wpMediaFor,
} from '../../lib/library/specSupport.ts'

const originalWpUrl = env.wpUrl
beforeEach(() => {
  env.wpUrl = 'https://example.com'
})
afterEach(async () => {
  await jobsSettled()
  resetJobsForTests()
  env.wpUrl = originalWpUrl
  await resetLibrary()
})

const item = fullItems.find((entry) => entry.id === 1000)
if (!item) throw new Error('fixture item 1000 is missing')

const media: FakeHandler = (call) => {
  const ids = String(call.params.include).split(',').map(Number)
  return fullItems
    .filter((entry) => ids.includes(entry.id))
    .map((entry) => wpMediaFor(entry))
}

const opAnswer = { ...pluginRestoreImage, id: 1000 }

/** Starts a job through the app and waits until it has settled. */
async function settledJob(res: request.Response) {
  expect(res.status).toBe(202)
  expect(res.headers['cache-control']).toBe('no-store')
  const { jobId } = JobAcceptedSchema.parse(res.body)
  await jobsSettled()
  const poll = await request(libraryApp()).get(`/jobs?ids=${jobId}`)
  return poll.body.jobs[0]
}

function withoutFeature(feature: PluginFeature): FakeHandler {
  return () => ({
    ...pluginInfo,
    features: pluginInfo.features.filter((f) => f !== feature),
  })
}

const edit = {
  ops: [
    { op: 'rotate', angle: 90 },
    { op: 'crop', x: 120, y: 0, width: 1334, height: 750 },
  ],
  scale: { width: 1067, height: 600 },
  applyTo: 'all',
  expectedModified: '2024-12-09T19:36:02Z',
}

describe('POST items/:id/edit', () => {
  it('runs the edit as a job and reads the item back (full view)', async () => {
    const spy = fakeLibrary({
      [plugin('POST', '/media/1000/edit')]: () => opAnswer,
      'GET /wp-json/wp/v2/media': media,
    })
    const res = await request(libraryApp()).post('/items/1000/edit').send(edit)
    const job = ImageJobSchema.parse(await settledJob(res))
    expect(job).toMatchObject({
      kind: 'edit',
      itemId: 1000,
      state: 'succeeded',
      error: null,
    })
    expect(job.result).toEqual({
      item,
      sizesRegenerated: 6,
      urlChanged: false,
    })
    const [call] = callsTo(spy, plugin('POST', '/media/1000/edit'))
    expect(call?.data).toEqual(edit)
    // Image operations get the idle timeout, never a short one.
    expect(call?.timeout).toBe(env.wpRequestTimeoutMs)
    expect(callsTo(spy, 'GET /wp-json/wp/v2/media')[0]?.params.context).toBe(
      'view',
    )
  })

  it('reports the plugin’s error in job.error (wpu_stale)', async () => {
    fakeLibrary({
      [plugin('POST', '/media/1000/edit')]: () => {
        throw wpErrorResponse(
          409,
          'wpu_stale',
          'The image changed since you started editing. Reload it and try again.',
          { modifiedAt: '2026-10-02T08:41:19Z' },
        )
      },
    })
    const res = await request(libraryApp()).post('/items/1000/edit').send(edit)
    const job = ImageJobSchema.parse(await settledJob(res))
    expect(job.state).toBe('failed')
    expect(job.error).toEqual({
      code: 'wpu_stale',
      message:
        'The image changed since you started editing. Reload it and try again.',
      details: { modifiedAt: '2026-10-02T08:41:19Z' },
    })
  })

  it('says the edit was applied when only reading it back failed', async () => {
    fakeLibrary({
      [plugin('POST', '/media/1000/edit')]: () => opAnswer,
      'GET /wp-json/wp/v2/media': () => {
        throw networkError()
      },
    })
    const res = await request(libraryApp()).post('/items/1000/edit').send(edit)
    const job = await settledJob(res)
    expect(job.error).toMatchObject({
      code: 'wp_unreachable',
      details: { applied: true, itemId: 1000 },
    })
  })

  it.each([
    [{ ...edit, ops: 'rotate' }, 'ops'],
    [{ ...edit, ops: [], scale: undefined }, 'ops'],
    [
      { ...edit, ops: Array.from({ length: 21 }, () => ({ op: 'flipH' })) },
      'ops',
    ],
    [{ ...edit, ops: [{ op: 'blur' }] }, 'ops[0].op'],
    [{ ...edit, ops: [{ op: 'rotate', angle: 45 }] }, 'ops[0].angle'],
    [{ ...edit, ops: [{ op: 'flipV', axis: 'x' }] }, 'ops[0].axis'],
    [
      { ...edit, ops: [{ op: 'crop', x: 1.5, y: 0, width: 1, height: 1 }] },
      'ops[0].x',
    ],
    [
      { ...edit, ops: [{ op: 'crop', x: 0, y: -1, width: 1, height: 1 }] },
      'ops[0].y',
    ],
    [
      { ...edit, ops: [{ op: 'crop', x: 0, y: 0, width: 0, height: 1 }] },
      'ops[0].width',
    ],
    [{ ...edit, scale: { width: 10 } }, 'scale.height'],
    [{ ...edit, scale: { width: 10, height: 5, keep: 1 } }, 'scale.keep'],
    [{ ...edit, applyTo: 'some' }, 'applyTo'],
    [{ ...edit, expectedModified: '2024-12-09 19:36:02' }, 'expectedModified'],
    [{ ...edit, expectedModified: undefined }, 'expectedModified'],
    [{ ...edit, quality: 90 }, 'quality'],
  ])('rejects %j (param %s) before starting a job', async (body, param) => {
    const spy = fakeLibrary()
    const res = await request(libraryApp()).post('/items/1000/edit').send(body)
    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({
      code: 'invalid_request',
      details: { param },
    })
    expect(callsTo(spy, plugin('POST', '/media/1000/edit'))).toHaveLength(0)
  })

  it('accepts a scale alone', async () => {
    fakeLibrary({
      [plugin('POST', '/media/1000/edit')]: () => opAnswer,
      'GET /wp-json/wp/v2/media': media,
    })
    const res = await request(libraryApp())
      .post('/items/1000/edit')
      .send({ ...edit, ops: [] })
    expect(res.status).toBe(202)
  })

  it('answers 404 for a non-numeric id', async () => {
    fakeLibrary()
    const res = await request(libraryApp()).post('/items/abc/edit').send(edit)
    expect(res.status).toBe(404)
    expect(res.body.code).toBe('not_found')
  })

  it('answers 409 feature_unavailable without image-edit', async () => {
    fakeLibrary({ [plugin('GET', '/info')]: withoutFeature('image-edit') })
    const res = await request(libraryApp()).post('/items/1000/edit').send(edit)
    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({
      code: 'feature_unavailable',
      details: { feature: 'image-edit' },
    })
  })
})

describe.each([
  ['/items/1000/edit/undo', '/media/1000/edit/undo', 'edit-undo'],
  ['/items/1000/restore', '/media/1000/restore', 'restore'],
])('POST %s', (route, pluginRoute, kind) => {
  it('runs as a job with {expectedModified}', async () => {
    const spy = fakeLibrary({
      [plugin('POST', pluginRoute)]: () => opAnswer,
      'GET /wp-json/wp/v2/media': media,
    })
    const body = { expectedModified: '2024-12-09T19:36:02Z' }
    const res = await request(libraryApp()).post(route).send(body)
    const job = ImageJobSchema.parse(await settledJob(res))
    expect(job).toMatchObject({ kind, itemId: 1000, state: 'succeeded' })
    expect(callsTo(spy, plugin('POST', pluginRoute))[0]?.data).toEqual(body)
  })

  it.each([
    [{}, 'expectedModified'],
    [{ expectedModified: 'yesterday' }, 'expectedModified'],
    [{ expectedModified: '2024-12-09T19:36:02Z', ops: [] }, 'ops'],
  ])('rejects %j (param %s)', async (body, param) => {
    fakeLibrary()
    const res = await request(libraryApp()).post(route).send(body)
    expect(res.status).toBe(400)
    expect(res.body.details).toEqual({ param })
  })
})

describe('POST items/:id/replace', () => {
  /** A plugin replace route that reads the multipart body it was sent. */
  function replaceRoute(received: { text?: string; headers?: object }) {
    return async (call: { data: unknown; headers: object }) => {
      const chunks: Buffer[] = []
      for await (const chunk of call.data as AsyncIterable<Buffer>) {
        chunks.push(Buffer.from(chunk))
      }
      received.text = Buffer.concat(chunks).toString('utf8')
      received.headers = call.headers
      return opAnswer
    }
  }

  it('streams the file and expectedModified to the plugin', async () => {
    const received: { text?: string; headers?: Record<string, unknown> } = {}
    fakeLibrary({
      [plugin('POST', '/media/1000/replace')]: replaceRoute(received),
      'GET /wp-json/wp/v2/media': media,
    })
    const res = await request(libraryApp())
      .post('/items/1000/replace')
      .field('expectedModified', '2024-12-09T19:36:02Z')
      .attach('file', Buffer.from('new image bytes'), {
        filename: 'still-life.jpg',
        contentType: 'image/jpeg',
      })
    const job = ImageJobSchema.parse(await settledJob(res))
    expect(job).toMatchObject({ kind: 'replace', state: 'succeeded' })
    expect(job.progress).toEqual({ done: 15, total: 15, unit: 'bytes' })
    expect(received.text).toContain(
      'name="expectedModified"\r\n\r\n2024-12-09T19:36:02Z\r\n',
    )
    expect(received.text).toContain(
      'name="file"; filename="still-life.jpg"\r\nContent-Type: image/jpeg\r\n\r\nnew image bytes\r\n',
    )
    const headers = received.headers as Record<string, unknown>
    expect(String(headers['Content-Type'])).toMatch(
      /^multipart\/form-data; boundary=/,
    )
    expect(headers['Content-Length']).toBe(
      Buffer.byteLength(received.text ?? ''),
    )
  })

  it('answers 400 upload_error without a file', async () => {
    fakeLibrary()
    const res = await request(libraryApp())
      .post('/items/1000/replace')
      .field('expectedModified', '2024-12-09T19:36:02Z')
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('upload_error')
  })

  it('answers 400 upload_error to a malformed multipart body', async () => {
    fakeLibrary()
    const res = await request(libraryApp())
      .post('/items/1000/replace')
      .set('Content-Type', 'multipart/form-data; boundary=xyz')
      .send('--xyz\r\nContent-Disposition: form-data; name="file"')
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('upload_error')
  })

  it('answers 400 for a missing expectedModified', async () => {
    fakeLibrary()
    const res = await request(libraryApp())
      .post('/items/1000/replace')
      .attach('file', Buffer.from('x'), 'a.jpg')
    expect(res.status).toBe(400)
    expect(res.body.details).toEqual({ param: 'expectedModified' })
  })

  it('answers 413 file_too_large over MAX_FILE_SIZE_MB', async () => {
    fakeLibrary()
    const originalMaxMb = env.maxFileSizeMb
    env.maxFileSizeMb = 1
    onTestFinished(() => {
      env.maxFileSizeMb = originalMaxMb
    })
    const big = Buffer.alloc(1024 * 1024 + 1)
    const res = await request(libraryApp())
      .post('/items/1000/replace')
      .field('expectedModified', '2024-12-09T19:36:02Z')
      .attach('file', big, 'big.jpg')
    expect(res.status).toBe(413)
    expect(res.body.code).toBe('file_too_large')
  })

  it('checks the feature before reading the upload', async () => {
    fakeLibrary({ [plugin('GET', '/info')]: withoutFeature('image-replace') })
    const res = await request(libraryApp())
      .post('/items/1000/replace')
      .field('expectedModified', '2024-12-09T19:36:02Z')
      .attach('file', Buffer.from('x'), 'a.jpg')
    expect(res.status).toBe(409)
    expect(res.body.details).toEqual({ feature: 'image-replace' })
  })
})

describe('POST items/regenerate', () => {
  it('regenerates one item at a time with per-item results', async () => {
    const spy = fakeLibrary({
      [plugin('POST', '/media/1000/regenerate')]: () => opAnswer,
      [plugin('POST', '/media/1091/regenerate')]: () => {
        throw wpErrorResponse(
          415,
          'wpu_unsupported_type',
          'SVG files have no generated sizes.',
          { mime: 'image/svg+xml' },
        )
      },
    })
    const res = await request(libraryApp())
      .post('/items/regenerate')
      .send({ ids: [1000, 1091] })
    const job = RegenerateJobSchema.parse(await settledJob(res))
    expect(job).toMatchObject({
      kind: 'regenerate',
      itemIds: [1000, 1091],
      state: 'succeeded',
      progress: { done: 2, total: 2, unit: 'items' },
    })
    expect(job.result).toEqual({
      results: [
        { id: 1000, ok: true, sizesRegenerated: 6 },
        {
          id: 1091,
          ok: false,
          error: {
            code: 'wpu_unsupported_type',
            message: 'SVG files have no generated sizes.',
          },
        },
      ],
    })
    expect(
      callsTo(spy, plugin('POST', '/media/1000/regenerate'))[0]?.data,
    ).toEqual({})
  })

  it('fails the job when WordPress can no longer be reached', async () => {
    const spy = fakeLibrary({
      [plugin('POST', '/media/1/regenerate')]: () => {
        throw networkError()
      },
    })
    const res = await request(libraryApp())
      .post('/items/regenerate')
      .send({ ids: [1, 2, 3] })
    const job = await settledJob(res)
    expect(job).toMatchObject({
      state: 'failed',
      error: { code: 'wp_unreachable' },
    })
    expect(callsTo(spy, plugin('POST', '/media/2/regenerate'))).toHaveLength(0)
  })

  it('updates progress as items finish', async () => {
    let release: () => void = () => {}
    fakeLibrary({
      [plugin('POST', '/media/1/regenerate')]: () => opAnswer,
      [plugin('POST', '/media/2/regenerate')]: () =>
        new Promise((resolve) => {
          release = () => resolve(opAnswer)
        }),
    })
    const res = await request(libraryApp())
      .post('/items/regenerate')
      .send({ ids: [1, 2] })
    const { jobId } = res.body
    await vi.waitFor(async () => {
      const poll = await request(libraryApp()).get(`/jobs?ids=${jobId}`)
      expect(poll.body.jobs[0]).toMatchObject({
        state: 'running',
        progress: { done: 1, total: 2, unit: 'items' },
      })
    })
    release()
  })

  it.each([
    [{}, 'ids'],
    [{ ids: [] }, 'ids'],
    [{ ids: Array.from({ length: 1001 }, (_, i) => i + 1) }, 'ids'],
    [{ ids: [1], sizes: ['thumbnail'] }, 'sizes'],
  ])('rejects %j (param %s)', async (body, param) => {
    fakeLibrary()
    const res = await request(libraryApp()).post('/items/regenerate').send(body)
    expect(res.status).toBe(400)
    expect(res.body.details).toEqual({ param })
  })

  it('answers 409 feature_unavailable without image-regenerate', async () => {
    fakeLibrary({
      [plugin('GET', '/info')]: withoutFeature('image-regenerate'),
    })
    const res = await request(libraryApp())
      .post('/items/regenerate')
      .send({ ids: [1] })
    expect(res.status).toBe(409)
    expect(res.body.details).toEqual({ feature: 'image-regenerate' })
  })
})
