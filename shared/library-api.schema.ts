// zod schemas for every DTO in library-api.ts and plugin-api.ts.
//
// Only tests and mocks import this file (it depends on zod, which the server's
// production image doesn't install). Each schema is checked at the type level
// against its hand-written type at the bottom of this file, so the two can't
// drift: change a type without its schema (or the reverse) and the typecheck
// fails.

import { z } from 'zod'
import type * as Api from './library-api.ts'
import {
  ALT_FILTERS,
  DELETE_MODES,
  EDIT_TARGETS,
  FOLDER_PARAM_PATTERN,
  INDEX_STATES,
  ITEM_VIEWS,
  JOB_STATES,
  LIMITS,
  MEDIA_KINDS,
  MONTH_PATTERN,
  ORIENTATIONS,
  PLUGIN_STATES,
  ROW_STRIDE,
  SIZE_FILTERS,
  SORT_KEYS,
  TYPE_FILTERS,
  USAGE_CONTEXTS,
  WP_STATES,
} from './library-api.ts'
import type * as Plugin from './plugin-api.ts'
import { PLUGIN_INSTALL_MODES } from './plugin-api.ts'

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

const id = z.number().int().positive()
const count = z.number().int().nonnegative()
/** ISO 8601 UTC, whole seconds, `Z` suffix */
const isoTime = z
  .string()
  .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/)
const rev = z.string().regex(/^[0-9]+$/)
const url = z.url()
const month = z.string().regex(new RegExp(MONTH_PATTERN))
const color = z.string().regex(/^#[0-9a-f]{6}$/)
const version = z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/)
const apiLevel = z.string().regex(/^[0-9]+\.[0-9]+$/)

export const MediaKindSchema = z.enum(MEDIA_KINDS)
export const SortKeySchema = z.enum(SORT_KEYS)
export const TypeFilterSchema = z.enum(TYPE_FILTERS)
export const SizeFilterSchema = z.enum(SIZE_FILTERS)
export const OrientationSchema = z.enum(ORIENTATIONS)
export const AltFilterSchema = z.enum(ALT_FILTERS)
export const UsageContextSchema = z.enum(USAGE_CONTEXTS)
export const WpStateSchema = z.enum(WP_STATES)
export const PluginStateSchema = z.enum(PLUGIN_STATES)
export const IndexStateSchema = z.enum(INDEX_STATES)
export const JobStateSchema = z.enum(JOB_STATES)
export const DeleteModeSchema = z.enum(DELETE_MODES)
export const EditTargetSchema = z.enum(EDIT_TARGETS)
export const ItemViewSchema = z.enum(ITEM_VIEWS)

/** The `folder` URL parameter, before parsing. */
export const FolderParamSchema = z
  .string()
  .regex(new RegExp(FOLDER_PARAM_PATTERN))
export const FolderRefSchema = z.union([
  z.literal('all'),
  z.literal('trash'),
  count,
])

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const ApiErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
})

export const ItemErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
})

export const ItemFailureSchema = z.object({
  id,
  ok: z.literal(false),
  error: ItemErrorSchema,
})

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

export const ImageSourceSchema = z.object({
  url,
  width: count,
  height: count,
})

export const NamedSizeSchema = z.object({
  name: z.string().min(1),
  url,
  width: count,
  height: count,
  mime: z.string(),
  filesize: count.nullable(),
})

export const ItemPermsSchema = z.object({
  edit: z.boolean(),
  delete: z.boolean(),
})

export const TrashStateSchema = z.object({
  trashedAt: isoTime,
  daysLeft: count.nullable(),
})

export const PostRefSchema = z.object({
  postId: id,
  postType: z.string().min(1),
  postTypeLabel: z.string(),
  title: z.string(),
  status: z.string().min(1),
  editUrl: url.nullable(),
  viewUrl: url.nullable(),
})

export const UsageRefSchema = z.object({
  postId: id.nullable(),
  postType: z.string().min(1),
  postTypeLabel: z.string(),
  title: z.string(),
  status: z.string().min(1),
  editUrl: url.nullable(),
  viewUrl: url.nullable(),
  contexts: z.array(UsageContextSchema).min(1),
})

export const WpUserCapsSchema = z.object({
  uploadFiles: z.boolean(),
  editPosts: z.boolean(),
  editOthersPosts: z.boolean(),
  deletePosts: z.boolean(),
  deleteOthersPosts: z.boolean(),
  manageOptions: z.boolean(),
})

export const WpUserSchema = z.object({
  id,
  name: z.string(),
  roles: z.array(z.string()),
  caps: WpUserCapsSchema,
})

