import {
  type ExifInfo,
  type ImageSource,
  type ItemView,
  LIMITS,
  type LibraryItemFull,
  type LibraryItemTile,
  MEDIA_KINDS,
  type MediaFileInfo,
  type MediaKind,
  type NamedSize,
  type PostRef,
  type TrashState,
} from '../../../../../shared/library-api.ts'
import type { WpuField } from '../../../../../shared/plugin-api.ts'
import { env } from '../../../config/env.ts'
import { knownPluginInfo } from '../cache.ts'
import { LibraryError } from '../errors.ts'
import {
  type CallOptions,
  capitalise,
  type PostTypeInfo,
  postTypes,
  wpGet,
} from '../pluginClient.ts'

// WordPress `/wp/v2/media` (+ the plugin's `wpu` field) → LibraryItem DTOs
// (server-api.md §7.5, §8.1), and the hydration call itself, which S2 reuses
// for job results and uploads.

// ---------------------------------------------------------------------------
// What WordPress sends
// ---------------------------------------------------------------------------

/** One `media_details.sizes` entry as core REST returns it. */
export interface WpMediaSize {
  file?: string
  width?: number
  height?: number
  filesize?: number
  mime_type?: string
  source_url?: string
}

export interface WpImageMeta {
  aperture?: string | number
  credit?: string
  camera?: string
  caption?: string
  created_timestamp?: string | number
  copyright?: string
  focal_length?: string | number
  iso?: string | number
  shutter_speed?: string | number
  title?: string
  orientation?: string | number
  keywords?: unknown
  /** the plugin adds it when it captured the lens */
  lens?: string
}

export interface WpMediaDetails {
  width?: number
  height?: number
  file?: string
  filesize?: number
  sizes?: Record<string, WpMediaSize> | unknown[]
  image_meta?: WpImageMeta
  // video and audio (getID3)
  length?: number
  fileformat?: string
  dataformat?: string
  codec?: string
  bitrate?: number
  sample_rate?: number
  channels?: number
  audio?: { sample_rate?: number; channels?: number; codec?: string }
}

export interface WpLink {
  href: string
  embeddable?: boolean
  post_type?: string
  id?: number
}

/** An attachment from `GET /wp/v2/media?context=view&_fields=…`. */
export interface WpMedia {
  id: number
  date_gmt: string | null
  modified_gmt: string | null
  alt_text?: string
  author?: number
  mime_type: string
  source_url: string
  /** WordPress 7.0+: the original upload's basename */
  filename?: string
  link?: string
  /** parent post id; 0 when unattached */
  post?: number | null
  media_details?: WpMediaDetails | unknown[]
  wpu?: WpuField | null
  _links?: Record<string, WpLink[]>
}

/** `_fields` for each view: only what the normaliser reads. */
export const MEDIA_FIELDS: Record<ItemView, readonly string[]> = {
  tile: [
    'id',
    'date_gmt',
    'modified_gmt',
    'alt_text',
    'author',
    'mime_type',
    'source_url',
    'filename',
    'media_details.sizes',
    'wpu',
  ],
  full: [
    'id',
    'date_gmt',
    'modified_gmt',
    'alt_text',
    'author',
    'mime_type',
    'source_url',
    'filename',
    'link',
    'post',
    'media_details',
    'wpu',
    '_links',
  ],
}

// ---------------------------------------------------------------------------
// Normalising one item
// ---------------------------------------------------------------------------

export interface NormaliseContext {
  /** EMPTY_TRASH_DAYS (from `/info`); 0 = WordPress never purges */
  trashDays: number
  /** "now", for `trash.daysLeft` */
  now: number
  /** WP_URL, for wp-admin links */
  wpUrl: string
  /** registered image size names, in WordPress's order (`/info`'s imageSizes) */
  sizeOrder: readonly string[]
  /**
   * Whether the site has attachment pages (`wp_attachment_pages_enabled`).
   * REST's `link` doesn't tell: it is `?attachment_id=N` either way.
   */
  attachmentPages: boolean
}

