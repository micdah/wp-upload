// Every TanStack Query key of the media manager, in one place.
//
// All keys start with `library`, then the resource. Collection and facets
// keys hold a normalised `CollectionQuery` (params.ts). Items live twice:
// per id (`item`, what the inspector and detail mode read) and per chunk
// (`items`, what one `items?ids=` request fetched for the grid); the chunk's
// queryFn seeds the per-id entries (items.ts).
//
// Feature files in core/data/<feature>.ts add keys under `library` too, with
// their feature name as the second element, so `invalidate.ts` can tell
// rev-dependent data apart.

import type {
  CollectionQuery,
  ItemView,
} from '../../../../../shared/library-api'

export const LIBRARY_ROOT = 'library' as const

export type LibraryResource =
  | 'bootstrap'
  | 'rev'
  | 'collection'
  | 'facets'
  | 'items'
  | 'item'
  | 'folders'
  | 'usage'
  | 'trash'
  | 'posts'
  | 'jobs'
  | 'upload-check'

/**
 * Resources whose data depends on the library revision: a new `rev` makes
 * them stale. `bootstrap`, `rev`, `posts`, `jobs` and `upload-check` are
 * `no-store` routes the client refetches on its own terms.
 */
const revDependent = new Set<string>([
  'collection',
  'facets',
  'items',
  'item',
  'folders',
  'usage',
  'trash',
] satisfies LibraryResource[])
export const REV_DEPENDENT: ReadonlySet<string> = revDependent

/**
 * A feature's own rev-dependent resource (its key's second element), so an
 * external change invalidates it too. Call it from the feature's register().
 */
export function registerRevDependent(resource: string): void {
  revDependent.add(resource)
}

export const libraryKeys = {
  all: [LIBRARY_ROOT] as const,
  bootstrap: () => [LIBRARY_ROOT, 'bootstrap'] as const,
  rev: () => [LIBRARY_ROOT, 'rev'] as const,
  collections: () => [LIBRARY_ROOT, 'collection'] as const,
  collection: (query: CollectionQuery) =>
    [LIBRARY_ROOT, 'collection', query] as const,
  allFacets: () => [LIBRARY_ROOT, 'facets'] as const,
  facets: (query: CollectionQuery) => [LIBRARY_ROOT, 'facets', query] as const,
  itemChunks: (view?: ItemView) =>
    view === undefined
      ? ([LIBRARY_ROOT, 'items'] as const)
      : ([LIBRARY_ROOT, 'items', view] as const),
  itemChunk: (view: ItemView, ids: readonly number[]) =>
    [LIBRARY_ROOT, 'items', view, ids] as const,
  items: (view?: ItemView) =>
    view === undefined
      ? ([LIBRARY_ROOT, 'item'] as const)
      : ([LIBRARY_ROOT, 'item', view] as const),
  item: (view: ItemView, id: number) =>
    [LIBRARY_ROOT, 'item', view, id] as const,
  folders: () => [LIBRARY_ROOT, 'folders'] as const,
  usages: () => [LIBRARY_ROOT, 'usage'] as const,
  usage: (id: number) => [LIBRARY_ROOT, 'usage', id] as const,
  trash: () => [LIBRARY_ROOT, 'trash'] as const,
  posts: (search: string, limit: number) =>
    [LIBRARY_ROOT, 'posts', search, limit] as const,
  jobs: (ids: readonly string[]) => [LIBRARY_ROOT, 'jobs', ids] as const,
  uploadCheck: (filename: string) =>
    [LIBRARY_ROOT, 'upload-check', filename] as const,
}

/** The resource of a library key (its second element), if it is one. */
export function keyResource(queryKey: readonly unknown[]): string | null {
  if (queryKey[0] !== LIBRARY_ROOT) {
    return null
  }
  const resource = queryKey[1]
  return typeof resource === 'string' ? resource : null
}
