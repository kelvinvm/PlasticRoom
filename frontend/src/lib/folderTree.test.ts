import { describe, expect, it } from 'vitest'
import { buildFolderTree } from './folderTree'
import type { Folder } from '../api/types'

const folder = (id: number, name: string, parentId: number | null, sortOrder = 0): Folder => ({
  id,
  name,
  parentId,
  description: null,
  coverImageFileId: null,
  sortOrder,
})

describe('buildFolderTree', () => {
  it('nests children under their parent', () => {
    const tree = buildFolderTree([
      folder(1, 'Parent', null),
      folder(2, 'Child', 1),
      folder(3, 'Grandchild', 2),
    ])
    expect(tree).toHaveLength(1)
    expect(tree[0].name).toBe('Parent')
    expect(tree[0].children[0].name).toBe('Child')
    expect(tree[0].children[0].children[0].name).toBe('Grandchild')
  })

  it('sorts siblings by sortOrder then name', () => {
    const tree = buildFolderTree([
      folder(1, 'Bravo', null, 1),
      folder(2, 'Alpha', null, 1),
      folder(3, 'First', null, 0),
    ])
    expect(tree.map((n) => n.name)).toEqual(['First', 'Alpha', 'Bravo'])
  })

  it('treats a folder whose parent is absent from the set as a root', () => {
    const tree = buildFolderTree([folder(2, 'Orphan', 99)])
    expect(tree).toHaveLength(1)
    expect(tree[0].name).toBe('Orphan')
  })

  it('sorts nested children, not just roots', () => {
    const tree = buildFolderTree([
      folder(1, 'Root', null),
      folder(2, 'Zeta', 1, 1),
      folder(3, 'Alpha', 1, 0),
    ])
    expect(tree[0].children.map((c) => c.name)).toEqual(['Alpha', 'Zeta'])
  })
})
