import type { AxiosRequestConfig, Method } from 'axios'
import axios from 'axios'
import type {
  CollectionResponse,
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
  RevResponse,
  TrashSummary,
  UsageResponse,
} from '../../../../shared/library-api.ts'
import {
  PLUGIN_NAMESPACE,
  type PluginBatchEnvelope,
  type PluginDeleteResponse,
  type PluginEmptyTrashRequest,
  type PluginImageOpResponse,
  type PluginInfo,
  type PluginMaintenanceRequest,
  type PluginMaintenanceResponse,
  type PluginMediaBatchRequest,
  type PluginMediaBatchResponse,
  type PluginRestoreResponse,
} from '../../../../shared/plugin-api.ts'
import { env } from '../../config/env.ts'
import { wpAxios } from '../../config/wpClient.ts'
import { LibraryError } from './errors.ts'

// The server's client for the companion plugin (`wp-upload/v1`,
// docs/media-manager/contracts/plugin-api.md) and for the few WordPress core
// routes the library needs. Everything goes through `wpAxios` (the
// Application Password), with the per-call timeouts of server-api.md §4.2.
//
// Calls throw the raw axios error (or a LibraryError for a 2xx that isn't
// JSON); routes turn it into an answer with toLibraryError().

// ---------------------------------------------------------------------------
// Timeouts (server-api.md §4.2)
// ---------------------------------------------------------------------------

/**
 * Per-call timeouts in milliseconds. List and mutation calls get a
 * wall-clock limit; `long` (image operations, replace) is the idle timeout of
 * WP_REQUEST_TIMEOUT_MS, because WordPress may need minutes for sub-sizes.
 */
export const TIMEOUTS = {
  /** `/info`, `/collection`, `/facets`, `/folders`, `/usage`, `/trash`, `/wp/v2/*` reads */
  read: 30_000,
  /** bootstrap's `/info`, so bootstrap answers quickly when WordPress hangs */
  bootstrap: 10_000,
  /** `/rev` (behind `GET rev` and the 2-second rev refresh) */
  rev: 10_000,
  /** `/media/batch`, `/media/trash`, `/media/delete`, `/trash/*`, folder mutations */
  mutation: 60_000,
  /** `/maintenance/step` */
  maintenance: 30_000,
  /** image operations and replace: idle timeout only, never shorter */
  get long(): number {
    return env.wpRequestTimeoutMs
  },
} as const

