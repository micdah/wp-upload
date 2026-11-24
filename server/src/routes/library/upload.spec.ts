import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  collectionAll,
  fullItems,
  pluginInfo,
  uploadCheckDuplicate,
} from '../../../../shared/fixtures/index.ts'
import {
  JobAcceptedSchema,
  JobsResponseSchema,
  UploadCheckResponseSchema,
  UploadJobSchema,
} from '../../../../shared/library-api.schema.ts'
import type {
  FileBirdInfo,
  FolderAssignResponse,
} from '../../../../shared/library-api.ts'
import { env } from '../../config/env.ts'
import { LibraryError } from '../../lib/library/errors.ts'
import {
  jobsSettled,
  resetJobsForTests,
  startJob,
} from '../../lib/library/jobs.ts'
import {
  callsTo,
  type FakeHandler,
  fakeLibrary,
  libraryApp,
  plugin,
  type RecordedCall,
  resetLibrary,
  routeKey,
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

const CREATE = 'POST /wp-json/wp/v2/media'
const ASSIGN = plugin('POST', '/folders/assign')
const NEW_ID = 1004

const media: FakeHandler = (call) => {
  const ids = String(call.params.include).split(',').map(Number)
  return fullItems
    .filter((entry) => ids.includes(entry.id))
    .map((entry) => wpMediaFor(entry))
}

/** Reads the multipart body WordPress would receive. */
async function readBody(call: RecordedCall): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of call.data as AsyncIterable<Buffer>) {
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

const received: { body?: string } = {}
const create: FakeHandler = async (call) => {
  received.body = await readBody(call)
  return { id: NEW_ID }
}

const assigned: FolderAssignResponse = {
  rev: '1795867200005',
  previous: [{ id: NEW_ID, folder: 0 }],
  skipped: [],
  moved: 1,
  counts: { all: 18, uncategorized: 2, byId: {} },
}

function info(filebird: FileBirdInfo | null): FakeHandler {
  return () => ({ ...pluginInfo, filebird })
}

async function upload(fields: Record<string, string> = {}) {
  let req = request(libraryApp()).post('/upload')
  for (const [name, value] of Object.entries(fields)) {
    req = req.field(name, value)
  }
  return req.attach('file', Buffer.from('jpeg bytes'), {
    filename: 'Strand ved Skagen.jpg',
    contentType: 'image/jpeg',
  })
}

async function settled(res: request.Response) {
  expect(res.status).toBe(202)
  const { jobId } = JobAcceptedSchema.parse(res.body)
  await jobsSettled()
  const poll = await request(libraryApp()).get(`/upload/jobs?ids=${jobId}`)
  return UploadJobSchema.parse(poll.body.jobs[0])
}

describe('POST upload', () => {
  it('uploads, files into the folder through the plugin and reads the item back', async () => {
    const spy = fakeLibrary({
      [CREATE]: create,
      [ASSIGN]: () => assigned,
      'GET /wp-json/wp/v2/media': media,
    })
    const job = await settled(await upload({ folder: '14' }))
    expect(job).toMatchObject({
      kind: 'upload',
      state: 'succeeded',
      filename: 'Strand ved Skagen.jpg',
      progress: { done: 10, total: 10, unit: 'bytes' },
      error: null,
    })
    expect(job.result?.item).toMatchObject({ id: NEW_ID, view: 'tile' })
    expect(job.result?.folder).toEqual({
      id: 14,
      assigned: true,
      message: null,
    })
    expect(callsTo(spy, ASSIGN)[0]?.data).toEqual({ folder: 14, ids: [NEW_ID] })
    expect(received.body).toContain(
      'name="file"; filename="Strand ved Skagen.jpg"\r\nContent-Type: image/jpeg\r\n\r\njpeg bytes\r\n',
    )
    const [call] = callsTo(spy, CREATE)
    expect(call?.timeout).toBe(env.wpRequestTimeoutMs)
    expect(call?.headers['Content-Length']).toBe(
      Buffer.byteLength(received.body ?? ''),
    )
  })

  it.each<[Record<string, string>, string]>([
    [{}, 'absent'],
    [{ folder: '' }, 'empty'],
    [{ folder: '0' }, '0'],
  ])('leaves the item in Uncategorized when folder is %s', async (fields) => {
    const spy = fakeLibrary({
      [CREATE]: create,
      'GET /wp-json/wp/v2/media': media,
    })
    const job = await settled(await upload(fields))
    expect(job.state).toBe('succeeded')
    expect(job.result?.folder).toBeNull()
    expect(callsTo(spy, ASSIGN)).toHaveLength(0)
  })

  it('reports a filing failure without failing the upload', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fakeLibrary({
      [CREATE]: create,
      [ASSIGN]: () => {
        throw wpErrorResponse(404, 'wpu_folder_not_found', 'No such folder.')
      },
      'GET /wp-json/wp/v2/media': media,
    })
    const job = await settled(await upload({ folder: '99' }))
    expect(job.state).toBe('succeeded')
    expect(job.result?.folder).toEqual({
      id: 99,
      assigned: false,
      message: 'No such folder.',
    })
  })

  it('reports an item the plugin skipped as not assigned', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    fakeLibrary({
      [CREATE]: create,
      [ASSIGN]: () => ({
        ...assigned,
        previous: [],
        moved: 0,
        skipped: [
          {
            id: NEW_ID,
            ok: false,
            error: { code: 'wpu_forbidden', message: 'Not yours.' },
          },
        ],
      }),
      'GET /wp-json/wp/v2/media': media,
    })
    const job = await settled(await upload({ folder: '14' }))
    expect(job.result?.folder).toEqual({
      id: 14,
      assigned: false,
      message: 'Not yours.',
    })
  })

  it('skips filing in FileBird’s per-user mode', async () => {
    const spy = fakeLibrary({
      [plugin('GET', '/info')]: info({
        active: true,
        version: '6.5.9',
        pro: false,
        perUser: true,
      }),
      [CREATE]: create,
      'GET /wp-json/wp/v2/media': media,
    })
    const job = await settled(await upload({ folder: '14' }))
    expect(job.result?.folder).toMatchObject({ id: 14, assigned: false })
    expect(job.result?.folder?.message).toMatch(/per-user/)
    expect(callsTo(spy, ASSIGN)).toHaveLength(0)
  })

  it.each<[string, FileBirdInfo | null]>([
    [
      'inactive',
      { active: false, version: '6.5.9', pro: false, perUser: false },
    ],
    ['not installed', null],
  ])('ignores the folder when FileBird is %s', async (_label, filebird) => {
    const spy = fakeLibrary({
      [plugin('GET', '/info')]: info(filebird),
      [CREATE]: create,
      'GET /wp-json/wp/v2/media': media,
    })
    const job = await settled(await upload({ folder: '14' }))
    expect(job.result?.folder).toBeNull()
    expect(callsTo(spy, ASSIGN)).toHaveLength(0)
  })

  it('fails the job with WordPress’s mapped error', async () => {
    fakeLibrary({
      [CREATE]: async (call) => {
        await readBody(call)
        throw wpErrorResponse(
          413,
          'rest_upload_file_too_big',
          'This file is too big.',
        )
      },
    })
    const job = await settled(await upload())
    expect(job.state).toBe('failed')
    expect(job.error).toEqual({
      code: 'rest_upload_file_too_big',
      message: 'This file is too big.',
    })
  })

  it('goes from running to processing once every byte is sent', async () => {
    let respond: () => void = () => {}
    fakeLibrary({
      [CREATE]: async (call) => {
        await readBody(call)
        await new Promise<void>((resolve) => {
          respond = resolve
        })
        return { id: NEW_ID }
      },
      'GET /wp-json/wp/v2/media': media,
    })
    const res = await upload()
    const { jobId } = res.body
    await vi.waitFor(async () => {
      const poll = await request(libraryApp()).get(`/upload/jobs?ids=${jobId}`)
      expect(poll.body.jobs[0]).toMatchObject({
        state: 'processing',
        progress: { done: 10, total: 10, unit: 'bytes' },
      })
    })
    respond()
  })

  it.each(['abc', '-1', '1.5', '01'])(
    'rejects folder=%s with 400 invalid_request',
    async (folder) => {
      const spy = fakeLibrary()
      const res = await upload({ folder })
      expect(res.status).toBe(400)
      expect(res.body).toMatchObject({
        code: 'invalid_request',
        details: { param: 'folder' },
      })
      expect(callsTo(spy, CREATE)).toHaveLength(0)
    },
  )

  it('makes the next cached read see the new item at once (polls /rev again)', async () => {
    // The plugin's rev moves when WordPress creates the attachment.
    let rev = '1795867200000'
    const spy = fakeLibrary({
      [plugin('GET', '/rev')]: () => ({ rev, index: pluginInfo.index }),
      [plugin('GET', '/collection')]: () => ({ ...collectionAll, rev }),
      [CREATE]: async (call) => {
        rev = '1795867200009'
        return create(call)
      },
      'GET /wp-json/wp/v2/media': media,
    })
    const before = await request(libraryApp()).get('/collection')
    expect(before.headers['x-library-rev']).toBe('1795867200000')

    // Without a folder: no plugin response reports the new rev.
    const job = await settled(await upload())
    expect(job.state).toBe('succeeded')

    // Well within the 2 s throttle, but the upload expired the last poll.
    const after = await request(libraryApp()).get('/collection')
    expect(after.headers['x-library-rev']).toBe('1795867200009')
    expect(after.body.rev).toBe('1795867200009')
    expect(callsTo(spy, plugin('GET', '/collection'))).toHaveLength(2)
  })

  it('answers 400 upload_error without a file', async () => {
    fakeLibrary()
    const res = await request(libraryApp()).post('/upload').field('folder', '1')
    expect(res.status).toBe(400)
    expect(res.body.code).toBe('upload_error')
  })

  it('answers 409 plugin_incompatible while the plugin is outdated', async () => {
    fakeLibrary({
      [plugin('GET', '/info')]: () => ({ ...pluginInfo, api: '0.9' }),
    })
    const res = await upload()
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('plugin_incompatible')
  })
})

