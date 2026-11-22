// Types and constants for the media manager's `/api/library/*` contract.
//
// The contract itself is docs/media-manager/contracts/server-api.md; this file
// mirrors it, and docs win if the two ever disagree (then fix this file).
//
// Runtime rule (implementation plan §2.3): the server imports this file at
// runtime, so it must stay dependency-free. Only types and `as const` lists
// live here: no enums (`erasableSyntaxOnly`), no functions, no imports of
// packages. Importers use relative paths: `.ts` extensions on the server, none
// on the client.
//
// Conventions used throughout:
// - JSON keys are camelCase.
// - Times are ISO 8601 UTC strings with a `Z` suffix and whole seconds,
//   e.g. "2026-11-22T10:15:00Z".
// - Ids are positive integers. Folder id 0 means Uncategorized.
// - `rev` is an opaque string: compare it for equality only.
// - "Additive only": fields are never renamed or removed; new optional
//   fields may appear, so consumers must ignore unknown keys.

// ---------------------------------------------------------------------------
// Media kinds and filters
// ---------------------------------------------------------------------------

/**
 * What kind of thing an item is, derived from its MIME type (see
 * server-api.md "Media kinds"). The position in this list is the numeric
 * `kind` code used in collection rows, so the order is frozen: new kinds are
 * appended, and consumers treat unknown codes as `other`.
 */
export const MEDIA_KINDS = [
  'image',
  'svg',
  'video',
  'audio',
  'document',
  'archive',
  'other',
] as const
export type MediaKind = (typeof MEDIA_KINDS)[number]

/** Kinds that have alt text and count for the "missing alt" filter. */
export const IMAGE_LIKE_KINDS = ['image', 'svg'] as const

/** The `type` URL/query parameter (interaction-spec §1). */
export const TYPE_FILTERS = ['image', 'video', 'audio', 'document'] as const
export type TypeFilter = (typeof TYPE_FILTERS)[number]

/** Which kinds each `type` filter matches. */
export const TYPE_FILTER_KINDS = {
  image: ['image', 'svg'],
  video: ['video'],
  audio: ['audio'],
  document: ['document', 'archive', 'other'],
} as const satisfies Record<TypeFilter, readonly MediaKind[]>

/** The `sort` parameter. The first entry is the default. */
export const SORT_KEYS = [
  'date-desc',
  'date-asc',
  'title-asc',
  'name-asc',
  'size-desc',
  'size-asc',
  'dimensions-desc',
  'type-asc',
] as const
export type SortKey = (typeof SORT_KEYS)[number]
export const DEFAULT_SORT = 'date-desc' satisfies SortKey

/** The `size` filter: strictly larger than this many bytes (decimal MB). */
export const SIZE_FILTER_BYTES = {
  gt1: 1_000_000,
  gt5: 5_000_000,
} as const
export const SIZE_FILTERS = ['gt1', 'gt5'] as const
export type SizeFilter = (typeof SIZE_FILTERS)[number]

/**
 * The `orient` filter. With r = width / height: landscape r > 1.1,
 * portrait r < 0.9, square otherwise. Items with an unknown dimension
 * (width or height 0) never match any orientation.
 */
export const ORIENTATIONS = ['landscape', 'portrait', 'square'] as const
export type Orientation = (typeof ORIENTATIONS)[number]
export const ORIENTATION_RATIO = {
  landscapeAbove: 1.1,
  portraitBelow: 0.9,
} as const

/** The `alt` filter has one value. */
export const ALT_FILTERS = ['missing'] as const
export type AltFilter = (typeof ALT_FILTERS)[number]

/** `month` is `YYYY-MM`, in the site's time zone (like wp-admin). */
export const MONTH_PATTERN = '^[0-9]{4}-(0[1-9]|1[0-2])$'

/**
 * The `folder` parameter as it appears in URLs: `all` (default), `trash`,
 * `0` (Uncategorized) or a positive folder id.
 */
export const FOLDER_PARAM_PATTERN = '^(all|trash|0|[1-9][0-9]*)$'

/** A parsed `folder` value: 0 is Uncategorized. */
export type FolderRef = 'all' | 'trash' | number

/** Usage contexts reported by the companion plugin's usage index. */
export const USAGE_CONTEXTS = [
  'featured',
  'image-block',
  'gallery-block',
  'file-block',
  'cover-block',
  'media-text',
  'video-block',
  'audio-block',
  'content',
  'shortcode-gallery',
  'site-logo',
  'site-icon',
] as const
export type UsageContext = (typeof USAGE_CONTEXTS)[number]

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