export interface CallOptions {
  /** overrides the call's default timeout (milliseconds) */
  timeoutMs?: number
  /** aborts the call, e.g. when the browser went away or a job was cancelled */
  signal?: AbortSignal
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export interface WpCall {
  method: Method
  /** path below WP_URL, e.g. `/wp-json/wp/v2/media` */
  path: string
  /** query parameters; lists must already be comma-joined */
  params?: Record<string, string | number | undefined>
  data?: unknown
  headers?: Record<string, string | number>
  timeoutMs: number
  /**
   * `wall` (default): the call fails after `timeoutMs` in total. `idle`: only
   * when no bytes move for `timeoutMs` (axios' own timeout), for calls that
   * may legitimately take minutes.
   */
  timeoutKind?: 'wall' | 'idle'
  signal?: AbortSignal
}

/**
 * One call to WordPress through `wpAxios`, returning the JSON body.
 *
 * - Redirects are not followed: a 3xx means WP_URL is wrong (server-api §2.3).
 * - A 2xx whose body isn't JSON (a WAF or maintenance page) is an error.
 * - `PATCH`, `PUT` and `DELETE` are retried once as `POST` with
 *   `X-HTTP-Method-Override` when the host answers 405 (some hosts block those
 *   methods; WordPress accepts the override).
 */
export async function wpCall<T>(call: WpCall): Promise<T> {
  try {
    return await sendOnce<T>(call)
  } catch (err) {
    if (isOverridable(call.method) && statusOf(err) === 405) {
      return sendOnce<T>({
        ...call,
        method: 'POST',
        headers: {
          ...call.headers,
          'X-HTTP-Method-Override': call.method.toUpperCase(),
        },
      })
    }
    throw err
  }
}

async function sendOnce<T>(call: WpCall): Promise<T> {
  const timeoutKind = call.timeoutKind ?? 'wall'
  const signals: AbortSignal[] = []
  if (call.signal) signals.push(call.signal)
  if (timeoutKind === 'wall') signals.push(AbortSignal.timeout(call.timeoutMs))

  const config: AxiosRequestConfig = {
    method: call.method,
    url: call.path,
    params: call.params,
    data: call.data,
    headers: call.headers,
    timeout: call.timeoutMs,
    maxRedirects: 0,
    signal: signals.length > 0 ? AbortSignal.any(signals) : undefined,
  }
  if (call.data !== undefined && !isStream(call.data)) {
    config.headers = { 'Content-Type': 'application/json', ...call.headers }
  }
  if (isStream(call.data)) {
    config.maxBodyLength = Number.POSITIVE_INFINITY
    config.maxContentLength = Number.POSITIVE_INFINITY
  }

  const response = await wpAxios.request(config)
  const data: unknown = response.data
  if (response.status === 204) return undefined as T
  if (data === null || typeof data !== 'object') {
    throw new LibraryError(
      502,
      'wp_unexpected_response',
      `WordPress returned an unexpected response (HTTP ${response.status}) ` +
        `for ${call.path}.`,
      { upstreamStatus: response.status },
    )
  }
  return data as T
}

function isOverridable(method: Method): boolean {
  const upper = method.toUpperCase()
  return upper === 'PATCH' || upper === 'PUT' || upper === 'DELETE'
}

function statusOf(err: unknown): number | undefined {
  return axios.isAxiosError(err) ? err.response?.status : undefined
}

function isStream(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as { pipe?: unknown }).pipe === 'function'
  )
}

// ---------------------------------------------------------------------------
// Library revision observer
// ---------------------------------------------------------------------------

/**
 * How a rev was seen: `poll` from the plugin's `GET /rev` (authoritative,
 * may go down after a database restore), `response` from any other plugin
 * response (reads report the rev they read; mutations the rev after them).
 */
export type RevSource = 'poll' | 'response'
type RevObserver = (rev: string, source: RevSource) => void

let revObserver: RevObserver | null = null

/**
 * Registers the one listener for every `rev` the plugin reports. cache.ts
 * registers itself here, so `currentRev` follows every plugin response,
 * including S2's mutations, without the routes doing anything.
 */
export function setRevObserver(observer: RevObserver | null): void {
  revObserver = observer
}

function observeRev(data: unknown, source: RevSource): void {
  if (!revObserver || !data || typeof data !== 'object') return
  const rev = (data as { rev?: unknown }).rev
  if (typeof rev === 'string' && /^[0-9]+$/.test(rev)) revObserver(rev, source)
}

// ---------------------------------------------------------------------------
// Plugin routes
// ---------------------------------------------------------------------------

const PLUGIN_BASE = `/wp-json/${PLUGIN_NAMESPACE}`

interface PluginCall {
  method?: Method
  params?: Record<string, string | number | undefined>
  data?: unknown
  headers?: Record<string, string | number>
  timeoutMs: number
  timeoutKind?: 'wall' | 'idle'
}

/** A call to a `wp-upload/v1` route, e.g. `pluginRequest('/folders', …)`. */
export async function pluginRequest<T>(
  route: string,
  call: PluginCall,
  options: CallOptions = {},
): Promise<T> {
  const data = await wpCall<T>({
    method: call.method ?? 'GET',
    path: `${PLUGIN_BASE}${route}`,
    params: call.params,
    data: call.data,
    headers: call.headers,
    timeoutMs: options.timeoutMs ?? call.timeoutMs,
    timeoutKind: call.timeoutKind,
    signal: options.signal,
  })
  observeRev(data, route === '/rev' ? 'poll' : 'response')
  return data
}