describe('upload jobs', () => {
  it('finds only upload jobs', async () => {
    fakeLibrary()
    const edit = startJob({
      kind: 'edit',
      itemId: 1000,
      run: async () => {
        throw new LibraryError(409, 'wpu_locked', 'Locked.')
      },
    })
    await jobsSettled()
    const res = await request(libraryApp()).get(`/upload/jobs?ids=${edit}`)
    expect(res.status).toBe(200)
    expect(JobsResponseSchema.parse(res.body)).toEqual({
      jobs: [{ id: edit, state: 'not_found' }],
    })
    expect(res.headers['cache-control']).toBe('no-store')
    const all = await request(libraryApp()).get(`/jobs?ids=${edit}`)
    expect(all.body.jobs[0]).toMatchObject({ id: edit, state: 'failed' })
  })

  it('cancels a running upload (204), then it reads not_found', async () => {
    const spy = fakeLibrary()
    const fallback = spy.getMockImplementation()
    let aborted = false
    spy.mockImplementation(async (config) => {
      if (routeKey(config) !== CREATE) return fallback?.(config) as never
      // WordPress never answers; only the cancel ends the request.
      return new Promise((_resolve, reject) => {
        config.signal?.addEventListener?.('abort', () => {
          aborted = true
          reject(new Error('canceled'))
        })
      })
    })
    const res = await upload()
    const { jobId } = res.body
    await vi.waitFor(async () => {
      const poll = await request(libraryApp()).get(`/upload/jobs?ids=${jobId}`)
      expect(poll.body.jobs[0].state).not.toBe('queued')
    })
    const cancel = await request(libraryApp()).delete(`/upload/jobs/${jobId}`)
    expect(cancel.status).toBe(204)
    expect(aborted).toBe(true)
    const poll = await request(libraryApp()).get(`/upload/jobs?ids=${jobId}`)
    expect(poll.body.jobs[0]).toEqual({ id: jobId, state: 'not_found' })
  })

  it('answers 404 job_not_found for an unknown or finished job', async () => {
    fakeLibrary({ [CREATE]: create, 'GET /wp-json/wp/v2/media': media })
    const unknown = await request(libraryApp()).delete('/upload/jobs/nope')
    expect(unknown.status).toBe(404)
    expect(unknown.body.code).toBe('job_not_found')

    const job = await settled(await upload())
    const finished = await request(libraryApp()).delete(
      `/upload/jobs/${job.id}`,
    )
    expect(finished.status).toBe(404)
  })

  it.each([
    ['/jobs', 'ids'],
    ['/jobs?ids=a,,b', 'ids'],
    ['/jobs?ids=a%20b', 'ids'],
    [
      `/jobs?ids=${Array.from({ length: 101 }, (_, i) => `j${i}`).join(',')}`,
      'ids',
    ],
    ['/upload/jobs?ids=a&kind=upload', 'kind'],
  ])('GET %s → 400 (param %s)', async (path, param) => {
    fakeLibrary()
    const res = await request(libraryApp()).get(path)
    expect(res.status).toBe(400)
    expect(res.body.details).toEqual({ param })
  })

  it('jobs answers every kind, in request order, deduplicated', async () => {
    fakeLibrary({ [CREATE]: create, 'GET /wp-json/wp/v2/media': media })
    const uploaded = await settled(await upload())
    const res = await request(libraryApp()).get(
      `/jobs?ids=missing,${uploaded.id},missing`,
    )
    expect(res.status).toBe(200)
    expect(res.body.jobs.map((job: { state: string }) => job.state)).toEqual([
      'not_found',
      'succeeded',
    ])
  })
})

