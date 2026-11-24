import { QueryObserver } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  CollectionQuery,
  FolderTree,
  LibraryItemFull,
  LibraryItemTile,
} from '../../../../../shared/library-api'
import { libraryApi } from './api'
import {
  allIds,
  type CollectionSnapshot,
  collectionQueryOptions,
  positionOf,
} from './collection'
import { folderTreeQueryOptions } from './folderTree'
import { applyRev, knownRev } from './invalidate'
import {
  type ItemChunk,
  itemChunkQueryOptions,
  itemQueryOptions,
} from './items'
import { libraryKeys } from './keys'
import {
  optimistic,
  optimisticMove,
  optimisticRemove,
  optimisticRestore,
  optimisticTargets,
  patchItems,
} from './optimistic'
import { DEFAULT_COLLECTION_QUERY, normaliseCollectionQuery } from './params'
import { applyItemSnapshots } from './results'
import { type DataTestContext, startDataTest } from './test-utils'

let test: DataTestContext

afterEach(() => {
  test?.stop()
})

const folder6 = normaliseCollectionQuery({ folder: '6' })
const folder12 = normaliseCollectionQuery({ folder: '12' })
const trash = normaliseCollectionQuery({ folder: 'trash' })

async function load(query: CollectionQuery): Promise<CollectionSnapshot> {
  return test.queryClient.fetchQuery(collectionQueryOptions(query))
}

function cachedCollection(query: CollectionQuery): CollectionSnapshot {
  const snapshot = test.queryClient.getQueryData<CollectionSnapshot>(
    libraryKeys.collection(query),
  )
  if (!snapshot) {
    throw new Error('collection not cached')
  }
  return snapshot
}

function cachedTree(): FolderTree {
  const tree = test.queryClient.getQueryData<FolderTree>(libraryKeys.folders())
  if (!tree) {
    throw new Error('tree not cached')
  }
  return tree
}

function folderCount(id: number): number {
  return cachedTree().folders.find((folder) => folder.id === id)?.count ?? -1
}

