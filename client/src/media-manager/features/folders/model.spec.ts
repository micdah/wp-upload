import { describe, expect, it } from 'vitest'
import {
  ancestorsOf,
  applyFolderMove,
  cleanFolderName,
  currentPlacement,
  descendantIds,
  flattenVisible,
  folderDropAvailability,
  folderPath,
  hasFolderNamed,
  highlightParts,
  indexFolders,
  isSelfOrDescendant,
  nestedCounts,
  resolveFolderMove,
  searchFolders,
  sortSiblings,
  subtreeFileCount,
} from './model'
import { sampleFolders, seedFolders } from './test/seedFolders'

// The folder tree's pure model: flattening, the drop rules (nest vs
// reorder, cycle block) and moves in the API's `{ parent, position }` shape
// (lifted from spike C3), plus search, counts, sorting and names.

const ALL_EXPANDED = new Set([1, 2, 3, 4, 5, 6, 7])

function names(folders: ReturnType<typeof sampleFolders>, parent: number) {
  return folders
    .filter((folder) => folder.parent === parent)
    .sort((a, b) => a.ord - b.ord)
    .map((folder) => folder.name)
}

describe('flattenVisible', () => {
  it('lists only top-level rows when nothing is expanded', () => {
    const rows = flattenVisible(indexFolders(sampleFolders()), new Set())
    expect(rows.map((row) => row.id)).toEqual([1, 2, 3])
    expect(rows.map((row) => [row.level, row.posInSet, row.setSize])).toEqual([
      [1, 1, 3],
      [1, 2, 3],
      [1, 3, 3],
    ])
    expect(rows.map((row) => row.hasChildren)).toEqual([true, true, false])
    expect(rows.every((row) => !row.expanded)).toBe(true)
  })

  it('walks expanded folders depth first with ARIA fields', () => {
    const rows = flattenVisible(indexFolders(sampleFolders()), ALL_EXPANDED)
    expect(
      rows.map((row) => [
        row.id,
        row.index,
        row.level,
        row.parent,
        row.posInSet,
        row.setSize,
      ]),
    ).toEqual([
      [1, 0, 1, 0, 1, 3],
      [4, 1, 2, 1, 1, 2],
      [7, 2, 3, 4, 1, 1],
      [5, 3, 2, 1, 2, 2],
      [2, 4, 1, 0, 2, 3],
      [6, 5, 2, 2, 1, 1],
      [3, 6, 1, 0, 3, 3],
    ])
    // An expanded id without children is not "expanded".
    expect(rows.find((row) => row.id === 3)?.expanded).toBe(false)
    expect(rows.find((row) => row.id === 1)?.expanded).toBe(true)
  })

  it('hides the children of a collapsed folder even if they are expanded', () => {
    const rows = flattenVisible(indexFolders(sampleFolders()), new Set([4, 2]))
    expect(rows.map((row) => row.id)).toEqual([1, 2, 6, 3])
  })

  it('orders siblings by ord then id, whatever the input order', () => {
    const shuffled = sampleFolders().reverse()
    shuffled.push({
      id: 8,
      name: 'Tie',
      parent: 0,
      ord: 1,
      color: null,
      count: 0,
    })
    const rows = flattenVisible(indexFolders(shuffled), new Set())
    expect(rows.map((row) => row.id)).toEqual([1, 2, 8, 3])
  })

  it('shows orphans at the top level and survives a parent cycle', () => {
    const folders = [
      ...sampleFolders(),
      { id: 9, name: 'Orphan', parent: 99, ord: 0, color: null, count: 0 },
    ]
    const rows = flattenVisible(indexFolders(folders), new Set())
    expect(rows.map((row) => row.id)).toContain(9)

    // 10 ↔ 11 point at each other: unreachable from the top (left out),
    // and ancestorsOf stops instead of looping.
    const cyclic = [
      ...sampleFolders(),
      { id: 10, name: 'A', parent: 11, ord: 0, color: null, count: 0 },
      { id: 11, name: 'B', parent: 10, ord: 0, color: null, count: 0 },
    ]
    const cyclicIndex = indexFolders(cyclic)
    const cyclicRows = flattenVisible(cyclicIndex, new Set([10, 11]))
    expect(cyclicRows.map((row) => row.id)).toEqual([1, 2, 3])
    expect(ancestorsOf(cyclicIndex, 10)).toEqual([11])
  })

  it('flattens 5k folders, fully expanded, quickly', () => {
    const folders = seedFolders(5000)
    const expanded = new Set(folders.map((folder) => folder.id))
    const started = performance.now()
    const index = indexFolders(folders)
    const rows = flattenVisible(index, expanded)
    const elapsed = performance.now() - started
    console.log(
      `[C3] index + flatten 5k (all expanded): ${elapsed.toFixed(1)} ms`,
    )
    expect(rows.length).toBe(5000)
    expect(new Set(rows.map((row) => row.id)).size).toBe(5000)
    // Budget 50 ms (one long task); generous ceiling for slow CI.
    expect(elapsed).toBeLessThan(200)
  })
})

