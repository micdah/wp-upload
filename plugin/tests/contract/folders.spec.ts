// The folder routes (plugin-api.md §5.16-5.20). Every test cleans up after
// itself: folders it creates are deleted, items it moves are moved back.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  FolderAssignResponseSchema,
  FolderDeleteResponseSchema,
  FolderMutationResponseSchema,
} from '../../../shared/library-api.schema.ts'
import type { FolderTree } from '../../../shared/library-api.ts'
import { anonymous, editor, PLUGIN } from './support/http.ts'
import {
  collection,
  expectError,
  folderTree,
  hydrate,
  ids,
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

const RUN = `p1t${Date.now().toString(36)}`
const created: number[] = []

async function createFolder(name: string, parent = 0) {
  const reply = await editor.post(`${PLUGIN}/folders`, { name, parent })
  expect(reply.status, JSON.stringify(reply.body).slice(0, 300)).toBe(201)
  const body = parse(FolderMutationResponseSchema, reply.body)
  created.push(body.folder.id)
  return body
}

async function patchFolder(id: number, change: Record<string, unknown>) {
  const reply = await editor.patch(`${PLUGIN}/folders/${id}`, change)
  expect(reply.status, JSON.stringify(reply.body).slice(0, 300)).toBe(200)
  return parse(FolderMutationResponseSchema, reply.body)
}

async function assign(folder: number, itemIds: number[]) {
  const reply = await editor.post(`${PLUGIN}/folders/assign`, {
    folder,
    ids: itemIds,
  })
  expect(reply.status, JSON.stringify(reply.body).slice(0, 300)).toBe(200)
  return parse(FolderAssignResponseSchema, reply.body)
}

function siblings(tree: FolderTree, parent: number): number[] {
  return tree.folders
    .filter((folder) => folder.parent === parent)
    .map((folder) => folder.id)
}

async function cleanUp(): Promise<void> {
  const tree = await folderTree()
  const existing = new Set(tree.folders.map((folder) => folder.id))
  for (const id of created.reverse()) {
    if (existing.has(id)) {
      await editor.del(`${PLUGIN}/folders/${id}`)
    }
  }
  created.length = 0
}

describe('GET /folders', () => {
  it('returns the shared tree, sorted by parent, ord, id, with counts', async () => {
    const tree = await folderTree()
    expect(tree.mode).toEqual({
      pro: false,
      perUser: false,
      readOnly: false,
      colorsWritable: false,
    })
    expect(tree.folders.length).toBeGreaterThan(0)
    const keys = tree.folders.map((folder) => [
      folder.parent,
      folder.ord,
      folder.id,
    ])
    const sorted = [...keys].sort(
      (a, b) =>
        (a[0] ?? 0) - (b[0] ?? 0) ||
        (a[1] ?? 0) - (b[1] ?? 0) ||
        (a[2] ?? 0) - (b[2] ?? 0),
    )
    expect(keys).toEqual(sorted)
    expect(tree.folders.every((folder) => folder.color === null)).toBe(true)
    const inFolders = tree.folders.reduce(
      (sum, folder) => sum + folder.count,
      0,
    )
    expect(inFolders + tree.counts.uncategorized).toBe(tree.counts.all)
    expect(tree.counts.all).toBe((await collection()).total)
  })

  it('answers 403 wpu_forbidden without credentials', async () => {
    expectError(await anonymous.get(`${PLUGIN}/folders`), 403, 'wpu_forbidden')
  })
})

describe('POST /folders', () => {
  afterAll(cleanUp)

  it('creates a folder last among its siblings, and bumps the rev', async () => {
    const before = await folderTree()
    const body = await createFolder(`  ${RUN}   top  `)
    expect(body.folder).toMatchObject({
      name: `${RUN} top`,
      parent: 0,
      color: null,
      count: 0,
    })
    expect(body.renamed).toBe(false)
    expect(body.requestedName).toBe(`${RUN} top`)
    expect(BigInt(body.rev)).toBeGreaterThan(BigInt(before.rev))
    expect(body.tree.rev).toBe(body.rev)
    const rootOrds = before.folders
      .filter((folder) => folder.parent === 0)
      .map((folder) => folder.ord)
    expect(body.folder.ord).toBeGreaterThan(Math.max(...rootOrds))
    expect(siblings(body.tree, 0).at(-1)).toBe(body.folder.id)
  })

  it('auto-suffixes a duplicate name among siblings, case-insensitively', async () => {
    const parent = await createFolder(`${RUN} parent`)
    const first = await createFolder('Logos', parent.folder.id)
    expect(first.renamed).toBe(false)
    const second = await createFolder('logos', parent.folder.id)
    expect(second.folder.name).toBe('logos (1)')
    expect(second.renamed).toBe(true)
    expect(second.requestedName).toBe('logos')
    const third = await createFolder('Logos', parent.folder.id)
    expect(third.folder.name).toBe('Logos (2)')
  })

  it('stores and returns plain text', async () => {
    const body = await createFolder(`${RUN} Tom & Jerry "x"`)
    expect(body.folder.name).toBe(`${RUN} Tom & Jerry "x"`)
    expect(body.renamed).toBe(false)
  })

  it('validates the body', async () => {
    const invalid: [unknown, number, string][] = [
      [{ name: '   ', parent: 0 }, 400, 'wpu_invalid_folder_name'],
      [{ name: 'x'.repeat(201), parent: 0 }, 400, 'wpu_invalid_folder_name'],
      [{ name: '<b></b>', parent: 0 }, 400, 'wpu_invalid_folder_name'],
      [{ name: 'ok', parent: 0, colour: '#fff' }, 400, 'wpu_invalid_param'],
      [{ name: 'ok', parent: '1' }, 400, 'wpu_invalid_param'],
      [{ name: 'ok', parent: -1 }, 400, 'wpu_invalid_param'],
      [{ name: 'ok' }, 400, 'wpu_invalid_param'],
      [{ name: 12, parent: 0 }, 400, 'wpu_invalid_param'],
      [{ name: 'ok', parent: 999999 }, 404, 'wpu_folder_not_found'],
    ]
    for (const [body, status, code] of invalid) {
      expectError(await editor.post(`${PLUGIN}/folders`, body), status, code)
    }
    expectError(
      await editor.raw('POST', `${PLUGIN}/folders`, '[1,2]'),
      400,
      'wpu_invalid_param',
    )
    expect((await createFolder('x'.repeat(200))).folder.name.length).toBe(200)
  })
})

describe('PATCH /folders/{id}', () => {
  afterAll(cleanUp)

  it('renames; a clash is auto-suffixed; an unchanged name is a no-op', async () => {
    const parent = await createFolder(`${RUN} rename`)
    const a = await createFolder('Alpha', parent.folder.id)
    await createFolder('Beta', parent.folder.id)
    const renamed = await patchFolder(a.folder.id, { name: '  Gamma  ' })
    expect(renamed.folder.name).toBe('Gamma')
    expect(renamed.renamed).toBe(false)
    expect(renamed.requestedName).toBe('Gamma')
    const clash = await patchFolder(a.folder.id, { name: 'Beta' })
    expect(clash.folder.name).toBe('Beta (1)')
    expect(clash.renamed).toBe(true)
    const same = await patchFolder(a.folder.id, { name: 'Beta (1)' })
    expect(same.folder.name).toBe('Beta (1)')
    expect(same.renamed).toBe(false)
  })

  it('moves to another parent (last by default) and reorders by position', async () => {
    const root = await createFolder(`${RUN} move`)
    const one = await createFolder('One', root.folder.id)
    const two = await createFolder('Two', root.folder.id)
    const three = await createFolder('Three', root.folder.id)
    const target = await createFolder(`${RUN} target`)
    const inside = await createFolder('Inside', target.folder.id)

    const moved = await patchFolder(three.folder.id, {
      parent: target.folder.id,
    })
    expect(moved.folder.parent).toBe(target.folder.id)
    expect(moved.renamed).toBe(false)
    expect(moved.requestedName).toBeNull()
    expect(siblings(moved.tree, target.folder.id)).toEqual([
      inside.folder.id,
      three.folder.id,
    ])

    const first = await patchFolder(three.folder.id, { position: 0 })
    expect(siblings(first.tree, target.folder.id)).toEqual([
      three.folder.id,
      inside.folder.id,
    ])

    const back = await patchFolder(three.folder.id, {
      parent: root.folder.id,
      position: 1,
    })
    expect(siblings(back.tree, root.folder.id)).toEqual([
      one.folder.id,
      three.folder.id,
      two.folder.id,
    ])

    const last = await patchFolder(one.folder.id, { position: 99 })
    expect(siblings(last.tree, root.folder.id)).toEqual([
      three.folder.id,
      two.folder.id,
      one.folder.id,
    ])

    const toRoot = await patchFolder(two.folder.id, { parent: 0, position: 0 })
    expect(siblings(toRoot.tree, 0)[0]).toBe(two.folder.id)
  })

  it('applies name, then move, in one request', async () => {
    const root = await createFolder(`${RUN} combo`)
    const child = await createFolder('Child', root.folder.id)
    const body = await patchFolder(child.folder.id, {
      name: 'Renamed child',
      parent: 0,
    })
    expect(body.folder).toMatchObject({ name: 'Renamed child', parent: 0 })
    expect(body.requestedName).toBe('Renamed child')
  })

  it('refuses a cycle, colours on Lite, bad bodies and unknown folders', async () => {
    const root = await createFolder(`${RUN} cycle`)
    const child = await createFolder('Child', root.folder.id)
    const grandchild = await createFolder('Grandchild', child.folder.id)
    const path = `${PLUGIN}/folders/${root.folder.id}`
    expectError(
      await editor.patch(path, { parent: root.folder.id }),
      409,
      'wpu_folder_cycle',
    )
    expectError(
      await editor.patch(path, { parent: grandchild.folder.id }),
      409,
      'wpu_folder_cycle',
    )
    expectError(
      await editor.patch(path, { color: '#aabbcc' }),
      409,
      'wpu_pro_required',
    )
    expectError(await editor.patch(path, {}), 400, 'wpu_invalid_param')
    expectError(
      await editor.patch(path, { color: 'red' }),
      400,
      'wpu_invalid_param',
    )
    expectError(
      await editor.patch(path, { position: -1 }),
      400,
      'wpu_invalid_param',
    )
    expectError(
      await editor.patch(path, { nmae: 'x' }),
      400,
      'wpu_invalid_param',
    )
    expectError(
      await editor.patch(path, { name: '' }),
      400,
      'wpu_invalid_folder_name',
    )
    expectError(
      await editor.patch(path, { parent: 999999 }),
      404,
      'wpu_folder_not_found',
    )
    expectError(
      await editor.patch(`${PLUGIN}/folders/999999`, { name: 'x' }),
      404,
      'wpu_folder_not_found',
    )
    const unchanged = await folderTree()
    expect(
      unchanged.folders.find((folder) => folder.id === root.folder.id)?.parent,
    ).toBe(0)
  })

  it('accepts POST with X-HTTP-Method-Override: PATCH', async () => {
    const folder = await createFolder(`${RUN} override`)
    const reply = await editor.post(
      `${PLUGIN}/folders/${folder.folder.id}`,
      { name: `${RUN} overridden` },
      { 'X-HTTP-Method-Override': 'PATCH' },
    )
    expect(reply.status).toBe(200)
    expect(reply.body.folder.name).toBe(`${RUN} overridden`)
  })
})

describe('DELETE /folders/{id}', () => {
  afterAll(cleanUp)

  it('deletes the subtree depth-first; its files become Uncategorized', async () => {
    const root = await createFolder(`${RUN} delete`)
    const a = await createFolder('A', root.folder.id)
    const a1 = await createFolder('A1', a.folder.id)
    const b = await createFolder('B', root.folder.id)
    const uncategorized = await ids({ folder: 0 })
    const items = uncategorized.slice(0, 3)
    await assign(a1.folder.id, [items[0] ?? 0])
    await assign(b.folder.id, [items[1] ?? 0, items[2] ?? 0])

    const reply = await editor.del(`${PLUGIN}/folders/${root.folder.id}`)
    expect(reply.status).toBe(200)
    const body = parse(FolderDeleteResponseSchema, reply.body)
    expect(body.deletedIds).toEqual([
      root.folder.id,
      a.folder.id,
      a1.folder.id,
      b.folder.id,
    ])
    expect(body.movedFiles).toBe(3)
    expect(
      body.tree.folders.some((folder) => body.deletedIds.includes(folder.id)),
    ).toBe(false)
    expect(await ids({ folder: 0 })).toEqual(expect.arrayContaining(items))
    const hydrated = await hydrate(items)
    expect([...hydrated.values()].map((item) => item.wpu.folder)).toEqual([
      0, 0, 0,
    ])

    expectError(
      await editor.del(`${PLUGIN}/folders/${root.folder.id}`),
      404,
      'wpu_folder_not_found',
    )
  })
})

describe('POST /folders/assign', () => {
  let folder: number
  let items: number[]
  let original: Map<number, number>

  beforeAll(async () => {
    folder = (await createFolder(`${RUN} assign`)).folder.id
    const tree = await folderTree()
    const filled = tree.folders.find(
      (candidate) => candidate.count >= 2 && candidate.id !== folder,
    )
    const fromFolder = await ids({ folder: filled?.id ?? 0 })
    items = [
      ...fromFolder.slice(0, 2),
      ...(await ids({ folder: 0 })).slice(0, 2),
    ]
    original = new Map(
      [...(await hydrate(items)).values()].map((item) => [
        item.id,
        item.wpu.folder ?? 0,
      ]),
    )
  })

  afterEach(async () => {
    for (const [id, previous] of original) {
      await assign(previous, [id])
    }
  })

  afterAll(cleanUp)

  it('moves items, reports previous folders, skips unknown ids, and returns every count', async () => {
    const before = await folderTree()
    const body = await assign(folder, [...items, 999999])
    expect(body.previous).toEqual(
      items.map((id) => ({ id, folder: original.get(id) })),
    )
    expect(body.skipped).toEqual([
      {
        id: 999999,
        ok: false,
        error: { code: 'wpu_not_found', message: expect.any(String) },
      },
    ])
    expect(body.moved).toBe(items.length)
    expect(BigInt(body.rev)).toBeGreaterThan(BigInt(before.rev))
    const after = await folderTree()
    expect(body.counts.all).toBe(after.counts.all)
    expect(body.counts.uncategorized).toBe(after.counts.uncategorized)
    expect(
      Object.keys(body.counts.byId)
        .map(Number)
        .sort((a, b) => a - b),
    ).toEqual(
      after.folders.map((candidate) => candidate.id).sort((a, b) => a - b),
    )
    expect(body.counts.byId[String(folder)]).toBe(items.length)
    expect(await ids({ folder })).toEqual(expect.arrayContaining(items))
    const hydrated = await hydrate(items)
    expect(
      [...hydrated.values()].every((item) => item.wpu.folder === folder),
    ).toBe(true)
  })

  it('counts only changed items as moved, and does not bump for no change', async () => {
    await assign(folder, items)
    const revBefore = (await editor.get(`${PLUGIN}/rev`)).body.rev
    const again = await assign(folder, items)
    expect(again.moved).toBe(0)
    expect(again.previous.every((entry) => entry.folder === folder)).toBe(true)
    // The rev reported is the current one, and nothing bumps it after the response.
    expect(again.rev).toBe(revBefore)
    expect((await editor.get(`${PLUGIN}/rev`)).body.rev).toBe(revBefore)
    const out = await assign(0, items)
    expect(out.moved).toBe(items.length)
    expect(await ids({ folder: 0 })).toEqual(expect.arrayContaining(items))
  })

  it('validates the body', async () => {
    const path = `${PLUGIN}/folders/assign`
    expectError(
      await editor.post(path, { folder, ids: [] }),
      400,
      'wpu_invalid_param',
    )
    expectError(
      await editor.post(path, { folder, ids: [1.5] }),
      400,
      'wpu_invalid_param',
    )
    expectError(
      await editor.post(path, { folder, ids: ['1'] }),
      400,
      'wpu_invalid_param',
    )
    expectError(await editor.post(path, { ids: [1] }), 400, 'wpu_invalid_param')
    expectError(
      await editor.post(path, { folder, ids: [1], extra: true }),
      400,
      'wpu_invalid_param',
    )
    const tooMany = await editor.post(path, {
      folder,
      ids: Array.from({ length: 5001 }, (_, index) => index + 1),
    })
    expectError(tooMany, 400, 'wpu_too_many_items')
    expect(tooMany.body.data).toMatchObject({ param: 'ids', max: 5000 })
    expectError(
      await editor.post(path, { folder: 999999, ids: [1] }),
      404,
      'wpu_folder_not_found',
    )
  })

  it('handles 5000 ids in one call', async () => {
    const everything = await ids()
    const padded = [
      ...everything,
      ...Array.from({ length: 5000 - everything.length }, (_, i) => 900000 + i),
    ]
    const started = Date.now()
    const body = await assign(folder, padded.slice(0, 5000))
    expect(body.previous.length).toBe(everything.length)
    expect(body.skipped.length).toBe(5000 - everything.length)
    expect(Date.now() - started).toBeLessThan(20000)
    // Put every item back where it was.
    const byFolder = new Map<number, number[]>()
    for (const entry of body.previous) {
      byFolder.set(entry.folder, [
        ...(byFolder.get(entry.folder) ?? []),
        entry.id,
      ])
    }
    for (const [previous, itemIds] of byFolder) {
      await assign(previous, itemIds)
    }
    const tree = await folderTree()
    expect(
      tree.folders.find((candidate) => candidate.id === folder)?.count,
    ).toBe(0)
  })

  it.skipIf(!authorAvailable)(
    'skips items an Author may not edit with wpu_forbidden',
    async () => {
      await asAuthor(async (author) => {
        const { user } = await info(author)
        const visible = toRows((await collection({}, author)).rows).map(
          (row) => row.id,
        )
        const hydrated = await hydrate(visible, author)
        const own = visible
          .filter((id) => hydrated.get(id)?.author === user.id)
          .slice(0, 1)
        const others = visible
          .filter((id) => hydrated.get(id)?.author !== user.id)
          .slice(0, 1)
        const ownOriginal = own.map((id) => hydrated.get(id)?.wpu.folder ?? 0)
        const reply = await author.post(`${PLUGIN}/folders/assign`, {
          folder,
          ids: [...own, ...others],
        })
        expect(reply.status).toBe(200)
        const body = parse(FolderAssignResponseSchema, reply.body)
        expect(
          body.skipped.map((entry) => [entry.id, entry.error.code]),
        ).toEqual(others.map((id) => [id, 'wpu_forbidden']))
        expect(body.previous.map((entry) => entry.id)).toEqual(own)
        for (const [index, id] of own.entries()) {
          await author.post(`${PLUGIN}/folders/assign`, {
            folder: ownOriginal[index],
            ids: [id],
          })
        }
      })
    },
  )
})

describe.skipIf(!variantsAvailable)(
  `folder routes with variants (${SKIP_REASON})`,
  () => {
    afterAll(async () => {
      resetVariant()
      await cleanUp()
    })

    it('answers 409 wpu_filebird_inactive for every folder route without FileBird', async () => {
      const folder = (await createFolder(`${RUN} inactive`)).folder.id
      setVariant({ filebird: 'off' })
      expectError(
        await editor.get(`${PLUGIN}/folders`),
        409,
        'wpu_filebird_inactive',
      )
      expectError(
        await editor.post(`${PLUGIN}/folders`, { name: 'x', parent: 0 }),
        409,
        'wpu_filebird_inactive',
      )
      expectError(
        await editor.patch(`${PLUGIN}/folders/${folder}`, { name: 'x' }),
        409,
        'wpu_filebird_inactive',
      )
      expectError(
        await editor.del(`${PLUGIN}/folders/${folder}`),
        409,
        'wpu_filebird_inactive',
      )
      expectError(
        await editor.post(`${PLUGIN}/folders/assign`, { folder: 0, ids: [1] }),
        409,
        'wpu_filebird_inactive',
      )
      setVariant({ filebird: 'on' })
    })

    it('serves the user’s own tree read-only in per-user mode', async () => {
      const folder = (await createFolder(`${RUN} per-user`)).folder.id
      setVariant({ peruser: 'on' })
      const tree = await folderTree()
      expect(tree.mode).toMatchObject({ perUser: true, readOnly: true })
      expect(tree.folders.some((candidate) => candidate.id === folder)).toBe(
        false,
      )
      expect(tree.counts.all).toBe((await collection()).total)
      expectError(
        await editor.post(`${PLUGIN}/folders`, { name: 'x', parent: 0 }),
        409,
        'wpu_filebird_per_user',
      )
      expectError(
        await editor.patch(`${PLUGIN}/folders/${folder}`, { name: 'x' }),
        409,
        'wpu_filebird_per_user',
      )
      expectError(
        await editor.del(`${PLUGIN}/folders/${folder}`),
        409,
        'wpu_filebird_per_user',
      )
      expectError(
        await editor.post(`${PLUGIN}/folders/assign`, { folder: 0, ids: [1] }),
        409,
        'wpu_filebird_per_user',
      )
      setVariant({ peruser: 'off' })
    })
  },
)
