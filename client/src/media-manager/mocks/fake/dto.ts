// Fake records → the contract's DTOs (server-api.md §8), for one viewer:
// renditions and their URLs, perms, trash state, attached-to and usage refs.
//
// Renditions point at the mock's own media route (`mock-media/<id>/<size>/…`,
// drawn as SVG placeholders by routes/media.ts), or at picsum.photos when the
// scenario asks for real photos. Either way they are absolute URLs, as the
// contract requires.

import type {
  ImageSizeDef,
  ImageSource,
  LibraryItemFull,
  LibraryItemTile,
  NamedSize,
  PostRef,
  TrashState,
  UsageRef,
} from '../../../../../shared/library-api.ts'
import type { FakeItem, FakePost, FakeUsage, FakeUser } from './types.ts'

export interface MediaUrls {
  /** absolute, ends with `/`: where the media route serves renditions */
  mediaBase: string
  /** placeholders drawn locally, or photos from picsum.photos */
  images: 'svg' | 'picsum'
  /** real sample files for players (the mock build bundles dev/fixtures) */
  samples?: { video?: string; audio?: string; pdf?: string }
  /** the fake WordPress site, for wp-admin and view links */
  siteUrl: string
}

export interface Viewer {
  id: number
  editOthers: boolean
  deleteOthers: boolean
}

export interface DtoContext {
  now: number
  viewer: Viewer
  /** EMPTY_TRASH_DAYS */
  trashDays: number
  /** without active FileBird, `folder` is null */
  filebirdActive: boolean
  /** false while the usage index builds: `usageCount` is null */
  usageComplete: boolean
  imageSizes: readonly ImageSizeDef[]
  urls: MediaUrls
  posts: ReadonlyMap<number, FakePost>
  users: ReadonlyMap<number, FakeUser>
}

const DAY_MS = 86_400_000
const POSTER_WIDTH = 768