/**
 * The collection query as the plugin takes it (server-api.md §6): every
 * value already validated and normalised, absent values left out.
 */
export type CollectionParams = Partial<
  Record<
    'folder' | 'q' | 'type' | 'alt' | 'size' | 'orient' | 'month' | 'sort',
    string
  >
>

/** A multipart body built by the caller (`POST /media/{id}/replace`). */
export interface MultipartBody {
  /** the whole body: a stream (e.g. from a temp file) or a buffer */
  body: NodeJS.ReadableStream | Buffer
  /** `multipart/form-data; boundary=…` */
  contentType: string
  /** exact byte length (chunked bodies don't work on every PHP host) */
  contentLength: number
}

function idList(ids: readonly number[]): string {
  return ids.join(',')
}

/** Typed calls to every route of plugin-api.md, with their default timeouts. */
export const pluginClient = {
  info(options?: CallOptions): Promise<PluginInfo> {
    return pluginRequest('/info', { timeoutMs: TIMEOUTS.read }, options)
  },

  rev(options?: CallOptions): Promise<RevResponse> {
    return pluginRequest('/rev', { timeoutMs: TIMEOUTS.rev }, options)
  },

  collection(
    params: CollectionParams,
    options?: CallOptions,
  ): Promise<CollectionResponse> {
    return pluginRequest(
      '/collection',
      { params, timeoutMs: TIMEOUTS.read },
      options,
    )
  },

  facets(params: CollectionParams, options?: CallOptions): Promise<Facets> {
    return pluginRequest(
      '/facets',
      { params, timeoutMs: TIMEOUTS.read },
      options,
    )
  },

  mediaBatch(
    body: PluginMediaBatchRequest,
    options?: CallOptions,
  ): Promise<PluginMediaBatchResponse> {
    return pluginRequest(
      '/media/batch',
      { method: 'POST', data: body, timeoutMs: TIMEOUTS.mutation },
      options,
    )
  },

  mediaTrash(
    body: { ids: number[] },
    options?: CallOptions,
  ): Promise<PluginDeleteResponse> {
    return pluginRequest(
      '/media/trash',
      { method: 'POST', data: body, timeoutMs: TIMEOUTS.mutation },
      options,
    )
  },

  mediaDelete(
    body: { ids: number[] },
    options?: CallOptions,
  ): Promise<PluginDeleteResponse> {
    return pluginRequest(
      '/media/delete',
      { method: 'POST', data: body, timeoutMs: TIMEOUTS.mutation },
      options,
    )
  },

  trash(options?: CallOptions): Promise<TrashSummary> {
    return pluginRequest('/trash', { timeoutMs: TIMEOUTS.read }, options)
  },

  trashRestore(
    body: { ids: number[] },
    options?: CallOptions,
  ): Promise<PluginRestoreResponse> {
    return pluginRequest(
      '/trash/restore',
      { method: 'POST', data: body, timeoutMs: TIMEOUTS.mutation },
      options,
    )
  },

  trashEmpty(
    body: PluginEmptyTrashRequest,
    options?: CallOptions,
  ): Promise<EmptyTrashResponse> {
    return pluginRequest(
      '/trash/empty',
      { method: 'POST', data: body, timeoutMs: TIMEOUTS.mutation },
      options,
    )
  },

  usage(ids: readonly number[], options?: CallOptions): Promise<UsageResponse> {
    return pluginRequest(
      '/usage',
      { params: { ids: idList(ids) }, timeoutMs: TIMEOUTS.read },
      options,
    )
  },

  imageEdit(
    id: number,
    body: EditRequest,
    options?: CallOptions,
  ): Promise<PluginImageOpResponse> {
    return pluginRequest(`/media/${id}/edit`, longPost(body), options)
  },

  imageEditUndo(
    id: number,
    body: ExpectedModified,
    options?: CallOptions,
  ): Promise<PluginImageOpResponse> {
    return pluginRequest(`/media/${id}/edit/undo`, longPost(body), options)
  },

  imageRestore(
    id: number,
    body: ExpectedModified,
    options?: CallOptions,
  ): Promise<PluginImageOpResponse> {
    return pluginRequest(`/media/${id}/restore`, longPost(body), options)
  },

  imageRegenerate(
    id: number,
    options?: CallOptions,
  ): Promise<PluginImageOpResponse> {
    return pluginRequest(`/media/${id}/regenerate`, longPost({}), options)
  },

  imageReplace(
    id: number,
    upload: MultipartBody,
    options?: CallOptions,
  ): Promise<PluginImageOpResponse> {
    return pluginRequest(
      `/media/${id}/replace`,
      {
        method: 'POST',
        data: upload.body,
        headers: {
          'Content-Type': upload.contentType,
          'Content-Length': upload.contentLength,
        },
        timeoutMs: TIMEOUTS.long,
        timeoutKind: 'idle',
      },
      options,
    )
  },

  folders(options?: CallOptions): Promise<FolderTree> {
    return pluginRequest('/folders', { timeoutMs: TIMEOUTS.read }, options)
  },

  createFolder(
    body: FolderCreateRequest,
    options?: CallOptions,
  ): Promise<FolderMutationResponse> {
    return pluginRequest(
      '/folders',
      { method: 'POST', data: body, timeoutMs: TIMEOUTS.mutation },
      options,
    )
  },

  updateFolder(
    id: number,
    body: FolderUpdateRequest,
    options?: CallOptions,
  ): Promise<FolderMutationResponse> {
    return pluginRequest(
      `/folders/${id}`,
      { method: 'PATCH', data: body, timeoutMs: TIMEOUTS.mutation },
      options,
    )
  },

  deleteFolder(
    id: number,
    options?: CallOptions,
  ): Promise<FolderDeleteResponse> {
    return pluginRequest(
      `/folders/${id}`,
      { method: 'DELETE', timeoutMs: TIMEOUTS.mutation },
      options,
    )
  },

  assignFolder(
    body: FolderAssignRequest,
    options?: CallOptions,
  ): Promise<FolderAssignResponse> {
    return pluginRequest(
      '/folders/assign',
      { method: 'POST', data: body, timeoutMs: TIMEOUTS.mutation },
      options,
    )
  },

  maintenanceStep(
    body: PluginMaintenanceRequest,
    options?: CallOptions,
  ): Promise<PluginMaintenanceResponse> {
    return pluginRequest(
      '/maintenance/step',
      { method: 'POST', data: body, timeoutMs: TIMEOUTS.maintenance },
      options,
    )
  },
}

