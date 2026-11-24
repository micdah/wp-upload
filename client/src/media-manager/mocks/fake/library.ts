// The stateful fake library: what WordPress + FileBird + the companion plugin
// + the server would do, in memory, for one viewer. Every method takes and
// returns contract types (server-api.md) or throws `FakeError`; the MSW
// routes (mocks/routes/) only parse requests and write responses.
//
// Mutations bump `rev` once per request that changed something, like the
// plugin's `wpu_rev`. Jobs settle lazily (jobs.ts); call `tick()` first in
// every request.

import {
  type BatchEachRequest,
  type BatchItemResult,
  type BatchSameRequest,
  type CollectionQuery,
  type CollectionResponse,
  type DeleteItemResult,
  type DeleteRequest,
  type DeleteResponse,
  type DuplicateMatch,
  type EditOp,
  type EditRequest,
  type EmptyTrashResponse,
  type Facets,
  type FileBirdInfo,
  type Folder,
  type FolderAssignment,
  type FolderAssignResponse,
  type FolderCounts,
  type FolderCreateRequest,
  type FolderDeleteResponse,
  type FolderMutationResponse,
  type FolderTree,
  type FolderUpdateRequest,
  type ImageEditorConfig,
  type ImageJobResult,
  type ImageSizeDef,
  type IndexStatus,
  type ItemError,
  type ItemFailure,
  type ItemMetaSnapshot,
  type ItemPatch,
  type ItemPatchResponse,
  type ItemsFullResponse,
  type ItemsTileResponse,
  type ItemView,
  type JobLookup,
  LIMITS,
  MEDIA_KINDS,
  type MediaKind,
  type PostsResponse,
  type RegenerateItemResult,
  type RestoreItemResult,
  type RestoreResponse,
  type RevResponse,
  ROW_STRIDE,
  type SiteInfo,
  type TrashConfig,
  type TrashSummary,
  type UploadCheckResponse,
  type UploadConfig,
  type UsageResponse,
  type WpUser,
} from '../../../../../shared/library-api.ts'
import {
  canDelete,
  canEdit,
  type DtoContext,
  type MediaUrls,
  postRef,
  storedPath,
  toFullDto,
  toTileDto,
  usageRefs,
  type Viewer,
} from './dto.ts'
import {
  type FakeError,
  fakeError,
  itemErrors,
  itemErrorToResponse,
} from './errors.ts'
import { type JobOutcome, JobRegistry } from './jobs.ts'
import { facetCounts, monthCounts, runQuery, searchText } from './query.ts'
import type {
  FakeDataset,
  FakeFolder,
  FakeItem,
  FakePost,
  FakeUser,
} from './types.ts'

export interface FakeLibraryConfig {
  dataset: FakeDataset
  user: WpUser
  /** null: FileBird not installed */
  filebird: FileBirdInfo | null
  trash: TrashConfig
  upload: UploadConfig
  imageSizes: ImageSizeDef[]
  imageEditor: ImageEditorConfig
  /** the plugin's indexes are still building */
  indexing: boolean
  /** the plugin's `features[]` */
  features: readonly string[]
  urls: MediaUrls
  /** ms since epoch; a manual clock in tests */
  clock?: () => number
  /** multiplies every job phase; 0 settles jobs on the next request */
  jobSpeed?: number
  /** the first rev */
  rev?: string
}

/** What the media route serves for a rendition or file. */
export interface MediaFile {
  item: FakeItem
  blob: Blob | null
}

export interface UploadInput {
  name: string
  type: string
  size: number
  blob: Blob
  /** sniffed from the file header when possible */
  width: number
  height: number
}

const EMPTY_TRASH_STEP = 20
const MAX_NAME_SUFFIX = 1000
const DEFAULT_REV = '1795867200000'

/** §5: the kind of a MIME type. */
export function kindOfMime(mime: string): MediaKind {
  if (mime === 'image/svg+xml') {
    return 'svg'
  }
  if (mime.startsWith('image/')) {
    return 'image'
  }
  if (mime.startsWith('video/')) {
    return 'video'
  }
  if (mime.startsWith('audio/')) {
    return 'audio'
  }
  if (
    mime === 'application/pdf' ||
    mime.startsWith('text/') ||
    mime === 'application/rtf' ||
    mime === 'application/msword' ||
    mime.startsWith('application/vnd.ms-') ||
    mime.startsWith('application/vnd.openxmlformats-officedocument.') ||
    mime.startsWith('application/vnd.oasis.opendocument.') ||
    mime.startsWith('application/vnd.apple.')
  ) {
    return 'document'
  }
  if (
    [
      'application/zip',
      'application/x-zip-compressed',
      'application/x-rar-compressed',
      'application/vnd.rar',
      'application/x-7z-compressed',
      'application/gzip',
      'application/x-gzip',
      'application/x-tar',
    ].includes(mime)
  ) {
    return 'archive'
  }
  return 'other'
}

/** Folder names as FileBird stores them: no tags, trimmed, collapsed. */
export function sanitiseFolderName(name: string): string {
  return name
    .replace(/<[^>]*>/g, '')
    .trim()
    .replace(/\s+/g, ' ')
}

