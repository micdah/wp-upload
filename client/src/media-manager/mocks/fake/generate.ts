// A deterministic large-library generator: 50k items (or any count), a few
// hundred nested folders and posts, with a realistic mix of kinds, sizes,
// aspect ratios, alt coverage, folder membership and usage. Same seed, same
// library, in Node and in every browser.
//
// Used by the `large` mock scenario and spike C5. Runs in plain Node (no
// Vite), hence the `.ts` import extensions.

import type { MediaKind } from '../../../../../shared/library-api.ts'
import { createRandom, type Random } from './random.ts'
import type {
  FakeDataset,
  FakeFolder,
  FakeItem,
  FakePost,
  FakeUsage,
} from './types.ts'

export interface GenerateOptions {
  items: number
  folders?: number
  posts?: number
  seed?: number
  /** the first (oldest) item's id */
  firstId?: number
  /** upload dates run evenly from `start` to `end` (ISO) */
  start?: string
  end?: string
}

const ADJECTIVES = [
  'quiet',
  'bright',
  'golden',
  'misty',
  'urban',
  'coastal',
  'rustic',
  'modern',
  'vivid',
  'soft',
  'stormy',
  'sunny',
  'frozen',
  'wild',
  'calm',
  'hidden',
  'nordic',
  'early',
  'late',
  'blue',
  'green',
  'amber',
  'silver',
  'velvet',
]
const NOUNS = [
  'harbour',
  'meadow',
  'skyline',
  'portrait',
  'workshop',
  'market',
  'forest',
  'studio',
  'bridge',
  'garden',
  'kitchen',
  'office',
  'festival',
  'product',
  'team',
  'street',
  'canyon',
  'lake',
  'island',
  'library',
  'stage',
  'bakery',
  'bicycle',
  'lighthouse',
  'mountain',
  'river',
  'café',
  'tårn',
  'sø',
  'strand',
]
const FOLDER_WORDS = [
  'Campaigns',
  'Products',
  'Events',
  'Blog',
  'Team',
  'Press',
  'Brand',
  'Stores',
  'Recipes',
  'Partners',
  'Social',
  'Newsletter',
  'Archive',
  'Website',
  'Print',
  'Video',
  'Podcasts',
  'Interiors',
  'Outdoor',
  'Seasonal',
]
const ALT_PHRASES = [
  'A person walking along',
  'Close-up of',
  'Wide view of',
  'Detail of',
  'Group of people at',
  'Empty',
  'Evening light over',
  'Morning at',
]
const ASPECTS: readonly [number, number][] = [
  [3, 2],
  [2, 3],
  [4, 3],
  [3, 4],
  [16, 9],
  [9, 16],
  [1, 1],
  [5, 4],
  [4, 5],
  [21, 9],
  [2, 1],
  [1, 2],
]

interface KindSpec {
  kind: MediaKind
  weight: number
  mimes: readonly [string, string][]
}

/** [mime, extension] per kind, with the share of the library each kind has. */
const KINDS: readonly KindSpec[] = [
  {
    kind: 'image',
    weight: 0.84,
    mimes: [
      ['image/jpeg', 'jpg'],
      ['image/jpeg', 'jpg'],
      ['image/jpeg', 'jpg'],
      ['image/png', 'png'],
      ['image/webp', 'webp'],
      ['image/gif', 'gif'],
    ],
  },
  { kind: 'svg', weight: 0.02, mimes: [['image/svg+xml', 'svg']] },
  {
    kind: 'video',
    weight: 0.04,
    mimes: [
      ['video/mp4', 'mp4'],
      ['video/webm', 'webm'],
    ],
  },
  { kind: 'audio', weight: 0.02, mimes: [['audio/mpeg', 'mp3']] },
  {
    kind: 'document',
    weight: 0.06,
    mimes: [
      ['application/pdf', 'pdf'],
      ['application/pdf', 'pdf'],
      [
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'docx',
      ],
      ['text/csv', 'csv'],
    ],
  },
  { kind: 'archive', weight: 0.015, mimes: [['application/zip', 'zip']] },
  { kind: 'other', weight: 0.005, mimes: [['application/json', 'json']] },
]