describe('the large seed', () => {
  it('is deterministic, sorted like the API and at most 5 levels deep', () => {
    const folders = seedFolders(300)
    expect(seedFolders(300)).toEqual(folders)
    const sorted = [...folders].sort(
      (a, b) => a.parent - b.parent || a.ord - b.ord || a.id - b.id,
    )
    expect(folders).toEqual(sorted)
    const index = indexFolders(folders)
    const rows = flattenVisible(index, new Set(folders.map((f) => f.id)))
    expect(rows.length).toBe(300)
    expect(Math.max(...rows.map((row) => row.level))).toBeLessThanOrEqual(5)
  })
})

describe('the cycle rule', () => {
  const index = indexFolders(sampleFolders())

  it('knows a folder’s subtree', () => {
    expect(isSelfOrDescendant(index, 1, 1)).toBe(true)
    expect(isSelfOrDescendant(index, 1, 7)).toBe(true)
    expect(isSelfOrDescendant(index, 4, 5)).toBe(false)
    expect(isSelfOrDescendant(index, 7, 1)).toBe(false)
    expect(ancestorsOf(index, 7)).toEqual([4, 1])
  })

  it('blocks every operation onto itself or into its subtree', () => {
    const self = folderDropAvailability(index, 1, { id: 1, expanded: false })
    expect(self.reason).toBe('self')
    expect(Object.values(self.operations)).toEqual([
      'blocked',
      'blocked',
      'blocked',
    ])
    const descendant = folderDropAvailability(index, 1, {
      id: 7,
      expanded: false,
    })
    expect(descendant.reason).toBe('cycle')
    expect(descendant.operations.combine).toBe('blocked')
    expect(descendant.operations['reorder-before']).toBe('blocked')
  })

  it('refuses to resolve or apply a move into the subtree', () => {
    expect(
      resolveFolderMove(index, 1, {
        kind: 'row',
        targetId: 7,
        operation: 'combine',
      }),
    ).toEqual({ ok: false, reason: 'cycle' })
    expect(
      resolveFolderMove(index, 1, {
        kind: 'row',
        targetId: 4,
        operation: 'reorder-after',
      }),
    ).toEqual({ ok: false, reason: 'cycle' })
    expect(
      resolveFolderMove(index, 4, {
        kind: 'row',
        targetId: 4,
        operation: 'combine',
      }),
    ).toEqual({ ok: false, reason: 'self' })
    expect(() =>
      applyFolderMove(sampleFolders(), 1, { parent: 7, position: 0 }),
    ).toThrow(/cycle/)
  })
})

describe('folderDropAvailability', () => {
  const index = indexFolders(sampleFolders())

  it('offers before, after and inside on a collapsed row', () => {
    const result = folderDropAvailability(index, 3, { id: 2, expanded: false })
    expect(result).toEqual({
      operations: {
        'reorder-before': 'available',
        'reorder-after': 'available',
        combine: 'available',
      },
      reason: null,
    })
  })

  it('has no "after" on an expanded row (its bottom edge means inside)', () => {
    const result = folderDropAvailability(index, 3, { id: 1, expanded: true })
    expect(result.operations['reorder-after']).toBe('not-available')
    expect(result.operations.combine).toBe('available')
  })

  it('offers only "inside" without a manual order', () => {
    const result = folderDropAvailability(
      index,
      3,
      { id: 2, expanded: false },
      { manualOrder: false },
    )
    expect(result.operations).toEqual({
      'reorder-before': 'not-available',
      'reorder-after': 'not-available',
      combine: 'available',
    })
  })
})

