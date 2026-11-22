// Builds the prototype's sample library (prototype/data/media.json and
// folders.json) from Picsum's photo list. Every Picsum photo is from Unsplash
// under the Unsplash License; credits are kept per item.
//
// The WordPress-side fields (titles, alt text, folders, "used in", EXIF…) are
// synthetic and deterministic (seeded), so re-running gives the same library.
//
// Usage: node docs/media-manager/design/scripts/build-sample-data.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.resolve(scriptDir, '../prototype/data')

const PHOTO_COUNT = 86
const MAX_PER_AUTHOR = 4
// WordPress scales originals above 2560 px ("big image threshold").
const BIG_IMAGE_THRESHOLD = 2560

// --- Deterministic randomness, so the sample library is stable -------------

function createRandom(seed) {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}
const random = createRandom(20261122)
const pick = (list) => list[Math.floor(random() * list.length)]
const chance = (probability) => random() < probability

// --- Fetching and curating photos ------------------------------------------

async function fetchPicsumList() {
  const photos = []
  for (let page = 1; page <= 10; page++) {
    const response = await fetch(
      `https://picsum.photos/v2/list?page=${page}&limit=100`,
    )
    if (!response.ok) throw new Error(`Picsum list failed: ${response.status}`)
    photos.push(...(await response.json()))
  }
  return photos
}

// Prefers variety: all orientations, a cap per author, a spread of aspect
// ratios, so the justified grid shows realistic row packing.
function curatePhotos(photos) {
  const byOrientation = { portrait: [], square: [], landscape: [] }
  for (const photo of photos) {
    const ratio = photo.width / photo.height
    if (ratio < 0.9) byOrientation.portrait.push(photo)
    else if (ratio <= 1.1) byOrientation.square.push(photo)
    else byOrientation.landscape.push(photo)
  }

  const chosen = []
  const perAuthor = new Map()
  const take = (list, limit) => {
    for (const photo of list) {
      if (chosen.length >= PHOTO_COUNT || limit <= 0) return
      const count = perAuthor.get(photo.author) ?? 0
      if (count >= MAX_PER_AUTHOR) continue
      perAuthor.set(photo.author, count + 1)
      chosen.push(photo)
      limit--
    }
  }
  const shuffled = (list) =>
    list
      .map((photo) => ({ photo, key: random() }))
      .sort((a, b) => a.key - b.key)
      .map(({ photo }) => photo)

  take(shuffled(byOrientation.portrait), 26)
  take(shuffled(byOrientation.square), 6)
  take(shuffled(byOrientation.landscape), PHOTO_COUNT)
  return shuffled(chosen)
}

// --- Synthetic WordPress library -------------------------------------------

const FOLDERS = [
  { id: 1, name: 'Brand', parent: 0, color: '#7c5cff' },
  { id: 2, name: 'Logos', parent: 1 },
  { id: 3, name: 'Icons', parent: 1 },
  { id: 4, name: 'Blog', parent: 0, color: '#1fb6ff' },
  { id: 5, name: '2025', parent: 4 },
  { id: 6, name: '2026', parent: 4 },
  { id: 7, name: 'Spring campaign', parent: 6 },
  { id: 8, name: 'Events', parent: 0, color: '#ff7a59' },
  { id: 9, name: 'Conference 2025', parent: 8 },
  { id: 10, name: 'Summer party', parent: 8 },
  { id: 11, name: 'Products', parent: 0, color: '#13ce66' },
  { id: 12, name: 'Outdoor', parent: 11 },
  { id: 13, name: 'Interior', parent: 11 },
  { id: 14, name: 'Team', parent: 0 },
  { id: 15, name: 'Press kit', parent: 0, color: '#ffc82c' },
  { id: 16, name: 'Archive', parent: 0 },
]
const PHOTO_FOLDERS = [5, 6, 7, 9, 10, 12, 13, 14, 15, 16]