const BIG_IMAGE_THRESHOLD = 2560

function pickKind(random: Random): KindSpec {
  let roll = random.next()
  for (const spec of KINDS) {
    roll -= spec.weight
    if (roll < 0) {
      return spec
    }
  }
  return KINDS[0] as KindSpec
}

function generateFolders(random: Random, count: number): FakeFolder[] {
  const folders: FakeFolder[] = []
  const topLevel = Math.max(1, Math.round(count / 10))
  for (let id = 1; id <= count; id++) {
    let parent = 0
    if (id > topLevel) {
      // Children pick an earlier folder; that nests up to a few levels.
      parent = random.int(1, Math.min(id - 1, topLevel * 4))
    }
    const word = random.pick(FOLDER_WORDS)
    folders.push({
      id,
      name: parent === 0 ? `${word} ${id}` : `${word} ${2018 + (id % 9)}`,
      parent,
      ord: id - 1,
      color: random.chance(0.2)
        ? `#${random.int(0, 0xffffff).toString(16).padStart(6, '0')}`
        : null,
    })
  }
  return folders
}

function generatePosts(
  random: Random,
  count: number,
  firstId: number,
  startMs: number,
  endMs: number,
): FakePost[] {
  const posts: FakePost[] = []
  const step = (endMs - startMs) / Math.max(1, count)
  for (let index = 0; index < count; index++) {
    const page = random.chance(0.15)
    const roll = random.next()
    posts.push({
      id: firstId + index,
      type: page ? 'page' : 'post',
      title: `${capitalise(random.pick(ADJECTIVES))} ${random.pick(NOUNS)} ${page ? 'page' : 'story'} ${index + 1}`,
      status:
        roll < 0.9
          ? 'publish'
          : roll < 0.95
            ? 'draft'
            : roll < 0.98
              ? 'private'
              : 'pending',
      date: Math.floor((startMs + index * step) / 1000) * 1000,
      authorId: random.int(1, 3),
    })
  }
  return posts
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

function dimensionsFor(random: Random, kind: MediaKind): [number, number] {
  if (kind === 'audio' || kind === 'archive' || kind === 'other') {
    return [0, 0]
  }
  if (kind === 'document') {
    return [1240, 1754]
  }
  if (kind === 'video') {
    return random.chance(0.8) ? [1920, 1080] : [1080, 1920]
  }
  const [aspectWidth, aspectHeight] = random.pick(ASPECTS)
  const longEdge = random.int(400, 6000)
  return aspectWidth >= aspectHeight
    ? [longEdge, Math.round((longEdge * aspectHeight) / aspectWidth)]
    : [Math.round((longEdge * aspectWidth) / aspectHeight), longEdge]
}

function filesizeFor(
  random: Random,
  kind: MediaKind,
  mime: string,
  width: number,
  height: number,
): number {
  const jitter = 0.6 + random.next() * 0.8
  switch (kind) {
    case 'video':
      return Math.round(random.int(2, 120) * 1_000_000 * jitter)
    case 'audio':
      return Math.round(random.int(1, 40) * 1_000_000 * jitter)
    case 'archive':
      return Math.round(random.int(1, 50) * 1_000_000 * jitter)
    case 'document':
    case 'other':
      return Math.round(random.int(20, 4000) * 1000 * jitter)
    case 'svg':
      return random.int(800, 40_000)
    default: {
      const bytesPerPixel =
        mime === 'image/png'
          ? 1.1
          : mime === 'image/gif'
            ? 0.5
            : mime === 'image/webp'
              ? 0.12
              : 0.22
      return Math.max(2000, Math.round(width * height * bytesPerPixel * jitter))
    }
  }
}

/**
 * A deterministic dataset. Ids grow with the upload date, as in WordPress.
 * 50k items take well under a second in Node.
 */
export function generateDataset(options: GenerateOptions): FakeDataset {
  const random = createRandom(options.seed ?? 20261122)
  const startMs = Date.parse(options.start ?? '2019-01-01T08:00:00Z')
  const endMs = Date.parse(options.end ?? '2026-11-20T18:00:00Z')
  const folderCount = options.folders ?? 300
  const postCount = options.posts ?? 500
  const firstId = options.firstId ?? 10_001
  const folders = generateFolders(random, folderCount)
  const posts = generatePosts(
    random,
    postCount,
    firstId + options.items + 1000,
    startMs,
    endMs,
  )
  const publishedPosts = posts.filter((post) => post.status === 'publish')
  const items: FakeItem[] = []
  const step = (endMs - startMs) / Math.max(1, options.items)

  for (let index = 0; index < options.items; index++) {
    const spec = pickKind(random)
    const [mime, extension] = random.pick(spec.mimes)
    const kind = spec.kind
    let [width, height] = dimensionsFor(random, kind)
    let original: { width: number; height: number } | null = null
    if (kind === 'image' && Math.max(width, height) > BIG_IMAGE_THRESHOLD) {
      original = { width, height }
      const scale = BIG_IMAGE_THRESHOLD / Math.max(width, height)
      width = Math.round(width * scale)
      height = Math.round(height * scale)
    }
    const name = `${random.pick(ADJECTIVES)}-${random.pick(NOUNS)}-${random.int(1, 9999)}`
    const uploadedAt =
      Math.floor((startMs + index * step + random.next() * step * 0.9) / 1000) *
      1000
    const imageLike = kind === 'image' || kind === 'svg'
    const usage: FakeUsage[] = []
    if (publishedPosts.length > 0 && random.chance(0.4)) {
      const uses = random.int(1, 3)
      for (let use = 0; use < uses; use++) {
        const post = random.pick(publishedPosts)
        if (!usage.some((entry) => entry.postId === post.id)) {
          usage.push({
            postId: post.id,
            contexts: [
              random.pick([
                'image-block',
                'gallery-block',
                'featured',
                'content',
              ] as const),
            ],
          })
        }
      }
    }
    items.push({
      id: firstId + index,
      kind,
      mime,
      title: name,
      filename: `${name}.${extension}`,
      width,
      height,
      filesize: filesizeFor(random, kind, mime, width, height),
      alt:
        imageLike && random.chance(0.6)
          ? `${random.pick(ALT_PHRASES)} ${name.replace(/-\d+$/, '').replace('-', ' ')}`
          : '',
      caption: random.chance(0.3)
        ? `${capitalise(random.pick(ADJECTIVES))} ${random.pick(NOUNS)}`
        : '',
      description: random.chance(0.15)
        ? `Photographed for the ${random.pick(FOLDER_WORDS).toLowerCase()} team.`
        : '',
      uploadedAt,
      modifiedAt: uploadedAt,
      authorId: random.chance(0.5) ? 1 : random.chance(0.7) ? 2 : 3,
      folder:
        folderCount > 0 && random.chance(0.75) ? random.int(1, folderCount) : 0,
      postParent: usage[0]?.postId ?? null,
      status: 'inherit',
      trashedAt: null,
      original,
      duration:
        kind === 'video' || kind === 'audio' ? random.int(5, 3600) : null,
      pages: mime === 'application/pdf' ? random.int(1, 80) : null,
      exif: null,
      media: null,
      edited: false,
      editedAt: null,
      undoable: false,
      restorable: false,
      sizesPending: random.chance(0.002),
      beforeEdit: null,
      pristine: width > 0 ? { width, height } : null,
      usage,
      imageSeed: String(firstId + index),
    })
  }
  return { items, folders, posts, users: [] }
}