export class FakeLibrary {
  readonly config: FakeLibraryConfig
  private readonly itemMap = new Map<number, FakeItem>()
  private readonly folderMap = new Map<number, FakeFolder>()
  private readonly postMap = new Map<number, FakePost>()
  private readonly userMap = new Map<number, FakeUser>()
  private readonly jobs = new JobRegistry()
  private revNumber: number
  private readonly clock: () => number
  private readonly jobSpeed: number

  constructor(config: FakeLibraryConfig) {
    this.config = config
    this.clock = config.clock ?? Date.now
    this.jobSpeed = config.jobSpeed ?? 1
    this.revNumber = Number(config.rev ?? DEFAULT_REV)
    for (const item of config.dataset.items) {
      this.itemMap.set(item.id, item)
    }
    for (const folder of config.dataset.folders) {
      this.folderMap.set(folder.id, folder)
    }
    for (const post of config.dataset.posts) {
      this.postMap.set(post.id, post)
    }
    for (const user of config.dataset.users) {
      this.userMap.set(user.id, user)
    }
    this.userMap.set(config.user.id, {
      id: config.user.id,
      name: config.user.name,
    })
  }

  // -------------------------------------------------------------------------
  // Basics
  // -------------------------------------------------------------------------

  now(): number {
    return this.clock()
  }

  get rev(): string {
    return String(this.revNumber)
  }

  /** A change happened: the plugin bumps `wpu_rev`. */
  bumpRev(): string {
    this.revNumber++
    return this.rev
  }

  /** Settles due jobs. Call at the start of every request. */
  tick(): void {
    this.jobs.tick(this.now())
  }

  get viewer(): Viewer {
    return {
      id: this.config.user.id,
      editOthers: this.config.user.caps.editOthersPosts,
      deleteOthers: this.config.user.caps.deleteOthersPosts,
    }
  }

  get filebirdActive(): boolean {
    return this.config.filebird?.active ?? false
  }

  get perUser(): boolean {
    return this.filebirdActive && (this.config.filebird?.perUser ?? false)
  }

  get pro(): boolean {
    return this.filebirdActive && (this.config.filebird?.pro ?? false)
  }

  private dtoContext(): DtoContext {
    return {
      now: this.now(),
      viewer: this.viewer,
      trashDays: this.config.trash.days,
      filebirdActive: this.filebirdActive,
      usageComplete: !this.config.indexing,
      imageSizes: this.config.imageSizes,
      urls: this.config.urls,
      posts: this.postMap,
      users: this.userMap,
    }
  }

  indexStatus(): IndexStatus {
    const media = this.itemMap.size
    const usage = [...this.postMap.values()].filter(
      (post) => post.status === 'publish',
    ).length
    if (this.config.indexing) {
      return {
        media: {
          state: 'building',
          done: Math.floor(media * 0.4),
          total: media,
        },
        usage: { state: 'building', done: 0, total: usage },
      }
    }
    return {
      media: { state: 'ready', done: media, total: media },
      usage: { state: 'ready', done: usage, total: usage },
    }
  }

  siteInfo(): SiteInfo {
    return {
      user: this.config.user,
      filebird: this.config.filebird,
      trash: this.config.trash,
      upload: this.config.upload,
      imageSizes: this.config.imageSizes,
      imageEditor: this.config.imageEditor,
      index: this.indexStatus(),
    }
  }

  revResponse(): RevResponse {
    return { rev: this.rev, index: this.indexStatus() }
  }

  /** Item records (devtools, tests). */
  item(id: number): FakeItem | undefined {
    return this.itemMap.get(id)
  }

  get itemCount(): number {
    return this.itemMap.size
  }

  // -------------------------------------------------------------------------
  // Collection, facets, items
  // -------------------------------------------------------------------------

  private assertFolderQuery(folder: CollectionQuery['folder']): void {
    if (typeof folder !== 'number') {
      return
    }
    if (!this.filebirdActive) {
      throw fakeError(409, 'wpu_filebird_inactive', 'FileBird is not active.')
    }
    if (folder !== 0 && !this.folderMap.has(folder)) {
      throw fakeError(
        404,
        'wpu_folder_not_found',
        `Folder ${folder} does not exist.`,
      )
    }
  }

  /** Search text per item, dropped whenever the item's text changes. */
  private readonly searchCache = new Map<number, string>()

  private textOf(item: FakeItem): string {
    let text = this.searchCache.get(item.id)
    if (text === undefined) {
      text = searchText(item, storedPath(item))
      this.searchCache.set(item.id, text)
    }
    return text
  }

  private query(query: CollectionQuery, sorted = true): FakeItem[] {
    this.assertFolderQuery(query.folder)
    return runQuery(
      this.itemMap.values(),
      query,
      { textOf: (item) => this.textOf(item) },
      { sorted },
    )
  }

  collection(query: CollectionQuery): CollectionResponse {
    const items = this.query(query)
    if (items.length > LIMITS.collectionRows) {
      throw fakeError(
        422,
        'wpu_collection_too_large',
        'The library is too large to list at once.',
      )
    }
    const rows = new Array<number>(items.length * ROW_STRIDE)
    let offset = 0
    for (const item of items) {
      rows[offset++] = item.id
      rows[offset++] = item.width
      rows[offset++] = item.height
      rows[offset++] = MEDIA_KINDS.indexOf(item.kind)
    }
    return {
      rev: this.rev,
      query,
      total: items.length,
      rows,
      indexComplete: !this.config.indexing,
    }
  }

