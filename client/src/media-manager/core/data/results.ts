// Applying what mutation responses say back to the cache, so the UI shows
// the server's truth without a refetch. Use after `optimistic()` succeeded,
// together with `applyRev(queryClient, response.rev, change)`.

import type { QueryClient } from '@tanstack/react-query'
import type {
  ItemMetaSnapshot,
  LibraryItemFull,
} from '../../../../../shared/library-api'
import { seedItems, toTile, updateCachedItems } from './items'

/**
 * Writes the metadata snapshots of `PATCH items/:id` and `items/batch`
 * (title, alt, caption, description, modifiedAt) into every cached copy.
 * `post` isn't on items; `attachedTo` comes from the full view's refetch,
 * which `applyRev` triggers for `post` changes.
 */
export function applyItemSnapshots(
  queryClient: QueryClient,
  snapshots: readonly { id: number; item: ItemMetaSnapshot }[],
): void {
  for (const { id, item } of snapshots) {
    updateCachedItems(queryClient, [id], (cached) =>
      cached.view === 'full'
        ? {
            ...cached,
            title: item.title,
            alt: item.alt,
            caption: item.caption,
            description: item.description,
            modifiedAt: item.modifiedAt,
          }
        : {
            ...cached,
            title: item.title,
            alt: item.alt,
            modifiedAt: item.modifiedAt,
          },
    )
  }
}

/**
 * Stores the item an image job returned (`job.result.item`, full view) in
 * every cached copy, so the new dimensions, sizes and flags show at once.
 */
export function applyJobItem(
  queryClient: QueryClient,
  item: LibraryItemFull,
): void {
  seedItems(queryClient, 'full', [item])
  const tile = toTile(item)
  updateCachedItems(
    queryClient,
    [item.id],
    (cached) => (cached.view === 'full' ? item : tile) as typeof cached,
  )
}