/** `bootstrap.wp.state`. */
export const WP_STATES = ['ok', 'unreachable', 'auth_failed'] as const
export type WpState = (typeof WP_STATES)[number]

/** `bootstrap.plugin.state` (implementation plan §2.6). */
export const PLUGIN_STATES = [
  'ok',
  'missing',
  'forbidden',
  'outdated',
  'too-new',
  'update-available',
] as const
export type PluginState = (typeof PLUGIN_STATES)[number]

/** Plugin states in which the app runs (all others block with a screen). */
export const PLUGIN_USABLE_STATES = ['ok', 'update-available'] as const

/**
 * Optional capabilities a plugin build can advertise in `features[]`.
 * API level 1.0 implies all of these; later additions are appended here.
 */
export const PLUGIN_FEATURES = [
  'collection',
  'facets',
  'media-batch',
  'trash',
  'usage',
  'image-edit',
  'image-regenerate',
  'image-replace',
  'folders',
  'folder-colors',
  'maintenance',
] as const
export type PluginFeature = (typeof PLUGIN_FEATURES)[number]

/** State of one of the plugin's index tables. */
export const INDEX_STATES = ['ready', 'building', 'stale'] as const
export type IndexState = (typeof INDEX_STATES)[number]

export const JOB_KINDS = [
  'upload',
  'edit',
  'edit-undo',
  'restore',
  'replace',
  'regenerate',
] as const
export type JobKind = (typeof JOB_KINDS)[number]

/**
 * - `queued`: waiting for a slot in the server's WordPress concurrency budget.
 * - `running`: talking to WordPress (an upload is sending bytes).
 * - `processing`: uploads only: every byte is sent and WordPress is
 *   generating sub-sizes, which can take minutes.
 * - `succeeded` / `failed`: final. Kept for 10 minutes, then `not_found`.
 */
export const JOB_STATES = [
  'queued',
  'running',
  'processing',
  'succeeded',
  'failed',
] as const
export type JobState = (typeof JOB_STATES)[number]
export const JOB_FINAL_STATES = ['succeeded', 'failed'] as const

export const DELETE_MODES = ['trash', 'delete'] as const
export type DeleteMode = (typeof DELETE_MODES)[number]

/** `applyTo` of an in-place image edit (wp-admin parity). */
export const EDIT_TARGETS = ['all', 'thumbnail', 'nothumb'] as const
export type EditTarget = (typeof EDIT_TARGETS)[number]

export const EDIT_OPS = ['rotate', 'flipH', 'flipV', 'crop'] as const
export type EditOpName = (typeof EDIT_OPS)[number]
export const ROTATE_ANGLES = [90, 180, 270] as const
export type RotateAngle = (typeof ROTATE_ANGLES)[number]

export const ITEM_VIEWS = ['tile', 'full'] as const
export type ItemView = (typeof ITEM_VIEWS)[number]

export const DOWNLOAD_VARIANTS = ['file', 'original'] as const
export type DownloadVariant = (typeof DOWNLOAD_VARIANTS)[number]

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Error codes the server itself produces (server-api.md "Errors"). */
export const SERVER_ERROR_CODES = [
  'unauthorized',
  'cross_site_request',
  'invalid_request',
  'invalid_json',
  'invalid_request_body',
  'not_found',
  'file_too_large',
  'upload_error',
  'job_not_found',
  'plugin_missing',
  'plugin_incompatible',
  'feature_unavailable',
  'plugin_not_bundled',
  'forbidden',
  'wp_auth_failed',
  'wp_unreachable',
  'wp_timeout',
  'wp_redirect',
  'wp_unexpected_response',
  'wp_error',
  'internal_error',
] as const