export const FileBirdInfoSchema = z.object({
  active: z.boolean(),
  version: z.string(),
  pro: z.boolean(),
  perUser: z.boolean(),
})

export const TrashConfigSchema = z.object({
  enabled: z.boolean(),
  days: count,
})

export const MimeTypeDefSchema = z.object({
  extensions: z.array(z.string().regex(/^[a-z0-9]+$/)).min(1),
  mime: z.string().min(1),
})

export const UploadConfigSchema = z.object({
  maxBytes: count,
  mimes: z.array(MimeTypeDefSchema),
})

export const ImageSizeDefSchema = z.object({
  name: z.string().min(1),
  width: count,
  height: count,
  crop: z.boolean(),
})

export const ImageEditorConfigSchema = z.object({
  mimes: z.array(z.string()),
  bigImageThreshold: count.nullable(),
})

export const IndexPartSchema = z.object({
  state: IndexStateSchema,
  done: count,
  total: count,
})

export const IndexStatusSchema = z.object({
  media: IndexPartSchema,
  usage: IndexPartSchema,
})

// ---------------------------------------------------------------------------
// bootstrap, rev
// ---------------------------------------------------------------------------

export const ChangelogEntrySchema = z.object({
  version,
  date: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/),
  changes: z.array(z.string()),
})

export const BundledPluginSchema = z.object({
  version,
  api: apiLevel,
  features: z.array(z.string()),
  changelog: z.array(ChangelogEntrySchema),
})

export const PluginStatusSchema = z.object({
  state: PluginStateSchema,
  version: version.nullable(),
  api: apiLevel.nullable(),
  features: z.array(z.string()),
  missingFeatures: z.array(z.string()),
  required: z.object({ major: count, minMinor: count }),
  bundled: BundledPluginSchema.nullable(),
  message: z.string().nullable(),
})

export const SiteInfoSchema = z.object({
  user: WpUserSchema,
  filebird: FileBirdInfoSchema.nullable(),
  trash: TrashConfigSchema,
  upload: UploadConfigSchema,
  imageSizes: z.array(ImageSizeDefSchema),
  imageEditor: ImageEditorConfigSchema,
  index: IndexStatusSchema,
})

export const BootstrapSchema = z.object({
  wp: z.object({ state: WpStateSchema, message: z.string().nullable() }),
  plugin: PluginStatusSchema.nullable(),
  site: SiteInfoSchema.nullable(),
  rev: rev.nullable(),
})

export const RevResponseSchema = z.object({
  rev,
  index: IndexStatusSchema,
})

// ---------------------------------------------------------------------------
// collection, facets
// ---------------------------------------------------------------------------

export const CollectionQuerySchema = z.object({
  folder: FolderRefSchema,
  q: z.string().min(1).max(LIMITS.queryLength).nullable(),
  type: TypeFilterSchema.nullable(),
  alt: AltFilterSchema.nullable(),
  size: SizeFilterSchema.nullable(),
  orient: OrientationSchema.nullable(),
  month: month.nullable(),
  sort: SortKeySchema,
})

export const CollectionResponseSchema = z
  .object({
    rev,
    query: CollectionQuerySchema,
    total: count,
    rows: z.array(z.number().int().nonnegative()),
    indexComplete: z.boolean(),
  })
  .refine((value) => value.rows.length === value.total * ROW_STRIDE, {
    message: 'rows must hold exactly 4 numbers per item',
  })

export const TypeCountsSchema = z.object({
  image: count,
  video: count,
  audio: count,
  document: count,
})

export const FacetCountsSchema = z.object({
  total: count,
  bytes: count,
  types: TypeCountsSchema,
  missingAlt: count,
  unused: count,
  editable: count,
})

export const MonthCountSchema = z.object({
  month,
  count: z.number().int().positive(),
})

export const FacetsSchema = z.object({
  rev,
  query: CollectionQuerySchema,
  view: FacetCountsSchema,
  folder: FacetCountsSchema,
  months: z.array(MonthCountSchema),
  indexComplete: z.boolean(),
  usageComplete: z.boolean(),
})

// ---------------------------------------------------------------------------
// items
// ---------------------------------------------------------------------------

