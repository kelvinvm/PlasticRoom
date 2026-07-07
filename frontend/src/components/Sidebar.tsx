import { useRef, useState } from 'react'
import type { Folder } from '../api/types'
import { buildFolderTree, type FolderNode } from '../lib/folderTree'
import { deleteFolder, reorderFolders, updateFolder } from '../api/client'
import { computeFolderMove } from '../lib/folderMove'
import styles from './Sidebar.module.css'

interface SidebarProps {
  folders: Folder[]
  selectedFolderId: number | null
  onSelectFolder: (id: number | null) => void
  onImport: () => void
  reloadFolders: () => void
  reloadFiles: () => void
}

interface RowProps {
  node: FolderNode
  depth: number
  selectedFolderId: number | null
  onSelectFolder: (id: number | null) => void
  collapsed: Set<number>
  onToggleCollapse: (id: number) => void
  onRename: (id: number, name: string) => void
  onRequestDelete: (node: FolderNode) => void
  draggable: boolean
  dragId: number | null
  dropTargetId: number | null
  onDragStartRow: (id: number) => void
  onDragOverRow: (id: number) => void
  onDropRow: (id: number) => void
  onDragEndRow: () => void
}

function FolderRow({
  node, depth, selectedFolderId, onSelectFolder, collapsed, onToggleCollapse, onRename, onRequestDelete,
  draggable, dragId, dropTargetId, onDragStartRow, onDragOverRow, onDropRow, onDragEndRow,
}: RowProps) {
  const selected = node.id === selectedFolderId
  const hasChildren = node.children.length > 0
  const isCollapsed = collapsed.has(node.id)
  const editable = !node.isSystem

  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(node.name)
  const committedRef = useRef(false)

  const commitRename = () => {
    if (committedRef.current) return
    committedRef.current = true
    const trimmed = draft.trim()
    if (trimmed && trimmed !== node.name) onRename(node.id, trimmed)
    setRenaming(false)
  }

  return (
    <>
      <div
        className={`${styles.row} ${selected ? styles.rowSelected : ''} ${dropTargetId === node.id ? styles.dropTarget : ''}`}
        style={{ paddingLeft: 12 + depth * 14 }}
        draggable={editable}
        onContextMenu={editable ? (e) => { e.preventDefault(); setMenuOpen(true) } : undefined}
        onDragStart={editable ? (e) => { e.stopPropagation(); onDragStartRow(node.id) } : undefined}
        onDragOver={editable ? (e) => { e.preventDefault(); onDragOverRow(node.id) } : undefined}
        onDrop={editable ? (e) => { e.preventDefault(); onDropRow(node.id) } : undefined}
        onDragEnd={editable ? onDragEndRow : undefined}
      >
        {hasChildren ? (
          <button
            type="button"
            className={styles.chevron}
            aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${node.name}`}
            aria-expanded={!isCollapsed}
            onClick={() => onToggleCollapse(node.id)}
          >
            {isCollapsed ? '▸' : '▾'}
          </button>
        ) : (
          <span className={styles.chevronSpacer} aria-hidden="true" />
        )}

        {renaming ? (
          <input
            className={styles.renameInput}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') { setDraft(node.name); setRenaming(false) }
            }}
            onBlur={commitRename}
          />
        ) : (
          <button
            type="button"
            className={styles.rowMain}
            aria-current={selected ? 'true' : undefined}
            onClick={() => onSelectFolder(node.id)}
          >
            <span className={styles.folderIcon} aria-hidden="true">📁</span>
            <span className={styles.rowLabel}>{node.name}</span>
            <span className={styles.fileCount}>{node.fileCount ?? 0}</span>
          </button>
        )}

        {menuOpen && (
          <div className={styles.menu} role="menu" onMouseLeave={() => setMenuOpen(false)}>
            <button
              type="button"
              role="menuitem"
              className={styles.menuItem}
              onClick={() => { setMenuOpen(false); setDraft(node.name); committedRef.current = false; setRenaming(true) }}
            >
              Rename
            </button>
            <button
              type="button"
              role="menuitem"
              className={styles.menuItemDanger}
              onClick={() => { setMenuOpen(false); onRequestDelete(node) }}
            >
              Delete
            </button>
          </div>
        )}
      </div>
      {hasChildren && !isCollapsed && node.children.map((child) => (
        <FolderRow
          key={child.id}
          node={child}
          depth={depth + 1}
          selectedFolderId={selectedFolderId}
          onSelectFolder={onSelectFolder}
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          onRename={onRename}
          onRequestDelete={onRequestDelete}
          draggable={draggable}
          dragId={dragId}
          dropTargetId={dropTargetId}
          onDragStartRow={onDragStartRow}
          onDragOverRow={onDragOverRow}
          onDropRow={onDropRow}
          onDragEndRow={onDragEndRow}
        />
      ))}
    </>
  )
}

export function Sidebar({
  folders, selectedFolderId, onSelectFolder, onImport, reloadFolders, reloadFiles,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [pendingDelete, setPendingDelete] = useState<FolderNode | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [dragId, setDragId] = useState<number | null>(null)
  const [dropTargetId, setDropTargetId] = useState<number | null>(null)

  const libraryTreeNodes = buildFolderTree(folders.filter((f) => !f.isSystem))

  const handleDrop = async (targetFolderId: number) => {
    const source = dragId
    setDragId(null)
    setDropTargetId(null)
    if (source === null || source === targetFolderId) return
    const items = computeFolderMove(libraryTreeNodes, source, { kind: 'onto', folderId: targetFolderId })
    if (items.length === 0) return
    setActionError(null)
    try {
      await reorderFolders(items)
      reloadFolders()
    } catch {
      setActionError('Could not move folder.')
    }
  }

  const toggleCollapse = (id: number) =>
    setCollapsed((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const handleRename = async (id: number, name: string) => {
    setActionError(null)
    try {
      await updateFolder(id, { name })
      reloadFolders()
    } catch {
      setActionError('Could not rename folder.')
    }
  }

  const subtreeIds = (node: FolderNode): number[] =>
    [node.id, ...node.children.flatMap(subtreeIds)]

  const confirmDelete = async () => {
    if (!pendingDelete) return
    const removed = new Set(subtreeIds(pendingDelete))
    setActionError(null)
    try {
      await deleteFolder(pendingDelete.id)
      setPendingDelete(null)
      if (selectedFolderId !== null && removed.has(selectedFolderId)) {
        onSelectFolder(null)
      }
      reloadFolders()
      reloadFiles()
    } catch {
      setActionError('Could not delete folder.')
    }
  }

  const collectionsTree = buildFolderTree(folders.filter((f) => f.isSystem))
  const allFilesSelected = selectedFolderId === null

  return (
    <nav className={styles.sidebar}>
      <div className={styles.brand}>
        <span className={styles.brandMark} aria-hidden="true" />
        <span className={styles.brandName}>PlasticRoom</span>
      </div>

      <button type="button" className={styles.importButton} onClick={onImport}>
        ⬆ Import files
      </button>

      <div className={styles.sectionLabel}>Library</div>
      <div className={`${styles.row} ${allFilesSelected ? styles.rowSelected : ''}`} style={{ paddingLeft: 12 }}>
        <span className={styles.chevronSpacer} aria-hidden="true" />
        <button
          type="button"
          className={styles.rowMain}
          aria-current={allFilesSelected ? 'true' : undefined}
          onClick={() => onSelectFolder(null)}
        >
          <span className={styles.folderIcon} aria-hidden="true">📁</span>
          <span className={styles.rowLabel}>All Files</span>
        </button>
      </div>
      {libraryTreeNodes.map((node) => (
        <FolderRow
          key={node.id}
          node={node}
          depth={1}
          selectedFolderId={selectedFolderId}
          onSelectFolder={onSelectFolder}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapse}
          onRename={handleRename}
          onRequestDelete={setPendingDelete}
          draggable
          dragId={dragId}
          dropTargetId={dropTargetId}
          onDragStartRow={setDragId}
          onDragOverRow={setDropTargetId}
          onDropRow={handleDrop}
          onDragEndRow={() => { setDragId(null); setDropTargetId(null) }}
        />
      ))}

      <div className={styles.sectionLabel}>Collections</div>
      {collectionsTree.map((node) => (
        <FolderRow
          key={node.id}
          node={node}
          depth={0}
          selectedFolderId={selectedFolderId}
          onSelectFolder={onSelectFolder}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapse}
          onRename={handleRename}
          onRequestDelete={setPendingDelete}
          draggable={false}
          dragId={null}
          dropTargetId={null}
          onDragStartRow={() => {}}
          onDragOverRow={() => {}}
          onDropRow={() => {}}
          onDragEndRow={() => {}}
        />
      ))}

      {actionError && <div role="alert" className={styles.actionError}>{actionError}</div>}

      {pendingDelete && (
        <div className={styles.dialogBackdrop} onClick={() => setPendingDelete(null)}>
          <div className={styles.dialog} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <p className={styles.dialogBody}>
              Delete “{pendingDelete.name}” and its subfolders? Files stay in your library but
              lose this folder assignment.
            </p>
            <div className={styles.dialogActions}>
              <button type="button" className={styles.dialogCancel} onClick={() => setPendingDelete(null)}>
                Cancel
              </button>
              <button type="button" className={styles.dialogDelete} onClick={confirmDelete}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </nav>
  )
}