/** Error codes of the companion plugin (plugin-api.md "Errors"). */
export const PLUGIN_ERROR_CODES = [
  'wpu_forbidden',
  'wpu_invalid_param',
  'wpu_not_found',
  'wpu_folder_not_found',
  'wpu_post_not_found',
  'wpu_invalid_parent',
  'wpu_too_many_items',
  'wpu_collection_too_large',
  'wpu_stale',
  'wpu_locked',
  'wpu_filebird_inactive',
  'wpu_filebird_per_user',
  'wpu_folder_cycle',
  'wpu_invalid_folder_name',
  'wpu_folder_name_exhausted',
  'wpu_pro_required',
  'wpu_trash_disabled',
  'wpu_not_trashed',
  'wpu_unsupported_type',
  'wpu_mime_mismatch',
  'wpu_file_too_large',
  'wpu_invalid_edit',
  'wpu_nothing_to_undo',
  'wpu_not_edited',
  'wpu_image_error',
  'wpu_io_error',
  'wpu_time_budget',
  'wpu_not_implemented',
  'wpu_internal',
] as const

export const ERROR_CODES = [
  ...SERVER_ERROR_CODES,
  ...PLUGIN_ERROR_CODES,
] as const
export type ServerErrorCode = (typeof SERVER_ERROR_CODES)[number]
export type PluginErrorCode = (typeof PLUGIN_ERROR_CODES)[number]
/**
 * Every code this contract defines. `ApiError.code` is typed `string`
 * because WordPress core codes (e.g. `rest_upload_sideload_error` on a 409,
 * 413 or 415) are passed through too; compare against these lists.
 */
export type ErrorCode = (typeof ERROR_CODES)[number]

/** The body of every non-2xx JSON response from `/api/library/*`. */
export interface ApiError {
  code: string
  message: string
  details?: Record<string, unknown>
}

/** The error of one item inside a per-item result list. */
export interface ItemError {
  code: string
  message: string
}

/** A failed entry in any per-item result list. */
export interface ItemFailure {
  id: number
  ok: false
  error: ItemError
}

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/** Every limit of the contract. Over a limit, requests get 400 `invalid_request`. */
export const LIMITS = {
  /** `items?ids=` */
  itemIds: 100,
  /** `items/batch` entries */
  batchItems: 100,
  /** `items/delete` and `trash/restore` ids */
  deleteIds: 100,
  /** `usage?ids=` */
  usageIds: 100,
  /** `jobs?ids=` and `upload/jobs?ids=` */
  jobIds: 100,
  /** `items/regenerate` ids */
  regenerateIds: 1000,
  /** `folders/assign` ids */
  assignIds: 5000,
  /** `posts?limit=` */
  postsLimit: 20,
  /** `upload/check` matches returned */
  duplicateMatches: 5,
  /** characters, after trimming */
  queryLength: 200,
  folderNameLength: 200,
  titleLength: 1000,
  altLength: 1000,
  captionLength: 5000,
  descriptionLength: 65535,
  /** operations in one image edit */
  editOps: 20,
  /** rows in one collection (beyond: 422 `wpu_collection_too_large`) */
  collectionRows: 250_000,
  /** JSON request bodies, in bytes (beyond: 413 `invalid_request_body`) */
  jsonBodyBytes: 4 * 1024 * 1024,
  /** a finished job stays readable this long, in milliseconds */
  finishedJobTtlMs: 10 * 60_000,
} as const

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------

/** One renderable image file. */
export interface ImageSource {
  url: string
  width: number
  height: number
}

/** A generated WordPress image size, as listed in the inspector's Sizes. */
export interface NamedSize {
  /** WordPress size name (`thumbnail`, `medium`, …), or `full` */
  name: string
  url: string
  width: number
  height: number
  mime: string
  filesize: number | null
}

/** What the WordPress user may do with one item. */
export interface ItemPerms {
  edit: boolean
  delete: boolean
}

/** Set when an item is in the Trash. */
export interface TrashState {
  trashedAt: string
  /** Days until WordPress purges it (EMPTY_TRASH_DAYS based); null when EMPTY_TRASH_DAYS is 0 (no purge). */
  daysLeft: number | null
}

/** A post, page or other entry that media can be attached to or used in. */
export interface PostRef {
  postId: number
  /** post type slug, e.g. `post`, `page` */
  postType: string
  /** singular label, e.g. "Post", "Page" */
  postTypeLabel: string
  /** plain text; "(no title)" when empty */
  title: string
  /** post status, e.g. `publish`, `draft`, `private` */
  status: string
  /**
   * wp-admin edit URL; null when the WordPress user is known not to be able to
   * edit it (usage refs). `posts` results always carry it (core search can't tell).
   */
  editUrl: string | null
  /** public URL; null when not viewable */
  viewUrl: string | null
}

