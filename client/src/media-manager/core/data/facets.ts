// Counts for the filter bar, chips, months menu and inspector summary
// (server-api.md §7.4), for the same query as the collection they belong to.

import {
  queryOptions,
  type UseQueryResult,
  useQuery,
} from '@tanstack/react-query'
import type { CollectionQuery, Facets } from '../../../../../shared/library-api'
import { libraryApi } from './api'
import type { LibraryError } from './errors'
import { libraryKeys } from './keys'
import { type CollectionParams, normaliseCollectionQuery } from './params'

export function facetsQueryOptions(query: CollectionQuery) {
  return queryOptions({
    queryKey: libraryKeys.facets(query),
    queryFn: ({ signal }) => libraryApi.facets(query, { signal }),
    staleTime: Number.POSITIVE_INFINITY,
  })
}

export function useFacets(
  params: CollectionParams | CollectionQuery,
  options: { enabled?: boolean; keepPrevious?: boolean } = {},
): UseQueryResult<Facets, LibraryError> {
  const query = normaliseCollectionQuery(params)
  return useQuery({
    ...facetsQueryOptions(query),
    enabled: options.enabled ?? true,
    placeholderData: options.keepPrevious
      ? (previous: Facets | undefined) => previous
      : undefined,
  })
}
