import { afterEach, describe, expect, it } from 'vitest'
import type { FolderTree } from '../../../../../shared/library-api'
import { bootstrapQueryOptions } from './bootstrap'
import {
  type BulkProgress,
  bulkAssign,
  bulkBatch,
  bulkDelete,
  bulkRegenerate,
  emptyTrash,
  groupByPreviousFolder,
  runChunked,
} from './bulk'
import { allIds, collectionQueryOptions } from './collection'
import { folderTreeQueryOptions } from './folderTree'
import { knownRev } from './invalidate'
import { libraryKeys } from './keys'
import { DEFAULT_COLLECTION_QUERY } from './params'
import { type DataTestContext, startDataTest } from './test-utils'

let test: DataTestContext

afterEach(() => {
  test?.stop()
})

async function largeIds(count: number): Promise<number[]> {
  test = startDataTest('large', { settings: { largeCount: count } })
  await test.queryClient.fetchQuery(bootstrapQueryOptions(test.queryClient))
  const snapshot = await test.queryClient.fetchQuery(
    collectionQueryOptions(DEFAULT_COLLECTION_QUERY),
  )
  return allIds(snapshot)
}

function requestsTo(path: string): string[] {
  return test.requests.filter((line) => line.includes(`api/library/${path}`))
}

describe('runChunked', () => {
  it('runs chunks in order, reports progress, and stops at the first failure', async () => {
    const seen: number[][] = []
    const progress: BulkProgress[] = []
    const outcome = await runChunked({
      items: [1, 2, 3, 4, 5],
      size: 2,
      onProgress: (step) => progress.push(step),
      run: async (chunk) => {
        seen.push(chunk)
        if (chunk.includes(5)) {
          throw new Error('boom')
        }
        return chunk.map((value) => value * 10)
      },
    })
    expect(seen).toEqual([[1, 2], [3, 4], [5]])
    expect(outcome.results).toEqual([10, 20, 30, 40])
    expect(outcome.done).toBe(4)
    expect(outcome.error).toBeInstanceOf(Error)
    expect(progress.map((step) => step.done)).toEqual([0, 2, 4])
    expect(progress.at(-1)).toMatchObject({ chunk: 2, chunks: 3, total: 5 })
  })

  it('stops between chunks when aborted', async () => {
    const controller = new AbortController()
    const outcome = await runChunked({
      items: [1, 2, 3, 4],
      size: 1,
      signal: controller.signal,
      run: async (chunk) => {
        if (chunk[0] === 2) {
          controller.abort()
        }
        return chunk
      },
    })
    expect(outcome).toMatchObject({ aborted: true, done: 2, results: [1, 2] })
  })
})

describe('bulk operations against the fake', () => {
  it('batch: 100 per request, results in order, rev followed', async () => {
    const ids = (await largeIds(250)).slice(0, 250)
    const outcome = await bulkBatch(test.queryClient, {
      ids,
      set: { caption: 'Bulk caption' },
    })
    expect(requestsTo('items/batch')).toHaveLength(3)
    expect(outcome.results.map((result) => result.id)).toEqual(ids)
    expect(outcome.results.every((result) => result.ok)).toBe(true)
    expect(knownRev(test.queryClient)).toBe(test.mock.library.rev)
    expect(test.mock.library.item(ids[249] ?? 0)?.caption).toBe('Bulk caption')
  })

  it('batch per item (Undo) keeps the each-form', async () => {
    const ids = (await largeIds(150)).slice(0, 150)
    const outcome = await bulkBatch(test.queryClient, {
      items: ids.map((id) => ({ id, set: { title: `t-${id}` } })),
    })
    expect(requestsTo('items/batch')).toHaveLength(2)
    expect(outcome.done).toBe(150)
    expect(test.mock.library.item(ids[120] ?? 0)?.title).toBe(`t-${ids[120]}`)
  })

  it('delete reports per-item failures without failing the run (Author)', async () => {
    test = startDataTest('author')
    const outcome = await bulkDelete(
      test.queryClient,
      [1000, 1090, 999999],
      'delete',
    )
    expect(outcome.error).toBeNull()
    expect(outcome.results).toEqual([
      {
        id: 1000,
        ok: false,
        error: expect.objectContaining({ code: 'wpu_forbidden' }),
      },
      { id: 1090, ok: true, trash: null },
      {
        id: 999999,
        ok: false,
        error: expect.objectContaining({ code: 'wpu_not_found' }),
      },
    ])
  })

  it('assign: 5000 per request, merged previous, fresh counts in the tree', async () => {
    const ids = await largeIds(6000)
    await test.queryClient.fetchQuery(folderTreeQueryOptions())
    const progress: number[] = []
    const outcome = await bulkAssign(test.queryClient, 7, ids, {
      onProgress: (step) => progress.push(step.done),
    })
    expect(requestsTo('folders/assign')).toHaveLength(2)
    expect(progress).toEqual([0, 5000, 6000])
    expect(outcome.previous).toHaveLength(6000)
    expect(outcome.moved).toBe(
      6000 - outcome.previous.filter((entry) => entry.folder === 7).length,
    )
    const tree = test.queryClient.getQueryData<FolderTree>(
      libraryKeys.folders(),
    )
    expect(tree?.folders.find((folder) => folder.id === 7)?.count).toBe(6000)

    // Undo: one assign per previous folder.
    const groups = groupByPreviousFolder(outcome.previous)
    expect([...groups.values()].flat()).toHaveLength(6000)
  })

  it('regenerate: one job per 1000 ids', async () => {
    const ids = await largeIds(2500)
    const outcome = await bulkRegenerate(ids)
    expect(outcome.results).toHaveLength(3)
    expect(new Set(outcome.results).size).toBe(3)
  })

  it('empties the Trash step by step until nothing remains', async () => {
    test = startDataTest('trash')
    // More trash than one step deletes (20).
    const ids = test.mock.library
      .collection({ ...DEFAULT_COLLECTION_QUERY })
      .rows.filter((_, index) => index % 4 === 0)
      .slice(0, 45)
    test.mock.library.deleteItems({ ids, mode: 'trash' })
    const before = test.mock.library.trashSummary().count
    const progress: BulkProgress[] = []
    const outcome = await emptyTrash(test.queryClient, {
      onProgress: (step) => progress.push(step),
    })
    expect(outcome).toMatchObject({
      deleted: before,
      remaining: 0,
      error: null,
    })
    expect(requestsTo('trash/empty').length).toBe(Math.ceil(before / 20))
    expect(progress.at(-1)).toMatchObject({ done: before, total: before })
    expect(test.mock.library.trashSummary().count).toBe(0)
  })
})
