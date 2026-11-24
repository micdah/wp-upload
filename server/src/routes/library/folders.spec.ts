import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import {
  folderAssignPressKit,
  folderCreateRenamed,
  folderDeleteEvents,
  folderTree,
  folderTreePerUser,
  folderTreePro,
} from '../../../../shared/fixtures/index.ts'
import {
  FolderAssignResponseSchema,
  FolderDeleteResponseSchema,
  FolderMutationResponseSchema,
  FolderTreeSchema,
} from '../../../../shared/library-api.schema.ts'
import { normaliseFolderTree } from '../../lib/library/normalise/folders.ts'
import {
  callsTo,
  fakeLibrary,
  libraryApp,
  plugin,
  resetLibrary,
  wpErrorResponse,
} from '../../lib/library/specSupport.ts'

afterEach(async () => {
  await resetLibrary()
})

describe('GET folders', () => {
  it.each([
    ['Lite', folderTree],
    ['Pro', folderTreePro],
    ['per-user', folderTreePerUser],
  ])('answers the %s tree, cached', async (_name, tree) => {
    const spy = fakeLibrary({ [plugin('GET', '/folders')]: () => tree })
    const app = libraryApp()
    const res = await request(app).get('/folders')
    await request(app).get('/folders')
    expect(res.status).toBe(200)
    expect(FolderTreeSchema.parse(res.body)).toEqual(tree)
    expect(res.headers['cache-control']).toBe('private, no-cache')
    expect(res.headers.etag).toBeDefined()
    expect(callsTo(spy, plugin('GET', '/folders'))).toHaveLength(1)
  })

  it('passes 409 wpu_filebird_inactive through', async () => {
    fakeLibrary({
      [plugin('GET', '/folders')]: () => {
        throw wpErrorResponse(409, 'wpu_filebird_inactive', 'No FileBird.')
      },
    })
    const res = await request(libraryApp()).get('/folders')
    expect(res.status).toBe(409)
    expect(res.body).toEqual({
      code: 'wpu_filebird_inactive',
      message: 'No FileBird.',
    })
  })
})

describe('normaliseFolderTree', () => {
  it('sorts by parent, ord and id, and hides colours without Pro', () => {
    const shuffled = {
      ...folderTree,
      folders: [...folderTree.folders]
        .reverse()
        .map((folder) => ({ ...folder, color: '#ABCDEF' })),
    }
    const normalised = normaliseFolderTree(shuffled)
    expect(normalised.folders.map((f) => f.id)).toEqual(
      folderTree.folders.map((f) => f.id),
    )
    expect(normalised.folders.every((f) => f.color === null)).toBe(true)
  })

  it('keeps valid Pro colours, lowercased, and drops invalid ones', () => {
    const [first, second] = folderTreePro.folders
    if (!first || !second) throw new Error('fixture too small')
    const tree = {
      ...folderTreePro,
      folders: [
        { ...first, color: '#7C5CFF' },
        { ...second, color: 'red' },
      ],
    }
    const colors = normaliseFolderTree(tree).folders.map((f) => f.color)
    expect(colors).toEqual(['#7c5cff', null])
  })
})

describe('POST folders', () => {
  it('creates a folder with the normalised name and answers 201', async () => {
    const spy = fakeLibrary({
      [plugin('POST', '/folders')]: () => folderCreateRenamed,
    })
    const res = await request(libraryApp())
      .post('/folders')
      .send({ name: '  Logos ', parent: 1 })
    expect(res.status).toBe(201)
    expect(FolderMutationResponseSchema.parse(res.body)).toEqual(
      folderCreateRenamed,
    )
    expect(res.headers['cache-control']).toBe('no-store')
    expect(res.headers['x-library-rev']).toBe(folderCreateRenamed.rev)
    expect(callsTo(spy, plugin('POST', '/folders'))[0]?.data).toEqual({
      name: 'Logos',
      parent: 1,
    })
  })

  it.each([
    [{ parent: 0 }, 'name'],
    [{ name: '   ', parent: 0 }, 'name'],
    [{ name: 'x'.repeat(201), parent: 0 }, 'name'],
    [{ name: 'A' }, 'parent'],
    [{ name: 'A', parent: -1 }, 'parent'],
    [{ name: 'A', parent: '1' }, 'parent'],
    [{ name: 'A', parent: 0, color: '#000000' }, 'color'],
  ])('rejects %j', async (body, param) => {
    fakeLibrary()
    const res = await request(libraryApp()).post('/folders').send(body)
    expect(res.status).toBe(400)
    expect(res.body.details).toEqual({ param })
  })

  it.each([
    [404, 'wpu_folder_not_found'],
    [409, 'wpu_folder_name_exhausted'],
    [409, 'wpu_filebird_per_user'],
    [400, 'wpu_invalid_folder_name'],
  ])('passes the plugin’s %i %s through', async (status, code) => {
    fakeLibrary({
      [plugin('POST', '/folders')]: () => {
        throw wpErrorResponse(status, code)
      },
    })
    const res = await request(libraryApp())
      .post('/folders')
      .send({ name: 'A', parent: 99 })
    expect(res.status).toBe(status)
    expect(res.body.code).toBe(code)
  })
})