const UPLOADERS = ['Anna Berg', 'Jonas Holm', 'Site Admin']
const POSTS = [
  { id: 201, type: 'post', title: 'Spring newsletter' },
  { id: 202, type: 'post', title: 'Behind the scenes at our studio' },
  { id: 203, type: 'page', title: 'About us' },
  { id: 204, type: 'page', title: 'Home' },
  { id: 205, type: 'post', title: 'Conference 2025 recap' },
  { id: 206, type: 'post', title: 'Five ideas for summer' },
  { id: 207, type: 'page', title: 'Press' },
  { id: 208, type: 'post', title: 'Product launch: Outdoor line' },
]
const CAMERAS = [
  { camera: 'Sony ILCE-7M4', lens: 'FE 24-70mm F2.8 GM II' },
  { camera: 'Canon EOS R6', lens: 'RF 35mm F1.8 Macro' },
  { camera: 'Fujifilm X-T5', lens: 'XF 23mm F1.4 R LM WR' },
  { camera: 'iPhone 15 Pro', lens: 'Main camera 6.86mm f/1.78' },
]
const NOUNS = [
  'landscape',
  'street',
  'detail',
  'portrait',
  'texture',
  'skyline',
  'workspace',
  'coast',
  'forest',
  'interior',
  'still-life',
  'travel',
]

function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function scaledSize(width, height) {
  const longEdge = Math.max(width, height)
  if (longEdge <= BIG_IMAGE_THRESHOLD) return { width, height, scaled: false }
  const factor = BIG_IMAGE_THRESHOLD / longEdge
  return {
    width: Math.round(width * factor),
    height: Math.round(height * factor),
    scaled: true,
  }
}

function dateBetween(startMs, endMs) {
  return new Date(startMs + random() * (endMs - startMs))
}

function usedInSample() {
  if (!chance(0.45)) return []
  const count = 1 + Math.floor(random() * 3)
  const posts = new Set()
  while (posts.size < count) posts.add(pick(POSTS))
  return [...posts]
}

function photoItem(photo, index, uploadedAt) {
  const noun = pick(NOUNS)
  const baseName = `${noun}-${slugify(photo.author)}-${photo.id}`
  const size = scaledSize(photo.width, photo.height)
  const isPng = chance(0.08)
  const extension = isPng ? 'png' : 'jpg'
  const exif = chance(0.75) ? pick(CAMERAS) : null
  const altMissing = chance(0.22)
  const modifiedAt = chance(0.3)
    ? dateBetween(uploadedAt.getTime(), Date.parse('2026-11-20'))
    : uploadedAt
  return {
    id: 1000 + index,
    kind: 'image',
    mime: isPng ? 'image/png' : 'image/jpeg',
    picsumId: photo.id,
    title: baseName,
    filename: `${baseName}${size.scaled ? '-scaled' : ''}.${extension}`,
    alt: altMissing
      ? ''
      : `Sample ${noun.replace('-', ' ')} photograph by ${photo.author}`,
    caption: chance(0.35) ? `Photo: ${photo.author} / Unsplash` : '',
    description: '',
    width: size.width,
    height: size.height,
    originalWidth: photo.width,
    originalHeight: photo.height,
    filesize: Math.round(
      size.width * size.height * (isPng ? 1.1 : 0.32) * (0.8 + random() * 0.4),
    ),
    uploaded: uploadedAt.toISOString(),
    modified: modifiedAt.toISOString(),
    author: pick(UPLOADERS),
    folder: chance(0.82) ? pick(PHOTO_FOLDERS) : 0,
    attachedTo: chance(0.4) ? pick(POSTS) : null,
    usedIn: usedInSample(),
    exif: exif && {
      ...exif,
      focalLength: pick([24, 35, 50, 70, 85]),
      aperture: pick([1.8, 2.8, 4, 5.6, 8]),
      shutter: pick(['1/60', '1/125', '1/250', '1/1000']),
      iso: pick([100, 200, 400, 800, 1600]),
      taken: dateBetween(
        uploadedAt.getTime() - 30 * 86400000,
        uploadedAt.getTime(),
      ).toISOString(),
    },
    credit: { author: photo.author, url: photo.url },
  }
}

