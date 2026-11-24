import { matchQuery } from '@tanstack/react-query'
import { afterEach, describe, expect, it } from 'vitest'
import type { CollectionQuery } from '../../../../../shared/library-api'
import { bootstrapQueryOptions } from './bootstrap'
import { collectionQueryOptions } from './collection'
import { connectivityStore } from './connectivity'
import { facetsQueryOptions } from './facets'
import { folderTreeQueryOptions } from './folderTree'
import {
  applyPolledRev,
  applyRev,
  filtersFor,
  knownRev,
  type LibraryChange,
  revSequence,
} from './invalidate'
import { itemChunkQueryOptions, itemQueryOptions } from './items'
import { libraryKeys, registerRevDependent } from './keys'
import { DEFAULT_COLLECTION_QUERY, normaliseCollectionQuery } from './params'
import { revQueryOptions } from './rev'
import { type DataTestContext, startDataTest } from './test-utils'

let test: DataTestContext

afterEach(() => {
  test?.stop()
})

const missingAlt = normaliseCollectionQuery({ alt: 'missing' })
const byTitle = normaliseCollectionQuery({ sort: 'title-asc' })
const folder6 = normaliseCollectionQuery({ folder: '6' })
const trash = normaliseCollectionQuery({ folder: 'trash' })

function invalidated(key: readonly unknown[]): boolean | undefined {
  return test.queryClient.getQueryState(key)?.isInvalidated
}

/**
 * Whether the map refetches this cached query for `change`. (Own mutations
 * also mark every rev-dependent query stale, so `isInvalidated` can't tell
 * the map's choice apart.)
 */
function mapped(change: LibraryChange, key: readonly unknown[]): boolean {
  const query = test.queryClient
    .getQueryCache()
    .find({ queryKey: key, exact: true })
  if (!query) {
    throw new Error(`not cached: ${JSON.stringify(key)}`)
  }
  return filtersFor(change).some((filters) => matchQuery(filters, query))
}

async function primeCollections(queries: CollectionQuery[]): Promise<void> {
  for (const query of queries) {
    await test.queryClient.fetchQuery(collectionQueryOptions(query))
    await test.queryClient.fetchQuery(facetsQueryOptions(query))
  }
}

describe('applyRev', () => {
  it('takes the first rev as the baseline, ignores the same rev, invalidates on a new one', async () => {
    test = startDataTest()
    await primeCollections([DEFAULT_COLLECTION_QUERY])
    expect(applyRev(test.queryClient, '100').changed).toBe(false)
    expect(knownRev(test.queryClient)).toBe('100')
    expect(applyRev(test.queryClient, '100').changed).toBe(false)
    expect(invalidated(libraryKeys.collection(DEFAULT_COLLECTION_QUERY))).toBe(
      false,
    )
    const { changed, settled } = applyRev(test.queryClient, '101')
    await settled
    expect(changed).toBe(true)
    expect(invalidated(libraryKeys.facets(DEFAULT_COLLECTION_QUERY))).toBe(true)
  })

  it('bootstrap sets the baseline rev', async () => {
    test = startDataTest()
    await test.queryClient.fetchQuery(bootstrapQueryOptions(test.queryClient))
    expect(knownRev(test.queryClient)).toBe(test.mock.library.rev)
  })
})