  facets(query: CollectionQuery): Facets {
    const view = this.query(query, false)
    const folderOnly = this.query(
      {
        folder: query.folder,
        q: null,
        type: null,
        alt: null,
        size: null,
        orient: null,
        month: null,
        sort: 'date-desc',
      },
      false,
    )
    const editable = (item: FakeItem) => canEdit(this.viewer, item)
    return {
      rev: this.rev,
      query,
      view: facetCounts(view, editable),
      folder: facetCounts(folderOnly, editable),
      months: query.folder === 'trash' ? [] : monthCounts(folderOnly),
      indexComplete: !this.config.indexing,
      usageComplete: !this.config.indexing,
    }
  }

  items(ids: readonly number[], view: 'tile'): ItemsTileResponse
  items(ids: readonly number[], view: 'full'): ItemsFullResponse
  items(
    ids: readonly number[],
    view: ItemView,
  ): ItemsTileResponse | ItemsFullResponse
  items(
    ids: readonly number[],
    view: ItemView,
  ): ItemsTileResponse | ItemsFullResponse {
    const context = this.dtoContext()
    const missing: number[] = []
    const found: FakeItem[] = []
    for (const id of ids) {
      const item = this.itemMap.get(id)
      if (item) {
        found.push(item)
      } else {
        missing.push(id)
      }
    }
    if (view === 'full') {
      return {
        rev: this.rev,
        items: found.map((item) => toFullDto(context, item)),
        missing,
      }
    }
    return {
      rev: this.rev,
      items: found.map((item) => toTileDto(context, item)),
      missing,
    }
  }

  // -------------------------------------------------------------------------
  // Metadata
  // -------------------------------------------------------------------------

  private snapshot(item: FakeItem): ItemMetaSnapshot {
    return {
      title: item.title,
      alt: item.alt,
      caption: item.caption,
      description: item.description,
      post: item.postParent,
      modifiedAt: new Date(item.modifiedAt)
        .toISOString()
        .replace(/\.\d{3}Z$/, 'Z'),
    }
  }

  /** Applies one change; returns the previous values or an item error. */
  private applyChange(
    id: number,
    set: ItemPatch,
    appendDescription: string | undefined,
  ): { previous: ItemPatch; item: FakeItem } | ItemError {
    const item = this.itemMap.get(id)
    if (!item) {
      return itemErrors.notFound(id)
    }
    if (!canEdit(this.viewer, item)) {
      return itemErrors.forbiddenEdit()
    }
    if (set.post !== undefined && set.post !== null) {
      if (this.itemMap.has(set.post)) {
        return itemErrors.invalidParent(id)
      }
      if (!this.postMap.has(set.post)) {
        return itemErrors.postNotFound(set.post)
      }
    }
    const previous: ItemPatch = {}
    let changesModified = false
    this.searchCache.delete(id)
    if (set.title !== undefined) {
      previous.title = item.title
      item.title = set.title
      changesModified = true
    }
    if (set.alt !== undefined) {
      previous.alt = item.alt
      item.alt = set.alt
    }
    if (set.caption !== undefined) {
      previous.caption = item.caption
      item.caption = set.caption
      changesModified = true
    }
    if (set.description !== undefined) {
      previous.description = item.description
      item.description = set.description
      changesModified = true
    }
    if (appendDescription !== undefined) {
      previous.description = item.description
      const base = item.description.replace(/\s+$/, '')
      item.description =
        base === '' ? appendDescription : `${base}\n\n${appendDescription}`
      changesModified = true
    }
    if (set.post !== undefined) {
      previous.post = item.postParent
      item.postParent = set.post
      changesModified = true
    }
    // Alt text is post meta: changing only alt leaves `modifiedAt` alone.
    if (changesModified) {
      item.modifiedAt = this.now()
    }
    return { previous, item }
  }

  patchItem(id: number, patch: ItemPatch): ItemPatchResponse {
    const outcome = this.applyChange(id, patch, undefined)
    if ('code' in outcome) {
      throw itemErrorToResponse(outcome)
    }
    return {
      rev: this.bumpRev(),
      id,
      previous: outcome.previous,
      item: this.snapshot(outcome.item),
    }
  }

  batch(request: BatchSameRequest | BatchEachRequest): {
    rev: string
    results: BatchItemResult[]
  } {
    const changes =
      'items' in request
        ? request.items
        : request.ids.map((id) => ({
            id,
            set: request.set,
            appendDescription: request.appendDescription,
          }))
    const results: BatchItemResult[] = []
    let changed = false
    for (const change of changes) {
      const outcome = this.applyChange(
        change.id,
        change.set,
        change.appendDescription,
      )
      if ('code' in outcome) {
        results.push({ id: change.id, ok: false, error: outcome })
        continue
      }
      changed = true
      results.push({
        id: change.id,
        ok: true,
        previous: outcome.previous,
        item: this.snapshot(outcome.item),
      })
    }
    return { rev: changed ? this.bumpRev() : this.rev, results }
  }

