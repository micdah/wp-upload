import { afterEach, describe, expect, it } from 'vitest'
import type {
  LibraryItemFull,
  LibraryItemTile,
} from '../../../../../shared/library-api'
import { mockFetch } from '../../mocks/node'
import { assignItemsToFolder } from './folders'
import { setHttpDeps } from './http'
import { saveBatchMeta, saveItemMeta } from './inspector'
import {
  type ItemChunk,
  itemChunkQueryOptions,
  itemQueryOptions,
} from './items'
import { libraryKeys } from './keys'
import { type DataTestContext, startDataTest } from './test-utils'

// The M3 race (M3-integration.md): an item read the server answered from
// its state *before* one of our writes, but whose response reached the
// client *after* the write's own response, overwrote the saved values in the
// cache ("Title saved", yet the old title and alt text showed again).
//
// Deterministic version over the fake backend: the fetch below lets the
// fake answer a GET at once (so it reads the state of that moment) but holds
// the response until the test releases it, and holds a write until the test
// lets it reach the fake.

let test: DataTestContext
let restoreFetch: (() => void) | null = null

afterEach(() => {
  restoreFetch?.()
  restoreFetch = null
  test?.stop()
})

interface Held {
  /** resolves once a matching request has been seen */
  seen: Promise<void>
  release: () => void
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {}
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

/**
 * Routes requests through the fake, holding:
 * - GET `items?…`: answered by the fake immediately, delivered on release;
 * - PATCH / POST: sent to the fake only on release.
 */
function controlNetwork() {
  const fake = mockFetch()
  const holds: { get: Held[]; write: Held[] } = { get: [], write: [] }
  const waiting: { get: (() => void)[]; write: (() => void)[] } = {
    get: [],
    write: [],
  }
  function hold(kind: 'get' | 'write'): {
    held: Held
    gate: Promise<void>
  } {
    const seen = deferred()
    const gate = deferred()
    const held = { seen: seen.promise, release: gate.resolve }
    holds[kind].push(held)
    seen.resolve()
    waiting[kind].shift()?.()
    return { held, gate: gate.promise }
  }
  restoreFetch = setHttpDeps({
    fetch: async (input, init) => {
      const method = init?.method ?? 'GET'
      const url = String(input)
      if (method === 'GET' && url.includes('library/items?')) {
        const response = await fake(input, init)
        const { gate } = hold('get')
        await gate
        return response
      }
      if (method !== 'GET') {
        const { gate } = hold('write')
        await gate
      }
      return fake(input, init)
    },
  })
  /** The next held request of this kind (waits for it to be sent). */
  async function next(kind: 'get' | 'write', index: number): Promise<Held> {
    while (holds[kind].length <= index) {
      await new Promise<void>((resolve) => waiting[kind].push(resolve))
    }
    const held = holds[kind][index] as Held
    await held.seen
    return held
  }
  return { next }
}

async function flush(): Promise<void> {
  for (let round = 0; round < 10; round++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

const CHUNK = [1000, 1001]

/** Loads 1001 into a chunk, its tile and its full item, before any holds. */
async function loadItem(): Promise<void> {
  await test.queryClient.fetchQuery(
    itemChunkQueryOptions(test.queryClient, 'tile', CHUNK),
  )
  await test.queryClient.fetchQuery(
    itemQueryOptions(test.queryClient, 'full', 1001),
  )
}

function cached() {
  const full = test.queryClient.getQueryData<LibraryItemFull>(
    libraryKeys.item('full', 1001),
  )
  const tile = test.queryClient.getQueryData<LibraryItemTile>(
    libraryKeys.item('tile', 1001),
  )
  const chunk = test.queryClient.getQueryData<ItemChunk>(
    libraryKeys.itemChunk('tile', CHUNK),
  )
  return {
    full: full?.title,
    tile: tile?.title,
    chunked: chunk?.items.find((item) => item.id === 1001)?.title,
  }
}

/** Refetches the chunk and the full item (as an invalidation would). */
function refetchItem(): void {
  void test.queryClient.refetchQueries({
    queryKey: libraryKeys.itemChunk('tile', CHUNK),
  })
  void test.queryClient.refetchQueries({
    queryKey: libraryKeys.item('full', 1001),
  })
}

describe('item reads racing our own writes', () => {
  it('a read answered before a PATCH but delivered after it keeps the saved value', async () => {
    test = startDataTest()
    await loadItem()
    const network = controlNetwork()

    const saving = saveItemMeta(test.queryClient, 1001, { title: 'Saved' })
    const patch = await network.next('write', 0)
    // Started while the PATCH is on its way (after its cancelQueries): the
    // server answers it from the old state.
    refetchItem()
    const chunkRead = await network.next('get', 0)
    const fullRead = await network.next('get', 1)

    patch.release()
    await saving
    expect(cached()).toEqual({ full: 'Saved', tile: 'Saved', chunked: 'Saved' })

    chunkRead.release()
    fullRead.release()
    await flush()
    expect(cached()).toEqual({ full: 'Saved', tile: 'Saved', chunked: 'Saved' })
  })

  it('a read sent after the write settled applies normally', async () => {
    test = startDataTest()
    await loadItem()
    const network = controlNetwork()

    const saving = saveItemMeta(test.queryClient, 1001, { title: 'Saved' })
    ;(await network.next('write', 0)).release()
    await saving
    // Someone else changes it afterwards; a later read must show that.
    test.mock.library.patchItem(1001, { title: 'Changed elsewhere' })
    refetchItem()
    ;(await network.next('get', 0)).release()
    ;(await network.next('get', 1)).release()
    await flush()
    expect(cached()).toEqual({
      full: 'Changed elsewhere',
      tile: 'Changed elsewhere',
      chunked: 'Changed elsewhere',
    })
  })

  it('the batch path (items/batch) keeps its values against an older read', async () => {
    test = startDataTest()
    await loadItem()
    const network = controlNetwork()

    const saving = saveBatchMeta(test.queryClient, [1000, 1001], {
      field: 'title',
      value: 'Batch',
    })
    const batch = await network.next('write', 0)
    refetchItem()
    const chunkRead = await network.next('get', 0)
    const fullRead = await network.next('get', 1)

    batch.release()
    await saving
    chunkRead.release()
    fullRead.release()
    await flush()
    expect(cached()).toEqual({ full: 'Batch', tile: 'Batch', chunked: 'Batch' })
  })

  it('a folder assign keeps the moved folder against an older read', async () => {
    test = startDataTest()
    await loadItem()
    const before = test.mock.library.item(1001)?.folder
    const target = before === 15 ? 3 : 15
    const network = controlNetwork()
    const folderOf = () => ({
      full: test.queryClient.getQueryData<LibraryItemFull>(
        libraryKeys.item('full', 1001),
      )?.folder,
      tile: test.queryClient.getQueryData<LibraryItemTile>(
        libraryKeys.item('tile', 1001),
      )?.folder,
    })

    const moving = assignItemsToFolder(test.queryClient, target, [1001])
    const assign = await network.next('write', 0)
    refetchItem()
    const chunkRead = await network.next('get', 0)
    const fullRead = await network.next('get', 1)

    assign.release()
    await moving
    chunkRead.release()
    fullRead.release()
    await flush()
    expect(test.mock.library.item(1001)?.folder).toBe(target)
    expect(folderOf()).toEqual({ full: target, tile: target })
  })
})
