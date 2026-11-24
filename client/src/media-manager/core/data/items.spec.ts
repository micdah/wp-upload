import { afterEach, describe, expect, it } from 'vitest'
import type {
  LibraryItemFull,
  LibraryItemTile,
} from '../../../../../shared/library-api'
import {
  allIds,
  type CollectionSnapshot,
  collectionQueryOptions,
  idsInRange,
  positionOf,
  rowKind,
  withoutIds,
} from './collection'
import {
  alignedChunks,
  chunkIds,
  itemChunkQueryOptions,
  itemQueryOptions,
  seedItems,
} from './items'
import { libraryKeys } from './keys'
import { DEFAULT_COLLECTION_QUERY } from './params'
import { type DataTestContext, startDataTest } from './test-utils'

let test: DataTestContext

afterEach(() => {
  test?.stop()
})

async function loadCollection(): Promise<CollectionSnapshot> {
  return test.queryClient.fetchQuery(
    collectionQueryOptions(DEFAULT_COLLECTION_QUERY),
  )
}

describe('collection snapshot', () => {
  it('keeps rows as a Uint32Array with accessors and positions', async () => {
    test = startDataTest()
    const snapshot = await loadCollection()
    expect(snapshot.rows).toBeInstanceOf(Uint32Array)
    expect(snapshot.rows.length).toBe(snapshot.total * 4)
    const ids = allIds(snapshot)
    expect(positionOf(snapshot, ids[10] ?? 0)).toBe(10)
    expect(positionOf(snapshot, 123456789)).toBe(-1)
    expect(idsInRange(snapshot, -5, 3)).toEqual(ids.slice(0, 3))
    const svg = ids.indexOf(1091)
    expect(rowKind(snapshot, svg)).toBe('svg')
  })

  it('removes ids without touching the original', async () => {
    test = startDataTest()
    const snapshot = await loadCollection()
    const [first, second] = allIds(snapshot)
    const smaller = withoutIds(snapshot, new Set([first ?? 0, second ?? 0]))
    expect(smaller.total).toBe(snapshot.total - 2)
    expect(allIds(smaller)).toEqual(allIds(snapshot).slice(2))
    expect(withoutIds(snapshot, new Set([999999]))).toBe(snapshot)
  })
})

describe('chunks', () => {
  it('splits ids into request-sized chunks', () => {
    const ids = Array.from({ length: 250 }, (_, index) => index + 1)
    expect(chunkIds(ids).map((chunk) => chunk.length)).toEqual([100, 100, 50])
  })

  it('aligns chunks to the collection so the same rows make the same keys', () => {
    test = startDataTest('large', { settings: { largeCount: 1000 } })
    return loadCollection().then((snapshot) => {
      const around = alignedChunks(snapshot, 150, 260)
      expect(around).toHaveLength(2)
      expect(around[0]).toEqual(idsInRange(snapshot, 100, 200))
      expect(around[1]).toEqual(idsInRange(snapshot, 200, 300))
      expect(alignedChunks(snapshot, 120, 180)).toEqual([around[0]])
      expect(alignedChunks(snapshot, 990, 2000)).toEqual([
        idsInRange(snapshot, 900, 1000),
      ])
      expect(alignedChunks(snapshot, 50, 50)).toEqual([])
    })
  })
})

describe('chunk seeding', () => {
  it('seeds the per-id cache from one chunk request', async () => {
    test = startDataTest()
    const snapshot = await loadCollection()
    const [ids = []] = alignedChunks(snapshot, 0, 10)
    const chunk = await test.queryClient.fetchQuery(
      itemChunkQueryOptions(test.queryClient, 'tile', ids),
    )
    expect(chunk.items.map((item) => item.id)).toEqual(ids)
    for (const id of ids) {
      const item = test.queryClient.getQueryData<LibraryItemTile>(
        libraryKeys.item('tile', id),
      )
      expect(item?.id).toBe(id)
    }
    // useItem() for a hydrated tile is served from cache: no request.
    const before = test.requests.length
    const item = await test.queryClient.fetchQuery(
      itemQueryOptions(test.queryClient, 'tile', ids[3] ?? 0),
    )
    expect(item?.id).toBe(ids[3])
    expect(test.requests.length).toBe(before)
  })

  it('seeds the tile cache from full items', async () => {
    test = startDataTest()
    const full = await test.queryClient.fetchQuery(
      itemQueryOptions(test.queryClient, 'full', 1009),
    )
    expect(full?.view).toBe('full')
    const tile = test.queryClient.getQueryData<LibraryItemTile>(
      libraryKeys.item('tile', 1009),
    )
    expect(tile).toMatchObject({ id: 1009, view: 'tile', title: full?.title })
    expect(tile).not.toHaveProperty('caption')
  })

  it('builds a re-sorted chunk from cached items without a request', async () => {
    test = startDataTest()
    const snapshot = await loadCollection()
    const ids = idsInRange(snapshot, 0, 20)
    await test.queryClient.fetchQuery(
      itemChunkQueryOptions(test.queryClient, 'tile', ids),
    )
    const before = test.requests.length
    const reversed = [...ids].reverse()
    const chunk = await test.queryClient.fetchQuery(
      itemChunkQueryOptions(test.queryClient, 'tile', reversed),
    )
    expect(chunk.items.map((item) => item.id)).toEqual(reversed)
    expect(test.requests.length).toBe(before)
  })

  it('refetches a chunk when one of its items was invalidated', async () => {
    test = startDataTest()
    const ids = [1000, 1001, 1002]
    await test.queryClient.fetchQuery(
      itemChunkQueryOptions(test.queryClient, 'tile', ids),
    )
    await test.queryClient.invalidateQueries({
      queryKey: libraryKeys.item('tile', 1001),
    })
    const before = test.requests.length
    await test.queryClient.fetchQuery(
      itemChunkQueryOptions(test.queryClient, 'tile', [1002, 1001, 1000]),
    )
    expect(test.requests.length).toBe(before + 1)
  })

  it('records missing ids and drops them from cached collections', async () => {
    test = startDataTest()
    const snapshot = await loadCollection()
    const [first = 0, second = 0] = allIds(snapshot)
    // Deleted behind the client's back.
    test.mock.library.deleteItems({ ids: [second], mode: 'delete' })
    const chunk = await test.queryClient.fetchQuery(
      itemChunkQueryOptions(test.queryClient, 'tile', [first, second]),
    )
    expect(chunk.missing).toEqual([second])
    expect(
      test.queryClient.getQueryData(libraryKeys.item('tile', second)),
    ).toBeNull()
    const cached = test.queryClient.getQueryData<CollectionSnapshot>(
      libraryKeys.collection(DEFAULT_COLLECTION_QUERY),
    )
    expect(cached && positionOf(cached, second)).toBe(-1)
    expect(cached?.total).toBe(snapshot.total - 1)
  })

  it('seedItems writes both views for full items only', () => {
    test = startDataTest()
    const tile = { id: 5, view: 'tile' } as LibraryItemTile
    const full = { id: 6, view: 'full', title: 'x' } as LibraryItemFull
    seedItems(test.queryClient, 'tile', [tile])
    seedItems(test.queryClient, 'full', [full])
    expect(test.queryClient.getQueryData(libraryKeys.item('full', 5))).toBe(
      undefined,
    )
    expect(
      test.queryClient.getQueryData(libraryKeys.item('tile', 6)),
    ).toMatchObject({ id: 6, view: 'tile' })
  })
})