  // -------------------------------------------------------------------------
  // Delete, trash
  // -------------------------------------------------------------------------

  deleteItems(request: DeleteRequest): DeleteResponse {
    if (request.mode === 'trash' && !this.config.trash.enabled) {
      throw fakeError(
        409,
        'wpu_trash_disabled',
        'The Trash is not enabled on this site.',
      )
    }
    const context = this.dtoContext()
    const results: DeleteItemResult[] = []
    let changed = false
    for (const id of request.ids) {
      const item = this.itemMap.get(id)
      if (!item) {
        results.push({ id, ok: false, error: itemErrors.notFound(id) })
        continue
      }
      if (!canDelete(this.viewer, item)) {
        results.push({ id, ok: false, error: itemErrors.forbiddenDelete() })
        continue
      }
      changed = true
      if (request.mode === 'delete') {
        this.itemMap.delete(id)
        results.push({ id, ok: true, trash: null })
        continue
      }
      if (item.status !== 'trash') {
        item.status = 'trash'
        item.trashedAt = this.now()
      }
      const trash = toTileDto(context, item).trash
      results.push({ id, ok: true, trash })
    }
    return { rev: changed ? this.bumpRev() : this.rev, results }
  }

  trashSummary(): TrashSummary {
    let count = 0
    let bytes = 0
    for (const item of this.itemMap.values()) {
      if (item.status === 'trash') {
        count++
        bytes += item.filesize ?? 0
      }
    }
    return {
      rev: this.rev,
      enabled: this.config.trash.enabled,
      days: this.config.trash.days,
      count,
      bytes,
    }
  }

  restore(ids: readonly number[]): RestoreResponse {
    const results: RestoreItemResult[] = []
    let changed = false
    for (const id of ids) {
      const item = this.itemMap.get(id)
      if (!item) {
        results.push({ id, ok: false, error: itemErrors.notFound(id) })
        continue
      }
      if (!canDelete(this.viewer, item)) {
        results.push({ id, ok: false, error: itemErrors.forbiddenDelete() })
        continue
      }
      if (item.status !== 'trash') {
        results.push({ id, ok: false, error: itemErrors.notTrashed(id) })
        continue
      }
      item.status = 'inherit'
      item.trashedAt = null
      changed = true
      results.push({
        id,
        ok: true,
        folder: this.filebirdActive ? item.folder : null,
      })
    }
    return { rev: changed ? this.bumpRev() : this.rev, results }
  }

  emptyTrashStep(): EmptyTrashResponse {
    const trashed = [...this.itemMap.values()]
      .filter((item) => item.status === 'trash')
      .sort((a, b) => (a.trashedAt ?? 0) - (b.trashedAt ?? 0) || a.id - b.id)
    const deletable = trashed.filter((item) => canDelete(this.viewer, item))
    const step = deletable.slice(0, EMPTY_TRASH_STEP)
    for (const item of step) {
      this.itemMap.delete(item.id)
    }
    return {
      rev: step.length > 0 ? this.bumpRev() : this.rev,
      deleted: step.length,
      remaining: deletable.length - step.length,
      skipped: trashed.length - deletable.length,
    }
  }

  // -------------------------------------------------------------------------
  // Usage, posts
  // -------------------------------------------------------------------------

  usage(ids: readonly number[]): UsageResponse {
    const context = this.dtoContext()
    return {
      rev: this.rev,
      complete: !this.config.indexing,
      items: ids.map((id) => {
        const item = this.itemMap.get(id)
        if (!item) {
          return { id, count: 0, refs: [] }
        }
        const refs = usageRefs(context, item.usage)
        return { id, count: refs.length, refs: refs.slice(0, 200) }
      }),
    }
  }

  posts(search: string, limit: number): PostsResponse {
    const context = this.dtoContext()
    const needle = search.trim().toLowerCase()
    const posts = [...this.postMap.values()]
      .filter((post) => post.status === 'publish')
      .filter(
        (post) => needle === '' || post.title.toLowerCase().includes(needle),
      )
      .sort((a, b) => b.date - a.date || b.id - a.id)
      .slice(0, limit)
      .map((post) => {
        // Core search can't say whether the user may edit: always a link.
        const ref = postRef(context, post)
        return {
          ...ref,
          editUrl: `${this.config.urls.siteUrl}wp-admin/post.php?post=${post.id}&action=edit`,
        }
      })
    return { posts }
  }

  // -------------------------------------------------------------------------
  // Folders
  // -------------------------------------------------------------------------

  private assertFolders(mutation: boolean): void {
    if (!this.filebirdActive) {
      throw fakeError(409, 'wpu_filebird_inactive', 'FileBird is not active.')
    }
    if (mutation && this.perUser) {
      throw fakeError(
        409,
        'wpu_filebird_per_user',
        'FileBird is set to per-user folders, which this app can’t change.',
      )
    }
  }

