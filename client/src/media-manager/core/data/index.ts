// The media manager's data layer: everything the client needs to talk to
// `api/library/*` (server-api.md). Import from here; feature tracks put their
// own queries and mutations in core/data/<feature>.ts on top of these.

export { type LibraryApi, libraryApi } from './api'
export {
  bootstrapQueryOptions,
  isLibraryUsable,
  useBootstrap,
} from './bootstrap'
export {
  type BulkAssignOutcome,
  type BulkOptions,
  type BulkOutcome,
  type BulkProgress,
  bulkAssign,
  bulkBatch,
  bulkDelete,
  bulkRegenerate,
  bulkRestore,
  type EmptyTrashOutcome,
  emptyTrash,
  groupByPreviousFolder,
  runChunked,
} from './bulk'
export {
  clearLibraryData,
  createLibraryQueryClient,
  LibraryQueryProvider,
  retryDelay,
  shouldRetry,
} from './client'
export {
  allIds,
  type CollectionSnapshot,
  collectionQueryOptions,
  idsInRange,
  parseCollection,
  positionOf,
  rowHeight,
  rowId,
  rowKind,
  rowWidth,
  type UseCollectionRowsOptions,
  useCollectionRows,
  withDimensions,
  withoutIds,
} from './collection'
export {
  backoffDelay,
  type ConnectivitySnapshot,
  type ConnectivityState,
  type ConnectivityStore,
  connectivityStore,
  createConnectivityStore,
  OFFLINE_BACKOFF_MS,
  REV_POLL_MS,
  useConnectivity,
} from './connectivity'
export {
  CLIENT_ERROR_CODES,
  type ErrorKind,
  errorKind,
  isAbortError,
  isLibraryError,
  LibraryError,
} from './errors'
export { facetsQueryOptions, useFacets } from './facets'
export {
  applyFolderCounts,
  folderTreeQueryOptions,
  setFolderTree,
  useFolderTree,
} from './folderTree'
export {
  http,
  LIBRARY_BASE,
  type LibraryResponse,
  libraryUrl,
  type Query,
  type RequestOptions,
  request,
} from './http'
export {
  applyPolledRev,
  applyRev,
  filtersFor,
  INVALIDATION_MAP,
  invalidateFor,
  isRevDependent,
  knownRev,
  type LibraryChange,
  type LibraryChangeKind,
  resetRev,
  revSequence,
  subscribeRev,
} from './invalidate'
export {
  alignedChunks,
  cachedItem,
  chunkIds,
  type HydratedItems,
  ITEM_CHUNK_SIZE,
  type ItemChunk,
  type ItemOf,
  itemChunkQueryOptions,
  itemQueryOptions,
  seedItems,
  toTile,
  updateCachedItems,
  useItem,
  useItemChunks,
} from './items'
export {
  keyResource,
  LIBRARY_ROOT,
  type LibraryResource,
  libraryKeys,
  REV_DEPENDENT,
  registerRevDependent,
} from './keys'
export {
  adjustFolderCounts,
  cachedFolders,
  combineRollbacks,
  type ItemFieldsPatch,
  type OptimisticOptions,
  optimistic,
  optimisticMove,
  optimisticRemove,
  optimisticRestore,
  optimisticTargets,
  patchItems,
  type Rollback,
  removeFromCollections,
  snapshotQueries,
} from './optimistic'
export {
  type CollectionParams,
  collectionSearchParams,
  DEFAULT_COLLECTION_QUERY,
  hasFilters,
  isFolderQuery,
  normaliseCollectionQuery,
  normaliseSearch,
  parseFolder,
} from './params'
export { applyItemSnapshots, applyJobItem } from './results'
export { revQueryOptions, useLibraryRev, useRevPolling } from './rev'
export {
  createSessionGate,
  type SessionGate,
  type SessionGateState,
  sessionGate,
  useSessionGate,
} from './session'
