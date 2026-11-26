import { describe, expect, it } from 'vitest'
import type { Folder } from '../../../../../shared/library-api'
import { indexFolders } from './model'
import {
  buildMoveOptions,
  currentTarget,
  describeFolderMove,
  describeItemsMove,
  FOLDER_MOVE_TEXT,
  keepActive,
  type MoveOption,
  type MoveOptionsInput,
  ONE_FOLDER_RULE,
  stepActive,
} from './moveOptions'

// The tree used throughout (manual order = the listed order):
//
//   Brand (1, purple)
//     Logos (2)
//     Icons (3)
//   Blog (4, blue)
//     2025 (5)
//       Spring campaign (7)
//     2026 (6)
//   Events (8)

function folder(
  id: number,
  name: string,
  parent: number,
  ord: number,
  color: string | null = null,
): Folder {
  return { id, name, parent, ord, color, count: 0 }
}

const FOLDERS: Folder[] = [
  folder(1, 'Brand', 0, 0, '#7c5cff'),
  folder(2, 'Logos', 1, 0),
  folder(3, 'Icons', 1, 1),
  folder(4, 'Blog', 0, 1, '#1fb6ff'),
  folder(5, '2025', 4, 0),
  folder(7, 'Spring campaign', 5, 0),
  folder(6, '2026', 4, 1),
  folder(8, 'Events', 0, 2),
]

const index = indexFolders(FOLDERS)

function build(overrides: Partial<MoveOptionsInput> = {}): MoveOption[] {
  return buildMoveOptions({
    index,
    subject: { kind: 'items', current: null },
    recent: [],
    sort: 'manual',
    pro: false,
    query: '',
    ...overrides,
  })
}

/** Compact view: label@depth, with markers for Current and the group. */
function summary(options: readonly MoveOption[]): string[] {
  return options.map(
    (option) =>
      `${option.group ? `[${option.group}] ` : ''}${option.kind === 'create' ? '+' : ''}${option.label}@${option.depth}${option.current ? ' (current)' : ''}`,
  )
}

