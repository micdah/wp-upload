// The media manager's QueryClient and its provider.
//
// Defaults: no refetch on focus (the rev poll covers freshness), no retries
// except for connectivity errors (twice, backing off), no retries of
// mutations, and `networkMode: 'always'` because the app tracks reachability
// itself (connectivity.ts) and the browser's online flag says nothing about
// WordPress. Any 409 `plugin_missing`/`plugin_incompatible` re-runs
// `bootstrap` (server-api.md §2.2), so the shell can switch screens.

import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import { type ReactNode, useState } from 'react'
import { errorKind, isLibraryError } from './errors'
import { resetRev } from './invalidate'
import { libraryKeys } from './keys'

/** Retries for reads: connectivity problems only, at most twice. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (!isLibraryError(error)) {
    return false
  }
  return error.kind === 'connectivity' && failureCount < 2
}

export function retryDelay(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 8000)
}

export function createLibraryQueryClient(): QueryClient {
  // Assigned below; the caches' callbacks only run after construction.
  let client: QueryClient | null = null

  function onError(error: unknown): void {
    if (client && errorKind(error) === 'plugin') {
      void client.invalidateQueries({ queryKey: libraryKeys.bootstrap() })
    }
  }

  client = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        retryDelay,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        networkMode: 'always',
      },
      mutations: {
        retry: false,
        networkMode: 'always',
      },
    },
  })
  return client
}

/** Drops all library data, e.g. on logout. */
export function clearLibraryData(queryClient: QueryClient): void {
  queryClient.removeQueries({ queryKey: libraryKeys.all })
  resetRev(queryClient)
}

/**
 * Provides a media-manager QueryClient (one per mount). Pass `client` in tests
 * to share one with the test.
 */
export function LibraryQueryProvider({
  children,
  client,
}: {
  children: ReactNode
  client?: QueryClient
}) {
  const [ownClient] = useState(() => client ?? createLibraryQueryClient())
  return (
    <QueryClientProvider client={ownClient}>{children}</QueryClientProvider>
  )
}