const itemBaseShape = {
  id,
  kind: MediaKindSchema,
  mime: z.string().min(1),
  title: z.string(),
  filename: z.string().min(1),
  width: count,
  height: count,
  filesize: count.nullable(),
  alt: z.string(),
  uploadedAt: isoTime,
  modifiedAt: isoTime,
  authorId: id,
  folder: count.nullable(),
  url,
  thumb: ImageSourceSchema.nullable(),
  srcset: z.array(ImageSourceSchema),
  poster: ImageSourceSchema.nullable(),
  duration: z.number().nonnegative().nullable(),
  pages: z.number().int().positive().nullable(),
  sizesPending: z.boolean(),
  perms: ItemPermsSchema,
  trash: TrashStateSchema.nullable(),
}

export const LibraryItemTileSchema = z.object({
  ...itemBaseShape,
  view: z.literal('tile'),
})

export const ExifInfoSchema = z.object({
  camera: z.string().nullable(),
  lens: z.string().nullable(),
  focalLength: z.number().positive().nullable(),
  aperture: z.number().positive().nullable(),
  shutter: z.string().nullable(),
  iso: z.number().int().positive().nullable(),
  takenAt: isoTime.nullable(),
  credit: z.string().nullable(),
  copyright: z.string().nullable(),
  keywords: z.array(z.string()),
})

export const MediaFileInfoSchema = z.object({
  format: z.string().nullable(),
  codec: z.string().nullable(),
  bitrate: count.nullable(),
  sampleRate: count.nullable(),
  channels: count.nullable(),
})

export const OriginalFileSchema = z.object({
  url,
  width: count,
  height: count,
  filename: z.string().min(1),
})

export const LibraryItemFullSchema = z.object({
  ...itemBaseShape,
  view: z.literal('full'),
  caption: z.string(),
  description: z.string(),
  author: z.object({ id, name: z.string() }),
  attachedTo: PostRefSchema.nullable(),
  original: OriginalFileSchema.nullable(),
  sizes: z.array(NamedSizeSchema),
  exif: ExifInfoSchema.nullable(),
  media: MediaFileInfoSchema.nullable(),
  edited: z.boolean(),
  editedAt: isoTime.nullable(),
  undoable: z.boolean(),
  restorable: z.boolean(),
  usageCount: count.nullable(),
  links: z.object({ edit: url, view: url.nullable() }),
})

export const LibraryItemSchema = z.discriminatedUnion('view', [
  LibraryItemTileSchema,
  LibraryItemFullSchema,
])

export const TrashItemSchema = LibraryItemTileSchema.extend({
  trash: TrashStateSchema,
})

export const ItemsTileResponseSchema = z.object({
  rev,
  items: z.array(LibraryItemTileSchema),
  missing: z.array(id),
})

export const ItemsFullResponseSchema = z.object({
  rev,
  items: z.array(LibraryItemFullSchema),
  missing: z.array(id),
})

const metaShape = {
  title: z.string().max(LIMITS.titleLength),
  alt: z.string().max(LIMITS.altLength),
  caption: z.string().max(LIMITS.captionLength),
  description: z.string().max(LIMITS.descriptionLength),
  post: id.nullable(),
}

export const ItemMetaSchema = z.object(metaShape)

export const ItemMetaSnapshotSchema = z.object({
  ...metaShape,
  modifiedAt: isoTime,
})

export const ItemPatchSchema = z
  .object({
    title: metaShape.title.optional(),
    alt: metaShape.alt.optional(),
    caption: metaShape.caption.optional(),
    description: metaShape.description.optional(),
    post: metaShape.post.optional(),
  })
  .strict()

/** A PATCH or batch `set` must change at least one field. */
export const NonEmptyItemPatchSchema = ItemPatchSchema.refine(
  (value) => Object.keys(value).length > 0,
  { message: 'set at least one field' },
)

export const ItemPatchResponseSchema = z.object({
  rev,
  id,
  previous: ItemPatchSchema,
  item: ItemMetaSnapshotSchema,
})

// ---------------------------------------------------------------------------
// items/batch, items/delete, trash
// ---------------------------------------------------------------------------

/**
 * The rules every batch change follows: change at least one field (or
 * append), and never both replace and append the description.
 */
function isValidChange(value: {
  set: Record<string, unknown>
  appendDescription?: string
}): boolean {
  const appends = value.appendDescription !== undefined
  if (appends && value.set.description !== undefined) return false
  return appends || Object.keys(value.set).length > 0
}

const changeRule = {
  message:
    'set at least one field or appendDescription, and not both set.description and appendDescription',
}

export const BatchItemChangeSchema = z
  .object({
    id,
    set: ItemPatchSchema,
    appendDescription: z
      .string()
      .min(1)
      .max(LIMITS.descriptionLength)
      .optional(),
  })
  .strict()
  .refine(isValidChange, changeRule)