function longPost(body: unknown): PluginCall {
  return {
    method: 'POST',
    data: body,
    timeoutMs: TIMEOUTS.long,
    timeoutKind: 'idle',
  }
}

/** Rounds in a row in which the plugin may process nothing (sendUntilDone). */
export const SEND_MAX_IDLE_ROUNDS = 3

/**
 * Sends a per-item batch until the plugin has processed every id: the plugin
 * stops starting items when its time budget is spent and returns the rest in
 * `remaining` (plugin-api.md §1.6). Results come back in request order.
 *
 * `send` gets the entries still to do; `idOf` says which id an entry is.
 * Gives up (500 `internal_error`) after SEND_MAX_IDLE_ROUNDS rounds in a row
 * without progress, so a plugin bug can't loop forever.
 */
export async function sendUntilDone<Entry, Result extends { id: number }>(
  entries: readonly Entry[],
  idOf: (entry: Entry) => number,
  send: (entries: Entry[]) => Promise<PluginBatchEnvelope<Result>>,
): Promise<{ rev: string; results: Result[] }> {
  const resultsById = new Map<number, Result>()
  let pending = [...entries]
  let rev = ''
  let idleRounds = 0

  while (pending.length > 0) {
    const answer = await send(pending)
    rev = answer.rev
    for (const result of answer.results) resultsById.set(result.id, result)

    const remaining = new Set(answer.remaining)
    const next = pending.filter((entry) => remaining.has(idOf(entry)))
    idleRounds = next.length === pending.length ? idleRounds + 1 : 0
    if (idleRounds >= SEND_MAX_IDLE_ROUNDS) {
      throw new LibraryError(
        500,
        'internal_error',
        'The companion plugin made no progress on a batch.',
      )
    }
    pending = next
  }

  const results: Result[] = []
  for (const entry of entries) {
    const result = resultsById.get(idOf(entry))
    if (result) results.push(result)
  }
  return { rev, results }
}