/**
 * One place an item is used. Site-level uses (`site-logo`, `site-icon`) have
 * `postId: null` and `postType: "site"`.
 */
export interface UsageRef {
  postId: number | null
  postType: string
  postTypeLabel: string
  title: string
  status: string
  editUrl: string | null
  viewUrl: string | null
  contexts: UsageContext[]
}

export interface WpUserCaps {
  uploadFiles: boolean
  editPosts: boolean
  editOthersPosts: boolean
  deletePosts: boolean
  deleteOthersPosts: boolean
  manageOptions: boolean
}

/** The WordPress user behind the Application Password. */
export interface WpUser {
  id: number
  name: string
  roles: string[]
  caps: WpUserCaps
}

export interface FileBirdInfo {
  /** false: installed but inactive (folder UI off, like `filebird: null`) */
  active: boolean
  version: string
  pro: boolean
  perUser: boolean
}

export interface TrashConfig {
  /** MEDIA_TRASH is on and EMPTY_TRASH_DAYS > 0 */
  enabled: boolean
  /** EMPTY_TRASH_DAYS */
  days: number
}

export interface MimeTypeDef {
  /** lowercase, without dots, e.g. ["jpg", "jpeg", "jpe"] */
  extensions: string[]
  mime: string
}

export interface UploadConfig {
  /** effective limit: the smaller of WordPress's and this server's */
  maxBytes: number
  mimes: MimeTypeDef[]
}

export interface ImageSizeDef {
  name: string
  width: number
  height: number
  crop: boolean
}

export interface ImageEditorConfig {
  /** MIME types the site's image editor can edit in place */
  mimes: string[]
  /** `big_image_size_threshold`, or null when disabled */
  bigImageThreshold: number | null
}

export interface IndexPart {
  state: IndexState
  /** items (media) or posts (usage) indexed so far */
  done: number
  total: number
}

export interface IndexStatus {
  media: IndexPart
  usage: IndexPart
}

// ---------------------------------------------------------------------------
// GET bootstrap
// ---------------------------------------------------------------------------

export interface ChangelogEntry {
  version: string
  /** YYYY-MM-DD */
  date: string
  changes: string[]
}

/** The plugin zip bundled in this app's image (from its `plugin.json`). */
export interface BundledPlugin {
  version: string
  api: string
  features: string[]
  /** entries newer than the installed version (all of them when missing) */
  changelog: ChangelogEntry[]
}

export interface PluginStatus {
  state: PluginState
  /** installed `WPU_VERSION`; null when missing */
  version: string | null
  /** installed `WPU_API` (`major.minor`); null when missing */
  api: string | null
  features: string[]
  /** optional features this server wants and the plugin lacks */
  missingFeatures: string[]
  required: { major: number; minMinor: number }
  bundled: BundledPlugin | null
  /** human-readable reason for any state other than `ok` */
  message: string | null
}

export interface SiteInfo {
  user: WpUser
  filebird: FileBirdInfo | null
  trash: TrashConfig
  upload: UploadConfig
  imageSizes: ImageSizeDef[]
  imageEditor: ImageEditorConfig
  index: IndexStatus
}

export interface Bootstrap {
  wp: { state: WpState; message: string | null }
  /** null unless `wp.state` is `ok` */
  plugin: PluginStatus | null
  /** null unless `plugin.state` is `ok` or `update-available` */
  site: SiteInfo | null
  rev: string | null
}

// ---------------------------------------------------------------------------
// GET rev
// ---------------------------------------------------------------------------

export interface RevResponse {
  rev: string
  index: IndexStatus
}

// ---------------------------------------------------------------------------
// GET collection, GET facets
// ---------------------------------------------------------------------------

/** The normalised collection query, echoed back with every default filled in. */
export interface CollectionQuery {
  folder: FolderRef
  q: string | null
  type: TypeFilter | null
  alt: AltFilter | null
  size: SizeFilter | null
  orient: Orientation | null
  month: string | null
  sort: SortKey
}

/** Number of entries per item in `CollectionResponse.rows`. */
export const ROW_STRIDE = 4

export interface CollectionResponse {
  rev: string
  query: CollectionQuery
  total: number
  /**
   * Flat `[id, width, height, kindCode, id, width, height, kindCode, …]`, in
   * collection order. `kindCode` indexes MEDIA_KINDS. Width/height 0 = unknown.
   */
  rows: number[]
  /** false while the plugin's media index is still building (see plugin-api.md) */
  indexComplete: boolean
}