export const BatchSameRequestSchema = z
  .object({
    ids: z.array(id).min(1).max(LIMITS.batchItems),
    set: ItemPatchSchema,
    appendDescription: z
      .string()
      .min(1)
      .max(LIMITS.descriptionLength)
      .optional(),
  })
  .strict()
  .refine(isValidChange, changeRule)

export const BatchEachRequestSchema = z
  .object({
    items: z.array(BatchItemChangeSchema).min(1).max(LIMITS.batchItems),
  })
  .strict()

export const BatchRequestSchema = z.union([
  BatchSameRequestSchema,
  BatchEachRequestSchema,
])

export const BatchItemSuccessSchema = z.object({
  id,
  ok: z.literal(true),
  previous: ItemPatchSchema,
  item: ItemMetaSnapshotSchema,
})

export const BatchItemResultSchema = z.union([
  BatchItemSuccessSchema,
  ItemFailureSchema,
])

export const BatchResponseSchema = z.object({
  rev,
  results: z.array(BatchItemResultSchema),
})

export const DeleteRequestSchema = z
  .object({
    ids: z.array(id).min(1).max(LIMITS.deleteIds),
    mode: DeleteModeSchema,
  })
  .strict()

export const DeleteItemSuccessSchema = z.object({
  id,
  ok: z.literal(true),
  trash: TrashStateSchema.nullable(),
})

export const DeleteItemResultSchema = z.union([
  DeleteItemSuccessSchema,
  ItemFailureSchema,
])

export const DeleteResponseSchema = z.object({
  rev,
  results: z.array(DeleteItemResultSchema),
})

export const TrashSummarySchema = z.object({
  rev,
  enabled: z.boolean(),
  days: count,
  count,
  bytes: count,
})

export const RestoreRequestSchema = z
  .object({
    ids: z.array(id).min(1).max(LIMITS.deleteIds),
  })
  .strict()

export const RestoreItemSuccessSchema = z.object({
  id,
  ok: z.literal(true),
  folder: count.nullable(),
})

export const RestoreItemResultSchema = z.union([
  RestoreItemSuccessSchema,
  ItemFailureSchema,
])

export const RestoreResponseSchema = z.object({
  rev,
  results: z.array(RestoreItemResultSchema),
})

export const EmptyTrashResponseSchema = z.object({
  rev,
  deleted: count,
  remaining: count,
  skipped: count,
})

// ---------------------------------------------------------------------------
// usage, posts
// ---------------------------------------------------------------------------

export const ItemUsageSchema = z.object({
  id,
  count,
  refs: z.array(UsageRefSchema).max(200),
})

export const UsageResponseSchema = z.object({
  rev,
  complete: z.boolean(),
  items: z.array(ItemUsageSchema),
})

export const PostsResponseSchema = z.object({
  posts: z.array(PostRefSchema),
})

// ---------------------------------------------------------------------------
// folders
// ---------------------------------------------------------------------------

const folderName = z.string().min(1).max(LIMITS.folderNameLength)

export const FolderSchema = z.object({
  id,
  name: folderName,
  parent: count,
  ord: z.number().int(),
  color: color.nullable(),
  count,
})

export const FolderModeSchema = z.object({
  pro: z.boolean(),
  perUser: z.boolean(),
  readOnly: z.boolean(),
  colorsWritable: z.boolean(),
})

export const FolderTreeSchema = z.object({
  rev,
  mode: FolderModeSchema,
  folders: z.array(FolderSchema),
  counts: z.object({ all: count, uncategorized: count }),
})

export const FolderCreateRequestSchema = z
  .object({
    name: folderName,
    parent: count,
  })
  .strict()

export const FolderUpdateRequestSchema = z
  .object({
    name: folderName.optional(),
    parent: count.optional(),
    position: count.optional(),
    color: color.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'send at least one field',
  })

export const FolderMutationResponseSchema = z.object({
  rev,
  folder: FolderSchema,
  renamed: z.boolean(),
  requestedName: z.string().nullable(),
  tree: FolderTreeSchema,
})

export const FolderDeleteResponseSchema = z.object({
  rev,
  deletedIds: z.array(id).min(1),
  movedFiles: count,
  tree: FolderTreeSchema,
})

export const FolderAssignRequestSchema = z
  .object({
    folder: count,
    ids: z.array(id).min(1).max(LIMITS.assignIds),
  })
  .strict()

export const FolderCountsSchema = z.object({
  all: count,
  uncategorized: count,
  byId: z.record(z.string().regex(/^[1-9][0-9]*$/), count),
})

