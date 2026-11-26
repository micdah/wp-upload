import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  LibraryItemFull,
  LibraryItemTile,
} from '../../../../../shared/library-api'
import { collectionQueryOptions } from './collection'
import { saveItemMeta } from './inspector'
import { knownRev } from './invalidate'
import {
  type ItemChunk,
  itemChunkQueryOptions,
  itemQueryOptions,
} from './items'
import { libraryKeys } from './keys'
import { normaliseCollectionQuery } from './params'
import { type DataTestContext, startDataTest } from './test-utils'

let test: DataTestContext

afterEach(() => {
  test?.stop()
})

/** Loads 1001 into every kind of cache entry: a chunk, a tile, a full item. */
async function loadItem(id = 1001): Promise<void> {
  await test.queryClient.fetchQuery(collectionQueryOptions(allFiles))
  await test.queryClient.fetchQuery(
    itemChunkQueryOptions(test.queryClient, 'tile', [1000, id]),
  )
  await test.queryClient.fetchQuery(
    itemQueryOptions(test.queryClient, 'full', id),
  )
}

const allFiles = normaliseCollectionQuery({})

function cached(id = 1001) {
  const full = test.queryClient.getQueryData<LibraryItemFull>(
    libraryKeys.item('full', id),
  )
  const tile = test.queryClient.getQueryData<LibraryItemTile>(
    libraryKeys.item('tile', id),
  )
  const chunk = test.queryClient.getQueryData<ItemChunk>(
    libraryKeys.itemChunk('tile', [1000, id]),
  )
  return { full, tile, chunked: chunk?.items.find((item) => item.id === id) }
}

describe('saveItemMeta', () => {
  it('patches the item on the server and every cached copy, and records the new rev', async () => {
    test = startDataTest()
    await loadItem()
    const revBefore = knownRev(test.queryClient)

    const response = await saveItemMeta(test.queryClient, 1001, {
      alt: 'A close-up of a leaf',
    })

    expect(response.item.alt).toBe('A close-up of a leaf')
    expect(response.previous).toEqual({ alt: '' })
    const { full, tile, chunked } = cached()
    expect(full?.alt).toBe('A close-up of a leaf')
    expect(full?.modifiedAt).toBe(response.item.modifiedAt)
    expect(tile?.alt).toBe('A close-up of a leaf')
    expect(chunked?.alt).toBe('A close-up of a leaf')
    expect(knownRev(test.queryClient)).toBe(response.rev)
    expect(response.rev).not.toBe(revBefore)
    expect(test.mock.library.item(1001)?.alt).toBe('A close-up of a leaf')
    expect(test.requests).toContain('PATCH api/library/items/1001')
  })

  it('shows the value in the cache while the request runs', async () => {
    // Writes take 200 ms, so the optimistic state is visible before the answer.
    test = startDataTest('normal', {
      settings: { latency: { read: 0, write: 200 } },
    })
    await loadItem()
    let settled = false
    const pending = saveItemMeta(test.queryClient, 1001, {
      title: 'Leaf',
    }).finally(() => {
      settled = true
    })
    await vi.waitFor(() => expect(cached().full?.title).toBe('Leaf'))
    expect(cached().chunked?.title).toBe('Leaf')
    expect(settled).toBe(false)
    await pending
  })

  it('rolls the cache back to what it held and rethrows when the PATCH fails', async () => {
    test = startDataTest()
    await loadItem()
    const before = cached()
    test.mock.network = 'offline'

    const error = await saveItemMeta(test.queryClient, 1001, {
      title: 'Never saved',
      alt: 'Never saved either',
    }).catch((caught: unknown) => caught)

    expect(error).toMatchObject({ status: 502, code: 'wp_unreachable' })
    const after = cached()
    expect(after.full).toEqual(before.full)
    expect(after.tile).toEqual(before.tile)
    expect(after.chunked).toEqual(before.chunked)
    test.mock.network = 'online'
    expect(test.mock.library.item(1001)?.title).toBe(before.full?.title)
  })

  it('refuses an empty patch without a request', async () => {
    test = startDataTest()
    await expect(saveItemMeta(test.queryClient, 1001, {})).rejects.toThrow(
      /at least one field/,
    )
    expect(test.requests).toEqual([])
  })
})