  private folderCounts(): FolderCounts {
    const byId: Record<string, number> = {}
    for (const folder of this.folderMap.values()) {
      byId[String(folder.id)] = 0
    }
    let all = 0
    let uncategorized = 0
    for (const item of this.itemMap.values()) {
      if (item.status === 'trash') {
        continue
      }
      all++
      if (item.folder === 0) {
        uncategorized++
      } else {
        const key = String(item.folder)
        if (key in byId) {
          byId[key] = (byId[key] ?? 0) + 1
        }
      }
    }
    return { all, uncategorized, byId }
  }

  private folderDto(folder: FakeFolder, counts: FolderCounts): Folder {
    return {
      id: folder.id,
      name: folder.name,
      parent: folder.parent,
      ord: folder.ord,
      color: this.pro ? folder.color : null,
      count: counts.byId[String(folder.id)] ?? 0,
    }
  }

  folderTree(): FolderTree {
    this.assertFolders(false)
    const counts = this.folderCounts()
    const folders = [...this.folderMap.values()]
      .sort((a, b) => a.parent - b.parent || a.ord - b.ord || a.id - b.id)
      .map((folder) => this.folderDto(folder, counts))
    return {
      rev: this.rev,
      mode: {
        pro: this.pro,
        perUser: this.perUser,
        readOnly: this.perUser,
        colorsWritable:
          this.pro && this.config.features.includes('folder-colors'),
      },
      folders,
      counts: { all: counts.all, uncategorized: counts.uncategorized },
    }
  }

  private siblings(parent: number, except?: number): FakeFolder[] {
    return [...this.folderMap.values()]
      .filter((folder) => folder.parent === parent && folder.id !== except)
      .sort((a, b) => a.ord - b.ord || a.id - b.id)
  }

  /** The name, auto-suffixed "Name (1)" on a clash among siblings. */
  private uniqueName(name: string, parent: number, except?: number): string {
    const taken = new Set(
      this.siblings(parent, except).map((folder) => folder.name.toLowerCase()),
    )
    if (!taken.has(name.toLowerCase())) {
      return name
    }
    for (let suffix = 1; suffix <= MAX_NAME_SUFFIX; suffix++) {
      const candidate = `${name} (${suffix})`
      if (!taken.has(candidate.toLowerCase())) {
        return candidate
      }
    }
    throw fakeError(
      409,
      'wpu_folder_name_exhausted',
      'Too many folders with this name.',
    )
  }

  private validName(raw: string): string {
    const name = sanitiseFolderName(raw)
    if (name === '') {
      throw fakeError(
        400,
        'wpu_invalid_folder_name',
        'Folder names can’t be empty.',
      )
    }
    return name
  }

  private mutationResponse(
    folder: FakeFolder,
    requestedName: string | null,
  ): FolderMutationResponse {
    const rev = this.bumpRev()
    const tree = this.folderTree()
    return {
      rev,
      folder: this.folderDto(folder, this.folderCounts()),
      renamed: requestedName !== null && requestedName !== folder.name,
      requestedName,
      tree,
    }
  }

  createFolder(request: FolderCreateRequest): FolderMutationResponse {
    this.assertFolders(true)
    if (request.parent !== 0 && !this.folderMap.has(request.parent)) {
      throw fakeError(
        404,
        'wpu_folder_not_found',
        `Folder ${request.parent} does not exist.`,
      )
    }
    const requested = this.validName(request.name)
    const name = this.uniqueName(requested, request.parent)
    const id = Math.max(0, ...this.folderMap.keys()) + 1
    const ord =
      Math.max(
        -1,
        ...[...this.folderMap.values()].map((folder) => folder.ord),
      ) + 1
    const folder: FakeFolder = {
      id,
      name,
      parent: request.parent,
      ord,
      color: null,
    }
    this.folderMap.set(id, folder)
    return this.mutationResponse(folder, requested)
  }

  private isInSubtree(candidate: number, root: number): boolean {
    let current: number | undefined = candidate
    const seen = new Set<number>()
    while (current !== undefined && current !== 0 && !seen.has(current)) {
      if (current === root) {
        return true
      }
      seen.add(current)
      current = this.folderMap.get(current)?.parent
    }
    return false
  }

  updateFolder(
    id: number,
    request: FolderUpdateRequest,
  ): FolderMutationResponse {
    this.assertFolders(true)
    const folder = this.folderMap.get(id)
    if (!folder) {
      throw fakeError(
        404,
        'wpu_folder_not_found',
        `Folder ${id} does not exist.`,
      )
    }
    if (request.color !== undefined && !this.pro) {
      throw fakeError(
        409,
        'wpu_pro_required',
        'Folder colours need FileBird Pro.',
      )
    }
    const parent = request.parent ?? folder.parent
    if (parent !== 0 && !this.folderMap.has(parent)) {
      throw fakeError(
        404,
        'wpu_folder_not_found',
        `Folder ${parent} does not exist.`,
      )
    }
    if (parent !== folder.parent && this.isInSubtree(parent, id)) {
      throw fakeError(
        409,
        'wpu_folder_cycle',
        'A folder can’t move into itself.',
      )
    }
    let requestedName: string | null = null
    if (request.name !== undefined) {
      requestedName = this.validName(request.name)
      folder.name = this.uniqueName(requestedName, parent, id)
    } else if (parent !== folder.parent) {
      folder.name = this.uniqueName(folder.name, parent, id)
    }
    if (request.color !== undefined) {
      folder.color = request.color
    }
    if (request.parent !== undefined || request.position !== undefined) {
      const siblings = this.siblings(parent, id)
      const currentIndex = this.siblings(folder.parent, id).findIndex(
        (sibling) => sibling.ord > folder.ord,
      )
      const position =
        request.position ??
        (parent === folder.parent
          ? currentIndex === -1
            ? siblings.length
            : currentIndex
          : siblings.length)
      siblings.splice(Math.min(position, siblings.length), 0, folder)
      folder.parent = parent
      siblings.forEach((sibling, index) => {
        sibling.ord = index
      })
    }
    return this.mutationResponse(folder, requestedName)
  }