/** The tile view of one attachment. Throws when the `wpu` field is missing. */
export function normaliseTile(
  media: WpMedia,
  context: NormaliseContext,
): LibraryItemTile {
  const wpu = requireWpu(media)
  const kind = toKind(wpu.kind)
  const renditions = readRenditions(media, wpu, kind, context.sizeOrder)
  return {
    id: media.id,
    view: 'tile',
    kind,
    mime: media.mime_type,
    title: wpu.raw.title,
    filename: filenameOf(media, wpu),
    width: wpu.width,
    height: wpu.height,
    filesize: wpu.filesize,
    alt: media.alt_text ?? '',
    uploadedAt: gmtToIso(media.date_gmt),
    modifiedAt: gmtToIso(media.modified_gmt),
    authorId: media.author ?? wpu.author.id,
    folder: wpu.folder,
    url: media.source_url,
    thumb: renditions.thumb,
    srcset: renditions.srcset,
    poster: wpu.poster,
    duration: wpu.duration,
    pages: wpu.pages,
    sizesPending: wpu.sizesPending,
    perms: { edit: wpu.perms.edit, delete: wpu.perms.delete },
    trash: trashState(wpu.trashedAt, context),
  }
}

/**
 * The full view of one attachment. `attachedTo` comes from the caller, which
 * resolves parent posts in one go (resolveParents).
 */
export function normaliseFull(
  media: WpMedia,
  context: NormaliseContext,
  attachedTo: PostRef | null,
): LibraryItemFull {
  const wpu = requireWpu(media)
  const tile = normaliseTile(media, context)
  const kind = tile.kind
  const details = detailsOf(media)
  return {
    ...tile,
    view: 'full',
    caption: wpu.raw.caption,
    description: wpu.raw.description,
    author: { id: wpu.author.id, name: wpu.author.name },
    attachedTo,
    original: wpu.original,
    sizes: readRenditions(media, wpu, kind, context.sizeOrder).sizes,
    exif: kind === 'image' ? readExif(details?.image_meta) : null,
    media: kind === 'video' || kind === 'audio' ? readMediaInfo(details) : null,
    edited: wpu.edited,
    editedAt: wpu.editedAt,
    undoable: wpu.undoable,
    restorable: wpu.restorable,
    usageCount: wpu.usageCount,
    links: {
      edit: editPostUrl(context.wpUrl, media.id),
      view:
        context.attachmentPages && media.link && media.link !== media.source_url
          ? media.link
          : null,
    },
  }
}

function requireWpu(media: WpMedia): WpuField {
  const wpu = media.wpu
  if (!wpu || typeof wpu !== 'object' || !wpu.raw || !wpu.perms) {
    throw new LibraryError(
      502,
      'wp_unexpected_response',
      'WordPress returned media without the companion plugin’s wpu field. ' +
        'Check that the plugin is active and up to date.',
    )
  }
  return wpu
}

function toKind(kind: unknown): MediaKind {
  return (MEDIA_KINDS as readonly unknown[]).includes(kind)
    ? (kind as MediaKind)
    : 'other'
}

/** `2024-12-09T19:36:02` (WordPress's `*_gmt`) → `2024-12-09T19:36:02Z`. */
export function gmtToIso(value: string | null | undefined): string {
  if (!value) return ''
  return value.endsWith('Z') ? value : `${value}Z`
}

function filenameOf(media: WpMedia, wpu: WpuField): string {
  if (media.filename) return media.filename
  if (wpu.original?.filename) return wpu.original.filename
  const base = media.source_url.split('/').pop() ?? ''
  return decodeURIComponent(base).replace(/-scaled(\.[^.]+)$/, '$1')
}

function trashState(
  trashedAt: string | null,
  context: NormaliseContext,
): TrashState | null {
  if (!trashedAt) return null
  if (context.trashDays === 0) return { trashedAt, daysLeft: null }
  const elapsedDays = Math.floor(
    (context.now - Date.parse(trashedAt)) / 86_400_000,
  )
  return {
    trashedAt,
    daysLeft: Math.max(0, context.trashDays - Math.max(0, elapsedDays)),
  }
}

/** `<WP_URL>/wp-admin/post.php?post=<id>&action=edit`. */
export function editPostUrl(wpUrl: string, id: number): string {
  return `${wpUrl}/wp-admin/post.php?post=${id}&action=edit`
}

// ---------------------------------------------------------------------------
// Renditions: thumb, srcset, sizes
// ---------------------------------------------------------------------------

