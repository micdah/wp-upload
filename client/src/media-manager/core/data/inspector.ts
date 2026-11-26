// The inspector's mutation: saving one item's metadata (inspector.md §3).
//
// Optimistic: the value reaches every cached copy of the item at once (tile,
// full, every chunk), so the grid and the panel show it while the request
// runs. A failed PATCH puts the cached values back and rethrows; the caller
// keeps the typed text for Retry. On success the response's snapshot and rev
// go into the cache, and `applyRev` refetches only what the change can
// affect (title sort, search, the missing-alt filter and facets).

import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import type {
  ItemPatch,
  ItemPatchResponse,
} from '../../../../../shared/library-api'
import { libraryApi } from './api'
import { applyRev } from './invalidate'
import { optimistic, optimisticTargets, patchItems } from './optimistic'
import { applyItemSnapshots } from './results'

/** The text fields the inspector edits on one item. */
export type ItemMetaField = 'title' | 'alt' | 'caption' | 'description'

/** At least one of the text fields; `post` (attach) is the usage feature's. */
export type ItemMetaPatch = Partial<Record<ItemMetaField, string>>

/**
 * PATCHes one item's text fields with an optimistic cache update. Resolves
 * with the response once the cache holds the server's snapshot; rejects
 * with the `LibraryError` after rolling the cache back.
 */
export async function saveItemMeta(
  queryClient: QueryClient,
  id: number,
  patch: ItemMetaPatch,
): Promise<ItemPatchResponse> {
  const fields = Object.keys(patch) as (keyof ItemPatch)[]
  if (fields.length === 0) {
    throw new Error('saveItemMeta needs at least one field')
  }
  const response = await optimistic(queryClient, {
    cancel: optimisticTargets.items([id]),
    apply: () => patchItems(queryClient, [id], patch),
    run: () => libraryApi.patchItem(id, patch),
  })
  applyItemSnapshots(queryClient, [{ id, item: response.item }])
  applyRev(queryClient, response.rev, { kind: 'item-meta', ids: [id], fields })
  return response
}

/** saveItemMeta bound to the provider's query client. */
export function useSaveItemMeta(): (
  id: number,
  patch: ItemMetaPatch,
) => Promise<ItemPatchResponse> {
  const queryClient = useQueryClient()
  return useCallback(
    (id, patch) => saveItemMeta(queryClient, id, patch),
    [queryClient],
  )
}