export const FolderAssignResponseSchema = z.object({
  rev,
  previous: z.array(z.object({ id, folder: count })),
  skipped: z.array(ItemFailureSchema),
  moved: count,
  counts: FolderCountsSchema,
})

// ---------------------------------------------------------------------------
// image operations, jobs
// ---------------------------------------------------------------------------

export const RotateOpSchema = z.object({
  op: z.literal('rotate'),
  angle: z.union([z.literal(90), z.literal(180), z.literal(270)]),
})

export const FlipHOpSchema = z.object({ op: z.literal('flipH') })
export const FlipVOpSchema = z.object({ op: z.literal('flipV') })

export const CropOpSchema = z.object({
  op: z.literal('crop'),
  x: count,
  y: count,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
})

export const EditOpSchema = z.discriminatedUnion('op', [
  RotateOpSchema,
  FlipHOpSchema,
  FlipVOpSchema,
  CropOpSchema,
])

export const EditRequestSchema = z
  .object({
    ops: z.array(EditOpSchema).max(LIMITS.editOps),
    scale: z
      .object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      })
      .strict()
      .optional(),
    applyTo: EditTargetSchema,
    expectedModified: isoTime,
  })
  .strict()
  .refine((value) => value.ops.length > 0 || value.scale !== undefined, {
    message: 'send at least one op or a scale',
  })

export const ExpectedModifiedSchema = z
  .object({ expectedModified: isoTime })
  .strict()

export const RegenerateRequestSchema = z
  .object({
    ids: z.array(id).min(1).max(LIMITS.regenerateIds),
  })
  .strict()

export const JobAcceptedSchema = z.object({ jobId: z.string().min(1) })

export const JobProgressSchema = z.object({
  done: count,
  total: count,
  unit: z.union([z.literal('bytes'), z.literal('items')]),
})

export const FolderAssignmentSchema = z.object({
  id: count,
  assigned: z.boolean(),
  message: z.string().nullable(),
})

export const UploadJobResultSchema = z.object({
  item: LibraryItemTileSchema,
  folder: FolderAssignmentSchema.nullable(),
})

export const ImageJobResultSchema = z.object({
  item: LibraryItemFullSchema,
  sizesRegenerated: count,
  urlChanged: z.boolean(),
})

export const RegenerateItemSuccessSchema = z.object({
  id,
  ok: z.literal(true),
  sizesRegenerated: count,
})

export const RegenerateItemResultSchema = z.union([
  RegenerateItemSuccessSchema,
  ItemFailureSchema,
])

export const RegenerateJobResultSchema = z.object({
  results: z.array(RegenerateItemResultSchema),
})

const jobBaseShape = {
  id: z.string().min(1),
  state: JobStateSchema,
  createdAt: isoTime,
  updatedAt: isoTime,
  progress: JobProgressSchema.nullable(),
  error: ApiErrorSchema.nullable(),
}

export const UploadJobSchema = z.object({
  ...jobBaseShape,
  kind: z.literal('upload'),
  filename: z.string().min(1),
  result: UploadJobResultSchema.nullable(),
})

export const ImageJobSchema = z.object({
  ...jobBaseShape,
  kind: z.enum(['edit', 'edit-undo', 'restore', 'replace']),
  itemId: id,
  result: ImageJobResultSchema.nullable(),
})

export const RegenerateJobSchema = z.object({
  ...jobBaseShape,
  kind: z.literal('regenerate'),
  itemIds: z.array(id).min(1),
  result: RegenerateJobResultSchema.nullable(),
})

export const JobSchema = z.union([
  UploadJobSchema,
  ImageJobSchema,
  RegenerateJobSchema,
])

export const JobNotFoundSchema = z.object({
  id: z.string().min(1),
  state: z.literal('not_found'),
})

export const JobLookupSchema = z.union([JobSchema, JobNotFoundSchema])

export const JobsResponseSchema = z.object({
  jobs: z.array(JobLookupSchema),
})

// ---------------------------------------------------------------------------
// upload
// ---------------------------------------------------------------------------

export const DuplicateMatchSchema = z.object({
  id,
  title: z.string(),
  filename: z.string(),
  thumb: ImageSourceSchema.nullable(),
})

export const UploadCheckResponseSchema = z.object({
  duplicate: z.boolean(),
  matches: z.array(DuplicateMatchSchema).max(LIMITS.duplicateMatches),
})

// ---------------------------------------------------------------------------
// Plugin-only wire types (plugin-api.ts)
// ---------------------------------------------------------------------------

