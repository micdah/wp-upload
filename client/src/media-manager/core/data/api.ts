// One typed function per `api/library/*` route (server-api.md §10). They
// return the response body; use `http.request` directly when you need the
// headers. Upload *transfers* (with byte progress) belong to core/uploads
// (track F1); this file has the upload routes that are plain JSON.

import type {
  BatchRequest,
  BatchResponse,
  Bootstrap,
  CollectionQuery,
  CollectionResponse,
  DeleteRequest,
  DeleteResponse,
  DownloadVariant,
  EditRequest,
  EmptyTrashResponse,
  ExpectedModified,
  Facets,
  FolderAssignRequest,
  FolderAssignResponse,
  FolderCreateRequest,
  FolderDeleteResponse,
  FolderMutationResponse,
  FolderTree,
  FolderUpdateRequest,
  ItemPatch,
  ItemPatchResponse,
  ItemsFullResponse,
  ItemsTileResponse,
  ItemView,
  JobAccepted,
  JobsResponse,
  PostsResponse,
  RegenerateRequest,
  RestoreRequest,
  RestoreResponse,
  RevResponse,
  TrashSummary,
  UploadCheckResponse,
  UsageResponse,
} from '../../../../../shared/library-api'
import { LibraryError } from './errors'
import { http, libraryUrl, reportProbe } from './http'
import { collectionSearchParams } from './params'

interface CallOptions {
  signal?: AbortSignal
}

type ItemsResponseFor<V extends ItemView> = V extends 'full'
  ? ItemsFullResponse
  : ItemsTileResponse

async function body<T>(promise: Promise<{ data: T }>): Promise<T> {
  return (await promise).data
}

/**
 * What a bootstrap says about reaching WordPress. Bootstrap is always 200,
 * so its status proves only that our server answered; `wp.state` says
 * whether WordPress did.
 */
function bootstrapProbeOutcome(bootstrap: Bootstrap): LibraryError | null {
  const message = bootstrap.wp.message ?? 'WordPress could not be reached.'
  switch (bootstrap.wp.state) {
    case 'ok':
      return null
    case 'auth_failed':
      return new LibraryError(502, { code: 'wp_auth_failed', message })
    default:
      return new LibraryError(502, { code: 'wp_unreachable', message })
  }
}

