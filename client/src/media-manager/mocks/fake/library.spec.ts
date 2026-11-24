import { afterEach, describe, expect, it } from 'vitest'
import {
  type CollectionQuery,
  ROW_STRIDE,
} from '../../../../../shared/library-api'
import type { MockContext } from '../context'
import { manualClock, startFakeBackend, stopFakeBackend } from '../node'
import { generateDataset } from './generate'
import type { FakeLibrary } from './library'
import { sniffDimensions } from './sniff'

afterEach(() => {
  stopFakeBackend()
})

const ALL: CollectionQuery = {
  folder: 'all',
  q: null,
  type: null,
  alt: null,
  size: null,
  orient: null,
  month: null,
  sort: 'date-desc',
}

function ids(
  library: FakeLibrary,
  query: Partial<CollectionQuery> = {},
): number[] {
  const { rows, total } = library.collection({ ...ALL, ...query })
  return Array.from(
    { length: total },
    (_, index) => rows[index * ROW_STRIDE] ?? 0,
  )
}

function fake(scenario = 'normal', clock?: () => number): MockContext {
  return startFakeBackend(scenario, clock ? { clock } : {})
}

describe('collection query', () => {
  it('lists the prototype library newest first, without trashed items', () => {
    const { library } = fake('trash')
    const all = ids(library)
    expect(all).toHaveLength(library.itemCount - 2)
    expect(all).not.toContain(1017)
    const trash = ids(library, { folder: 'trash' })
    // Newest trash first.
    expect(trash).toEqual([1026, 1017])
  })

  it('searches every term across text fields, case-insensitively', () => {
    const { library } = fake()
    const hits = ids(library, { q: 'JOSHUA still' })
    expect(hits).toContain(1000)
    for (const id of hits) {
      const item = library.item(id)
      const text = `${item?.title} ${item?.alt} ${item?.filename}`.toLowerCase()
      expect(text).toContain('joshua')
    }
    expect(ids(library, { q: 'zzzz-nothing' })).toEqual([])
  })

  it('filters by type, missing alt, size and orientation', () => {
    const { library } = fake()
    for (const id of ids(library, { type: 'document' })) {
      expect(['document', 'archive', 'other']).toContain(library.item(id)?.kind)
    }
    for (const id of ids(library, { alt: 'missing' })) {
      const item = library.item(id)
      expect(['image', 'svg']).toContain(item?.kind)
      expect(item?.alt.trim()).toBe('')
    }
    for (const id of ids(library, { size: 'gt5' })) {
      expect(library.item(id)?.filesize).toBeGreaterThan(5_000_000)
    }
    for (const id of ids(library, { orient: 'portrait' })) {
      const item = library.item(id)
      expect((item?.width ?? 0) / (item?.height ?? 1)).toBeLessThan(0.9)
    }
  })

  it('sorts with the id tiebreaker and unknown sizes last', () => {
    const { library } = fake()
    const bySize = ids(library, { sort: 'size-asc' })
    const sizes = bySize.map((id) => library.item(id)?.filesize ?? 0)
    expect([...sizes].sort((a, b) => a - b)).toEqual(sizes)
    const byDimensions = ids(library, { sort: 'dimensions-desc' })
    const last = library.item(byDimensions.at(-1) ?? 0)
    expect((last?.width ?? 0) * (last?.height ?? 0)).toBe(0)
  })

  it('counts facets for the view and for the folder alone', () => {
    const { library } = fake()
    const facets = library.facets({ ...ALL, folder: 6, type: 'image' })
    expect(facets.view.total).toBe(facets.folder.types.image)
    expect(facets.folder.total).toBe(ids(library, { folder: 6 }).length)
    expect(facets.months.reduce((sum, month) => sum + month.count, 0)).toBe(
      facets.folder.total,
    )
  })

  it('refuses folder filters without FileBird and unknown folders', () => {
    expect(() => ids(fake('no-filebird').library, { folder: 0 })).toThrow(
      /FileBird is not active/,
    )
    expect(() => ids(fake().library, { folder: 4242 })).toThrow(
      /does not exist/,
    )
  })
})

describe('metadata', () => {
  it('alt-only changes keep modifiedAt; others bump it and the rev', () => {
    const { library } = fake()
    const before = library.item(1000)?.modifiedAt
    const rev = library.rev
    const alt = library.patchItem(1000, { alt: 'x' })
    expect(alt.rev).not.toBe(rev)
    expect(library.item(1000)?.modifiedAt).toBe(before)
    library.patchItem(1000, { title: 'y' })
    expect(library.item(1000)?.modifiedAt).not.toBe(before)
  })

  it('appends a description paragraph and returns the whole previous one', () => {
    const { library } = fake()
    library.patchItem(1000, { description: 'First.  \n' })
    const result = library.batch({
      ids: [1000],
      set: {},
      appendDescription: 'Second.',
    })
    expect(result.results[0]).toMatchObject({
      ok: true,
      previous: { description: 'First.  \n' },
      item: { description: 'First.\n\nSecond.' },
    })
  })

  it('checks attach targets', () => {
    const { library } = fake()
    expect(() => library.patchItem(1000, { post: 9999 })).toThrow(
      /does not exist/,
    )
    expect(() => library.patchItem(1000, { post: 1001 })).toThrow(/attached/)
    expect(library.patchItem(1000, { post: 205 }).previous).toEqual({
      post: null,
    })
  })
})

