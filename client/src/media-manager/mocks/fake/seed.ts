// The default fake library: the prototype's sample data
// (docs/media-manager/design/prototype/data/*.json), turned into fake
// records, with the states the shared fixtures give some items (1009 edited
// in place, 1029 still processing, 1017 and 1026 in the Trash when the
// scenario has one).

// `?raw` (Vite) rather than a JSON import: TypeScript treats `*?raw` as an
// ambient string module, so `tsc` passes where docs/ isn't present (the
// production image's client build stage copies only client/ and shared/).
// Only the mock build and tests load this file.
import foldersText from '../../../../../docs/media-manager/design/prototype/data/folders.json?raw'
import mediaText from '../../../../../docs/media-manager/design/prototype/data/media.json?raw'
import type {
  ExifInfo,
  MediaKind,
  UsageContext,
} from '../../../../../shared/library-api.ts'
import { hashString } from './random.ts'
import type {
  FakeDataset,
  FakeFolder,
  FakeItem,
  FakePost,
  FakeUsage,
  FakeUser,
} from './types.ts'

interface PrototypePostRef {
  id: number
  type: string
  title: string
}

interface PrototypeMedia {
  id: number
  kind: string
  mime: string
  picsumId?: string
  posterPicsumId?: string
  title: string
  filename: string
  alt: string
  caption: string
  description: string
  width: number
  height: number
  originalWidth?: number
  originalHeight?: number
  filesize: number
  uploaded: string
  modified: string
  author: string
  folder?: number | null
  attachedTo: PrototypePostRef | null
  usedIn?: PrototypePostRef[]
  exif?: {
    camera?: string
    lens?: string
    focalLength?: number
    aperture?: number
    shutter?: string
    iso?: number
    taken?: string
  } | null
  credit?: { author?: string; url?: string }
  duration?: number
  pages?: number
}

interface PrototypeFolder {
  id: number
  name: string
  parent: number
  order: number
  color?: string
  count: number
}

/** The fixture users (shared/fixtures/items.ts `fixtureUsers`). */
export const FAKE_USERS: FakeUser[] = [
  { id: 1, name: 'Site Admin' },
  { id: 2, name: 'Anna Berg' },
  { id: 3, name: 'Jonas Holm' },
]

/** Items the Trash scenario starts with, and when they were trashed. */
export const SEED_TRASHED: Readonly<Record<number, string>> = {
  1017: '2026-11-10T09:12:44Z',
  1026: '2026-11-20T16:03:10Z',
}

/** Usage contexts a post can use an item in, picked per (item, post). */
const POST_CONTEXTS: UsageContext[] = [
  'image-block',
  'gallery-block',
  'content',
  'featured',
  'cover-block',
  'media-text',
]

const MEDIA_KIND_SET: ReadonlySet<string> = new Set<MediaKind>([
  'image',
  'svg',
  'video',
  'audio',
  'document',
  'archive',
  'other',
])

function toMs(iso: string): number {
  // Whole seconds, like WordPress stores them.
  return Math.floor(Date.parse(iso) / 1000) * 1000
}

function userId(name: string): number {
  return FAKE_USERS.find((user) => user.name === name)?.id ?? 1
}

function contextFor(
  itemId: number,
  postId: number,
  kind: MediaKind,
): UsageContext {
  if (kind === 'video') {
    return 'video-block'
  }
  if (kind === 'audio') {
    return 'audio-block'
  }
  if (kind === 'document' || kind === 'archive') {
    return 'file-block'
  }
  const index = hashString(`${itemId}:${postId}`) % POST_CONTEXTS.length
  return POST_CONTEXTS[index] ?? 'image-block'
}

function toExif(entry: PrototypeMedia): ExifInfo | null {
  if (!entry.exif) {
    return null
  }
  return {
    camera: entry.exif.camera ?? null,
    lens: entry.exif.lens ?? null,
    focalLength: entry.exif.focalLength ?? null,
    aperture: entry.exif.aperture ?? null,
    shutter: entry.exif.shutter ?? null,
    iso: entry.exif.iso ?? null,
    takenAt: entry.exif.taken
      ? new Date(toMs(entry.exif.taken)).toISOString().replace(/\.\d{3}Z$/, 'Z')
      : null,
    credit: entry.credit?.author ?? null,
    copyright: null,
    keywords: [],
  }
}