describe('resolveFolderMove and applyFolderMove', () => {
  const folders = sampleFolders()
  const index = indexFolders(folders)

  it('nests as the last child', () => {
    const result = resolveFolderMove(index, 3, {
      kind: 'row',
      targetId: 1,
      operation: 'combine',
    })
    expect(result).toEqual({
      ok: true,
      move: { parent: 1, position: 2 },
      noop: false,
    })
    if (!result.ok) throw new Error('expected a move')
    const after = applyFolderMove(folders, 3, result.move)
    expect(names(after, 1)).toEqual(['Logos', 'Colours', 'Archive'])
    expect(names(after, 0)).toEqual(['Brand', 'Events'])
  })

  it('reorders before and after a sibling, counting without itself', () => {
    // Archive (top, position 2) before Brand → position 0.
    const before = resolveFolderMove(index, 3, {
      kind: 'row',
      targetId: 1,
      operation: 'reorder-before',
    })
    expect(before).toEqual({
      ok: true,
      move: { parent: 0, position: 0 },
      noop: false,
    })
    // Brand (position 0) after Events: Events is at 0 once Brand is removed.
    const after = resolveFolderMove(index, 1, {
      kind: 'row',
      targetId: 2,
      operation: 'reorder-after',
    })
    expect(after).toEqual({
      ok: true,
      move: { parent: 0, position: 1 },
      noop: false,
    })
    if (!after.ok) throw new Error('expected a move')
    expect(names(applyFolderMove(folders, 1, after.move), 0)).toEqual([
      'Events',
      'Brand',
      'Archive',
    ])
  })

  it('moves across parents, renumbering both sibling groups', () => {
    // Old (under Logos) before Colours, under Brand.
    const result = resolveFolderMove(index, 7, {
      kind: 'row',
      targetId: 5,
      operation: 'reorder-before',
    })
    expect(result).toEqual({
      ok: true,
      move: { parent: 1, position: 1 },
      noop: false,
    })
    if (!result.ok) throw new Error('expected a move')
    const after = applyFolderMove(folders, 7, result.move)
    expect(names(after, 1)).toEqual(['Logos', 'Old', 'Colours'])
    expect(names(after, 4)).toEqual([])
    const ords = after
      .filter((folder) => folder.parent === 1)
      .map((folder) => folder.ord)
    expect(ords).toEqual([0, 1, 2])
    // API order: parent, then ord.
    expect(after.map((folder) => folder.parent)).toEqual([0, 0, 0, 1, 1, 1, 2])
    // The input is untouched.
    expect(folders).toEqual(sampleFolders())
  })

  it('moves to the end of the top level from the empty tree area', () => {
    expect(resolveFolderMove(index, 7, { kind: 'root' })).toEqual({
      ok: true,
      move: { parent: 0, position: 3 },
      noop: false,
    })
  })

  it('flags moves that change nothing', () => {
    const noops = [
      resolveFolderMove(index, 2, {
        kind: 'row',
        targetId: 1,
        operation: 'reorder-after',
      }),
      resolveFolderMove(index, 2, {
        kind: 'row',
        targetId: 3,
        operation: 'reorder-before',
      }),
      resolveFolderMove(index, 5, {
        kind: 'row',
        targetId: 1,
        operation: 'combine',
      }),
      resolveFolderMove(index, 3, { kind: 'root' }),
    ]
    for (const result of noops) {
      expect(result).toMatchObject({ ok: true, noop: true })
    }
  })

  it('reports unknown folders', () => {
    expect(resolveFolderMove(index, 99, { kind: 'root' })).toEqual({
      ok: false,
      reason: 'missing',
    })
  })
})

describe('display sort (FileBird Pro)', () => {
  const folders = [
    { id: 1, name: 'event 10', parent: 0, ord: 0, color: null, count: 0 },
    { id: 2, name: 'Event 2', parent: 0, ord: 1, color: null, count: 0 },
    { id: 3, name: 'archive', parent: 0, ord: 2, color: null, count: 0 },
  ]

  it('keeps the manual order by default', () => {
    expect(sortSiblings(folders, 'manual').map((f) => f.id)).toEqual([1, 2, 3])
  })

  it('sorts naturally and case-insensitively by name, both ways', () => {
    expect(sortSiblings(folders, 'name-asc').map((f) => f.id)).toEqual([
      3, 2, 1,
    ])
    expect(sortSiblings(folders, 'name-desc').map((f) => f.id)).toEqual([
      1, 2, 3,
    ])
  })

  it('applies to every level of the flattened tree', () => {
    const rows = flattenVisible(indexFolders(sampleFolders()), new Set([1]), {
      sort: 'name-asc',
    })
    expect(rows.map((row) => row.folder.name)).toEqual([
      'Archive',
      'Brand',
      'Colours',
      'Logos',
      'Events',
    ])
  })
})