export function isoTime(ms: number): string {
  return new Date(Math.floor(ms / 1000) * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
}

function extensionOf(filename: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(filename)
  return match?.[1]?.toLowerCase() ?? 'bin'
}

function baseName(filename: string): string {
  return filename.replace(/\.[a-z0-9]+$/i, '')
}

function uploadDir(item: FakeItem): string {
  return new Date(item.uploadedAt).toISOString().slice(0, 7).replace('-', '/')
}

/** The stored file path (searchable, server-api.md §6). */
export function storedPath(item: FakeItem): string {
  const file = item.original
    ? `${baseName(item.filename)}-scaled.${extensionOf(item.filename)}`
    : item.filename
  return `${uploadDir(item)}/${file}`
}

function picsumUrl(item: FakeItem, width: number, height: number): string {
  const w = Math.max(1, width)
  const h = Math.max(1, height)
  return /^\d+$/.test(item.imageSeed) && item.id < 10_000
    ? `https://picsum.photos/id/${item.imageSeed}/${w}/${h}`
    : `https://picsum.photos/seed/${encodeURIComponent(item.imageSeed)}/${w}/${h}`
}

/** URL of one rendition (`WxH`) or of the file itself (`full`). */
export function renditionUrl(
  urls: MediaUrls,
  item: FakeItem,
  size: { width: number; height: number } | 'full',
  suffix = '',
): string {
  const fullFile = storedPath(item).split('/').pop() ?? item.filename
  if (size === 'full') {
    if (urls.images === 'picsum' && item.kind === 'image' && !item.blob) {
      return picsumUrl(item, item.width, item.height)
    }
    return `${urls.mediaBase}${item.id}/full/${encodeURIComponent(fullFile)}`
  }
  if (urls.images === 'picsum' && !item.blob) {
    return picsumUrl(item, size.width, size.height)
  }
  const name = `${baseName(item.filename)}${suffix}-${size.width}x${size.height}.jpg`
  return `${urls.mediaBase}${item.id}/${size.width}x${size.height}/${encodeURIComponent(name)}`
}

/** The file `url` points to, or a bundled sample for players. */
function fileUrl(urls: MediaUrls, item: FakeItem): string {
  if (!item.blob) {
    if (item.kind === 'video' && urls.samples?.video) {
      return urls.samples.video
    }
    if (item.kind === 'audio' && urls.samples?.audio) {
      return urls.samples.audio
    }
    if (item.mime === 'application/pdf' && urls.samples?.pdf) {
      return urls.samples.pdf
    }
  }
  return renditionUrl(urls, item, 'full')
}

interface Rendition {
  name: string
  width: number
  height: number
  crop: boolean
}

function fitWithin(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } | null {
  const scales = [
    maxWidth > 0 ? maxWidth / width : Number.POSITIVE_INFINITY,
    maxHeight > 0 ? maxHeight / height : Number.POSITIVE_INFINITY,
  ]
  const scale = Math.min(...scales)
  if (scale >= 1) {
    return null
  }
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/** The sub-sizes WordPress would have generated for this item. */
function subSizes(
  item: FakeItem,
  imageSizes: readonly ImageSizeDef[],
): Rendition[] {
  if (item.width === 0 || item.height === 0 || item.sizesPending) {
    return []
  }
  const pdf = item.mime === 'application/pdf'
  if (item.kind !== 'image' && !pdf) {
    return []
  }
  const sizes: Rendition[] = []
  for (const size of imageSizes) {
    if (size.crop && !pdf) {
      if (item.width >= size.width && item.height >= size.height) {
        sizes.push({
          name: size.name,
          width: size.width,
          height: size.height,
          crop: true,
        })
      }
      continue
    }
    const fitted = fitWithin(item.width, item.height, size.width, size.height)
    if (fitted) {
      sizes.push({ name: size.name, ...fitted, crop: false })
    }
  }
  // Two names can give the same dimensions; keep the first.
  const seen = new Set<string>()
  return sizes
    .filter((size) => {
      const key = `${size.width}x${size.height}`
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
    .sort((a, b) => a.width * a.height - b.width * b.height)
}

function estimateBytes(
  item: FakeItem,
  width: number,
  height: number,
): number | null {
  if (item.filesize === null || item.width === 0 || item.height === 0) {
    return null
  }
  const ratio = (width * height) / (item.width * item.height)
  return Math.max(500, Math.round(item.filesize * ratio))
}

function poster(urls: MediaUrls, item: FakeItem): ImageSource | null {
  if (item.kind !== 'video' || item.width === 0 || item.height === 0) {
    return null
  }
  const height = Math.round((POSTER_WIDTH * item.height) / item.width)
  return {
    url: renditionUrl(urls, item, { width: POSTER_WIDTH, height }, '-poster'),
    width: POSTER_WIDTH,
    height,
  }
}

export function canEdit(viewer: Viewer, item: FakeItem): boolean {
  return viewer.editOthers || item.authorId === viewer.id
}

export function canDelete(viewer: Viewer, item: FakeItem): boolean {
  return viewer.deleteOthers || item.authorId === viewer.id
}

function trashState(context: DtoContext, item: FakeItem): TrashState | null {
  if (item.status !== 'trash' || item.trashedAt === null) {
    return null
  }
  const daysLeft =
    context.trashDays === 0
      ? null
      : Math.max(
          0,
          context.trashDays -
            Math.floor((context.now - item.trashedAt) / DAY_MS),
        )
  return { trashedAt: isoTime(item.trashedAt), daysLeft }
}

export function toTileDto(
  context: DtoContext,
  item: FakeItem,
): LibraryItemTile {
  const { urls } = context
  const renditions = subSizes(item, context.imageSizes)
  const thumbnail = renditions.find((size) => size.name === 'thumbnail')
  const pdf = item.mime === 'application/pdf'
  const pdfSuffix = pdf ? '-pdf' : ''
  let srcset: ImageSource[] = []
  if (item.kind === 'svg') {
    srcset = [
      { url: fileUrl(urls, item), width: item.width, height: item.height },
    ]
  } else if (
    renditions.length > 0 ||
    (item.kind === 'image' && item.width > 0)
  ) {
    srcset = renditions
      .filter((size) => !size.crop)
      .map((size) => ({
        url: renditionUrl(urls, item, size, pdfSuffix),
        width: size.width,
        height: size.height,
      }))
    srcset.push({
      url: pdf
        ? renditionUrl(
            urls,
            item,
            { width: item.width, height: item.height },
            pdfSuffix,
          )
        : renditionUrl(urls, item, 'full'),
      width: item.width,
      height: item.height,
    })
  }
  return {
    id: item.id,
    view: 'tile',
    kind: item.kind,
    mime: item.mime,
    title: item.title,
    filename: item.filename,
    width: item.width,
    height: item.height,
    filesize: item.filesize,
    alt: item.alt,
    uploadedAt: isoTime(item.uploadedAt),
    modifiedAt: isoTime(item.modifiedAt),
    authorId: item.authorId,
    folder: context.filebirdActive ? item.folder : null,
    url: fileUrl(urls, item),
    thumb: thumbnail
      ? {
          url: renditionUrl(urls, item, thumbnail, pdfSuffix),
          width: thumbnail.width,
          height: thumbnail.height,
        }
      : null,
    srcset,
    poster: poster(urls, item),
    duration: item.duration,
    pages: item.pages,
    sizesPending: item.sizesPending,
    perms: {
      edit: canEdit(context.viewer, item),
      delete: canDelete(context.viewer, item),
    },
    trash: trashState(context, item),
  }
}

function postTypeLabel(type: string): string {
  return type === 'page' ? 'Page' : 'Post'
}

/**
 * A post as the viewer may see it: `editUrl` only when they can edit it,
 * `viewUrl` only when it is public. Others' private posts are anonymised.
 */
export function postRef(context: DtoContext, post: FakePost): PostRef {
  const { siteUrl } = context.urls
  const own = post.authorId === context.viewer.id
  const canEditPost = context.viewer.editOthers || own
  if (post.status === 'private' && !canEditPost) {
    return {
      postId: post.id,
      postType: post.type,
      postTypeLabel: postTypeLabel(post.type),
      title: 'Private post',
      status: post.status,
      editUrl: null,
      viewUrl: null,
    }
  }
  return {
    postId: post.id,
    postType: post.type,
    postTypeLabel: postTypeLabel(post.type),
    title: post.title || '(no title)',
    status: post.status,
    editUrl: canEditPost
      ? `${siteUrl}wp-admin/post.php?post=${post.id}&action=edit`
      : null,
    viewUrl: post.status === 'publish' ? `${siteUrl}?p=${post.id}` : null,
  }
}

const SITE_TITLES: Record<string, string> = {
  'site-logo': 'Site logo',
  'site-icon': 'Site icon',
}

/** Usage refs, sorted: site-level first, then featured, then by title. */
export function usageRefs(
  context: DtoContext,
  usage: readonly FakeUsage[],
): UsageRef[] {
  const refs: UsageRef[] = []
  for (const entry of usage) {
    if (entry.postId === null) {
      const context0 = entry.contexts[0] ?? 'site-logo'
      refs.push({
        postId: null,
        postType: 'site',
        postTypeLabel: 'Site',
        title: SITE_TITLES[context0] ?? 'Site',
        status: 'publish',
        editUrl: `${context.urls.siteUrl}wp-admin/site-editor.php`,
        viewUrl: context.urls.siteUrl,
        contexts: [...entry.contexts],
      })
      continue
    }
    const post = context.posts.get(entry.postId)
    if (!post) {
      continue
    }
    refs.push({ ...postRef(context, post), contexts: [...entry.contexts] })
  }
  const rank = (ref: UsageRef) =>
    ref.postId === null ? 0 : ref.contexts.includes('featured') ? 1 : 2
  return refs.sort(
    (a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title),
  )
}

export function toFullDto(
  context: DtoContext,
  item: FakeItem,
): LibraryItemFull {
  const tile = toTileDto(context, item)
  const { urls, siteUrl } = {
    urls: context.urls,
    siteUrl: context.urls.siteUrl,
  }
  const pdf = item.mime === 'application/pdf'
  const renditions = subSizes(item, context.imageSizes)
  let sizes: NamedSize[] = []
  if (item.kind === 'svg') {
    sizes = [
      {
        name: 'full',
        url: tile.url,
        width: item.width,
        height: item.height,
        mime: item.mime,
        filesize: item.filesize,
      },
    ]
  } else if (item.kind === 'image' || (pdf && item.width > 0)) {
    const mime = pdf ? 'image/jpeg' : item.mime
    sizes = renditions.map((size) => ({
      name: size.name,
      url: renditionUrl(urls, item, size, pdf ? '-pdf' : ''),
      width: size.width,
      height: size.height,
      mime,
      filesize: estimateBytes(item, size.width, size.height),
    }))
    sizes.push({
      name: 'full',
      url: pdf
        ? renditionUrl(
            urls,
            item,
            { width: item.width, height: item.height },
            '-pdf',
          )
        : tile.url,
      width: item.width,
      height: item.height,
      mime,
      filesize: pdf ? null : item.filesize,
    })
  }
  const author = context.users.get(item.authorId)
  const attached =
    item.postParent === null ? undefined : context.posts.get(item.postParent)
  return {
    ...tile,
    view: 'full',
    caption: item.caption,
    description: item.description,
    author: {
      id: item.authorId,
      name: author?.name ?? `User ${item.authorId}`,
    },
    attachedTo: attached ? postRef(context, attached) : null,
    original: item.original
      ? {
          url: `${urls.mediaBase}${item.id}/original/${encodeURIComponent(item.filename)}`,
          width: item.original.width,
          height: item.original.height,
          filename: item.filename,
        }
      : null,
    sizes,
    exif: item.exif,
    media: item.media,
    edited: item.edited,
    editedAt: item.editedAt === null ? null : isoTime(item.editedAt),
    undoable: item.undoable,
    restorable: item.restorable,
    usageCount: context.usageComplete ? item.usage.length : null,
    links: {
      edit: `${siteUrl}wp-admin/post.php?post=${item.id}&action=edit`,
      view: null,
    },
  }
}
