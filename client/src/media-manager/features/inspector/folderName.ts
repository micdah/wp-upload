// The name the inspector gives a folder: "All files", "Uncategorized", or
// the path "Blog / 2026" (inspector.md §2: the summary heading, the alt-text
// coverage and the alt pass's toasts).

import type { QueryClient } from '@tanstack/react-query'
import type { FolderRef, FolderTree } from '../../../../../shared/library-api'
import { useFolderTree } from '../../core/data/folderTree'
import { libraryKeys } from '../../core/data/keys'
import { useCore } from '../../core/state'

/** The folder's path from the top, joined with " / ". */
export function folderPath(id: number, tree: FolderTree | undefined): string {
  if (id === 0) {
    return 'Uncategorized'
  }
  const byId = new Map(
    (tree?.folders ?? []).map((folder) => [folder.id, folder]),
  )
  const names: string[] = []
  const seen = new Set<number>()
  let current = byId.get(id)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    names.unshift(current.name)
    current = current.parent === 0 ? undefined : byId.get(current.parent)
  }
  return names.length > 0 ? names.join(' / ') : 'This folder'
}

export function folderLabel(
  folder: FolderRef,
  tree: FolderTree | undefined,
): string {
  if (folder === 'all') {
    return 'All files'
  }
  if (folder === 'trash') {
    return 'Trash'
  }
  return folderPath(folder, tree)
}

/** folderLabel with the cached tree, for code outside React (toasts). */
export function cachedFolderLabel(
  queryClient: QueryClient,
  folder: FolderRef,
): string {
  return folderLabel(
    folder,
    queryClient.getQueryData<FolderTree>(libraryKeys.folders()),
  )
}

/** folderLabel for a component; loads the tree when a path needs it. */
export function useFolderLabel(folder: FolderRef): string {
  const fileBird = useCore(
    (state) => state.bootstrap?.site?.filebird?.active === true,
  )
  const { data } = useFolderTree({
    enabled: fileBird && typeof folder === 'number' && folder > 0,
  })
  return folderLabel(folder, data)
}
