// Rev polling (server-api.md §7.2): every 15 s while the page is visible, on
// focus and on reconnect; 15 → 30 → 60 s while WordPress is unreachable
// (system.md "offline"). A rev different from the known one invalidates per
// the central map (invalidate.ts, `external`).

import {
  type QueryClient,
  queryOptions,
  type UseQueryResult,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'
import type { RevResponse } from '../../../../../shared/library-api'
import { libraryApi } from './api'
import {
  backoffDelay,
  type ConnectivityStore,
  connectivityStore,
} from './connectivity'
import type { LibraryError } from './errors'
import {
  applyPolledRev,
  knownRev,
  revSequence,
  subscribeRev,
} from './invalidate'
import { libraryKeys } from './keys'

export function revQueryOptions(
  queryClient: QueryClient,
  connectivity: ConnectivityStore = connectivityStore,
) {
  return queryOptions({
    queryKey: libraryKeys.rev(),
    queryFn: async ({ signal }): Promise<RevResponse> => {
      const sentAt = revSequence(queryClient)
      const response = await libraryApi.rev({ signal })
      applyPolledRev(queryClient, response.rev, sentAt)
      return response
    },
    staleTime: 0,
    retry: false,
    refetchInterval: () => backoffDelay(connectivity.getSnapshot().failures),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  })
}

/**
 * Starts the rev poll for as long as the calling component is mounted (the
 * shell, once bootstrap says the library is usable). Its data also carries
 * the index state for "Indexing library…". "Retry now" is its `refetch()`.
 */
export function useRevPolling(
  options: { enabled?: boolean } = {},
): UseQueryResult<RevResponse, LibraryError> {
  const queryClient = useQueryClient()
  return useQuery({
    ...revQueryOptions(queryClient),
    enabled: options.enabled ?? true,
  })
}

/** The library revision the client currently knows. */
export function useLibraryRev(): string | null {
  const queryClient = useQueryClient()
  return useSyncExternalStore(
    (listener) => subscribeRev(queryClient, listener),
    () => knownRev(queryClient),
  )
}
