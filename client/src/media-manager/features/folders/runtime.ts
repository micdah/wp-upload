// What the folder commands need outside React: the media manager's
// QueryClient. The column (mounted whenever FileBird is active) binds it, so
// commands that change folders or assignments can reach the cache. Without
// FileBird there is no column and no client here, and those commands only
// explain why they can't run.

import type { QueryClient } from '@tanstack/react-query'

let client: QueryClient | null = null

export function bindFolderQueryClient(next: QueryClient | null): void {
  client = next
}

export function folderQueryClient(): QueryClient | null {
  return client
}