// ---------------------------------------------------------------------------
// WordPress core routes
// ---------------------------------------------------------------------------

/** A `GET` of a WordPress core REST route below `/wp-json`. */
export function wpGet<T>(
  route: string,
  params: Record<string, string | number | undefined>,
  options: CallOptions = {},
): Promise<T> {
  return wpCall<T>({
    method: 'GET',
    path: `/wp-json${route}`,
    params,
    timeoutMs: options.timeoutMs ?? TIMEOUTS.read,
    signal: options.signal,
  })
}

/** A post type as the library needs it. */
export interface PostTypeInfo {
  slug: string
  /** singular label, e.g. "Page" */
  label: string
  restBase: string | null
  restNamespace: string
}

interface WpTypeView {
  slug?: string
  name?: string
  rest_base?: string
  rest_namespace?: string
}

interface WpTypeEdit extends WpTypeView {
  labels?: { singular_name?: string }
}

const POST_TYPES_TTL_MS = 10 * 60_000
let postTypesCache: {
  at: number
  types: Map<string, PostTypeInfo>
} | null = null
let postTypesInFlight: Promise<Map<string, PostTypeInfo>> | null = null

/**
 * Every REST-visible post type with its singular label, cached for 10
 * minutes (server-api.md §7.10). `context=edit` carries `labels`, but only for
 * types this user may edit; `context=view` (plural `name`) fills the rest.
 */
export async function postTypes(
  options: CallOptions = {},
): Promise<Map<string, PostTypeInfo>> {
  if (postTypesCache && Date.now() - postTypesCache.at < POST_TYPES_TTL_MS) {
    return postTypesCache.types
  }
  if (!postTypesInFlight) {
    postTypesInFlight = loadPostTypes(options).finally(() => {
      postTypesInFlight = null
    })
  }
  return postTypesInFlight
}

async function loadPostTypes(
  options: CallOptions,
): Promise<Map<string, PostTypeInfo>> {
  const [viewTypes, editTypes] = await Promise.all([
    wpGet<Record<string, WpTypeView>>(
      '/wp/v2/types',
      { context: 'view' },
      options,
    ),
    // Fails with 403 for a user who can edit no type at all.
    wpGet<Record<string, WpTypeEdit>>(
      '/wp/v2/types',
      { context: 'edit' },
      options,
    ).catch((err: unknown) => {
      if (statusOf(err) === 403) return {} as Record<string, WpTypeEdit>
      throw err
    }),
  ])

  const types = new Map<string, PostTypeInfo>()
  for (const [slug, view] of Object.entries(viewTypes)) {
    const edit = editTypes[slug]
    types.set(slug, {
      slug,
      label: edit?.labels?.singular_name || view.name || capitalise(slug),
      restBase: view.rest_base || null,
      restNamespace: view.rest_namespace || 'wp/v2',
    })
  }
  postTypesCache = { at: Date.now(), types }
  return types
}

/** "Some Type" for a type WordPress doesn't describe. */
export function capitalise(slug: string): string {
  const words = slug.replace(/[-_]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Clears module state between tests. */
export function resetPluginClientForTests(): void {
  postTypesCache = null
  postTypesInFlight = null
}
