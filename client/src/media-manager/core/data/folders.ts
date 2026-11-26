// The folder feature's queries and mutations (track A3, server-api.md §7.11),
// on top of core/data's folder tree query (folderTree.ts).
//
// - Every tree mutation (create, rename, move, colour, delete) answers with
//   the whole tree after the change; it goes straight into the cache, then
//   `applyRev` invalidates what the change can affect (invalidate.ts).
// - Rename, move and colour are optimistic: the cached tree changes at once
//   and is put back if the request fails.
// - Assigning items to a folder is optimistic too (`optimisticMove`: the
//   items leave other folders' views, their `folder` and the counts change),
//   then chunked per D24 (`bulkAssign`).

import type { QueryClient } from '@tanstack/react-query'
import type {
  Folder,
  FolderAssignResponse,
  FolderDeleteResponse,
  FolderMutationResponse,
  FolderTree,
  FolderUpdateRequest,
} from '../../../../../shared/library-api'
import { libraryApi } from './api'
import {
  type BulkAssignOutcome,
  bulkAssign,
  groupByPreviousFolder,
} from './bulk'
import { setFolderTree } from './folderTree'
import { applyRev } from './invalidate'
import { libraryKeys } from './keys'
import {
  optimisticMove,
  optimisticTargets,
  type Rollback,
  snapshotQueries,
} from './optimistic'

/** The cached tree, if it has loaded. */
export function cachedFolderTree(
  queryClient: QueryClient,
): FolderTree | undefined {
  return queryClient.getQueryData<FolderTree>(libraryKeys.folders())
}

/** Changes the cached tree's folder list; returns the rollback. */
function patchCachedFolders(
  queryClient: QueryClient,
  change: (folders: readonly Folder[]) => Folder[],
): Rollback {
  const rollback = snapshotQueries(queryClient, [optimisticTargets.folders()])
  queryClient.setQueryData<FolderTree>(libraryKeys.folders(), (tree) =>
    tree ? { ...tree, folders: change(tree.folders) } : tree,
  )
  return rollback
}

function applyTreeResponse(
  queryClient: QueryClient,
  response: { rev: string; tree: FolderTree },
): void {
  setFolderTree(queryClient, response.tree)
  applyRev(queryClient, response.rev, { kind: 'folder-tree' })
}

/** Creates a folder; the response's `folder.name` is the final name. */
export async function createFolder(
  queryClient: QueryClient,
  name: string,
  parent: number,
): Promise<FolderMutationResponse> {
  const response = await libraryApi.createFolder({ name, parent })
  applyTreeResponse(queryClient, response)
  return response
}

/**
 * PATCHes a folder (rename, move, colour). `optimisticFolders` shows the
 * change in the cached tree while the request runs; it is rolled back if the
 * request fails, and the error is rethrown.
 */
export async function updateFolder(
  queryClient: QueryClient,
  id: number,
  patch: FolderUpdateRequest,
  optimisticFolders?: (folders: readonly Folder[]) => Folder[],
): Promise<FolderMutationResponse> {
  await queryClient.cancelQueries(optimisticTargets.folders())
  const rollback = optimisticFolders
    ? patchCachedFolders(queryClient, optimisticFolders)
    : null
  try {
    const response = await libraryApi.updateFolder(id, patch)
    applyTreeResponse(queryClient, response)
    return response
  } catch (error) {
    rollback?.()
    throw error
  }
}

/** Sets fields on one folder in a list (for optimistic renames and colours). */
export function withFolderFields(
  id: number,
  fields: Partial<Pick<Folder, 'name' | 'color'>>,
): (folders: readonly Folder[]) => Folder[] {
  return (folders) =>
    folders.map((folder) =>
      folder.id === id ? { ...folder, ...fields } : folder,
    )
}

/** Deletes a folder and its subtree; their files move to Uncategorized. */
export async function deleteFolder(
  queryClient: QueryClient,
  id: number,
): Promise<FolderDeleteResponse> {
  const response = await libraryApi.deleteFolder(id)
  setFolderTree(queryClient, response.tree)
  applyRev(queryClient, response.rev, {
    kind: 'folder-delete',
    folderIds: response.deletedIds,
  })
  return response
}

export interface AssignOutcome extends BulkAssignOutcome {
  /** ids whose folder actually changed */
  movedIds: number[]
}

/**
 * Moves items into a folder (0 = Uncategorized) with an optimistic update,
 * chunked per D24. `optimisticIds` (default: all) are the ones expected to
 * move, e.g. without the items an Author may not change; the server still
 * decides and reports `skipped`. A run that failed before anything was
 * assigned is rolled back. Otherwise the responses' counts and `applyRev`
 * bring the cache to the server's state (skipped items come back with the
 * refetch); Undo covers exactly what was done. Never throws for a request
 * error: the outcome carries it.
 */
export async function assignItemsToFolder(
  queryClient: QueryClient,
  folder: number,
  ids: readonly number[],
  options: { optimisticIds?: readonly number[] } = {},
): Promise<AssignOutcome> {
  const optimisticIds = options.optimisticIds ?? ids
  await Promise.all([
    queryClient.cancelQueries(optimisticTargets.folders()),
    queryClient.cancelQueries(
      optimisticTargets.collections(
        (query) => typeof query.folder === 'number',
      ),
    ),
    ...optimisticTargets
      .items(optimisticIds)
      .map((filters) => queryClient.cancelQueries(filters)),
  ])
  const rollback = optimisticMove(queryClient, optimisticIds, folder)
  const outcome = await bulkAssign(queryClient, folder, ids)
  if (outcome.done === 0) {
    // Nothing reached the server: put the cache back; the rollback
    // invalidates what it touched, so the server's state wins.
    rollback()
  }
  const movedIds = outcome.previous
    .filter((entry) => entry.folder !== folder)
    .map((entry) => entry.id)
  return { ...outcome, movedIds }
}

/**
 * Undo of an assign: each item back to the folder it had (one request per
 * previous folder, server-api.md §7.11). Items that were already in the
 * target are left alone. Throws the first failure.
 */
export async function restoreItemFolders(
  queryClient: QueryClient,
  previous: FolderAssignResponse['previous'],
  target: number,
): Promise<number> {
  const groups = groupByPreviousFolder(
    previous.filter((entry) => entry.folder !== target),
  )
  let restored = 0
  for (const [folder, ids] of groups) {
    const outcome = await assignItemsToFolder(queryClient, folder, ids)
    if (outcome.error !== null) {
      throw outcome.error
    }
    restored += ids.length
  }
  return restored
}