// A handful of non-image items so typed tiles and detail variants get designed.
function nonImageItems(photos, startId, uploadedDates) {
  const poster = (offset) => photos[(offset * 7) % photos.length]
  const base = (index, fields) => ({
    id: startId + index,
    caption: '',
    description: '',
    uploaded: uploadedDates[index].toISOString(),
    modified: uploadedDates[index].toISOString(),
    author: pick(UPLOADERS),
    attachedTo: null,
    usedIn: usedInSample(),
    exif: null,
    alt: '',
    ...fields,
  })
  return [
    base(0, {
      kind: 'video',
      mime: 'video/mp4',
      title: 'studio-tour',
      filename: 'studio-tour.mp4',
      width: 1920,
      height: 1080,
      duration: 94,
      filesize: 48_200_000,
      posterPicsumId: poster(1).id,
      folder: 14,
      credit: { author: poster(1).author, url: poster(1).url },
    }),
    base(1, {
      kind: 'video',
      mime: 'video/webm',
      title: 'product-teaser-outdoor',
      filename: 'product-teaser-outdoor.webm',
      width: 1080,
      height: 1920,
      duration: 21,
      filesize: 9_800_000,
      posterPicsumId: poster(2).id,
      folder: 12,
      credit: { author: poster(2).author, url: poster(2).url },
    }),
    base(2, {
      kind: 'document',
      mime: 'application/pdf',
      title: 'press-release-spring-2026',
      filename: 'press-release-spring-2026.pdf',
      width: 1240,
      height: 1754,
      pages: 3,
      filesize: 412_000,
      folder: 15,
    }),
    base(3, {
      kind: 'document',
      mime: 'application/pdf',
      title: 'annual-report-2025',
      filename: 'annual-report-2025.pdf',
      width: 1240,
      height: 1754,
      pages: 28,
      filesize: 6_300_000,
      folder: 16,
    }),
    base(4, {
      kind: 'audio',
      mime: 'audio/mpeg',
      title: 'podcast-episode-12',
      filename: 'podcast-episode-12.mp3',
      width: 1,
      height: 1,
      duration: 1843,
      filesize: 29_400_000,
      folder: 4,
    }),
    base(5, {
      kind: 'svg',
      mime: 'image/svg+xml',
      title: 'logo-mark',
      filename: 'logo-mark.svg',
      width: 512,
      height: 512,
      filesize: 3_100,
      folder: 2,
      alt: 'Company logo mark',
    }),
    base(6, {
      kind: 'archive',
      mime: 'application/zip',
      title: 'brand-assets',
      filename: 'brand-assets.zip',
      width: 1,
      height: 1,
      filesize: 18_700_000,
      folder: 1,
    }),
  ]
}

function folderCounts(items) {
  const counts = new Map(FOLDERS.map((folder) => [folder.id, 0]))
  for (const item of items) {
    if (item.folder) counts.set(item.folder, counts.get(item.folder) + 1)
  }
  return FOLDERS.map((folder, order) => ({
    ...folder,
    order,
    count: counts.get(folder.id),
  }))
}

async function main() {
  const photos = curatePhotos(await fetchPicsumList())
  const start = Date.parse('2024-11-25')
  const end = Date.parse('2026-11-20')
  const uploadDates = photos
    .map(() => dateBetween(start, end))
    .sort((a, b) => a - b)

  const images = photos.map((photo, index) =>
    photoItem(photo, index, uploadDates[index]),
  )
  // Non-image items get dates spread through the library, so they mix in
  // with the photos instead of clustering at one end of the sort order.
  const otherDates = Array.from({ length: 7 }, () => dateBetween(start, end))
  const others = nonImageItems(photos, 1000 + images.length, otherDates)
  const items = [...images, ...others]

  fs.mkdirSync(dataDir, { recursive: true })
  fs.writeFileSync(
    path.join(dataDir, 'media.json'),
    `${JSON.stringify(items, null, 2)}\n`,
  )
  fs.writeFileSync(
    path.join(dataDir, 'folders.json'),
    `${JSON.stringify(folderCounts(items), null, 2)}\n`,
  )
  console.log(`Wrote ${items.length} items and ${FOLDERS.length} folders`)
}

await main()
