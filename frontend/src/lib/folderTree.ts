import type { Folder } from '../api/types'

export interface FolderNode extends Folder {
  children: FolderNode[]
}

export function buildFolderTree(folders: Folder[]): FolderNode[] {
  const nodes = new Map<number, FolderNode>()
  for (const f of folders) {
    nodes.set(f.id, { ...f, children: [] })
  }

  const roots: FolderNode[] = []
  for (const node of nodes.values()) {
    if (node.parentId !== null && nodes.has(node.parentId)) {
      nodes.get(node.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  const sortRecursive = (list: FolderNode[]) => {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    list.forEach((n) => sortRecursive(n.children))
  }
  sortRecursive(roots)

  return roots
}
