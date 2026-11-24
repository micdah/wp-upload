// GET api/library/bootstrap: always 200, even when WordPress is down, so the
// client can always decide which screen to show (server-api.md §7.1).
//
// TEMPORARY (M1): F2's core/data provides the real bootstrap hook. At
// integration this delegates to it (see tracks/F1-handoff.md).

import { useQuery } from '@tanstack/react-query'
import type { Bootstrap } from '../../../../../shared/library-api'
import { apiFetch } from '../../../lib/api'

export const BOOTSTRAP_QUERY_KEY = ['mm-core-temp', 'bootstrap'] as const

async function fetchBootstrap(signal: AbortSignal): Promise<Bootstrap> {
  const response = await apiFetch('api/library/bootstrap', {
    signal,
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) {
    throw new Error(`Server responded with HTTP ${response.status}.`)
  }
  return (await response.json()) as Bootstrap
}

export function useBootstrap() {
  return useQuery({
    queryKey: BOOTSTRAP_QUERY_KEY,
    queryFn: ({ signal }) => fetchBootstrap(signal),
    staleTime: Number.POSITIVE_INFINITY,
    retry: 1,
    refetchOnWindowFocus: false,
  })
}