function toItem(entry: PrototypeMedia): FakeItem {
  const kind = (
    MEDIA_KIND_SET.has(entry.kind) ? entry.kind : 'other'
  ) as MediaKind
  const scaled = /-scaled\.[a-z0-9]+$/i.test(entry.filename)
  // The prototype stores 1×1 for files without dimensions.
  const hasDimensions = entry.width > 1 && entry.height > 1
  const width = hasDimensions ? entry.width : 0
  const height = hasDimensions ? entry.height : 0
  const original =
    scaled && entry.originalWidth && entry.originalHeight
      ? { width: entry.originalWidth, height: entry.originalHeight }
      : null
  const usage: FakeUsage[] = (entry.usedIn ?? []).map((post) => ({
    postId: post.id,
    contexts: [contextFor(entry.id, post.id, kind)],
  }))
  return {
    id: entry.id,
    kind,
    mime: entry.mime,
    title: entry.title,
    filename: entry.filename.replace(/-scaled(\.[a-z0-9]+)$/i, '$1'),
    width,
    height,
    filesize: entry.filesize,
    alt: entry.alt,
    caption: entry.caption,
    description: entry.description,
    uploadedAt: toMs(entry.uploaded),
    modifiedAt: toMs(entry.modified),
    authorId: userId(entry.author),
    folder: entry.folder ?? 0,
    postParent: entry.attachedTo?.id ?? null,
    status: 'inherit',
    trashedAt: null,
    original,
    duration: entry.duration ?? null,
    pages: entry.pages ?? null,
    exif: toExif(entry),
    media:
      kind === 'video' || kind === 'audio'
        ? {
            format: entry.mime.split('/')[1] ?? null,
            codec: kind === 'video' ? 'h264' : 'mp3',
            bitrate: kind === 'video' ? 4_000_000 : 128_000,
            sampleRate: 44_100,
            channels: 2,
          }
        : null,
    edited: false,
    editedAt: null,
    undoable: false,
    restorable: false,
    sizesPending: false,
    beforeEdit: null,
    pristine: hasDimensions ? { width, height } : null,
    usage,
    imageSeed: entry.posterPicsumId ?? entry.picsumId ?? String(entry.id),
  }
}

/** Applies the states the shared fixtures give some items. */
function applyFixtureStates(items: FakeItem[], withTrash: boolean): void {
  for (const item of items) {
    if (item.id === 1009) {
      const editedAt = toMs('2026-10-02T08:41:19Z')
      item.edited = true
      item.editedAt = editedAt
      item.modifiedAt = editedAt
      item.undoable = true
      item.restorable = true
      item.beforeEdit = { width: item.width, height: item.height }
    }
    if (item.id === 1029) {
      item.sizesPending = true
    }
    if (item.id === 1091) {
      item.usage.unshift({ postId: null, contexts: ['site-logo'] })
    }
    const trashedAt = SEED_TRASHED[item.id]
    if (withTrash && trashedAt) {
      item.status = 'trash'
      item.trashedAt = toMs(trashedAt)
    }
  }
}

function collectPosts(entries: PrototypeMedia[]): FakePost[] {
  const posts = new Map<number, FakePost>()
  for (const entry of entries) {
    for (const ref of [entry.attachedTo, ...(entry.usedIn ?? [])]) {
      if (!ref || posts.has(ref.id)) {
        continue
      }
      posts.set(ref.id, {
        id: ref.id,
        type: ref.type === 'page' ? 'page' : 'post',
        title: ref.title,
        status: 'publish',
        // Newer ids are more recent, as in the fixtures' `postsRecent`.
        date: toMs('2026-01-01T09:00:00Z') + (ref.id - 200) * 86_400_000,
        authorId: 1,
      })
    }
  }
  // A draft and a private post the picker must not offer (core search).
  posts.set(209, {
    id: 209,
    type: 'post',
    title: 'Autumn newsletter (draft)',
    status: 'draft',
    date: toMs('2026-11-01T09:00:00Z'),
    authorId: 2,
  })
  posts.set(210, {
    id: 210,
    type: 'page',
    title: 'Internal: brand guidelines',
    status: 'private',
    date: toMs('2026-10-01T09:00:00Z'),
    authorId: 1,
  })
  return [...posts.values()].sort((a, b) => a.id - b.id)
}

function toFolder(entry: PrototypeFolder): FakeFolder {
  return {
    id: entry.id,
    name: entry.name,
    parent: entry.parent,
    ord: entry.order,
    color: entry.color ?? null,
  }
}

/** The prototype's library (93 items, 16 folders, 10 posts). */
export function prototypeDataset(options: { withTrash: boolean }): FakeDataset {
  const entries = JSON.parse(mediaText) as PrototypeMedia[]
  const items = entries.map(toItem)
  applyFixtureStates(items, options.withTrash)
  return {
    items,
    folders: (JSON.parse(foldersText) as PrototypeFolder[]).map(toFolder),
    posts: collectPosts(entries),
    users: FAKE_USERS,
  }
}