export const libraryApi = {
  async bootstrap(options: CallOptions = {}) {
    // Not a probe by status (always 200): reported from `wp.state` instead.
    const bootstrap = await body(
      http.get<Bootstrap>('bootstrap', { ...options, probe: false }),
    )
    reportProbe(bootstrapProbeOutcome(bootstrap))
    return bootstrap
  },

  rev(options: CallOptions = {}) {
    return body(http.get<RevResponse>('rev', { ...options, probe: true }))
  },

  collection(query: CollectionQuery, options: CallOptions = {}) {
    return body(
      http.get<CollectionResponse>('collection', {
        ...options,
        query: collectionSearchParams(query),
      }),
    )
  },

  facets(query: CollectionQuery, options: CallOptions = {}) {
    return body(
      http.get<Facets>('facets', {
        ...options,
        query: collectionSearchParams(query),
      }),
    )
  },

  /** 1–100 ids (LIMITS.itemIds); chunk larger lists with items.ts. */
  items<V extends ItemView>(
    ids: readonly number[],
    view: V,
    options: CallOptions = {},
  ) {
    return body(
      http.get<ItemsResponseFor<V>>('items', {
        ...options,
        query: { ids, view: view === 'tile' ? null : view },
      }),
    )
  },

  patchItem(id: number, patch: ItemPatch, options: CallOptions = {}) {
    return body(
      http.patch<ItemPatchResponse>(`items/${id}`, { ...options, body: patch }),
    )
  },

  /** ≤ 100 items; bulk.ts chunks larger selections. */
  batch(request: BatchRequest, options: CallOptions = {}) {
    return body(
      http.post<BatchResponse>('items/batch', { ...options, body: request }),
    )
  },

  /** ≤ 100 ids; bulk.ts chunks larger selections. */
  deleteItems(request: DeleteRequest, options: CallOptions = {}) {
    return body(
      http.post<DeleteResponse>('items/delete', { ...options, body: request }),
    )
  },

  usage(ids: readonly number[], options: CallOptions = {}) {
    return body(
      http.get<UsageResponse>('usage', { ...options, query: { ids } }),
    )
  },

  posts(search = '', limit?: number, options: CallOptions = {}) {
    return body(
      http.get<PostsResponse>('posts', {
        ...options,
        query: { search, limit },
      }),
    )
  },

  folders(options: CallOptions = {}) {
    return body(http.get<FolderTree>('folders', options))
  },

  createFolder(request: FolderCreateRequest, options: CallOptions = {}) {
    return body(
      http.post<FolderMutationResponse>('folders', {
        ...options,
        body: request,
      }),
    )
  },

  updateFolder(
    id: number,
    request: FolderUpdateRequest,
    options: CallOptions = {},
  ) {
    return body(
      http.patch<FolderMutationResponse>(`folders/${id}`, {
        ...options,
        body: request,
      }),
    )
  },

  deleteFolder(id: number, options: CallOptions = {}) {
    return body(http.delete<FolderDeleteResponse>(`folders/${id}`, options))
  },

  /** ≤ 5000 ids; bulk.ts chunks larger selections. */
  assignFolder(request: FolderAssignRequest, options: CallOptions = {}) {
    return body(
      http.post<FolderAssignResponse>('folders/assign', {
        ...options,
        body: request,
      }),
    )
  },

  editImage(id: number, request: EditRequest, options: CallOptions = {}) {
    return body(
      http.post<JobAccepted>(`items/${id}/edit`, {
        ...options,
        body: request,
      }),
    )
  },

  undoImageEdit(
    id: number,
    request: ExpectedModified,
    options: CallOptions = {},
  ) {
    return body(
      http.post<JobAccepted>(`items/${id}/edit/undo`, {
        ...options,
        body: request,
      }),
    )
  },

  restoreImage(
    id: number,
    request: ExpectedModified,
    options: CallOptions = {},
  ) {
    return body(
      http.post<JobAccepted>(`items/${id}/restore`, {
        ...options,
        body: request,
      }),
    )
  },

  replaceImage(
    id: number,
    file: Blob,
    expectedModified: string,
    options: CallOptions & { filename?: string } = {},
  ) {
    const form = new FormData()
    if (options.filename === undefined) {
      form.append('file', file)
    } else {
      form.append('file', file, options.filename)
    }
    form.append('expectedModified', expectedModified)
    return body(
      http.post<JobAccepted>(`items/${id}/replace`, {
        signal: options.signal,
        body: form,
      }),
    )
  },

  /** ≤ 1000 ids; bulk.ts chunks larger selections. */
  regenerate(request: RegenerateRequest, options: CallOptions = {}) {
    return body(
      http.post<JobAccepted>('items/regenerate', {
        ...options,
        body: request,
      }),
    )
  },

  jobs(ids: readonly string[], options: CallOptions = {}) {
    return body(http.get<JobsResponse>('jobs', { ...options, query: { ids } }))
  },

  trash(options: CallOptions = {}) {
    return body(http.get<TrashSummary>('trash', options))
  },

  /** ≤ 100 ids; bulk.ts chunks larger selections. */
  restoreFromTrash(request: RestoreRequest, options: CallOptions = {}) {
    return body(
      http.post<RestoreResponse>('trash/restore', {
        ...options,
        body: request,
      }),
    )
  },

  /** One time-budgeted step; bulk.ts `emptyTrash` loops while `remaining > 0`. */
  emptyTrashStep(options: CallOptions = {}) {
    return body(
      http.post<EmptyTrashResponse>('trash/empty', { ...options, body: {} }),
    )
  },

  uploadJobs(ids: readonly string[], options: CallOptions = {}) {
    return body(
      http.get<JobsResponse>('upload/jobs', { ...options, query: { ids } }),
    )
  },

  cancelUpload(jobId: string, options: CallOptions = {}) {
    return body(
      http.delete<undefined>(`upload/jobs/${encodeURIComponent(jobId)}`, {
        ...options,
        expect: 'none',
      }),
    )
  },

  uploadCheck(filename: string, options: CallOptions = {}) {
    return body(
      http.get<UploadCheckResponse>('upload/check', {
        ...options,
        query: { filename },
      }),
    )
  },

  /** A relative URL for `<a href>`: the server streams the file. */
  downloadUrl(id: number, variant: DownloadVariant = 'file'): string {
    return libraryUrl(`items/${id}/download`, {
      variant: variant === 'file' ? null : variant,
    })
  },

  /** A relative URL for `<a href>`: the bundled plugin zip. */
  pluginDownloadUrl(): string {
    return libraryUrl('plugin/download')
  },
}

export type LibraryApi = typeof libraryApi