  deleteFolder(id: number): FolderDeleteResponse {
    this.assertFolders(true)
    if (!this.folderMap.has(id)) {
      throw fakeError(
        404,
        'wpu_folder_not_found',
        `Folder ${id} does not exist.`,
      )
    }
    const deletedIds: number[] = []
    const queue = [id]
    while (queue.length > 0) {
      const current = queue.shift() as number
      deletedIds.push(current)
      for (const child of this.siblings(current)) {
        queue.push(child.id)
      }
    }
    const deleted = new Set(deletedIds)
    let movedFiles = 0
    for (const item of this.itemMap.values()) {
      if (deleted.has(item.folder)) {
        item.folder = 0
        movedFiles++
      }
    }
    for (const folderId of deletedIds) {
      this.folderMap.delete(folderId)
    }
    const rev = this.bumpRev()
    return { rev, deletedIds, movedFiles, tree: this.folderTree() }
  }

  assign(folder: number, ids: readonly number[]): FolderAssignResponse {
    this.assertFolders(true)
    if (folder !== 0 && !this.folderMap.has(folder)) {
      throw fakeError(
        404,
        'wpu_folder_not_found',
        `Folder ${folder} does not exist.`,
      )
    }
    const previous: FolderAssignResponse['previous'] = []
    const skipped: ItemFailure[] = []
    let moved = 0
    for (const id of ids) {
      const item = this.itemMap.get(id)
      if (!item) {
        skipped.push({ id, ok: false, error: itemErrors.notFound(id) })
        continue
      }
      if (!canEdit(this.viewer, item)) {
        skipped.push({ id, ok: false, error: itemErrors.forbiddenEdit() })
        continue
      }
      previous.push({ id, folder: item.folder })
      if (item.folder !== folder) {
        item.folder = folder
        moved++
      }
    }
    return {
      rev: moved > 0 ? this.bumpRev() : this.rev,
      previous,
      skipped,
      moved,
      counts: this.folderCounts(),
    }
  }

  // -------------------------------------------------------------------------
  // Image operations (jobs)
  // -------------------------------------------------------------------------

  private imagePhases(): {
    queued: number
    running: number
    processing: number
  } {
    return {
      queued: Math.round(200 * this.jobSpeed),
      running: Math.round(1300 * this.jobSpeed),
      processing: 0,
    }
  }

  private checkImage(
    id: number,
    expectedModified: string,
  ): FakeItem | JobOutcome<never> {
    const item = this.itemMap.get(id)
    if (!item) {
      return failed('wpu_not_found', `Media item ${id} does not exist.`)
    }
    if (!canEdit(this.viewer, item)) {
      return failed('forbidden', 'You can’t edit media uploaded by others.')
    }
    if (!this.config.imageEditor.mimes.includes(item.mime)) {
      return failed(
        'wpu_unsupported_type',
        `Images of type ${item.mime} can’t be edited.`,
      )
    }
    const current = new Date(item.modifiedAt)
      .toISOString()
      .replace(/\.\d{3}Z$/, 'Z')
    if (current !== expectedModified) {
      return failed(
        'wpu_stale',
        'The image changed since you started editing. Reload it and try again.',
        { modifiedAt: current },
      )
    }
    return item
  }

  private imageResult(item: FakeItem): ImageJobResult {
    const full = toFullDto(this.dtoContext(), item)
    return {
      item: full,
      sizesRegenerated: Math.max(0, full.sizes.length - 1),
      urlChanged: false,
    }
  }

  private finishImageChange(
    item: FakeItem,
    width: number,
    height: number,
  ): void {
    const before = item.width * item.height
    item.width = width
    item.height = height
    if (item.filesize !== null && before > 0) {
      item.filesize = Math.max(
        1000,
        Math.round((item.filesize * width * height) / before),
      )
    }
    item.modifiedAt = this.now()
    this.bumpRev()
  }

  startEdit(id: number, request: EditRequest): string {
    return this.jobs.start(
      {
        kind: 'edit',
        itemId: id,
        phases: this.imagePhases(),
        total: 0,
        unit: null,
        settle: () => {
          const checked = this.checkImage(id, request.expectedModified)
          if (!('id' in checked)) {
            return checked
          }
          const dims = applyEditOps(checked, request)
          if ('error' in dims) {
            return failed('wpu_invalid_edit', dims.error)
          }
          checked.beforeEdit = { width: checked.width, height: checked.height }
          checked.edited = true
          checked.editedAt = this.now()
          checked.undoable = true
          checked.restorable = true
          this.finishImageChange(checked, dims.width, dims.height)
          return { state: 'succeeded', result: this.imageResult(checked) }
        },
      },
      this.now(),
    )
  }