export interface TypeCounts {
  image: number
  video: number
  audio: number
  document: number
}

export interface FacetCounts {
  total: number
  /** sum of file sizes, in bytes */
  bytes: number
  types: TypeCounts
  /** image-like items with empty alt text */
  missingAlt: number
  /** items the usage index knows no use of */
  unused: number
  /** items the WordPress user may edit */
  editable: number
}

export interface MonthCount {
  /** YYYY-MM */
  month: string
  count: number
}

export interface Facets {
  rev: string
  query: CollectionQuery
  /** exactly the items `collection` returns for the same query */
  view: FacetCounts
  /** the folder alone, no other filter: type chips, missing-alt chip, alt coverage */
  folder: FacetCounts
  /** months of the folder alone, newest first, only months with items */
  months: MonthCount[]
  indexComplete: boolean
  usageComplete: boolean
}

// ---------------------------------------------------------------------------
// GET items, PATCH items/:id
// ---------------------------------------------------------------------------

interface LibraryItemBase {
  id: number
  kind: MediaKind
  mime: string
  /** plain text */
  title: string
  /** basename of the original upload, e.g. `beach.jpg` (never `-scaled`) */
  filename: string
  /** of the file `url` points to (the `-scaled` file for big images); 0 = unknown */
  width: number
  height: number
  /** bytes of the file `url` points to; null = unknown */
  filesize: number | null
  /** '' when empty */
  alt: string
  uploadedAt: string
  modifiedAt: string
  authorId: number
  /** FileBird folder id (0 = Uncategorized); null without active FileBird */
  folder: number | null
  /** the attached file (what WordPress calls `source_url`) */
  url: string
  /** the `thumbnail` size (usually a 150 px square crop), if generated */
  thumb: ImageSource | null
  /** uncropped renditions, ascending by width, ending with the full file */
  srcset: ImageSource[]
  /** cover image of a video or audio item */
  poster: ImageSource | null
  /** seconds, video and audio */
  duration: number | null
  /** page count, PDFs, when known */
  pages: number | null
  /** WordPress hasn't generated every registered sub-size yet ("Processing") */
  sizesPending: boolean
  perms: ItemPerms
  trash: TrashState | null
}

/** What the grid, filmstrip and selection need (`view=tile`). */
export interface LibraryItemTile extends LibraryItemBase {
  view: 'tile'
}

export interface ExifInfo {
  camera: string | null
  lens: string | null
  /** millimetres */
  focalLength: number | null
  /** f-number */
  aperture: number | null
  /** formatted, e.g. "1/60" or "2s" */
  shutter: string | null
  iso: number | null
  takenAt: string | null
  credit: string | null
  copyright: string | null
  keywords: string[]
}

export interface MediaFileInfo {
  format: string | null
  codec: string | null
  /** bits per second */
  bitrate: number | null
  /** Hz */
  sampleRate: number | null
  channels: number | null
}

export interface OriginalFile {
  url: string
  width: number
  height: number
  filename: string
}

/** Everything the inspector and detail mode need (`view=full`). */
export interface LibraryItemFull extends LibraryItemBase {
  view: 'full'
  /** raw (unrendered) values */
  caption: string
  description: string
  author: { id: number; name: string }
  attachedTo: PostRef | null
  /** the untouched upload when WordPress scaled or rotated it */
  original: OriginalFile | null
  /** every generated size, smallest first, ending with `full` */
  sizes: NamedSize[]
  exif: ExifInfo | null
  media: MediaFileInfo | null
  /** edited in place at least once */
  edited: boolean
  /** when it was last edited in place (the inspector's "edited on"); null if never */
  editedAt: string | null
  /** the last in-place edit can be undone */
  undoable: boolean
  /** the original image can be restored */
  restorable: boolean
  /** posts using it; null while the usage index doesn't cover it yet */
  usageCount: number | null
  links: { edit: string; view: string | null }
}

export type LibraryItem = LibraryItemTile | LibraryItemFull

/** An item in the Trash view (`folder=trash`): `trash` is always set. */
export interface TrashItem extends LibraryItemTile {
  trash: TrashState
}

export interface ItemsTileResponse {
  rev: string
  items: LibraryItemTile[]
  /** requested ids that don't exist (any more) or aren't visible */
  missing: number[]
}