describe('the invalidation map', () => {
  it('external: every rev-dependent query, not bootstrap or posts', async () => {
    test = startDataTest()
    await test.queryClient.fetchQuery(bootstrapQueryOptions(test.queryClient))
    await primeCollections([DEFAULT_COLLECTION_QUERY, folder6])
    await test.queryClient.fetchQuery(folderTreeQueryOptions())
    await test.queryClient.fetchQuery(
      itemQueryOptions(test.queryClient, 'full', 1000),
    )
    test.queryClient.setQueryData(libraryKeys.posts('', 10), { posts: [] })
    registerRevDependent('feature-thing')
    test.queryClient.setQueryData(['library', 'feature-thing'], 1)

    await applyRev(test.queryClient, 'external-2').settled

    expect(invalidated(libraryKeys.collection(folder6))).toBe(true)
    expect(invalidated(libraryKeys.folders())).toBe(true)
    expect(invalidated(libraryKeys.item('full', 1000))).toBe(true)
    expect(invalidated(libraryKeys.item('tile', 1000))).toBe(true)
    expect(invalidated(['library', 'feature-thing'])).toBe(true)
    expect(invalidated(libraryKeys.bootstrap())).toBe(false)
    expect(invalidated(libraryKeys.posts('', 10))).toBe(false)
  })

  it('item-meta (alt): the missing-alt view and all facets, not a plain view', async () => {
    test = startDataTest()
    await test.queryClient.fetchQuery(bootstrapQueryOptions(test.queryClient))
    await primeCollections([DEFAULT_COLLECTION_QUERY, missingAlt, byTitle])
    const change1: LibraryChange = {
      kind: 'item-meta',
      ids: [1000],
      fields: ['alt'],
    }
    await applyRev(test.queryClient, 'meta-2', change1).settled
    expect(mapped(change1, libraryKeys.collection(missingAlt))).toBe(true)
    expect(
      mapped(change1, libraryKeys.collection(DEFAULT_COLLECTION_QUERY)),
    ).toBe(false)
    expect(mapped(change1, libraryKeys.collection(byTitle))).toBe(false)
    expect(mapped(change1, libraryKeys.facets(DEFAULT_COLLECTION_QUERY))).toBe(
      true,
    )
  })

  it('item-meta (title): the title sort, and full items only when `post` changed', async () => {
    test = startDataTest()
    await test.queryClient.fetchQuery(bootstrapQueryOptions(test.queryClient))
    await primeCollections([DEFAULT_COLLECTION_QUERY, byTitle])
    await test.queryClient.fetchQuery(
      itemQueryOptions(test.queryClient, 'full', 1000),
    )
    const change2: LibraryChange = {
      kind: 'item-meta',
      ids: [1000],
      fields: ['title'],
    }
    await applyRev(test.queryClient, 'title-2', change2).settled
    expect(mapped(change2, libraryKeys.collection(byTitle))).toBe(true)
    expect(
      mapped(change2, libraryKeys.collection(DEFAULT_COLLECTION_QUERY)),
    ).toBe(false)
    expect(mapped(change2, libraryKeys.item('full', 1000))).toBe(false)
    const change3: LibraryChange = {
      kind: 'item-meta',
      ids: [1000],
      fields: ['post'],
    }
    await applyRev(test.queryClient, 'post-3', change3).settled
    expect(mapped(change3, libraryKeys.item('full', 1000))).toBe(true)
  })

  it('folder-assign: folder views, the tree and the moved items; not All files', async () => {
    test = startDataTest()
    await test.queryClient.fetchQuery(bootstrapQueryOptions(test.queryClient))
    await primeCollections([DEFAULT_COLLECTION_QUERY, folder6])
    await test.queryClient.fetchQuery(folderTreeQueryOptions())
    await test.queryClient.fetchQuery(
      itemChunkQueryOptions(test.queryClient, 'tile', [1000, 1001]),
    )
    const change4: LibraryChange = {
      kind: 'folder-assign',
      ids: [1001],
      folder: 6,
    }
    await applyRev(test.queryClient, 'assign-2', change4).settled
    expect(mapped(change4, libraryKeys.collection(folder6))).toBe(true)
    expect(
      mapped(change4, libraryKeys.collection(DEFAULT_COLLECTION_QUERY)),
    ).toBe(false)
    expect(mapped(change4, libraryKeys.folders())).toBe(true)
    expect(mapped(change4, libraryKeys.itemChunk('tile', [1000, 1001]))).toBe(
      true,
    )
    expect(mapped(change4, libraryKeys.item('tile', 1000))).toBe(false)
    expect(mapped(change4, libraryKeys.item('tile', 1001))).toBe(true)
  })

  it('empty-trash: only the Trash', async () => {
    test = startDataTest('trash')
    await test.queryClient.fetchQuery(bootstrapQueryOptions(test.queryClient))
    await primeCollections([DEFAULT_COLLECTION_QUERY, trash])
    const change5: LibraryChange = { kind: 'empty-trash' }
    await applyRev(test.queryClient, 'empty-2', change5).settled
    expect(mapped(change5, libraryKeys.collection(trash))).toBe(true)
    expect(
      mapped(change5, libraryKeys.collection(DEFAULT_COLLECTION_QUERY)),
    ).toBe(false)
  })

  it('folder-delete: items whose cached folder was deleted', async () => {
    test = startDataTest()
    await test.queryClient.fetchQuery(bootstrapQueryOptions(test.queryClient))
    // 1000 is in folder 5, 1001 elsewhere.
    await test.queryClient.fetchQuery(
      itemQueryOptions(test.queryClient, 'tile', 1000),
    )
    await test.queryClient.fetchQuery(
      itemQueryOptions(test.queryClient, 'tile', 1003),
    )
    const other = test.mock.library.item(1003)?.folder
    expect(other).not.toBe(5)
    const change6: LibraryChange = {
      kind: 'folder-delete',
      folderIds: [5],
    }
    await applyRev(test.queryClient, 'delete-2', change6).settled
    expect(mapped(change6, libraryKeys.item('tile', 1000))).toBe(true)
    expect(mapped(change6, libraryKeys.item('tile', 1003))).toBe(false)
  })
})