  startUndo(id: number, expectedModified: string): string {
    return this.jobs.start(
      {
        kind: 'edit-undo',
        itemId: id,
        phases: this.imagePhases(),
        total: 0,
        unit: null,
        settle: () => {
          const checked = this.checkImage(id, expectedModified)
          if (!('id' in checked)) {
            return checked
          }
          if (!checked.undoable || !checked.beforeEdit) {
            return failed('wpu_nothing_to_undo', 'There is no edit to undo.')
          }
          const { width, height } = checked.beforeEdit
          checked.beforeEdit = null
          checked.undoable = false
          checked.edited =
            checked.pristine !== null &&
            (checked.pristine.width !== width ||
              checked.pristine.height !== height)
          this.finishImageChange(checked, width, height)
          return { state: 'succeeded', result: this.imageResult(checked) }
        },
      },
      this.now(),
    )
  }

  startRestore(id: number, expectedModified: string): string {
    return this.jobs.start(
      {
        kind: 'restore',
        itemId: id,
        phases: this.imagePhases(),
        total: 0,
        unit: null,
        settle: () => {
          const checked = this.checkImage(id, expectedModified)
          if (!('id' in checked)) {
            return checked
          }
          if (!checked.restorable || !checked.pristine) {
            return failed(
              'wpu_not_edited',
              'This image has no original to restore.',
            )
          }
          const { width, height } = checked.pristine
          checked.beforeEdit = null
          checked.undoable = false
          checked.restorable = false
          checked.edited = false
          checked.editedAt = null
          this.finishImageChange(checked, width, height)
          return { state: 'succeeded', result: this.imageResult(checked) }
        },
      },
      this.now(),
    )
  }

  startReplace(
    id: number,
    file: UploadInput,
    expectedModified: string,
  ): string {
    return this.jobs.start(
      {
        kind: 'replace',
        itemId: id,
        phases: this.imagePhases(),
        total: 0,
        unit: null,
        settle: () => {
          const item = this.itemMap.get(id)
          if (!item) {
            return failed('wpu_not_found', `Media item ${id} does not exist.`)
          }
          if (file.type !== item.mime) {
            return failed(
              'wpu_mime_mismatch',
              `The new file must be a ${item.mime} file, like the one it replaces.`,
            )
          }
          const checked = this.checkImage(id, expectedModified)
          if (!('id' in checked)) {
            return checked
          }
          checked.blob = file.blob
          checked.filesize = file.size
          checked.beforeEdit = null
          checked.undoable = false
          const width = file.width || checked.width
          const height = file.height || checked.height
          checked.pristine = { width, height }
          this.finishImageChange(checked, width, height)
          checked.filesize = file.size
          return { state: 'succeeded', result: this.imageResult(checked) }
        },
      },
      this.now(),
    )
  }

  startRegenerate(ids: readonly number[]): string {
    return this.jobs.start(
      {
        kind: 'regenerate',
        itemIds: [...ids],
        phases: {
          queued: Math.round(200 * this.jobSpeed),
          running: Math.round(300 * ids.length * this.jobSpeed),
          processing: 0,
        },
        total: ids.length,
        unit: 'items',
        settle: () => {
          const results: RegenerateItemResult[] = ids.map((id) => {
            const item = this.itemMap.get(id)
            if (!item) {
              return { id, ok: false, error: itemErrors.notFound(id) }
            }
            if (item.kind !== 'image') {
              return { id, ok: false, error: itemErrors.unsupported(item.mime) }
            }
            if (!canEdit(this.viewer, item)) {
              return { id, ok: false, error: itemErrors.forbiddenEdit() }
            }
            item.sizesPending = false
            const sizes = toFullDto(this.dtoContext(), item).sizes.length
            return { id, ok: true, sizesRegenerated: Math.max(0, sizes - 1) }
          })
          if (results.some((result) => result.ok)) {
            this.bumpRev()
          }
          return { state: 'succeeded', result: { results } }
        },
      },
      this.now(),
    )
  }

  jobLookups(ids: readonly string[], uploadsOnly: boolean): JobLookup[] {
    const now = this.now()
    return ids.map((id) => this.jobs.lookup(id, now, uploadsOnly))
  }

  // -------------------------------------------------------------------------
  // Upload
  // -------------------------------------------------------------------------

  startUpload(file: UploadInput, folder: number): string {
    const bytesPerMs = 4000 // about 4 MB/s
    const image = file.type.startsWith('image/')
    return this.jobs.start(
      {
        kind: 'upload',
        filename: file.name,
        phases: {
          queued: Math.round(100 * this.jobSpeed),
          running: Math.round(
            Math.max(400, file.size / bytesPerMs) * this.jobSpeed,
          ),
          processing: Math.round((image ? 1500 : 300) * this.jobSpeed),
        },
        total: file.size,
        unit: 'bytes',
        settle: () => {
          const item = this.createUploadedItem(file)
          const assignment = this.fileUpload(item, folder)
          this.bumpRev()
          return {
            state: 'succeeded',
            result: {
              item: toTileDto(this.dtoContext(), item),
              folder: assignment,
            },
          }
        },
      },
      this.now(),
    )
  }