export interface ItemsFullResponse {
  rev: string
  items: LibraryItemFull[]
  missing: number[]
}

/** The editable metadata of an item. `post` is the attached-to post id. */
export interface ItemMeta {
  title: string
  alt: string
  caption: string
  description: string
  post: number | null
}

export interface ItemMetaSnapshot extends ItemMeta {
  modifiedAt: string
}

/** Body of `PATCH items/:id`; at least one field. `post: null` detaches. */
export interface ItemPatch {
  title?: string
  alt?: string
  caption?: string
  description?: string
  post?: number | null
}

export interface ItemPatchResponse {
  rev: string
  id: number
  /** the previous values of the patched fields only */
  previous: ItemPatch
  item: ItemMetaSnapshot
}

// ---------------------------------------------------------------------------
// POST items/batch
// ---------------------------------------------------------------------------

/** One item's change. `appendDescription` adds a paragraph to the description. */
export interface BatchItemChange {
  id: number
  set: ItemPatch
  appendDescription?: string
}

/** The same change for every id (batch edit in the inspector). */
export interface BatchSameRequest {
  ids: number[]
  set: ItemPatch
  appendDescription?: string
}

/** A different change per item (e.g. Undo restoring each previous value). */
export interface BatchEachRequest {
  items: BatchItemChange[]
}

export type BatchRequest = BatchSameRequest | BatchEachRequest

export interface BatchItemSuccess {
  id: number
  ok: true
  previous: ItemPatch
  item: ItemMetaSnapshot
}

export type BatchItemResult = BatchItemSuccess | ItemFailure

export interface BatchResponse {
  rev: string
  results: BatchItemResult[]
}

// ---------------------------------------------------------------------------
// POST items/delete, trash/*
// ---------------------------------------------------------------------------

export interface DeleteRequest {
  ids: number[]
  mode: DeleteMode
}

export interface DeleteItemSuccess {
  id: number
  ok: true
  /** set for mode `trash`, null for `delete` */
  trash: TrashState | null
}

export type DeleteItemResult = DeleteItemSuccess | ItemFailure

export interface DeleteResponse {
  rev: string
  results: DeleteItemResult[]
}

export interface TrashSummary {
  rev: string
  enabled: boolean
  days: number
  count: number
  bytes: number
}

export interface RestoreRequest {
  ids: number[]
}

export interface RestoreItemSuccess {
  id: number
  ok: true
  /** the folder it is back in (FileBird keeps it while trashed) */
  folder: number | null
}

export type RestoreItemResult = RestoreItemSuccess | ItemFailure

export interface RestoreResponse {
  rev: string
  results: RestoreItemResult[]
}

/** One time-budgeted step; call again while `remaining > 0`. */
export interface EmptyTrashResponse {
  rev: string
  deleted: number
  /** trashed items the user may delete that are still there */
  remaining: number
  /** trashed items the user may not delete (Author), left alone */
  skipped: number
}

// ---------------------------------------------------------------------------
// GET usage, GET posts
// ---------------------------------------------------------------------------

export interface ItemUsage {
  id: number
  /** number of distinct places (refs) */
  count: number
  /** at most 200, featured uses first */
  refs: UsageRef[]
}

export interface UsageResponse {
  rev: string
  /** false while the usage index is still building */
  complete: boolean
  items: ItemUsage[]
}

