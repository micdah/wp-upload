import { describe, expect, it } from 'vitest'
import { buildEntries, type EntryInput, treeItems } from './entries'
import { indexFolders } from './model'
import { sampleFolders } from './test/seedFolders'

// The column's row list: pseudo rows, the separator, the folders and the
// inline input, with the ARIA numbers a flat virtualised tree needs.

function input(patch: Partial<EntryInput> = {}): EntryInput {
  return {
    index: indexFolders(sampleFolders()),
    expanded: new Set(),
    sort: 'manual',
    search: '',
    editing: null,
    pendingCreate: null,
    trash: false,
    ...patch,
  }
}

function shape(patch: Partial<EntryInput> = {}) {
  return buildEntries(input(patch)).entries.map((entry) =>
    entry.kind === 'separator'
      ? '---'
      : `${entry.key}:${entry.level}:${entry.posInSet}/${entry.setSize}`,
  )
}

describe('buildEntries', () => {
  it('puts All files and Uncategorized at level 1 before the folders', () => {
    expect(shape()).toEqual([
      'all:1:1/5',
      'uncategorized:1:2/5',
      '---',
      'f1:1:3/5',
      'f2:1:4/5',
      'f3:1:5/5',
    ])
  })

  it('adds the Trash row when the Trash is on', () => {
    expect(shape({ trash: true }).slice(0, 4)).toEqual([
      'all:1:1/6',
      'uncategorized:1:2/6',
      'trash:1:3/6',
      '---',
    ])
  })

  it('hides the pseudo rows and marks matches while searching', () => {
    const list = buildEntries(input({ search: 'logo' }))
    expect(list.searching).toBe(true)
    expect(list.matchCount).toBe(1)
    expect(
      list.entries.map((entry) =>
        entry.kind === 'folder' ? [entry.ref, entry.match] : entry.kind,
      ),
    ).toEqual([
      [1, false],
      [4, true],
    ])
  })

  it('places a new folder input as the parent’s last child', () => {
    expect(
      shape({
        expanded: new Set([1]),
        editing: { mode: 'new', parent: 1 },
      }),
    ).toEqual([
      'all:1:1/5',
      'uncategorized:1:2/5',
      '---',
      'f1:1:3/5',
      'f4:2:1/3',
      'f5:2:2/3',
      'new:2:3/3',
      'f2:1:4/5',
      'f3:1:5/5',
    ])
  })

  it('places a new top-level folder at the end and counts it', () => {
    expect(shape({ editing: { mode: 'new', parent: 0 } })).toEqual([
      'all:1:1/6',
      'uncategorized:1:2/6',
      '---',
      'f1:1:3/6',
      'f2:1:4/6',
      'f3:1:5/6',
      'new:1:6/6',
    ])
  })

  it('shows the parent of a new folder as open, even when empty', () => {
    const list = buildEntries(input({ editing: { mode: 'new', parent: 3 } }))
    const parent = list.entries.find((entry) => entry.key === 'f3')
    expect(parent?.kind === 'folder' && parent.row.expanded).toBe(true)
    expect(list.entries.at(-1)?.key).toBe('new')
  })

  it('shows a pending create where the input was', () => {
    const list = buildEntries(
      input({ pendingCreate: { parent: 0, name: 'Logos' } }),
    )
    const last = list.entries.at(-1)
    expect(last?.kind).toBe('pending')
    expect(last?.kind === 'pending' && last.name).toBe('Logos')
  })

  it('says when there are no folders at all', () => {
    const list = buildEntries(input({ index: indexFolders([]) }))
    expect(list.noFolders).toBe(true)
    expect(list.entries.map((entry) => entry.kind)).toEqual([
      'all',
      'uncategorized',
    ])
  })

  it('lists treeitems without the separator', () => {
    const items = treeItems(buildEntries(input()).entries)
    expect(items.map((entry) => entry.key)).toEqual([
      'all',
      'uncategorized',
      'f1',
      'f2',
      'f3',
    ])
  })
})
