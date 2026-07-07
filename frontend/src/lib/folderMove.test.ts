import { describe, expect, it } from 'vitest'
import { buildFolderTree } from './folderTree'
import { computeFolderMove, resolveDropPosition, resolveRootDrop } from './folderMove'
import type { Folder } from '../api/types'

// A(1) [C(3), D(4)], B(2)  — roots A,B; A has children C,D
const f = (id: number, parentId: number | null, sortOrder: number): Folder => ({
  id, name: `f${id}`, parentId, description: null, coverImageFileId: null, sortOrder, isSystem: false,
})
const tree = () => buildFolderTree([f(1, null, 0), f(2, null, 1), f(3, 1, 0), f(4, 1, 1)])

describe('computeFolderMove', () => {
  it('reorders root siblings: move B before A', () => {
    const items = computeFolderMove(tree(), 2, { kind: 'between', parentId: null, index: 0 })
    expect(items).toContainEqual({ id: 2, parentId: null, sortOrder: 0 })
    expect(items).toContainEqual({ id: 1, parentId: null, sortOrder: 1 })
  })

  it('re-nests B onto A, appended after A\'s existing children', () => {
    const items = computeFolderMove(tree(), 2, { kind: 'onto', folderId: 1 })
    expect(items).toEqual([{ id: 2, parentId: 1, sortOrder: 2 }])
  })

  it('reorders children: move D before C', () => {
    const items = computeFolderMove(tree(), 4, { kind: 'between', parentId: 1, index: 0 })
    expect(items).toContainEqual({ id: 4, parentId: 1, sortOrder: 0 })
    expect(items).toContainEqual({ id: 3, parentId: 1, sortOrder: 1 })
  })

  it('refuses dropping a folder onto itself', () => {
    expect(computeFolderMove(tree(), 1, { kind: 'onto', folderId: 1 })).toEqual([])
  })

  it('refuses dropping a folder into its own descendant', () => {
    // A(1) onto C(3), which is a child of A -> cycle
    expect(computeFolderMove(tree(), 1, { kind: 'onto', folderId: 3 })).toEqual([])
    expect(computeFolderMove(tree(), 1, { kind: 'between', parentId: 3, index: 0 })).toEqual([])
  })

  it('returns [] when the dragged folder does not exist', () => {
    expect(computeFolderMove(tree(), 999, { kind: 'onto', folderId: 1 })).toEqual([])
  })
})

describe('resolveDropPosition', () => {
  it('onto a folder → onto DropPosition', () => {
    expect(resolveDropPosition(tree(), 2, 1, 'onto')).toEqual({ kind: 'onto', folderId: 1 })
  })

  it('before a root sibling → between at that index', () => {
    // drag D(4) before B(2): root siblings without drag = [A(1), B(2)], B at index 1
    expect(resolveDropPosition(tree(), 4, 2, 'before')).toEqual({ kind: 'between', parentId: null, index: 1 })
  })

  it('after a root sibling → between at index+1', () => {
    // drag C(3) after B(2): root siblings without drag = [A(1), B(2)], B at index 1 → 2
    expect(resolveDropPosition(tree(), 3, 2, 'after')).toEqual({ kind: 'between', parentId: null, index: 2 })
  })

  it('reorder within a parent (after a sibling)', () => {
    // drag C(3) after D(4): children of A(1) without drag = [D(4)], D at index 0 → 1
    expect(resolveDropPosition(tree(), 3, 4, 'after')).toEqual({ kind: 'between', parentId: 1, index: 1 })
  })

  it('onto/into itself → null', () => {
    expect(resolveDropPosition(tree(), 1, 1, 'onto')).toBeNull()
    expect(resolveDropPosition(tree(), 1, 1, 'before')).toBeNull()
  })

  it('unknown target → null', () => {
    expect(resolveDropPosition(tree(), 1, 999, 'onto')).toBeNull()
  })
})

describe('resolveRootDrop', () => {
  it('moves the dragged folder to the end of the root list', () => {
    // roots without drag C(3) = [A(1), B(2)] → index 2
    expect(resolveRootDrop(tree(), 3)).toEqual({ kind: 'between', parentId: null, index: 2 })
  })
})