  private createUploadedItem(file: UploadInput): FakeItem {
    const now = this.now()
    const id = Math.max(0, ...this.itemMap.keys()) + 1
    const kind = kindOfMime(file.type)
    const title = file.name.replace(/\.[^.]+$/, '')
    const item: FakeItem = {
      id,
      kind,
      mime: file.type || 'application/octet-stream',
      title,
      filename: file.name,
      width: file.width,
      height: file.height,
      filesize: file.size,
      alt: '',
      caption: '',
      description: '',
      uploadedAt: now,
      modifiedAt: now,
      authorId: this.config.user.id,
      folder: 0,
      postParent: null,
      status: 'inherit',
      trashedAt: null,
      original: null,
      duration: null,
      pages: null,
      exif: null,
      media: null,
      edited: false,
      editedAt: null,
      undoable: false,
      restorable: false,
      sizesPending: false,
      beforeEdit: null,
      pristine:
        file.width > 0 ? { width: file.width, height: file.height } : null,
      usage: [],
      imageSeed: String(id),
      blob: file.blob,
    }
    this.itemMap.set(id, item)
    return item
  }

  private fileUpload(item: FakeItem, folder: number): FolderAssignment | null {
    if (folder === 0 || !this.filebirdActive) {
      return null
    }
    if (this.perUser) {
      return {
        id: folder,
        assigned: false,
        message:
          'FileBird is set to per-user folders, so the file stayed in Uncategorized.',
      }
    }
    if (!this.folderMap.has(folder)) {
      return {
        id: folder,
        assigned: false,
        message:
          'That folder no longer exists, so the file stayed in Uncategorized.',
      }
    }
    item.folder = folder
    return { id: folder, assigned: true, message: null }
  }

  cancelUpload(jobId: string): void {
    if (!this.jobs.cancelUpload(jobId)) {
      throw fakeError(
        404,
        'job_not_found',
        `Upload ${jobId} is unknown or finished.`,
      )
    }
  }

  uploadCheck(filename: string): UploadCheckResponse {
    const wanted = filename.toLowerCase()
    const base = wanted.replace(/\.[^.]+$/, '')
    const context = this.dtoContext()
    const matches: DuplicateMatch[] = []
    for (const item of this.itemMap.values()) {
      if (item.status === 'trash') {
        continue
      }
      const name = item.filename.toLowerCase()
      if (name === wanted || name.replace(/\.[^.]+$/, '') === base) {
        matches.push({
          id: item.id,
          title: item.title,
          filename: item.filename,
          thumb: toTileDto(context, item).thumb,
        })
      }
      if (matches.length >= LIMITS.duplicateMatches) {
        break
      }
    }
    return { duplicate: matches.length > 0, matches }
  }

  // -------------------------------------------------------------------------
  // Files
  // -------------------------------------------------------------------------

  mediaFile(id: number): MediaFile | null {
    const item = this.itemMap.get(id)
    return item ? { item, blob: item.blob ?? null } : null
  }

  /** Changes an item behind the client's back (devtools: test the rev poll). */
  externalEdit(
    id: number,
    patch: Partial<Pick<FakeItem, 'title' | 'alt'>>,
  ): boolean {
    const item = this.itemMap.get(id)
    if (!item) {
      return false
    }
    Object.assign(item, patch)
    this.searchCache.delete(id)
    item.modifiedAt = this.now()
    this.bumpRev()
    return true
  }
}

/** A failed job outcome; its error is what the server maps (§2.3). */
function failed(
  code: string,
  message: string,
  details?: Record<string, unknown>,
): JobOutcome<never> {
  return {
    state: 'failed',
    error:
      details === undefined ? { code, message } : { code, message, details },
  }
}

/**
 * The dimensions after an edit recipe (rotate/flip → crop → scale), or why
 * it is invalid (crop outside the image, scale up or not proportional).
 */
export function applyEditOps(
  item: { width: number; height: number },
  request: EditRequest,
): { width: number; height: number } | { error: string } {
  let width = item.width
  let height = item.height
  for (const op of request.ops as EditOp[]) {
    if (op.op === 'rotate' && op.angle !== 180) {
      ;[width, height] = [height, width]
    }
    if (op.op === 'crop') {
      if (op.x + op.width > width || op.y + op.height > height) {
        return { error: 'The crop is outside the image.' }
      }
      width = op.width
      height = op.height
    }
  }
  if (request.scale) {
    const { width: scaledWidth, height: scaledHeight } = request.scale
    if (scaledWidth > width || scaledHeight > height) {
      return { error: 'Images can only be scaled down.' }
    }
    const expectedHeight = Math.round((scaledWidth * height) / width)
    if (Math.abs(expectedHeight - scaledHeight) > 1) {
      return { error: 'The scale must keep the proportions.' }
    }
    width = scaledWidth
    height = scaledHeight
  }
  return { width, height }
}

export type { FakeError }