export const PluginInfoSchema = z.object({
  plugin: z.literal('wp-upload-companion'),
  version,
  api: apiLevel,
  features: z.array(z.string()),
  install: z.enum(PLUGIN_INSTALL_MODES),
  wpVersion: z.string(),
  user: WpUserSchema,
  filebird: FileBirdInfoSchema.nullable(),
  trash: TrashConfigSchema,
  upload: UploadConfigSchema,
  imageSizes: z.array(ImageSizeDefSchema),
  imageEditor: ImageEditorConfigSchema,
  index: IndexStatusSchema,
  rev,
})

/** The part of `/info` every plugin build has, compatible or not. */
export const PluginIdentitySchema = z.object({
  plugin: z.literal('wp-upload-companion'),
  version,
  api: apiLevel,
  features: z.array(z.string()),
})

export const WpRestErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  data: z
    .looseObject({ status: z.number().int().optional() })
    .nullable()
    .optional(),
})

const remaining = z.array(id)

export const PluginMediaBatchRequestSchema = z
  .object({
    items: z.array(BatchItemChangeSchema).min(1).max(LIMITS.batchItems),
  })
  .strict()

export const PluginMediaBatchResponseSchema = z.object({
  rev,
  results: z.array(BatchItemResultSchema),
  remaining,
})

export const PluginDeleteResponseSchema = z.object({
  rev,
  results: z.array(DeleteItemResultSchema),
  remaining,
})

export const PluginRestoreResponseSchema = z.object({
  rev,
  results: z.array(RestoreItemResultSchema),
  remaining,
})

export const PluginEmptyTrashRequestSchema = z
  .object({
    budgetMs: z.number().int().min(100).max(20_000).optional(),
  })
  .strict()

export const PluginImageOpResponseSchema = z.object({
  rev,
  id,
  modifiedAt: isoTime,
  width: count,
  height: count,
  mime: z.string(),
  sizesRegenerated: count,
  urlChanged: z.boolean(),
  edited: z.boolean(),
  undoable: z.boolean(),
  restorable: z.boolean(),
})

export const PluginMaintenanceRequestSchema = z
  .object({
    budgetMs: z.number().int().min(100).max(20_000).optional(),
  })
  .strict()

export const PluginMaintenanceResponseSchema = z.object({
  rev,
  locked: z.boolean(),
  did: z.object({ media: count, usage: count, folders: count }),
  more: z.boolean(),
  index: IndexStatusSchema,
})

export const WpuFieldSchema = z.object({
  kind: MediaKindSchema,
  width: count,
  height: count,
  filesize: count.nullable(),
  folder: count.nullable(),
  perms: ItemPermsSchema,
  trashedAt: isoTime.nullable(),
  duration: z.number().nonnegative().nullable(),
  pages: z.number().int().positive().nullable(),
  poster: ImageSourceSchema.nullable(),
  original: OriginalFileSchema.nullable(),
  raw: z.object({
    title: z.string(),
    caption: z.string(),
    description: z.string(),
  }),
  author: z.object({ id, name: z.string() }),
  edited: z.boolean(),
  editedAt: isoTime.nullable(),
  undoable: z.boolean(),
  restorable: z.boolean(),
  sizesPending: z.boolean(),
  usageCount: count.nullable(),
})

// ---------------------------------------------------------------------------
// Type-level drift check: each schema's inferred type must be *identical* to
// the hand-written type. A mismatch makes `Check<…>` fail to typecheck.
// ---------------------------------------------------------------------------

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false
type Check<T extends true> = T
type Same<S extends z.ZodType, T> = Equal<z.infer<S>, T>

