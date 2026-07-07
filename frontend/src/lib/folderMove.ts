import type { FolderOrderItem } from '../api/types'
import type { FolderNode } from './folderTree'

export type DropPosition =
  | { kind: 'onto'; folderId: number }
  | { kind: 'between'; parentId: number | null; index: number }

function findNode(tree: FolderNode[], id: number): FolderNode | null {
  for (const node of tree) {
    if (node.id === id) return node
    const found = findNode(node.children, id)
    if (found) return found
  }
  return null
}

function childrenOf(tree: FolderNode[], parentId: number | null): FolderNode[] {
  if (parentId === null) return tree
  return findNode(tree, parentId)?.children ?? []
}

function collectIds(node: FolderNode, acc: Set<number>): void {
  acc.add(node.id)
  for (const child of node.children) collectIds(child, acc)
}

export function computeFolderMove(
  tree: FolderNode[],
  dragId: number,
  drop: DropPosition,
): FolderOrderItem[] {
  const dragNode = findNode(tree, dragId)
  if (!dragNode) return []

  const targetParentId = drop.kind === 'onto' ? drop.folderId : drop.parentId

  // Illegal: dropping into self or into one of the dragged node's own descendants.
  const subtree = new Set<number>()
  collectIds(dragNode, subtree)
  if (targetParentId !== null && subtree.has(targetParentId)) return []

  // Destination siblings, with the dragged node removed if already present.
  const siblings = childrenOf(tree, targetParentId).filter((n) => n.id !== dragId)

  let insertIndex: number
  if (drop.kind === 'onto') {
    insertIndex = siblings.length // append as the last child
  } else {
    insertIndex = Math.max(0, Math.min(drop.index, siblings.length))
  }

  const ordered = [...siblings]
  ordered.splice(insertIndex, 0, dragNode)

  const deltas: FolderOrderItem[] = []
  ordered.forEach((node, index) => {
    const parentChanged = node.id === dragId && (node.parentId ?? null) !== targetParentId
    if (node.id === dragId || parentChanged || node.sortOrder !== index) {
      deltas.push({ id: node.id, parentId: targetParentId, sortOrder: index })
    }
  })

  return deltas
}
