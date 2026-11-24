// A small seeded PRNG (mulberry32), so generated libraries are identical on
// every run and in every browser: e2e screenshots and perf numbers compare.

export interface Random {
  /** [0, 1) */
  next(): number
  /** integer in [min, max] */
  int(min: number, max: number): number
  pick<T>(list: readonly T[]): T
  chance(probability: number): boolean
}

export function createRandom(seed: number): Random {
  let state = seed >>> 0
  function next(): number {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int(min, max) {
      return min + Math.floor(next() * (max - min + 1))
    },
    pick<T>(list: readonly T[]): T {
      const value = list[Math.floor(next() * list.length)]
      if (value === undefined) {
        throw new Error('pick() from an empty list')
      }
      return value
    },
    chance(probability) {
      return next() < probability
    },
  }
}

/** A stable 32-bit hash of a string (FNV-1a), e.g. for ETags and hues. */
export function hashString(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}
