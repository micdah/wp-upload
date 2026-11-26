import type { Folder } from '../../../../../../shared/library-api'

// Deterministic synthetic folder lists for spike C3: the `large` seed's 300
// folders (plan §5) and a 5k stress case. Same shape as the API's
// `FolderTree.folders`: flat, sorted by parent, then ord, then id.

const WORDS = [
  'Brand',
  'Press kit',
  'Events',
  'Products',
  'Team',
  'Archive',
  'Social',
  'Campaigns',
  'Logos',
  'Video',
  'Print',
  'Web',
  'Drafts',
  'Partners',
  'Stock',
  'Portraits',
]

/** mulberry32: a tiny seeded PRNG, so every run builds the same tree. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export interface SeedOptions {
  /** default 1 */
  seed?: number
  /** deepest level (1 = top level only). Default 5 */
  maxDepth?: number
  /** share of folders placed at the top level. Default 0.2 */
  topLevelShare?: number
}

/**
 * `count` folders with ids 1…count. Each folder goes to the top level or under
 * a random earlier folder that isn't at `maxDepth` yet, so the tree is a mix
 * of wide and deep branches, like a real library.
 */
export function seedFolders(
  count: number,
  { seed = 1, maxDepth = 5, topLevelShare = 0.2 }: SeedOptions = {},
): Folder[] {
  const random = makeRandom(seed)
  const folders: Folder[] = []
  const depthOf = new Map<number, number>()
  const childCount = new Map<number, number>()
  const nestable: number[] = []
  for (let id = 1; id <= count; id++) {
    let parent = 0
    if (nestable.length > 0 && random() >= topLevelShare) {
      parent = nestable[Math.floor(random() * nestable.length)] ?? 0
    }
    const depth = (depthOf.get(parent) ?? 0) + 1
    const ord = childCount.get(parent) ?? 0
    childCount.set(parent, ord + 1)
    depthOf.set(id, depth)
    if (depth < maxDepth) {
      nestable.push(id)
    }
    const word = WORDS[Math.floor(random() * WORDS.length)] ?? 'Folder'
    folders.push({
      id,
      name: `${word} ${id}`,
      parent,
      ord,
      color: null,
      count: Math.floor(random() * 200),
    })
  }
  return folders.sort((a, b) => a.parent - b.parent || a.ord - b.ord)
}

/** A small hand-made tree for exact assertions. */
export function sampleFolders(): Folder[] {
  // Brand (1)          ├ Logos (4) ─ Old (7)
  //                    └ Colours (5)
  // Events (2)         └ 2026 (6)
  // Archive (3)
  const folder = (
    id: number,
    name: string,
    parent: number,
    ord: number,
  ): Folder => ({ id, name, parent, ord, color: null, count: id })
  return [
    folder(1, 'Brand', 0, 0),
    folder(2, 'Events', 0, 1),
    folder(3, 'Archive', 0, 2),
    folder(4, 'Logos', 1, 0),
    folder(5, 'Colours', 1, 1),
    folder(6, '2026', 2, 0),
    folder(7, 'Old', 4, 0),
  ]
}