export interface PostsResponse {
  posts: PostRef[]
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

export interface Folder {
  id: number
  /** plain text, never HTML-entity encoded */
  name: string
  /** 0 = top level */
  parent: number
  /** FileBird's sibling order */
  ord: number
  /** `#rrggbb`, or null */
  color: string | null
  /** files directly in it (trash excluded) */
  count: number
}

export interface FolderMode {
  pro: boolean
  perUser: boolean
  /** mutations are refused (per-user mode) */
  readOnly: boolean
  /** colours can be written (Pro detected and plugin feature present) */
  colorsWritable: boolean
}

export interface FolderTree {
  rev: string
  mode: FolderMode
  /** flat, sorted by parent, then ord, then id */
  folders: Folder[]
  counts: { all: number; uncategorized: number }
}

export interface FolderCreateRequest {
  name: string
  /** 0 = top level */
  parent: number
}

/**
 * At least one field. `position` is the 0-based index among the siblings under
 * the (new) parent, counted without the moved folder; larger = last.
 */
export interface FolderUpdateRequest {
  name?: string
  parent?: number
  position?: number
  color?: string | null
}

export interface FolderMutationResponse {
  rev: string
  folder: Folder
  /** the final name differs from the requested one (auto-suffixed) */
  renamed: boolean
  /** the name as requested, when a name was sent */
  requestedName: string | null
  tree: FolderTree
}

export interface FolderDeleteResponse {
  rev: string
  deletedIds: number[]
  /** files that moved to Uncategorized */
  movedFiles: number
  tree: FolderTree
}

export interface FolderAssignRequest {
  /** 0 = Uncategorized (remove from folder) */
  folder: number
  ids: number[]
}

export interface FolderCounts {
  all: number
  uncategorized: number
  /** folder id (as a string key) → direct count */
  byId: Record<string, number>
}

export interface FolderAssignResponse {
  rev: string
  /** the folder each moved item was in before (also for items already there) */
  previous: { id: number; folder: number }[]
  skipped: ItemFailure[]
  /** items whose folder actually changed */
  moved: number
  counts: FolderCounts
}

// ---------------------------------------------------------------------------
// Image operations and jobs
// ---------------------------------------------------------------------------

export interface RotateOp {
  op: 'rotate'
  angle: RotateAngle
}

export interface FlipHOp {
  op: 'flipH'
}

export interface FlipVOp {
  op: 'flipV'
}

/** Pixels in the image as it looks after the preceding ops. */
export interface CropOp {
  op: 'crop'
  x: number
  y: number
  width: number
  height: number
}

export type EditOp = RotateOp | FlipHOp | FlipVOp | CropOp

export interface EditRequest {
  ops: EditOp[]
  /** proportional, down only; applied after the ops */
  scale?: { width: number; height: number }
  applyTo: EditTarget
  /** the item's `modifiedAt` the edit was based on */
  expectedModified: string
}

/** Body of `edit/undo` and `restore` (and a field of `replace`). */
export interface ExpectedModified {
  expectedModified: string
}

export interface RegenerateRequest {
  ids: number[]
}

/** 202 body of every route that starts a job. */
export interface JobAccepted {
  jobId: string
}

export interface JobProgress {
  done: number
  total: number
  unit: 'bytes' | 'items'
}

export interface FolderAssignment {
  id: number
  assigned: boolean
  /** why it couldn't be filed; null when assigned */
  message: string | null
}

export interface UploadJobResult {
  item: LibraryItemTile
  /** null when no folder was requested */
  folder: FolderAssignment | null
}

export interface ImageJobResult {
  /** the item after the operation */
  item: LibraryItemFull
  sizesRegenerated: number
  /** the file URL changed (escape hatch for spikes X2/X3, see plugin-api.md §5.11, §5.15) */
  urlChanged: boolean
}

export interface RegenerateItemSuccess {
  id: number
  ok: true
  sizesRegenerated: number
}

export type RegenerateItemResult = RegenerateItemSuccess | ItemFailure

export interface RegenerateJobResult {
  results: RegenerateItemResult[]
}

export interface UploadJob {
  id: string
  kind: 'upload'
  state: JobState
  createdAt: string
  updatedAt: string
  progress: JobProgress | null
  error: ApiError | null
  filename: string
  result: UploadJobResult | null
}

export interface ImageJob {
  id: string
  kind: 'edit' | 'edit-undo' | 'restore' | 'replace'
  state: JobState
  createdAt: string
  updatedAt: string
  progress: JobProgress | null
  error: ApiError | null
  itemId: number
  result: ImageJobResult | null
}

export interface RegenerateJob {
  id: string
  kind: 'regenerate'
  state: JobState
  createdAt: string
  updatedAt: string
  progress: JobProgress | null
  error: ApiError | null
  itemIds: number[]
  result: RegenerateJobResult | null
}

export type Job = UploadJob | ImageJob | RegenerateJob

export interface JobNotFound {
  id: string
  state: 'not_found'
}

export type JobLookup = Job | JobNotFound

export interface JobsResponse {
  jobs: JobLookup[]
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

export interface DuplicateMatch {
  id: number
  title: string
  filename: string
  thumb: ImageSource | null
}

export interface UploadCheckResponse {
  duplicate: boolean
  matches: DuplicateMatch[]
}

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

export const LIBRARY_REV_HEADER = 'X-Library-Rev'