function detailsOf(media: WpMedia): WpMediaDetails | null {
  const details = media.media_details
  return details && !Array.isArray(details) && typeof details === 'object'
    ? details
    : null
}

const EXTENSION_MIMES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpe: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  heic: 'image/heic',
  svg: 'image/svg+xml',
}

function mimeFromUrl(url: string): string | null {
  const extension = url.split('?')[0]?.split('.').pop()?.toLowerCase() ?? ''
  return EXTENSION_MIMES[extension] ?? null
}

interface Renditions {
  thumb: ImageSource | null
  srcset: ImageSource[]
  sizes: NamedSize[]
}

/**
 * Reads `media_details.sizes`:
 * - `sizes`: every entry, smallest first, ending with `full`. "Smallest first"
 *   is the order of the registered sizes (thumbnail, medium, medium_large,
 *   large, 1536x1536, 2048x2048, then theme sizes), as wp-admin lists them;
 *   WordPress itself stores them in generation order (medium, large,
 *   thumbnail, …). Unregistered names follow, by pixel count. Core REST adds
 *   `full` (the attached file) for images; for an image or SVG without
 *   generated sizes it is built from the item itself. For PDFs core's `full`
 *   is the preview image, but REST reports the PDF's MIME type and no size
 *   there, so the MIME type is taken from the file name instead.
 * - `thumb`: the `thumbnail` size.
 * - `srcset`: the uncropped sizes (same aspect ratio as `full`, ±1 px) plus
 *   `full`, ascending by width.
 */
function readRenditions(
  media: WpMedia,
  wpu: WpuField,
  kind: MediaKind,
  sizeOrder: readonly string[],
): Renditions {
  const raw = detailsOf(media)?.sizes
  const entries =
    raw && !Array.isArray(raw) && typeof raw === 'object'
      ? Object.entries(raw)
      : []
  const imageLike = kind === 'image' || kind === 'svg'

  let full: NamedSize | null = null
  const others: NamedSize[] = []
  for (const [name, size] of entries) {
    const named = toNamedSize(name, size)
    if (!named) continue
    if (name === 'full') {
      full = {
        ...named,
        mime: imageLike
          ? media.mime_type
          : (mimeFromUrl(named.url) ?? named.mime),
        filesize: named.filesize ?? (imageLike ? wpu.filesize : null),
      }
    } else {
      others.push(named)
    }
  }
  if (!full && imageLike && wpu.width > 0 && wpu.height > 0) {
    full = {
      name: 'full',
      url: media.source_url,
      width: wpu.width,
      height: wpu.height,
      mime: media.mime_type,
      filesize: wpu.filesize,
    }
  }

  const rank = (name: string) => {
    const index = sizeOrder.indexOf(name)
    return index === -1 ? sizeOrder.length : index
  }
  others.sort(
    (a, b) =>
      rank(a.name) - rank(b.name) ||
      a.width * a.height - b.width * b.height ||
      a.width - b.width,
  )
  const sizes = full ? [...others, full] : others

  const thumbnail = others.find((size) => size.name === 'thumbnail')
  const thumb = thumbnail ? toSource(thumbnail) : null

  const srcset: ImageSource[] = []
  if (full) {
    const seen = new Set<string>()
    const target = full
    for (const size of [...others.filter((s) => sameShape(s, target)), full]) {
      if (seen.has(size.url)) continue
      seen.add(size.url)
      srcset.push(toSource(size))
    }
    srcset.sort((a, b) => a.width - b.width || a.height - b.height)
  }

  return { thumb, srcset, sizes }
}

function toNamedSize(name: string, size: WpMediaSize): NamedSize | null {
  if (
    !size ||
    typeof size.source_url !== 'string' ||
    typeof size.width !== 'number' ||
    typeof size.height !== 'number'
  ) {
    return null
  }
  return {
    name,
    url: size.source_url,
    width: size.width,
    height: size.height,
    mime: size.mime_type ?? mimeFromUrl(size.source_url) ?? '',
    filesize: typeof size.filesize === 'number' ? size.filesize : null,
  }
}

function toSource(size: NamedSize): ImageSource {
  return { url: size.url, width: size.width, height: size.height }
}

