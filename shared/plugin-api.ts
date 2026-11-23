// Wire types of the companion plugin's `wp-upload/v1` REST namespace that the
// server's plugin client and the plugin contract tests need.
//
// The contract itself is docs/media-manager/contracts/plugin-api.md. Where a
// plugin response is identical to the server's (collection, facets, folders,
// usage, trash summary, …), it is not repeated here: import it from
// library-api.ts. Same runtime rule as library-api.ts: dependency-free, types
// and `as const` lists only.

import type {
  BatchItemChange,
  BatchItemResult,
  DeleteItemResult,
  FileBirdInfo,
  ImageEditorConfig,
  ImageSizeDef,
  IndexStatus,
  ItemPerms,
  MediaKind,
  OriginalFile,
  RestoreItemResult,
  TrashConfig,
  UploadConfig,
  WpUser,
} from './library-api.ts'

/** The plugin's REST namespace. */
export const PLUGIN_NAMESPACE = 'wp-upload/v1'

/** The plugin's slug and main file name. */
export const PLUGIN_SLUG = 'wp-upload-companion'

export const PLUGIN_INSTALL_MODES = ['plugin', 'mu-plugin'] as const
export type PluginInstallMode = (typeof PLUGIN_INSTALL_MODES)[number]

/**
 * `GET /info`. The shape is frozen across every plugin version: fields are
 * only ever added. `plugin`, `version`, `api` and `features` are always the
 * first thing a consumer reads, so any build, even an incompatible one, can be
 * identified.
 */
export interface PluginInfo {
  plugin: 'wp-upload-companion'
  /** `WPU_VERSION`, semver */
  version: string
  /** `WPU_API`, `major.minor` */
  api: string
  features: string[]
  install: PluginInstallMode
  wpVersion: string
  user: WpUser
  filebird: FileBirdInfo | null
  trash: TrashConfig
  /** `maxBytes` here is WordPress's own `wp_max_upload_size()` */
  upload: UploadConfig
  imageSizes: ImageSizeDef[]
  imageEditor: ImageEditorConfig
  index: IndexStatus
  rev: string
}

/** `data` of the 403 `wpu_forbidden` answer to `GET /info`. */
export interface PluginForbiddenData {
  status: 403
  plugin: 'wp-upload-companion'
  version: string
  api: string
}

/** A WordPress REST error body (`WP_Error` serialised by core). */
export interface WpRestError {
  code: string
  message: string
  data?: { status?: number; [key: string]: unknown } | null
}

/** Envelope of every per-item mutation route of the plugin. */
export interface PluginBatchEnvelope<Result> {
  rev: string
  results: Result[]
  /**
   * Ids not processed because the request's time budget ran out, in request
   * order. Send them again. Usually empty.
   */
  remaining: number[]
}

/** `POST /media/batch` body. */
export interface PluginMediaBatchRequest {
  items: BatchItemChange[]
}

export type PluginMediaBatchResponse = PluginBatchEnvelope<BatchItemResult>
export type PluginDeleteResponse = PluginBatchEnvelope<DeleteItemResult>
export type PluginRestoreResponse = PluginBatchEnvelope<RestoreItemResult>

/** `POST /trash/empty` body. */
export interface PluginEmptyTrashRequest {
  budgetMs?: number
}

/** Result of every image operation route. */
export interface PluginImageOpResponse {
  rev: string
  id: number
  modifiedAt: string
  width: number
  height: number
  mime: string
  sizesRegenerated: number
  urlChanged: boolean
  edited: boolean
  undoable: boolean
  restorable: boolean
}

/** `POST /maintenance/step` body. */
export interface PluginMaintenanceRequest {
  budgetMs?: number
}

export interface PluginMaintenanceResponse {
  rev: string
  /** another step holds the lock; nothing was done */
  locked: boolean
  /** rows (re)indexed in this step */
  did: { media: number; usage: number; folders: number }
  /** call again: something is left to do */
  more: boolean
  index: IndexStatus
}

/**
 * The `wpu` field the plugin adds to every attachment in `/wp/v2/media`
 * (context `view` and `edit`). It is `null` for users without
 * `upload_files`.
 */
export interface WpuField {
  kind: MediaKind
  /** same numbers as the collection rows */
  width: number
  height: number
  filesize: number | null
  folder: number | null
  perms: ItemPerms
  trashedAt: string | null
  duration: number | null
  pages: number | null
  poster: { url: string; width: number; height: number } | null
  original: OriginalFile | null
  raw: { title: string; caption: string; description: string }
  author: { id: number; name: string }
  edited: boolean
  editedAt: string | null
  undoable: boolean
  restorable: boolean
  sizesPending: boolean
  usageCount: number | null
}

/** Keys of the `wpu` field and the track whose provider fills them. */
export const WPU_FIELD_PROVIDERS = {
  kind: 'P1',
  width: 'P1',
  height: 'P1',
  filesize: 'P1',
  folder: 'P1',
  perms: 'P1',
  trashedAt: 'P1',
  duration: 'P1',
  pages: 'P1',
  poster: 'P1',
  original: 'P1',
  raw: 'P1',
  author: 'P1',
  edited: 'P2',
  editedAt: 'P2',
  undoable: 'P2',
  restorable: 'P2',
  sizesPending: 'P2',
  usageCount: 'P2',
} as const satisfies Record<keyof WpuField, 'P1' | 'P2'>