describe('GET upload/check', () => {
  it('finds items with the file name’s slug', async () => {
    const svg = fullItems.find((entry) => entry.id === 1091)
    const spy = fakeLibrary({
      'GET /wp-json/wp/v2/media': () => (svg ? [wpMediaFor(svg)] : []),
    })
    const res = await request(libraryApp()).get(
      '/upload/check?filename=logo-mark.svg',
    )
    expect(res.status).toBe(200)
    expect(UploadCheckResponseSchema.parse(res.body)).toEqual(
      uploadCheckDuplicate,
    )
    expect(res.headers['cache-control']).toBe('no-store')
    expect(callsTo(spy, 'GET /wp-json/wp/v2/media')[0]?.params).toMatchObject({
      slug: 'logo-mark',
      per_page: 5,
      context: 'view',
    })
  })

  it('answers no duplicate for a name without a slug, without asking WordPress', async () => {
    const spy = fakeLibrary()
    const res = await request(libraryApp()).get('/upload/check?filename=.jpg')
    expect(res.body).toEqual({ duplicate: false, matches: [] })
    expect(callsTo(spy, 'GET /wp-json/wp/v2/media')).toHaveLength(0)
  })

  it.each([
    ['/upload/check', 'filename'],
    [`/upload/check?filename=${'a'.repeat(256)}`, 'filename'],
    ['/upload/check?filename=a.jpg&size=1', 'size'],
  ])('%s → 400 (param %s)', async (path, param) => {
    fakeLibrary()
    const res = await request(libraryApp()).get(path)
    expect(res.status).toBe(400)
    expect(res.body.details).toEqual({ param })
  })
})