// Uncropped = scaled from the full image: within 1 px of its aspect ratio.
function sameShape(size: NamedSize, full: NamedSize): boolean {
  if (full.width <= 0 || full.height <= 0) return false
  const deviation = Math.abs(
    size.height * full.width - size.width * full.height,
  )
  return deviation <= Math.max(full.width, full.height)
}

// ---------------------------------------------------------------------------
// EXIF and media file details
// ---------------------------------------------------------------------------

function positiveNumber(value: unknown): number | null {
  const number = typeof value === 'string' ? Number(value) : value
  return typeof number === 'number' && Number.isFinite(number) && number > 0
    ? number
    : null
}

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

/** "1/60" below a second, "2s" or "1.5s" from one second on. */
export function formatShutter(seconds: number): string {
  if (seconds >= 1) return `${Math.round(seconds * 10) / 10}s`
  return `1/${Math.round(1 / seconds)}`
}

function readExif(meta: WpImageMeta | undefined): ExifInfo | null {
  if (!meta || typeof meta !== 'object') return null
  const shutter = positiveNumber(meta.shutter_speed)
  const taken = positiveNumber(meta.created_timestamp)
  const exif: ExifInfo = {
    camera: nonEmpty(meta.camera),
    lens: nonEmpty(meta.lens),
    focalLength: positiveNumber(meta.focal_length),
    aperture: positiveNumber(meta.aperture),
    shutter: shutter === null ? null : formatShutter(shutter),
    iso: positiveNumber(meta.iso),
    takenAt:
      taken === null
        ? null
        : new Date(taken * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    credit: nonEmpty(meta.credit),
    copyright: nonEmpty(meta.copyright),
    keywords: Array.isArray(meta.keywords)
      ? meta.keywords.filter((k): k is string => typeof k === 'string')
      : [],
  }
  const useful =
    exif.keywords.length > 0 ||
    Object.entries(exif).some(
      ([key, value]) => key !== 'keywords' && value !== null,
    )
  return useful ? exif : null
}

function readMediaInfo(details: WpMediaDetails | null): MediaFileInfo | null {
  if (!details) return null
  const bitrate = positiveNumber(details.bitrate)
  const info: MediaFileInfo = {
    format: nonEmpty(details.fileformat),
    codec: nonEmpty(details.codec) ?? nonEmpty(details.dataformat),
    bitrate: bitrate === null ? null : Math.round(bitrate),
    sampleRate:
      positiveNumber(details.sample_rate) ??
      positiveNumber(details.audio?.sample_rate),
    channels:
      positiveNumber(details.channels) ??
      positiveNumber(details.audio?.channels),
  }
  return Object.values(info).some((value) => value !== null) ? info : null
}

// ---------------------------------------------------------------------------
// Attached-to posts
// ---------------------------------------------------------------------------

/** A post as `GET /wp/v2/<type>/<id>?_fields=…` returns it. */
interface WpPost {
  id: number
  type?: string
  status?: string
  link?: string
  title?: { raw?: string; rendered?: string }
  _links?: { self?: Array<{ targetHints?: { allow?: unknown[] } }> }
}

const POST_FIELDS = 'id,type,status,link,title,_links'
const PARENT_CONCURRENCY = 4

/** Where to read an attachment's parent post, from its `_links`. */
export function parentLink(
  media: WpMedia,
): { postId: number; href: string; postType: string | null } | null {
  const postId = media.post
  if (!postId || postId <= 0) return null
  const link = media._links?.['wp:attached-to']?.[0]
  if (link?.href) {
    return { postId, href: link.href, postType: link.post_type ?? null }
  }
  return {
    postId,
    href: `${env.wpUrl}/wp-json/wp/v2/posts/${postId}`,
    postType: null,
  }
}

/**
 * The REST route (below `/wp-json`) to read a parent post from. Only the
 * route is taken from WordPress's links, never their origin or path prefix:
 * WP_URL supplies those, because the URLs WordPress hands out use its own
 * `siteurl`, which may differ from WP_URL (an internal host name or port,
 * `www.`), and already contain any subdirectory WordPress lives in.
 *
 * 1. The post type's own REST base and namespace, when the type is known;
 * 2. else the route in the link WordPress gave;
 * 3. else `/wp/v2/posts/<id>`.
 */
export function parentRoute(
  link: { postId: number; href: string; postType: string | null },
  types: ReadonlyMap<string, PostTypeInfo>,
): string {
  const type = link.postType ? types.get(link.postType) : undefined
  if (type?.restBase) {
    return `/${type.restNamespace}/${type.restBase}/${link.postId}`
  }
  const route = restRouteOf(link.href)
  if (route?.endsWith(`/${link.postId}`)) return route
  return `/wp/v2/posts/${link.postId}`
}

/**
 * The route of a WordPress REST URL: what follows `/wp-json` (pretty
 * permalinks), or the `rest_route` parameter (plain permalinks). Null for
 * anything else.
 */
export function restRouteOf(href: string): string | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  const param = url.searchParams.get('rest_route')
  if (param?.startsWith('/')) return param
  const marker = url.pathname.indexOf('/wp-json/')
  if (marker === -1) return null
  return url.pathname.slice(marker + '/wp-json'.length)
}

