import express from 'express'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { errorHandler } from '../middleware/errorHandler.ts'

vi.mock('../lib/filebird.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/filebird.ts')>()
  return { ...actual, listFolders: vi.fn(), createFolder: vi.fn() }
})

import { env } from '../config/env.ts'
import { createFolder, listFolders } from '../lib/filebird.ts'
import { foldersRouter } from './folders.ts'

// Plain describe: every test toggles the shared env.filebirdApiKey and
// asserts on the shared module mocks across a real supertest request.
describe('folders', () => {
  const originalKey = env.filebirdApiKey

  function buildApp() {
    const app = express()
    app.use(foldersRouter)
    app.use(errorHandler)
    return app
  }

  beforeEach(() => {
    env.filebirdApiKey = 'fb-key'
  })

  afterEach(() => {
    env.filebirdApiKey = originalKey
    vi.mocked(listFolders).mockReset()
    vi.mocked(createFolder).mockReset()
  })

  it.each([
    ['GET', () => request(buildApp()).get('/folders')],
    ['POST', () => request(buildApp()).post('/folders').send({ name: 'Cats' })],
  ])(
    '%s /folders responds 404 when FileBird is disabled',
    async (_method, send) => {
      env.filebirdApiKey = null

      const res = await send()

      expect(res.status).toBe(404)
      expect(res.body.code).toBe('filebird_disabled')
      expect(listFolders).not.toHaveBeenCalled()
      expect(createFolder).not.toHaveBeenCalled()
    },
  )

  describe('GET /folders', () => {
    it('returns the folder tree', async () => {
      const folders = [{ id: 1, name: 'Cats', children: [] }]
      vi.mocked(listFolders).mockResolvedValue(folders)

      const res = await request(buildApp()).get('/folders')

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ folders })
    })

    it('maps a WpError to the matching HTTP response', async () => {
      vi.mocked(listFolders).mockRejectedValue({
        status: 502,
        code: 'filebird_unauthorized',
        message: 'Bad key',
      })

      const res = await request(buildApp()).get('/folders')

      expect(res.status).toBe(502)
      expect(res.body).toEqual({
        code: 'filebird_unauthorized',
        message: 'Bad key',
      })
    })
  })

  describe('POST /folders', () => {
    it('creates a folder under the given parent and returns its id', async () => {
      vi.mocked(createFolder).mockResolvedValue({ id: 40 })

      const res = await request(buildApp())
        .post('/folders')
        .send({ name: '  Dogs  ', parentId: 1 })

      expect(res.status).toBe(201)
      expect(res.body).toEqual({ id: 40 })
      expect(createFolder).toHaveBeenCalledWith('Dogs', 1)
    })

    it('defaults to the root when no parentId is given', async () => {
      vi.mocked(createFolder).mockResolvedValue({ id: 41 })

      await request(buildApp()).post('/folders').send({ name: 'Dogs' })

      expect(createFolder).toHaveBeenCalledWith('Dogs', 0)
    })

    it.each([
      [{}],
      [{ name: '   ' }],
      [{ name: 42 }],
      [{ name: 'x'.repeat(201) }],
    ])('responds 400 for an invalid name: %j', async (body) => {
      const res = await request(buildApp()).post('/folders').send(body)

      expect(res.status).toBe(400)
      expect(res.body.code).toBe('invalid_folder_name')
      expect(createFolder).not.toHaveBeenCalled()
    })

    it.each([[-1], [1.5], ['3']])(
      'responds 400 for an invalid parentId: %j',
      async (parentId) => {
        const res = await request(buildApp())
          .post('/folders')
          .send({ name: 'Dogs', parentId })

        expect(res.status).toBe(400)
        expect(res.body.code).toBe('invalid_parent_id')
      },
    )

    it('responds 400 for a malformed JSON body', async () => {
      const res = await request(buildApp())
        .post('/folders')
        .set('Content-Type', 'application/json')
        .send('{nope')

      expect(res.status).toBe(400)
      expect(res.body.code).toBe('invalid_json')
    })

    it('maps a WpError from createFolder to the matching HTTP response', async () => {
      vi.mocked(createFolder).mockRejectedValue({
        status: 502,
        code: 'filebird_error',
        message: 'A folder with this name already exists.',
      })

      const res = await request(buildApp())
        .post('/folders')
        .send({ name: 'Dogs' })

      expect(res.status).toBe(502)
      expect(res.body).toEqual({
        code: 'filebird_error',
        message: 'A folder with this name already exists.',
      })
    })
  })
})
