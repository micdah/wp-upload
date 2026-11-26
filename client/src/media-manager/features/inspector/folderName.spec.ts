import { describe, expect, it } from 'vitest'
import type { Folder, FolderTree } from '../../../../../shared/library-api'
import { folderLabel, folderPath } from './folderName'

function folder(id: number, name: string, parent = 0): Folder {
  return { id, name, parent, ord: 0, color: null, count: 0 }
}

function tree(folders: Folder[]): FolderTree {
  return {
    rev: '1',
    mode: {} as FolderTree['mode'],
    folders,
    counts: { all: 0, uncategorized: 0 },
  }
}

const TREE = tree([
  folder(4, 'Blog'),
  folder(6, '2026', 4),
  folder(7, 'Spring campaign', 6),
  folder(11, 'Products'),
])

describe('folderPath', () => {
  it('joins the names from the top with " / "', () => {
    expect(folderPath(7, TREE)).toBe('Blog / 2026 / Spring campaign')
    expect(folderPath(6, TREE)).toBe('Blog / 2026')
    expect(folderPath(11, TREE)).toBe('Products')
  })

  it('calls 0 Uncategorized, with or without a tree', () => {
    expect(folderPath(0, TREE)).toBe('Uncategorized')
    expect(folderPath(0, undefined)).toBe('Uncategorized')
  })

  it('stops at a parent the tree lacks', () => {
    const orphan = tree([folder(6, '2026', 4), folder(7, 'Spring', 6)])
    expect(folderPath(7, orphan)).toBe('2026 / Spring')
  })

  it('says "This folder" when the tree is not loaded or lacks the folder', () => {
    expect(folderPath(7, undefined)).toBe('This folder')
    expect(folderPath(99, TREE)).toBe('This folder')
  })

  it('survives a cycle in the tree', () => {
    const cyclic = tree([folder(1, 'A', 2), folder(2, 'B', 1)])
    expect(folderPath(1, cyclic)).toBe('B / A')
  })
})

describe('folderLabel', () => {
  it('names All files, Trash and folders', () => {
    expect(folderLabel('all', undefined)).toBe('All files')
    expect(folderLabel('trash', undefined)).toBe('Trash')
    expect(folderLabel(0, TREE)).toBe('Uncategorized')
    expect(folderLabel(6, TREE)).toBe('Blog / 2026')
  })
})