/**
 * Resolves parent posts to PostRefs with one `context=view` read each
 * (`editUrl` only when the user may edit the post). A post the user can't
 * read becomes "Private post" with no URLs; a post that no longer exists,
 * null. Other errors fail the request.
 */
export async function resolveParents(
  links: Array<{ postId: number; href: string; postType: string | null }>,
  options: CallOptions = {},
): Promise<Map<number, PostRef | null>> {
  const unique = new Map(links.map((link) => [link.postId, link]))
  const result = new Map<number, PostRef | null>()
  if (unique.size === 0) return result
  const types = await postTypes(options)
  const queue = [...unique.values()]

  async function worker(): Promise<void> {
    for (let link = queue.shift(); link; link = queue.shift()) {
      result.set(link.postId, await resolveParent(link, types, options))
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(PARENT_CONCURRENCY, queue.length) }, worker),
  )
  return result
}

async function resolveParent(
  link: { postId: number; href: string; postType: string | null },
  types: ReadonlyMap<string, PostTypeInfo>,
  options: CallOptions,
): Promise<PostRef | null> {
  const labelOf = (type: string) => types.get(type)?.label ?? capitalise(type)
  const route = parentRoute(link, types)

  let post: WpPost
  try {
    post = await wpGet<WpPost>(
      route,
      { context: 'view', _fields: POST_FIELDS },
      options,
    )
  } catch (err) {
    const status = httpStatus(err)
    if (status === 404) return null
    if (status !== 403) throw err
    const type = link.postType ?? 'post'
    return {
      postId: link.postId,
      postType: type,
      postTypeLabel: labelOf(type),
      title: 'Private post',
      status: 'private',
      editUrl: null,
      viewUrl: null,
    }
  }

  const type = post.type ?? link.postType ?? 'post'
  const status = post.status ?? 'publish'
  const title = decodeHtml(
    post.title?.raw ?? stripTags(post.title?.rendered ?? ''),
  ).trim()
  const editable = await canEdit(post, route, options)
  return {
    postId: link.postId,
    postType: type,
    postTypeLabel: labelOf(type),
    title: title || '(no title)',
    status,
    editUrl: editable ? editPostUrl(env.wpUrl, link.postId) : null,
    viewUrl: status === 'publish' && post.link ? post.link : null,
  }
}

/**
 * Whether this user may edit the post: the methods its `self` link allows
 * (`targetHints`, WordPress 6.7+), or, without them, whether `context=edit`
 * (which needs `edit_post`) answers.
 */
async function canEdit(
  post: WpPost,
  route: string,
  options: CallOptions,
): Promise<boolean> {
  const allow = post._links?.self?.[0]?.targetHints?.allow
  if (Array.isArray(allow)) {
    return allow.some((method) => method === 'PUT' || method === 'PATCH')
  }
  try {
    await wpGet(route, { context: 'edit', _fields: 'id' }, options)
    return true
  } catch (err) {
    const status = httpStatus(err)
    if (status === 403 || status === 404) return false
    throw err
  }
}

function httpStatus(err: unknown): number | undefined {
  const response = (err as { response?: { status?: number } } | null)?.response
  return response?.status
}

// ---------------------------------------------------------------------------
// HTML text (rendered titles)
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  copy: '©',
  reg: '®',
  trade: '™',
}