describe('buildMoveOptions without a query', () => {
  it('starts with Uncategorized for items, then every folder in tree order', () => {
    expect(summary(build())).toEqual([
      'Uncategorized@0',
      'Brand@0',
      'Logos@1',
      'Icons@1',
      'Blog@0',
      '2025@1',
      'Spring campaign@2',
      '2026@1',
      'Events@0',
    ])
    const [root] = build()
    expect(root).toMatchObject({ kind: 'root', target: 0, path: '' })
  })

  it('starts with Top level in folder mode', () => {
    const [root] = build({ subject: { kind: 'folder', folderId: 2 } })
    expect(root).toMatchObject({ kind: 'root', label: 'Top level', target: 0 })
  })

  it('shows Recent (with paths) and heads the rest "All folders"', () => {
    const options = build({ recent: [7, 1] })
    expect(summary(options).slice(0, 5)).toEqual([
      'Uncategorized@0',
      '[Recent] Spring campaign@0',
      '[Recent] Brand@0',
      '[All folders] Brand@0',
      '[All folders] Logos@1',
    ])
    expect(options[1]).toMatchObject({
      key: 'recent-7',
      target: 7,
      path: 'Blog · 2025',
    })
    // Keys stay unique when a folder is in both groups.
    const keys = options.map((option) => option.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('offers at most three recent folders, only ones that still exist', () => {
    const options = build({ recent: [99, 8, 0, 2, 8, 3, 5] })
    expect(
      options
        .filter((option) => option.group === 'Recent')
        .map((o) => o.target),
    ).toEqual([8, 2, 3])
  })

  it('has no headings when no recent folder is left', () => {
    const options = build({ recent: [99] })
    expect(options.every((option) => option.group === null)).toBe(true)
  })

  it('leaves out the moved folder and its subtree in folder mode, Recent too', () => {
    const options = build({
      subject: { kind: 'folder', folderId: 4 },
      recent: [5, 8],
    })
    expect(summary(options)).toEqual([
      'Top level@0 (current)',
      '[Recent] Events@0',
      '[All folders] Brand@0',
      '[All folders] Logos@1',
      '[All folders] Icons@1',
      '[All folders] Events@0',
    ])
  })
})

describe('Current', () => {
  it('marks the one folder every item is in', () => {
    const options = build({
      subject: { kind: 'items', current: 5 },
      recent: [5],
    })
    expect(
      options.filter((option) => option.current).map((option) => option.key),
    ).toEqual(['recent-5', 'folder-5'])
  })

  it('marks Uncategorized when every item is uncategorised', () => {
    const options = build({ subject: { kind: 'items', current: 0 } })
    expect(
      options.filter((option) => option.current).map((o) => o.key),
    ).toEqual(['root'])
  })

  it('marks nothing when the items are in several folders (or unknown)', () => {
    expect(build().some((option) => option.current)).toBe(false)
  })

  it('marks nothing for a folder that no longer exists', () => {
    expect(currentTarget(index, { kind: 'items', current: 99 })).toBeNull()
  })

  it('marks the parent in folder mode, or Top level for a top-level folder', () => {
    const nested = build({ subject: { kind: 'folder', folderId: 7 } })
    expect(nested.filter((o) => o.current).map((o) => o.key)).toEqual([
      'folder-5',
    ])
    const top = build({ subject: { kind: 'folder', folderId: 8 } })
    expect(top.filter((o) => o.current).map((o) => o.key)).toEqual(['root'])
  })
})

describe('buildMoveOptions with a query', () => {
  it('lists matches flat, each with its parent path', () => {
    const options = build({ query: '  20 ' })
    expect(summary(options)).toEqual(['2025@0', '2026@0', '+20@0'])
    expect(options.map((option) => option.path)).toEqual(['Blog', 'Blog', ''])
    expect(build({ query: 'spring' })[0]).toMatchObject({
      label: 'Spring campaign',
      path: 'Blog · 2025',
    })
  })

  it('matches case-insensitively and hides Recent and headings', () => {
    const options = build({ query: 'LOG', recent: [1] })
    expect(summary(options)).toEqual(['Logos@0', 'Blog@0', '+LOG@0'])
  })

  it('keeps the root option when its label matches', () => {
    expect(summary(build({ query: 'uncat' }))).toEqual([
      'Uncategorized@0',
      '+uncat@0',
    ])
    expect(
      build({ subject: { kind: 'folder', folderId: 2 }, query: 'top' })[0],
    ).toMatchObject({ kind: 'root', label: 'Top level' })
  })

  it('offers Create with the cleaned name when no folder has that exact name', () => {
    const create = build({ query: '  Press   kit ' }).at(-1)
    expect(create).toMatchObject({
      key: 'create',
      kind: 'create',
      target: null,
      label: 'Press kit',
      current: false,
    })
  })

  it('offers no Create when a folder has exactly that name, in any case', () => {
    const options = build({ query: 'blog' })
    expect(summary(options)).toEqual(['Blog@0'])
    // Anywhere in the tree, even inside the blocked subtree.
    const folderMode = build({
      subject: { kind: 'folder', folderId: 4 },
      query: '2025',
    })
    expect(folderMode).toEqual([])
  })

  it('offers no Create for an empty (whitespace) query', () => {
    expect(build({ query: '   ' }).some((o) => o.kind === 'create')).toBe(false)
  })

  it('leaves out the blocked subtree in folder mode', () => {
    const options = build({
      subject: { kind: 'folder', folderId: 4 },
      query: 'o',
    })
    expect(options.map((option) => option.label)).toEqual([
      'Top level',
      'Logos',
      'Icons',
      'o',
    ])
  })
})

describe('Pro', () => {
  it('sorts by name and passes colours through only with Pro', () => {
    const pro = build({ pro: true, sort: 'name-desc' })
    expect(summary(pro)).toEqual([
      'Uncategorized@0',
      'Events@0',
      'Brand@0',
      'Logos@1',
      'Icons@1',
      'Blog@0',
      '2026@1',
      '2025@1',
      'Spring campaign@2',
    ])
    expect(pro.find((option) => option.target === 1)?.color).toBe('#7c5cff')
    expect(pro.find((option) => option.target === 2)?.color).toBeNull()

    const lite = build({ pro: false, sort: 'name-desc' })
    expect(lite[1]?.label).toBe('Brand')
    expect(lite.every((option) => option.color === null)).toBe(true)
  })

  it('colours recent options too', () => {
    const options = build({ pro: true, recent: [4] })
    expect(options[1]).toMatchObject({ group: 'Recent', color: '#1fb6ff' })
  })
})

describe('the active option', () => {
  const options = build({ subject: { kind: 'items', current: 1 } })
  // Uncategorized, Brand (current), Logos, …

  it('skips Current on the way down and up', () => {
    expect(stepActive(options, 'root', 1)).toBe('folder-2')
    expect(stepActive(options, 'folder-2', -1)).toBe('root')
  })

  it('stays at either end', () => {
    expect(stepActive(options, 'root', -1)).toBe('root')
    expect(stepActive(options, 'folder-8', 1)).toBe('folder-8')
  })

  it('starts at the first or last choosable option when none is active', () => {
    expect(stepActive(options, null, 1)).toBe('root')
    expect(stepActive(options, null, -1)).toBe('folder-8')
  })

  it('keeps the active option while it is there, else takes the first choosable', () => {
    expect(keepActive(options, 'folder-6')).toBe('folder-6')
    expect(keepActive(options, 'folder-1')).toBe('root')
    expect(keepActive(options, 'gone')).toBe('root')
    const rootCurrent = build({ subject: { kind: 'items', current: 0 } })
    expect(keepActive(rootCurrent, null)).toBe('folder-1')
    expect(keepActive([], 'root')).toBeNull()
  })
})

describe('describeItemsMove', () => {
  const item = (folder: number | null | undefined, title = 'Beach') => ({
    title,
    filename: `${title.trim().toLowerCase() || 'file'}.jpg`,
    folder,
  })

  it('names one item by its title, else its file name', () => {
    expect(describeItemsMove(index, [10], [item(5)]).title).toBe('Move “Beach”')
    expect(describeItemsMove(index, [10], [item(5, ' ')]).title).toBe(
      'Move “file.jpg”',
    )
    expect(describeItemsMove(index, [10], [null]).title).toBe('Move 1 item')
  })

  it('counts several items', () => {
    expect(
      describeItemsMove(index, [1, 2, 3], [item(5), item(5), item(5)]),
    ).toMatchObject({
      title: 'Move 3 items',
      subtitle: `From “2025”. ${ONE_FOLDER_RULE}`,
      confirmLabel: 'Move here',
      subject: { kind: 'items', current: 5 },
    })
  })

  it('says Uncategorized, or how many folders', () => {
    expect(describeItemsMove(index, [1, 2], [item(0), item(0)])).toMatchObject({
      subtitle: `From Uncategorized. ${ONE_FOLDER_RULE}`,
      subject: { current: 0 },
    })
    expect(
      describeItemsMove(index, [1, 2, 3], [item(0), item(5), item(5)]),
    ).toMatchObject({
      subtitle: `From 2 folders. ${ONE_FOLDER_RULE}`,
      subject: { current: null },
    })
  })

  it('leaves out "From" and Current when a folder is unknown', () => {
    for (const unknown of [null, undefined, 99]) {
      expect(
        describeItemsMove(index, [1, 2], [item(5), item(unknown)]),
      ).toMatchObject({
        subtitle: ONE_FOLDER_RULE,
        subject: { current: null },
      })
    }
    expect(describeItemsMove(index, [1], [null]).subtitle).toBe(ONE_FOLDER_RULE)
  })
})

describe('describeFolderMove', () => {
  it('names the folder and what moves with it', () => {
    expect(describeFolderMove(index, 4)).toEqual({
      title: 'Move “Blog”',
      subtitle: FOLDER_MOVE_TEXT,
      confirmLabel: 'Move folder',
      subject: { kind: 'folder', folderId: 4 },
    })
  })
})