describe('search', () => {
  const index = indexFolders(sampleFolders())

  it('matches case-insensitively and keeps every ancestor visible', () => {
    const search = searchFolders(index, '  OLD ')
    expect([...(search?.matches ?? [])]).toEqual([7])
    expect([...(search?.visible ?? [])].sort()).toEqual([1, 4, 7])
  })

  it('is off for an empty query', () => {
    expect(searchFolders(index, '   ')).toBeNull()
  })

  it('shows only the visible rows, expanded, without touching the saved set', () => {
    const search = searchFolders(index, 'old')
    const expanded = new Set<number>()
    const rows = flattenVisible(index, expanded, { only: search?.visible })
    expect(rows.map((row) => [row.id, row.level, row.expanded])).toEqual([
      [1, 1, true],
      [4, 2, true],
      [7, 3, false],
    ])
    // Set sizes count the visible siblings only.
    expect(rows.map((row) => row.setSize)).toEqual([1, 1, 1])
    expect(expanded.size).toBe(0)
  })

  it('marks the first match in a name', () => {
    expect(highlightParts('Press kit', 'xyz')).toBeNull()
    expect(highlightParts('Press kit', 'ss k')).toEqual({
      before: 'Pre',
      match: 'ss k',
      after: 'it',
    })
    expect(highlightParts('Logos', '')).toBeNull()
  })
})

describe('counts and subtrees', () => {
  const index = indexFolders(sampleFolders())

  it('lists a subtree depth first, without the folder itself', () => {
    expect(descendantIds(index, 1)).toEqual([4, 7, 5])
    expect(descendantIds(index, 3)).toEqual([])
  })

  it('sums the files of a subtree (the delete confirm)', () => {
    // counts equal ids in the sample: 1 + 4 + 7 + 5
    expect(subtreeFileCount(index, 1)).toBe(17)
    expect(subtreeFileCount(index, 7)).toBe(7)
  })

  it('computes nested counts for every folder in one pass', () => {
    const totals = nestedCounts(index)
    expect(totals.get(1)).toBe(17)
    expect(totals.get(4)).toBe(11)
    expect(totals.get(2)).toBe(8)
    expect(totals.get(3)).toBe(3)
    expect(totals.size).toBe(7)
  })

  it('handles 5k folders quickly', () => {
    const big = indexFolders(seedFolders(5000))
    const start = performance.now()
    const totals = nestedCounts(big)
    expect(performance.now() - start).toBeLessThan(100)
    const top = big.children.get(0) ?? []
    const sum = top.reduce(
      (total, folder) => total + (totals.get(folder.id) ?? 0),
      0,
    )
    const all = [...big.byId.values()].reduce((total, f) => total + f.count, 0)
    expect(sum).toBe(all)
  })

  it('names the path of ancestors, top first', () => {
    expect(folderPath(index, 7)).toEqual(['Brand', 'Logos'])
    expect(folderPath(index, 1)).toEqual([])
  })
})

describe('names', () => {
  it('collapses whitespace, trims and caps at 200 characters', () => {
    expect(cleanFolderName('  Press \n  kit  ')).toBe('Press kit')
    expect(cleanFolderName('   ')).toBe('')
    expect(cleanFolderName('a'.repeat(250))).toHaveLength(200)
  })

  it('finds an existing name anywhere, case-insensitively', () => {
    const index = indexFolders(sampleFolders())
    expect(hasFolderNamed(index, ' old ')).toBe(true)
    expect(hasFolderNamed(index, 'New')).toBe(false)
    expect(hasFolderNamed(index, '')).toBe(false)
  })
})

describe('currentPlacement (the Undo of a move)', () => {
  it('is the parent and the index among siblings without itself', () => {
    const folders = sampleFolders()
    const index = indexFolders(folders)
    expect(currentPlacement(index, 5)).toEqual({ parent: 1, position: 1 })
    expect(currentPlacement(index, 99)).toBeNull()
    // Moving away and back with it restores the original order.
    const away = applyFolderMove(folders, 5, { parent: 0, position: 0 })
    const back = applyFolderMove(away, 5, { parent: 1, position: 1 })
    const order = (list: typeof folders, parent: number) =>
      list
        .filter((folder) => folder.parent === parent)
        .sort((a, b) => a.ord - b.ord)
        .map((folder) => folder.id)
    expect(order(back, 1)).toEqual([4, 5])
    expect(order(back, 0)).toEqual([1, 2, 3])
  })
})