describe('rev polling', () => {
  it('a rev changed elsewhere invalidates; our own mutation’s rev does not', async () => {
    connectivityStore.reset()
    test = startDataTest()
    await test.queryClient.fetchQuery(bootstrapQueryOptions(test.queryClient))
    await primeCollections([DEFAULT_COLLECTION_QUERY])
    const poll = revQueryOptions(test.queryClient)

    // Nothing changed: the poll is a no-op.
    await test.queryClient.fetchQuery({ ...poll, staleTime: 0 })
    expect(invalidated(libraryKeys.collection(DEFAULT_COLLECTION_QUERY))).toBe(
      false,
    )

    // Someone edits in wp-admin.
    test.mock.library.externalEdit(1000, { title: 'Edited in wp-admin' })
    await test.queryClient.fetchQuery({ ...poll, staleTime: 0 })
    expect(invalidated(libraryKeys.collection(DEFAULT_COLLECTION_QUERY))).toBe(
      true,
    )
    await test.queryClient.refetchQueries()
    expect(invalidated(libraryKeys.collection(DEFAULT_COLLECTION_QUERY))).toBe(
      false,
    )

    // Our own mutation sets the rev first; the next poll sees no change.
    const patched = test.mock.library.patchItem(1001, { alt: 'Mine' })
    applyRev(test.queryClient, patched.rev, {
      kind: 'item-meta',
      ids: [1001],
      fields: ['alt'],
    })
    const sequence = revSequence(test.queryClient)
    await test.queryClient.fetchQuery({ ...poll, staleTime: 0 })
    expect(revSequence(test.queryClient)).toBe(sequence)
    expect(knownRev(test.queryClient)).toBe(patched.rev)
  })

  it('a change elsewhere hidden behind our own mutation’s rev is fetched on next use (C-3)', async () => {
    connectivityStore.reset()
    test = startDataTest()
    await test.queryClient.fetchQuery(bootstrapQueryOptions(test.queryClient))
    await primeCollections([DEFAULT_COLLECTION_QUERY])
    const full1000 = itemQueryOptions(test.queryClient, 'full', 1000)
    await test.queryClient.fetchQuery(full1000)

    // Someone edits 1000 in wp-admin, then our own edit of 1001 lands before
    // the next poll: our rev already includes their change.
    test.mock.library.externalEdit(1000, { title: 'Edited in wp-admin' })
    const patched = test.mock.library.patchItem(1001, { alt: 'Mine' })
    const change: LibraryChange = {
      kind: 'item-meta',
      ids: [1001],
      fields: ['alt'],
    }
    await applyRev(test.queryClient, patched.rev, change).settled
    await test.queryClient.fetchQuery({
      ...revQueryOptions(test.queryClient),
      staleTime: 0,
    })

    // The map doesn't touch 1000 or the plain view, but both are stale now…
    expect(mapped(change, libraryKeys.item('full', 1000))).toBe(false)
    expect(invalidated(libraryKeys.item('full', 1000))).toBe(true)
    expect(invalidated(libraryKeys.collection(DEFAULT_COLLECTION_QUERY))).toBe(
      true,
    )
    expect(invalidated(libraryKeys.bootstrap())).toBe(false)
    // …so their next use fetches the other user's change.
    const item = await test.queryClient.fetchQuery(full1000)
    expect(item?.title).toBe('Edited in wp-admin')
  })

  it('ignores a poll answer overtaken by a newer rev (C-14)', async () => {
    test = startDataTest()
    applyRev(test.queryClient, 'rev-1')
    await primeCollections([DEFAULT_COLLECTION_QUERY])

    // A poll is sent at rev-1; our own mutation lands before it answers.
    const sentAt = revSequence(test.queryClient)
    applyRev(test.queryClient, 'rev-2', { kind: 'folder-tree' })
    await test.queryClient.refetchQueries()
    const late = applyPolledRev(test.queryClient, 'rev-1', sentAt)
    expect(late.changed).toBe(false)
    expect(knownRev(test.queryClient)).toBe('rev-2')
    expect(invalidated(libraryKeys.collection(DEFAULT_COLLECTION_QUERY))).toBe(
      false,
    )

    // A poll sent after it applies as usual.
    const fresh = applyPolledRev(
      test.queryClient,
      'rev-3',
      revSequence(test.queryClient),
    )
    expect(fresh.changed).toBe(true)
    expect(knownRev(test.queryClient)).toBe('rev-3')
  })
})