/** Decodes the HTML entities WordPress puts in rendered text. */
export function decodeHtml(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi,
    (match, entity: string) => {
      if (entity[0] === '#') {
        const code =
          entity[1] === 'x' || entity[1] === 'X'
            ? Number.parseInt(entity.slice(2), 16)
            : Number.parseInt(entity.slice(1), 10)
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : match
      }
      return NAMED_ENTITIES[entity.toLowerCase()] ?? match
    },
  )
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '')
}

// ---------------------------------------------------------------------------
// Hydration (server-api.md §7.5)
// ---------------------------------------------------------------------------

export interface Hydrated<Item> {
  /** in the order of `ids` */
  items: Item[]
  /** ids WordPress didn't return: gone, or not visible to this user */
  missing: number[]
}

/** The context for normalising now: trash days from the last `/info`. */
export function currentNormaliseContext(): NormaliseContext {
  const info = knownPluginInfo()?.info
  return {
    trashDays: info?.trash.days ?? 30,
    now: Date.now(),
    wpUrl: env.wpUrl,
    sizeOrder: info?.imageSizes.map((size) => size.name) ?? DEFAULT_SIZE_ORDER,
    // Not in /info yet (change request in the S1 handoff): without it the
    // view link stays off, since new sites have no attachment pages.
    attachmentPages:
      (info as { attachmentPages?: unknown } | undefined)?.attachmentPages ===
      true,
  }
}

/** WordPress core's registered sizes, until `/info` has been read. */
const DEFAULT_SIZE_ORDER = [
  'thumbnail',
  'medium',
  'medium_large',
  'large',
  '1536x1536',
  '2048x2048',
]

/** Fetches up to 100 attachments by id, in any status, raw. */
export async function fetchMedia(
  ids: readonly number[],
  view: ItemView,
  options: CallOptions = {},
): Promise<WpMedia[]> {
  if (ids.length === 0) return []
  if (ids.length > LIMITS.itemIds) {
    throw new Error(`fetchMedia: at most ${LIMITS.itemIds} ids`)
  }
  const media = await wpGet<unknown>(
    '/wp/v2/media',
    {
      include: ids.join(','),
      per_page: ids.length,
      orderby: 'include',
      status: 'inherit,private,trash',
      // Never `edit`: it silently drops items the user can't edit.
      context: 'view',
      _fields: MEDIA_FIELDS[view].join(','),
    },
    options,
  )
  if (!Array.isArray(media)) {
    throw new LibraryError(
      502,
      'wp_unexpected_response',
      'WordPress answered the media query with an unexpected response.',
    )
  }
  return media as WpMedia[]
}

/** Hydrates items by id (tile view), in the order given. */
export async function hydrateItems(
  ids: readonly number[],
  view: 'tile',
  options?: CallOptions,
): Promise<Hydrated<LibraryItemTile>>
/** Hydrates items by id (full view), in the order given. */
export async function hydrateItems(
  ids: readonly number[],
  view: 'full',
  options?: CallOptions,
): Promise<Hydrated<LibraryItemFull>>
export async function hydrateItems(
  ids: readonly number[],
  view: ItemView,
  options?: CallOptions,
): Promise<Hydrated<LibraryItemTile | LibraryItemFull>>
export async function hydrateItems(
  ids: readonly number[],
  view: ItemView,
  options: CallOptions = {},
): Promise<Hydrated<LibraryItemTile | LibraryItemFull>> {
  const media = await fetchMedia(ids, view, options)
  const byId = new Map(media.map((entry) => [entry.id, entry]))
  const context = currentNormaliseContext()

  let parents = new Map<number, PostRef | null>()
  if (view === 'full') {
    const links = media
      .map(parentLink)
      .filter((link): link is NonNullable<typeof link> => link !== null)
    parents = await resolveParents(links, options)
  }

  const items: Array<LibraryItemTile | LibraryItemFull> = []
  const missing: number[] = []
  for (const id of ids) {
    const entry = byId.get(id)
    if (!entry) {
      missing.push(id)
      continue
    }
    items.push(
      view === 'full'
        ? normaliseFull(
            entry,
            context,
            entry.post ? (parents.get(entry.post) ?? null) : null,
          )
        : normaliseTile(entry, context),
    )
  }
  return { items, missing }
}