export type SchemaDriftChecks = [
  Check<Same<typeof ApiErrorSchema, Api.ApiError>>,
  Check<Same<typeof ItemErrorSchema, Api.ItemError>>,
  Check<Same<typeof ItemFailureSchema, Api.ItemFailure>>,
  Check<Same<typeof FolderRefSchema, Api.FolderRef>>,
  Check<Same<typeof ImageSourceSchema, Api.ImageSource>>,
  Check<Same<typeof NamedSizeSchema, Api.NamedSize>>,
  Check<Same<typeof ItemPermsSchema, Api.ItemPerms>>,
  Check<Same<typeof TrashStateSchema, Api.TrashState>>,
  Check<Same<typeof PostRefSchema, Api.PostRef>>,
  Check<Same<typeof UsageRefSchema, Api.UsageRef>>,
  Check<Same<typeof WpUserCapsSchema, Api.WpUserCaps>>,
  Check<Same<typeof WpUserSchema, Api.WpUser>>,
  Check<Same<typeof FileBirdInfoSchema, Api.FileBirdInfo>>,
  Check<Same<typeof TrashConfigSchema, Api.TrashConfig>>,
  Check<Same<typeof MimeTypeDefSchema, Api.MimeTypeDef>>,
  Check<Same<typeof UploadConfigSchema, Api.UploadConfig>>,
  Check<Same<typeof ImageSizeDefSchema, Api.ImageSizeDef>>,
  Check<Same<typeof ImageEditorConfigSchema, Api.ImageEditorConfig>>,
  Check<Same<typeof IndexPartSchema, Api.IndexPart>>,
  Check<Same<typeof IndexStatusSchema, Api.IndexStatus>>,
  Check<Same<typeof ChangelogEntrySchema, Api.ChangelogEntry>>,
  Check<Same<typeof BundledPluginSchema, Api.BundledPlugin>>,
  Check<Same<typeof PluginStatusSchema, Api.PluginStatus>>,
  Check<Same<typeof SiteInfoSchema, Api.SiteInfo>>,
  Check<Same<typeof BootstrapSchema, Api.Bootstrap>>,
  Check<Same<typeof RevResponseSchema, Api.RevResponse>>,
  Check<Same<typeof CollectionQuerySchema, Api.CollectionQuery>>,
  Check<Same<typeof CollectionResponseSchema, Api.CollectionResponse>>,
  Check<Same<typeof TypeCountsSchema, Api.TypeCounts>>,
  Check<Same<typeof FacetCountsSchema, Api.FacetCounts>>,
  Check<Same<typeof MonthCountSchema, Api.MonthCount>>,
  Check<Same<typeof FacetsSchema, Api.Facets>>,
  Check<Same<typeof LibraryItemTileSchema, Api.LibraryItemTile>>,
  Check<Same<typeof ExifInfoSchema, Api.ExifInfo>>,
  Check<Same<typeof MediaFileInfoSchema, Api.MediaFileInfo>>,
  Check<Same<typeof OriginalFileSchema, Api.OriginalFile>>,
  Check<Same<typeof LibraryItemFullSchema, Api.LibraryItemFull>>,
  Check<Same<typeof LibraryItemSchema, Api.LibraryItem>>,
  Check<Same<typeof TrashItemSchema, Api.TrashItem>>,
  Check<Same<typeof ItemsTileResponseSchema, Api.ItemsTileResponse>>,
  Check<Same<typeof ItemsFullResponseSchema, Api.ItemsFullResponse>>,
  Check<Same<typeof ItemMetaSchema, Api.ItemMeta>>,
  Check<Same<typeof ItemMetaSnapshotSchema, Api.ItemMetaSnapshot>>,
  Check<Same<typeof ItemPatchSchema, Api.ItemPatch>>,
  Check<Same<typeof ItemPatchResponseSchema, Api.ItemPatchResponse>>,
  Check<Same<typeof BatchItemChangeSchema, Api.BatchItemChange>>,
  Check<Same<typeof BatchSameRequestSchema, Api.BatchSameRequest>>,
  Check<Same<typeof BatchEachRequestSchema, Api.BatchEachRequest>>,
  Check<Same<typeof BatchRequestSchema, Api.BatchRequest>>,
  Check<Same<typeof BatchItemSuccessSchema, Api.BatchItemSuccess>>,
  Check<Same<typeof BatchItemResultSchema, Api.BatchItemResult>>,
  Check<Same<typeof BatchResponseSchema, Api.BatchResponse>>,
  Check<Same<typeof DeleteRequestSchema, Api.DeleteRequest>>,
  Check<Same<typeof DeleteItemSuccessSchema, Api.DeleteItemSuccess>>,
  Check<Same<typeof DeleteItemResultSchema, Api.DeleteItemResult>>,
  Check<Same<typeof DeleteResponseSchema, Api.DeleteResponse>>,
  Check<Same<typeof TrashSummarySchema, Api.TrashSummary>>,
  Check<Same<typeof RestoreRequestSchema, Api.RestoreRequest>>,
  Check<Same<typeof RestoreItemSuccessSchema, Api.RestoreItemSuccess>>,
  Check<Same<typeof RestoreItemResultSchema, Api.RestoreItemResult>>,
  Check<Same<typeof RestoreResponseSchema, Api.RestoreResponse>>,
  Check<Same<typeof EmptyTrashResponseSchema, Api.EmptyTrashResponse>>,
  Check<Same<typeof ItemUsageSchema, Api.ItemUsage>>,
  Check<Same<typeof UsageResponseSchema, Api.UsageResponse>>,
  Check<Same<typeof PostsResponseSchema, Api.PostsResponse>>,
  Check<Same<typeof FolderSchema, Api.Folder>>,
  Check<Same<typeof FolderModeSchema, Api.FolderMode>>,
  Check<Same<typeof FolderTreeSchema, Api.FolderTree>>,
  Check<Same<typeof FolderCreateRequestSchema, Api.FolderCreateRequest>>,
  Check<Same<typeof FolderUpdateRequestSchema, Api.FolderUpdateRequest>>,
  Check<Same<typeof FolderMutationResponseSchema, Api.FolderMutationResponse>>,
  Check<Same<typeof FolderDeleteResponseSchema, Api.FolderDeleteResponse>>,
  Check<Same<typeof FolderAssignRequestSchema, Api.FolderAssignRequest>>,
  Check<Same<typeof FolderCountsSchema, Api.FolderCounts>>,
  Check<Same<typeof FolderAssignResponseSchema, Api.FolderAssignResponse>>,
  Check<Same<typeof RotateOpSchema, Api.RotateOp>>,
  Check<Same<typeof FlipHOpSchema, Api.FlipHOp>>,
  Check<Same<typeof FlipVOpSchema, Api.FlipVOp>>,
  Check<Same<typeof CropOpSchema, Api.CropOp>>,
  Check<Same<typeof EditOpSchema, Api.EditOp>>,
  Check<Same<typeof EditRequestSchema, Api.EditRequest>>,
  Check<Same<typeof ExpectedModifiedSchema, Api.ExpectedModified>>,
  Check<Same<typeof RegenerateRequestSchema, Api.RegenerateRequest>>,
  Check<Same<typeof JobAcceptedSchema, Api.JobAccepted>>,
  Check<Same<typeof JobProgressSchema, Api.JobProgress>>,
  Check<Same<typeof FolderAssignmentSchema, Api.FolderAssignment>>,
  Check<Same<typeof UploadJobResultSchema, Api.UploadJobResult>>,
  Check<Same<typeof ImageJobResultSchema, Api.ImageJobResult>>,
  Check<Same<typeof RegenerateItemSuccessSchema, Api.RegenerateItemSuccess>>,
  Check<Same<typeof RegenerateItemResultSchema, Api.RegenerateItemResult>>,
  Check<Same<typeof RegenerateJobResultSchema, Api.RegenerateJobResult>>,
  Check<Same<typeof UploadJobSchema, Api.UploadJob>>,
  Check<Same<typeof ImageJobSchema, Api.ImageJob>>,
  Check<Same<typeof RegenerateJobSchema, Api.RegenerateJob>>,
  Check<Same<typeof JobSchema, Api.Job>>,
  Check<Same<typeof JobNotFoundSchema, Api.JobNotFound>>,
  Check<Same<typeof JobLookupSchema, Api.JobLookup>>,
  Check<Same<typeof JobsResponseSchema, Api.JobsResponse>>,
  Check<Same<typeof DuplicateMatchSchema, Api.DuplicateMatch>>,
  Check<Same<typeof UploadCheckResponseSchema, Api.UploadCheckResponse>>,
  Check<Same<typeof PluginInfoSchema, Plugin.PluginInfo>>,
  Check<Same<typeof WpRestErrorSchema, Plugin.WpRestError>>,
  Check<
    Same<typeof PluginMediaBatchRequestSchema, Plugin.PluginMediaBatchRequest>
  >,
  Check<
    Same<typeof PluginMediaBatchResponseSchema, Plugin.PluginMediaBatchResponse>
  >,
  Check<Same<typeof PluginDeleteResponseSchema, Plugin.PluginDeleteResponse>>,
  Check<Same<typeof PluginRestoreResponseSchema, Plugin.PluginRestoreResponse>>,
  Check<
    Same<typeof PluginEmptyTrashRequestSchema, Plugin.PluginEmptyTrashRequest>
  >,
  Check<Same<typeof PluginImageOpResponseSchema, Plugin.PluginImageOpResponse>>,
  Check<
    Same<typeof PluginMaintenanceRequestSchema, Plugin.PluginMaintenanceRequest>
  >,
  Check<
    Same<
      typeof PluginMaintenanceResponseSchema,
      Plugin.PluginMaintenanceResponse
    >
  >,
  Check<Same<typeof WpuFieldSchema, Plugin.WpuField>>,
]