describe('PATCH folders/:id', () => {
  it('sends a move with position and a lowercased colour', async () => {
    const spy = fakeLibrary({
      [plugin('PATCH', '/folders/2')]: () => folderCreateRenamed,
    })
    const res = await request(libraryApp())
      .patch('/folders/2')
      .send({ parent: 0, position: 1, color: '#ABCDEF' })
    expect(res.status).toBe(200)
    expect(callsTo(spy, plugin('PATCH', '/folders/2'))[0]?.data).toEqual({
      parent: 0,
      position: 1,
      color: '#abcdef',
    })
  })

  it('clears a colour with null', async () => {
    const spy = fakeLibrary({
      [plugin('PATCH', '/folders/2')]: () => folderCreateRenamed,
    })
    await request(libraryApp()).patch('/folders/2').send({ color: null })
    expect(callsTo(spy, plugin('PATCH', '/folders/2'))[0]?.data).toEqual({
      color: null,
    })
  })

  it('passes a cycle through as 409', async () => {
    fakeLibrary({
      [plugin('PATCH', '/folders/2')]: () => {
        throw wpErrorResponse(409, 'wpu_folder_cycle', 'Cycle.')
      },
    })
    const res = await request(libraryApp())
      .patch('/folders/2')
      .send({ parent: 3 })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe('wpu_folder_cycle')
  })

  it.each([
    [{}, 'body'],
    [{ position: -1 }, 'position'],
    [{ position: 1.5 }, 'position'],
    [{ color: 'red' }, 'color'],
    [{ name: '' }, 'name'],
    [{ ord: 1 }, 'ord'],
  ])('rejects %j', async (body, param) => {
    fakeLibrary()
    const res = await request(libraryApp()).patch('/folders/2').send(body)
    expect(res.status).toBe(400)
    expect(res.body.details).toEqual({ param })
  })

  it('answers 404 for a non-numeric id', async () => {
    fakeLibrary()
    const res = await request(libraryApp())
      .patch('/folders/x')
      .send({ name: 'A' })
    expect(res.status).toBe(404)
  })
})

describe('DELETE folders/:id', () => {
  it('deletes the subtree and answers the new tree', async () => {
    fakeLibrary({
      [plugin('DELETE', '/folders/8')]: () => folderDeleteEvents,
    })
    const res = await request(libraryApp()).delete('/folders/8')
    expect(res.status).toBe(200)
    expect(FolderDeleteResponseSchema.parse(res.body)).toEqual(
      folderDeleteEvents,
    )
    expect(res.headers['x-library-rev']).toBe(folderDeleteEvents.rev)
  })
})

describe('POST folders/assign', () => {
  it('assigns deduplicated ids and answers the plugin’s result', async () => {
    const spy = fakeLibrary({
      [plugin('POST', '/folders/assign')]: () => folderAssignPressKit,
    })
    const res = await request(libraryApp())
      .post('/folders/assign')
      .send({ folder: 15, ids: [1002, 1003, 1002, 999999] })
    expect(res.status).toBe(200)
    expect(FolderAssignResponseSchema.parse(res.body)).toEqual(
      folderAssignPressKit,
    )
    expect(callsTo(spy, plugin('POST', '/folders/assign'))[0]?.data).toEqual({
      folder: 15,
      ids: [1002, 1003, 999999],
    })
  })

  it('takes 5000 ids, not 5001', async () => {
    fakeLibrary({
      [plugin('POST', '/folders/assign')]: () => folderAssignPressKit,
    })
    const ids = Array.from({ length: 5001 }, (_, i) => i + 1)
    const app = libraryApp()
    const ok = await request(app)
      .post('/folders/assign')
      .send({ folder: 0, ids: ids.slice(0, 5000) })
    const tooMany = await request(app)
      .post('/folders/assign')
      .send({ folder: 0, ids })
    expect(ok.status).toBe(200)
    expect(tooMany.status).toBe(400)
    expect(tooMany.body.details).toEqual({ param: 'ids' })
  })

  it.each([
    [{ ids: [1] }, 'folder'],
    [{ folder: 1 }, 'ids'],
    [{ folder: 1, ids: [] }, 'ids'],
    [{ folder: 1, ids: [0] }, 'ids'],
    [{ folder: 1, ids: '1,2' }, 'ids'],
  ])('rejects %j', async (body, param) => {
    fakeLibrary()
    const res = await request(libraryApp()).post('/folders/assign').send(body)
    expect(res.status).toBe(400)
    expect(res.body.details).toEqual({ param })
  })
})