describe('optimistic rollback', () => {
  it('patches every cached copy and restores them all when the mutation fails', async () => {
    test = startDataTest('author')
    // 1000 belongs to Site Admin: an Author may not edit it (403).
    await test.queryClient.fetchQuery(
      itemChunkQueryOptions(test.queryClient, 'tile', [1000, 1001]),
    )
    await test.queryClient.fetchQuery(
      itemQueryOptions(test.queryClient, 'full', 1000),
    )
    const original = test.queryClient.getQueryData<LibraryItemFull>(
      libraryKeys.item('full', 1000),
    )

    const error = await optimistic(test.queryClient, {
      cancel: optimisticTargets.items([1000]),
      apply: () =>
        patchItems(test.queryClient, [1000], {
          alt: 'New alt',
          caption: 'New caption',
        }),
      run: () =>
        libraryApi.patchItem(1000, { alt: 'New alt', caption: 'New caption' }),
    }).catch((caught: unknown) => caught)

    expect(error).toMatchObject({ status: 403, code: 'forbidden' })
    expect(
      test.queryClient.getQueryData(libraryKeys.item('full', 1000)),
    ).toEqual(original)
    const chunk = test.queryClient.getQueryData<ItemChunk>(
      libraryKeys.itemChunk('tile', [1000, 1001]),
    )
    expect(chunk?.items[0]?.alt).toBe(original?.alt)
  })

  it('after a rollback, refetches what it touched so the server wins over a stale snapshot (C-4)', async () => {
    test = startDataTest()
    const options = itemQueryOptions(test.queryClient, 'full', 1000)
    // A mounted view of the item, so the invalidation refetches it.
    const observer = new QueryObserver(test.queryClient, options)
    const unsubscribe = observer.subscribe(() => {})
    try {
      await vi.waitFor(() =>
        expect(observer.getCurrentResult().status).toBe('success'),
      )
      const mutation: { fail?: (error: Error) => void } = {}
      const pending = optimistic(test.queryClient, {
        cancel: optimisticTargets.items([1000]),
        apply: () => patchItems(test.queryClient, [1000], { alt: 'Mine' }),
        run: () =>
          new Promise<never>((_resolve, reject) => {
            mutation.fail = reject
          }),
      }).catch((caught: unknown) => caught)

      // The optimistic state is applied and the mutation is in flight.
      await vi.waitFor(() => expect(mutation.fail).toBeDefined())
      // Meanwhile another change reaches the server and the cache.
      test.mock.library.externalEdit(1000, { title: 'Edited elsewhere' })
      test.queryClient.setQueryData<LibraryItemFull | null>(
        libraryKeys.item('full', 1000),
        (item) => (item ? { ...item, title: 'Edited elsewhere' } : item),
      )

      mutation.fail?.(new Error('refused'))
      await pending
      // The snapshot (old title) came back, but the refetch restores the
      // server's state.
      await vi.waitFor(() =>
        expect(observer.getCurrentResult().data?.title).toBe(
          'Edited elsewhere',
        ),
      )
      expect(observer.getCurrentResult().data?.alt).not.toBe('Mine')
    } finally {
      unsubscribe()
    }
  })

  it('shows the change before the server answers, then the server’s snapshot', async () => {
    test = startDataTest()
    await test.queryClient.fetchQuery(
      itemChunkQueryOptions(test.queryClient, 'tile', [1000]),
    )
    await test.queryClient.fetchQuery(
      itemQueryOptions(test.queryClient, 'full', 1000),
    )
    let seenDuringRequest: string | undefined
    const response = await optimistic(test.queryClient, {
      cancel: optimisticTargets.items([1000]),
      apply: () =>
        patchItems(test.queryClient, [1000], { title: 'Optimistic title' }),
      run: async () => {
        seenDuringRequest = test.queryClient.getQueryData<LibraryItemTile>(
          libraryKeys.item('tile', 1000),
        )?.title
        return libraryApi.patchItem(1000, { title: 'Server title' })
      },
    })
    expect(seenDuringRequest).toBe('Optimistic title')
    applyItemSnapshots(test.queryClient, [response])
    expect(
      test.queryClient.getQueryData<LibraryItemFull>(
        libraryKeys.item('full', 1000),
      ),
    ).toMatchObject({
      title: 'Server title',
      modifiedAt: response.item.modifiedAt,
    })
    expect(
      test.queryClient.getQueryData<ItemChunk>(
        libraryKeys.itemChunk('tile', [1000]),
      )?.items[0]?.title,
    ).toBe('Server title')
  })

  it('applies full-only fields to full items only', async () => {
    test = startDataTest()
    await test.queryClient.fetchQuery(
      itemQueryOptions(test.queryClient, 'full', 1000),
    )
    patchItems(test.queryClient, [1000], { caption: 'Only on full' })
    expect(
      test.queryClient.getQueryData<LibraryItemFull>(
        libraryKeys.item('full', 1000),
      )?.caption,
    ).toBe('Only on full')
    expect(
      test.queryClient.getQueryData(libraryKeys.item('tile', 1000)),
    ).not.toHaveProperty('caption')
  })
})

