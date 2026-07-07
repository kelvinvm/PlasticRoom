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

export type DropZone = 'before' | 'onto' | 'after'

// Map a hovered target row + zone to the DropPosition computeFolderMove expects.
// Returns null for a no-op (hovering the dragged row itself, or a missing target).
export function resolveDropPosition(
  tree: FolderNode[],
  dragId: number,
  targetId: number,
  zone: DropZone,
): DropPosition | null {
  if (targetId === dragId) return null
  const target = findNode(tree, targetId)
  if (!target) return null

  if (zone === 'onto') {
    return { kind: 'onto', folderId: targetId }
  }

  const parentId = target.parentId
  const siblings = childrenOf(tree, parentId).filter((n) => n.id !== dragId)
  const targetIndex = siblings.findIndex((n) => n.id === targetId)
  if (targetIndex === -1) return null
  const index = zone === 'before' ? targetIndex : targetIndex + 1
  return { kind: 'between', parentId, index }
}

// Drop onto the root/"All Files" target: move the dragged folder to the end of the root list.
export function resolveRootDrop(tree: FolderNode[], dragId: number): DropPosition {
  const rootCount = tree.filter((n) => n.id !== dragId).length
  return { kind: 'between', parentId: null, index: rootCount }
}
