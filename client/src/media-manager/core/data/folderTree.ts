// The FileBird folder tree (server-api.md §7.11). Every folder mutation
// answers with the whole tree after the change, and `folders/assign` with
// fresh counts; both go straight into the cache here instead of a refetch.
// Track A3 builds the folder UI and its mutations on top
// (core/data/folders.ts).

import {
  type QueryClient,
  queryOptions,
  type UseQueryResult,
  useQuery,
} from '@tanstack/react-query'
import type {
  FolderCounts,
  FolderTree,
} from '../../../../../shared/library-api'
import { libraryApi } from './api'
import type { LibraryError } from './errors'
import { libraryKeys } from './keys'

export function folderTreeQueryOptions() {
  return queryOptions({
    queryKey: libraryKeys.folders(),
    queryFn: ({ signal }) => libraryApi.folders({ signal }),
    staleTime: Number.POSITIVE_INFINITY,
  })
}

/**
 * The tree. Pass `enabled: false` without active FileBird (the route answers
 * 409 `wpu_filebird_inactive` then).
 */
export function useFolderTree(
  options: { enabled?: boolean } = {},
): UseQueryResult<FolderTree, LibraryError> {
  return useQuery({
    ...folderTreeQueryOptions(),
    enabled: options.enabled ?? true,
  })
}

/** Stores the tree a folder mutation returned. */
export function setFolderTree(
  queryClient: QueryClient,
  tree: FolderTree,
): void {
  queryClient.setQueryData(libraryKeys.folders(), tree)
}

/** Applies the fresh direct counts `folders/assign` returned. */
export function applyFolderCounts(
  queryClient: QueryClient,
  counts: FolderCounts,
  rev?: string,
): void {
  queryClient.setQueryData<FolderTree>(libraryKeys.folders(), (tree) => {
    if (!tree) {
      return tree
    }
    return {
      ...tree,
      rev: rev ?? tree.rev,
      counts: { all: counts.all, uncategorized: counts.uncategorized },
      folders: tree.folders.map((folder) => {
        const count = counts.byId[String(folder.id)]
        return count === undefined || count === folder.count
          ? folder
          : { ...folder, count }
      }),
    }
  })
}
