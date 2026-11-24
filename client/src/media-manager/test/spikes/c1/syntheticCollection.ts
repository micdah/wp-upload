import { MEDIA_KINDS, ROW_STRIDE } from '../../../../../../shared/library-api'

// A deterministic, realistic-looking `CollectionResponse.rows` for the C1
// measurements: mostly photos in common camera ratios, some portraits,
// panoramas and odd sizes, a share of non-image kinds, and a few items with
// unknown sizes (0). Seeded, so every run lays out the same rows.

/** Mulberry32: a tiny seeded PRNG, good enough for test data. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const KIND = Object.fromEntries(
  MEDIA_KINDS.map((kind, code) => [kind, code]),
) as Record<(typeof MEDIA_KINDS)[number], number>

// [width, height] of common photo and video sizes.
const PICTURE_SIZES: [number, number][] = [
  [6000, 4000],
  [4000, 3000],
  [4032, 3024],
  [1920, 1080],
  [4000, 6000],
  [3000, 4000],
  [1080, 1350],
  [2048, 2048],
  [8000, 2000],
  [1200, 628],
  [640, 960],
]

/**
 * `count` items as a flat `[id, width, height, kindCode, …]` array, in the
 * shape `JSON.parse` gives the client (a plain number array).
 */
export function syntheticCollectionRows(count: number, seed = 1): number[] {
  const random = seededRandom(seed)
  const rows: number[] = new Array(count * ROW_STRIDE)
  for (let i = 0; i < count; i++) {
    const roll = random()
    let kind = KIND.image
    if (roll > 0.99) kind = KIND.other
    else if (roll > 0.97) kind = KIND.archive
    else if (roll > 0.91) kind = KIND.document
    else if (roll > 0.87) kind = KIND.audio
    else if (roll > 0.78) kind = KIND.video
    else if (roll > 0.74) kind = KIND.svg
    const size = PICTURE_SIZES[Math.floor(random() * PICTURE_SIZES.length)]
    const unknown = random() < 0.03 || kind === KIND.audio
    const offset = i * ROW_STRIDE
    rows[offset] = 1000 + i
    rows[offset + 1] = unknown || !size ? 0 : size[0]
    rows[offset + 2] = unknown || !size ? 0 : size[1]
    rows[offset + 3] = kind
  }
  return rows
}
