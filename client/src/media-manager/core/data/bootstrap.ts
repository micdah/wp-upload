// `bootstrap` (server-api.md §7.1): the first call after login, always 200.
// It decides which screen the app shows, and sets the client's baseline
// library revision. Re-running it ("Check again", or after a 409
// `plugin_missing`/`plugin_incompatible`, see client.ts) picks up a new rev
// like the poller does.

import {
  type QueryClient,
  queryOptions,
  type UseQueryResult,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import {
  type Bootstrap,
  PLUGIN_USABLE_STATES,
} from '../../../../../shared/library-api'
import { libraryApi } from './api'
import type { LibraryError } from './errors'
import { applyRev } from './invalidate'
import { libraryKeys } from './keys'

export function bootstrapQueryOptions(queryClient: QueryClient) {
  return queryOptions({
    queryKey: libraryKeys.bootstrap(),
    queryFn: async ({ signal }) => {
      const bootstrap = await libraryApi.bootstrap({ signal })
      applyRev(queryClient, bootstrap.rev)
      return bootstrap
    },
    staleTime: Number.POSITIVE_INFINITY,
    // Always 200 unless the session is gone; nothing to retry.
    retry: false,
  })
}

export function useBootstrap(
  options: { enabled?: boolean } = {},
): UseQueryResult<Bootstrap, LibraryError> {
  const queryClient = useQueryClient()
  return useQuery({
    ...bootstrapQueryOptions(queryClient),
    enabled: options.enabled ?? true,
  })
}

/** The app runs (plugin `ok` or `update-available` and WordPress reachable). */
export function isLibraryUsable(bootstrap: Bootstrap | undefined): boolean {
  if (bootstrap?.wp.state !== 'ok' || !bootstrap.plugin) {
    return false
  }
  return (PLUGIN_USABLE_STATES as readonly string[]).includes(
    bootstrap.plugin.state,
  )
}