describe('membership removal', () => {
  it('moving items removes them from other folders’ collections, not from All files', async () => {
    test = startDataTest()
    const all = await load(DEFAULT_COLLECTION_QUERY)
    const inSix = await load(folder6)
    const inTwelve = await load(folder12)
    await test.queryClient.fetchQuery(folderTreeQueryOptions())
    const moving = allIds(inSix).slice(0, 2)
    await test.queryClient.fetchQuery(
      itemChunkQueryOptions(test.queryClient, 'tile', moving),
    )
    const countSix = folderCount(6)
    const countTwelve = folderCount(12)

    const rollback = optimisticMove(test.queryClient, moving, 12)

    expect(cachedCollection(folder6).total).toBe(inSix.total - 2)
    for (const id of moving) {
      expect(positionOf(cachedCollection(folder6), id)).toBe(-1)
      expect(
        positionOf(cachedCollection(DEFAULT_COLLECTION_QUERY), id),
      ).not.toBe(-1)
    }
    // The target folder gains them only on refetch (their position is the server's).
    expect(cachedCollection(folder12).total).toBe(inTwelve.total)
    expect(cachedCollection(DEFAULT_COLLECTION_QUERY).total).toBe(all.total)
    expect(folderCount(6)).toBe(countSix - 2)
    expect(folderCount(12)).toBe(countTwelve + 2)
    expect(
      test.queryClient.getQueryData<LibraryItemTile>(
        libraryKeys.item('tile', moving[0] ?? 0),
      )?.folder,
    ).toBe(12)

    rollback()
    expect(cachedCollection(folder6).total).toBe(inSix.total)
    expect(folderCount(6)).toBe(countSix)
    expect(
      test.queryClient.getQueryData<LibraryItemTile>(
        libraryKeys.item('tile', moving[0] ?? 0),
      )?.folder,
    ).toBe(6)
  })

  it('trashing removes items from every view but the Trash; restoring leaves the Trash', async () => {
    test = startDataTest('trash')
    const all = await load(DEFAULT_COLLECTION_QUERY)
    const inTrash = await load(trash)
    await test.queryClient.fetchQuery(folderTreeQueryOptions())
    const [victim = 0] = allIds(all)
    optimisticRemove(test.queryClient, [victim])
    expect(cachedCollection(DEFAULT_COLLECTION_QUERY).total).toBe(all.total - 1)
    expect(cachedCollection(trash).total).toBe(inTrash.total)
    expect(cachedTree().counts.all).toBe(all.total - 1)

    const [trashed = 0] = allIds(inTrash)
    optimisticRestore(test.queryClient, [trashed])
    expect(positionOf(cachedCollection(trash), trashed)).toBe(-1)
  })

  it('deleting from the Trash only leaves the Trash', async () => {
    test = startDataTest('trash')
    const all = await load(DEFAULT_COLLECTION_QUERY)
    const inTrash = await load(trash)
    const [trashed = 0] = allIds(inTrash)
    optimisticRemove(test.queryClient, [trashed], { fromTrash: true })
    expect(cachedCollection(trash).total).toBe(inTrash.total - 1)
    expect(cachedCollection(DEFAULT_COLLECTION_QUERY).total).toBe(all.total)
  })

  it('a late collection refetch can’t overwrite the optimistic state', async () => {
    // Reads take 30 ms, so the refetch below is still in flight.
    test = startDataTest('normal', {
      settings: { latency: { read: 30, write: 0 } },
    })
    await load(folder6)
    const moving = allIds(cachedCollection(folder6)).slice(0, 1)
    // A refetch is in flight when the move starts…
    const refetch = test.queryClient.refetchQueries({
      queryKey: libraryKeys.collection(folder6),
    })
    const response = await optimistic(test.queryClient, {
      cancel: [optimisticTargets.collections(() => true)],
      apply: () => optimisticMove(test.queryClient, moving, 12),
      run: () => libraryApi.assignFolder({ folder: 12, ids: moving }),
    })
    await refetch
    expect(
      test.queryClient.getQueryState(libraryKeys.collection(folder6))
        ?.fetchStatus,
    ).toBe('idle')
    // …and was cancelled, so the moved item stays out.
    expect(positionOf(cachedCollection(folder6), moving[0] ?? 0)).toBe(-1)
    expect(response.moved).toBe(1)
    applyRev(test.queryClient, response.rev, {
      kind: 'folder-assign',
      ids: moving,
      folder: 12,
    })
    expect(knownRev(test.queryClient)).toBe(response.rev)
  })
})