describe('folders', () => {
  it('auto-suffixes clashing names and reports it', () => {
    const { library } = fake()
    const created = library.createFolder({ name: 'Logos', parent: 1 })
    expect(created).toMatchObject({
      renamed: true,
      requestedName: 'Logos',
      folder: { name: 'Logos (1)', parent: 1 },
    })
  })

  it('moves and reorders among siblings, and refuses cycles', () => {
    const { library } = fake()
    expect(() => library.updateFolder(4, { parent: 7 })).toThrow(/into itself/)
    const moved = library.updateFolder(14, { parent: 4, position: 0 })
    const children = moved.tree.folders.filter((folder) => folder.parent === 4)
    expect(children.map((folder) => folder.id)).toEqual([14, 5, 6])
  })

  it('deletes a subtree and moves its files to Uncategorized', () => {
    const { library } = fake()
    const inEvents = [8, 9, 10].reduce(
      (sum, id) => sum + ids(library, { folder: id }).length,
      0,
    )
    const uncategorized = ids(library, { folder: 0 }).length
    const result = library.deleteFolder(8)
    expect(result.deletedIds).toEqual([8, 9, 10])
    expect(result.movedFiles).toBe(inEvents)
    expect(ids(library, { folder: 0 }).length).toBe(uncategorized + inEvents)
  })

  it('refuses mutations in per-user mode and colours without Pro', () => {
    expect(() =>
      fake('per-user').library.createFolder({ name: 'x', parent: 0 }),
    ).toThrow(/per-user/)
    expect(() => fake().library.updateFolder(1, { color: '#ff0000' })).toThrow(
      /Pro/,
    )
    expect(
      fake('pro').library.updateFolder(1, { color: '#ff0000' }).folder.color,
    ).toBe('#ff0000')
  })

  it('assign reports previous folders and skips what an Author may not edit', () => {
    const { library } = fake('author')
    const result = library.assign(2, [1090, 1000, 424242])
    expect(result.previous).toEqual([{ id: 1090, folder: 4 }])
    expect(result.skipped.map((entry) => entry.error.code)).toEqual([
      'wpu_forbidden',
      'wpu_not_found',
    ])
    expect(result.moved).toBe(1)
  })
})

describe('jobs', () => {
  it('runs an edit queued → running → succeeded on the clock, then applies it', () => {
    const clock = manualClock()
    const { library } = startFakeBackend('normal', {
      clock,
      settings: { jobSpeed: 1 },
    })
    const item = library.items([1000], 'full').items[0]
    const jobId = library.startEdit(1000, {
      ops: [{ op: 'rotate', angle: 90 }],
      applyTo: 'all',
      expectedModified: item?.modifiedAt ?? '',
    })
    const state = () => {
      library.tick()
      return library.jobLookups([jobId], false)[0]
    }
    expect(state()).toMatchObject({
      state: 'queued',
      kind: 'edit',
      itemId: 1000,
    })
    clock.advance(500)
    expect(state()).toMatchObject({ state: 'running' })
    clock.advance(2000)
    const done = state()
    expect(done).toMatchObject({ state: 'succeeded' })
    expect(library.item(1000)).toMatchObject({
      width: item?.height,
      height: item?.width,
      edited: true,
      undoable: true,
    })
    clock.advance(11 * 60_000)
    expect(state()).toEqual({ id: jobId, state: 'not_found' })
  })

  it('fails with wpu_stale when the item changed since editing started', () => {
    const { library } = fake()
    const jobId = library.startEdit(1000, {
      ops: [{ op: 'flipH' }],
      applyTo: 'all',
      expectedModified: '2000-01-01T00:00:00Z',
    })
    library.tick()
    expect(library.jobLookups([jobId], false)[0]).toMatchObject({
      state: 'failed',
      error: { code: 'wpu_stale', details: { modifiedAt: expect.any(String) } },
    })
  })

  it('uploads with byte progress, processing, then a new item in its folder', async () => {
    const clock = manualClock()
    const { library } = startFakeBackend('normal', {
      clock,
      settings: { jobSpeed: 1 },
    })
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48,
      0x44, 0x52, 0, 0, 0x03, 0x20, 0, 0, 0x02, 0x58,
    ])
    expect(sniffDimensions(png)).toEqual({ width: 800, height: 600 })
    const before = ids(library).length
    const jobId = library.startUpload(
      {
        name: 'team.png',
        type: 'image/png',
        size: 4_000_000,
        blob: new Blob([png]),
        width: 800,
        height: 600,
      },
      6,
    )
    const state = () => {
      library.tick()
      return library.jobLookups([jobId], true)[0]
    }
    clock.advance(600)
    expect(state()).toMatchObject({
      state: 'running',
      progress: { unit: 'bytes', total: 4_000_000 },
    })
    clock.advance(1000)
    expect(state()).toMatchObject({ state: 'processing' })
    clock.advance(2000)
    const done = state()
    expect(done).toMatchObject({
      state: 'succeeded',
      result: {
        item: { width: 800, height: 600, folder: 6 },
        folder: { assigned: true },
      },
    })
    expect(ids(library)).toHaveLength(before + 1)
    expect(library.uploadCheck('team.png').duplicate).toBe(true)
  })
})

describe('generator', () => {
  it('is deterministic and grows ids with the upload date', () => {
    const first = generateDataset({ items: 2000 })
    const second = generateDataset({ items: 2000 })
    expect(first.items.map((item) => item.title)).toEqual(
      second.items.map((item) => item.title),
    )
    for (let index = 1; index < first.items.length; index++) {
      const previous = first.items[index - 1]
      const current = first.items[index]
      expect((current?.uploadedAt ?? 0) >= (previous?.uploadedAt ?? 0)).toBe(
        true,
      )
      expect((current?.id ?? 0) > (previous?.id ?? 0)).toBe(true)
    }
  })
})
