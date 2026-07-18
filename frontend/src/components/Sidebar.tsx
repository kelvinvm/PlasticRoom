import { useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import type { Folder, FolderOrderItem, Tag } from '../api/types'
import { buildFolderTree, type FolderNode } from '../lib/folderTree'
import { deleteFolder, deleteTag, reorderFolders, updateFolder, updateTag } from '../api/client'
import { computeFolderMove, resolveDropPosition, resolveRootDrop, type DropZone } from '../lib/folderMove'
import { tagColor, TAG_COLOR_KEYS } from '../lib/format'
import { ConfirmDialog } from './ConfirmDialog'
import styles from './Sidebar.module.css'

interface SidebarProps {
  folders: Folder[]
  selectedFolderId: number | null
  onSelectFolder: (id: number | null) => void
  onImport: () => void
  reloadFolders: () => void
  reloadFiles: () => void
  tags: Tag[]
  selectedTagIds: number[]
  onToggleTag: (id: number) => void
  reloadTags: () => void
  onTagDeleted: (id: number) => void
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
  openMenuId: number | null
  onOpenMenu: (id: number) => void
  onCloseMenu: () => void
  dragId: number | null
  dropTarget: { id: number | 'root'; zone: DropZone } | null
  onDragStartRow: (id: number) => void
  onDragOverRow: (id: number, zone: DropZone) => void
  onDragLeaveRow: (id: number) => void
  onDropRow: (id: number, zone: DropZone) => void
  onDragEndRow: () => void
}

function zoneFromEvent(e: DragEvent<HTMLDivElement>): DropZone {
  const rect = e.currentTarget.getBoundingClientRect()
  const offset = e.clientY - rect.top
  return rect.height > 0 && offset < rect.height * 0.25 ? 'before'
    : rect.height > 0 && offset > rect.height * 0.75 ? 'after'
    : 'onto'
}

function FolderRow({
  node, depth, selectedFolderId, onSelectFolder, collapsed, onToggleCollapse, onRename, onRequestDelete,
  openMenuId, onOpenMenu, onCloseMenu,
  dragId, dropTarget, onDragStartRow, onDragOverRow, onDragLeaveRow, onDropRow, onDragEndRow,
}: RowProps) {
  const selected = node.id === selectedFolderId
  const hasChildren = node.children.length > 0
  const isCollapsed = collapsed.has(node.id)
  const editable = true
  const menuOpen = openMenuId === node.id

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

  const isTarget = dropTarget !== null && dropTarget.id === node.id
  const dropClass = isTarget
    ? dropTarget!.zone === 'before' ? styles.dropBefore
      : dropTarget!.zone === 'after' ? styles.dropAfter
      : styles.dropTarget
    : ''

  return (
    <>
      <div
        className={`${styles.row} ${selected ? styles.rowSelected : ''} ${dropClass}`}
        style={{ paddingLeft: 12 + depth * 14 }}
        draggable={editable}
        onContextMenu={editable ? (e) => { e.preventDefault(); onOpenMenu(node.id) } : undefined}
        onDragStart={editable ? () => onDragStartRow(node.id) : undefined}
        onDragOver={editable ? (e) => { e.preventDefault(); onDragOverRow(node.id, zoneFromEvent(e)) } : undefined}
        onDragLeave={editable ? (e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) onDragLeaveRow(node.id) } : undefined}
        onDrop={editable ? (e) => { e.preventDefault(); onDropRow(node.id, zoneFromEvent(e)) } : undefined}
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
          <div className={styles.menu} role="menu" onMouseLeave={onCloseMenu}>
            <button
              type="button"
              role="menuitem"
              className={styles.menuItem}
              onClick={() => { onCloseMenu(); setDraft(node.name); committedRef.current = false; setRenaming(true) }}
            >
              Rename
            </button>
            <button
              type="button"
              role="menuitem"
              className={styles.menuItemDanger}
              onClick={() => { onCloseMenu(); onRequestDelete(node) }}
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
          openMenuId={openMenuId}
          onOpenMenu={onOpenMenu}
          onCloseMenu={onCloseMenu}
          dragId={dragId}
          dropTarget={dropTarget}
          onDragStartRow={onDragStartRow}
          onDragOverRow={onDragOverRow}
          onDragLeaveRow={onDragLeaveRow}
          onDropRow={onDropRow}
          onDragEndRow={onDragEndRow}
        />
      ))}
    </>
  )
}

export function Sidebar({
  folders, selectedFolderId, onSelectFolder, onImport, reloadFolders, reloadFiles,
  tags, selectedTagIds, onToggleTag, reloadTags, onTagDeleted,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [pendingDelete, setPendingDelete] = useState<FolderNode | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [openMenuId, setOpenMenuId] = useState<number | null>(null)
  const [dragId, setDragId] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: number | 'root'; zone: DropZone } | null>(null)

  const [openTagMenuId, setOpenTagMenuId] = useState<number | null>(null)
  const [recoloringTagId, setRecoloringTagId] = useState<number | null>(null)
  const [renamingTagId, setRenamingTagId] = useState<number | null>(null)
  const [tagDraft, setTagDraft] = useState('')
  const [pendingDeleteTag, setPendingDeleteTag] = useState<Tag | null>(null)
  const [tagDeleteError, setTagDeleteError] = useState<string | null>(null)

  const collectionsTree = buildFolderTree(folders)

  // Dismiss an open folder context menu on outside click or Escape.
  useEffect(() => {
    if (openMenuId === null) return
    const close = () => setOpenMenuId(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenMenuId(null) }
    document.addEventListener('click', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [openMenuId])

  // Dismiss an open tag context menu or recolor popover on outside click or Escape.
  useEffect(() => {
    if (openTagMenuId === null && recoloringTagId === null) return
    const close = () => { setOpenTagMenuId(null); setRecoloringTagId(null) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('click', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [openTagMenuId, recoloringTagId])

  const commitMove = async (items: FolderOrderItem[]) => {
    if (items.length === 0) return
    setActionError(null)
    try {
      await reorderFolders(items)
      reloadFolders()
      // The grid filter is descendant-inclusive, so a re-nest can change which
      // files fall under the selected folder — refresh the grid too.
      reloadFiles()
    } catch {
      setActionError('Could not move folder.')
    }
  }

  const handleDrop = (targetId: number, zone: DropZone) => {
    const source = dragId
    setDragId(null)
    setDropTarget(null)
    if (source === null) return
    const pos = resolveDropPosition(collectionsTree, source, targetId, zone)
    if (!pos) return
    return commitMove(computeFolderMove(collectionsTree, source, pos))
  }

  const handleRootDrop = () => {
    const source = dragId
    setDragId(null)
    setDropTarget(null)
    if (source === null) return
    return commitMove(computeFolderMove(collectionsTree, source, resolveRootDrop(collectionsTree, source)))
  }

  const handleDragLeaveRow = (id: number) =>
    setDropTarget((cur) => (cur?.id === id ? null : cur))

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

  const commitTagRename = async (tag: Tag) => {
    setRenamingTagId(null)
    const trimmed = tagDraft.trim()
    if (!trimmed || trimmed === tag.name) return
    setActionError(null)
    try {
      await updateTag(tag.id, trimmed, tag.colorKey)
      reloadTags()
    } catch {
      setActionError('Could not rename tag.')
    }
  }

  const commitTagRecolor = async (tag: Tag, colorKey: string) => {
    setRecoloringTagId(null)
    setActionError(null)
    try {
      await updateTag(tag.id, tag.name, colorKey)
      reloadTags()
    } catch {
      setActionError('Could not recolor tag.')
    }
  }

  const confirmDeleteTag = async () => {
    if (!pendingDeleteTag) return
    const id = pendingDeleteTag.id
    setTagDeleteError(null)
    try {
      await deleteTag(id)
      setPendingDeleteTag(null)
      onTagDeleted(id)
      reloadTags()
    } catch {
      setTagDeleteError('Could not delete tag.')
    }
  }

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

      <div className={styles.sectionLabel}>Collections</div>
      <div
        className={`${styles.row} ${allFilesSelected ? styles.rowSelected : ''} ${dropTarget?.id === 'root' ? styles.dropTarget : ''}`}
        style={{ paddingLeft: 12 }}
        onDragOver={(e) => { e.preventDefault(); setDropTarget({ id: 'root', zone: 'onto' }) }}
        onDrop={(e) => { e.preventDefault(); handleRootDrop() }}
      >
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
      {collectionsTree.map((node) => (
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
          openMenuId={openMenuId}
          onOpenMenu={setOpenMenuId}
          onCloseMenu={() => setOpenMenuId(null)}
          dragId={dragId}
          dropTarget={dropTarget}
          onDragStartRow={(id) => { setActionError(null); setDragId(id) }}
          onDragOverRow={(id, zone) => setDropTarget({ id, zone })}
          onDragLeaveRow={handleDragLeaveRow}
          onDropRow={handleDrop}
          onDragEndRow={() => { setDragId(null); setDropTarget(null) }}
        />
      ))}

      <div className={styles.sectionLabel}>Tags</div>
      {tags.map((tag) => {
        const active = selectedTagIds.includes(tag.id)
        const tagMenuOpen = openTagMenuId === tag.id
        const renaming = renamingTagId === tag.id
        const recoloring = recoloringTagId === tag.id
        return (
          <div key={tag.id} className={styles.tagRowWrap}>
            {renaming ? (
              <input
                className={styles.renameInput}
                autoFocus
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitTagRename(tag)
                  if (e.key === 'Escape') setRenamingTagId(null)
                }}
                onBlur={() => commitTagRename(tag)}
              />
            ) : (
              <button
                type="button"
                className={`${styles.tagRow} ${active ? styles.tagRowActive : ''}`}
                aria-pressed={active}
                onClick={() => onToggleTag(tag.id)}
                onContextMenu={(e) => { e.preventDefault(); setOpenTagMenuId(tag.id) }}
              >
                <span className={styles.tagDot} style={{ background: tagColor(tag.colorKey) }} aria-hidden="true" />
                <span className={styles.rowLabel}>{tag.name}</span>
              </button>
            )}

            {tagMenuOpen && (
              <div className={styles.menu} role="menu" onMouseLeave={() => setOpenTagMenuId(null)}>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  onClick={() => { setOpenTagMenuId(null); setTagDraft(tag.name); setRenamingTagId(tag.id) }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  onClick={(e) => { e.stopPropagation(); setOpenTagMenuId(null); setRecoloringTagId(tag.id) }}
                >
                  Recolor
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItemDanger}
                  onClick={() => { setOpenTagMenuId(null); setPendingDeleteTag(tag) }}
                >
                  Delete
                </button>
              </div>
            )}

            {recoloring && (
              <div className={styles.colorPopover} role="menu">
                {TAG_COLOR_KEYS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    role="menuitem"
                    aria-label={key}
                    className={styles.colorSwatch}
                    style={{ background: tagColor(key) }}
                    onClick={() => commitTagRecolor(tag, key)}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}

      {actionError && <div role="alert" className={styles.actionError}>{actionError}</div>}

      {pendingDelete && (
        <ConfirmDialog
          body={<>Delete “{pendingDelete.name}” and its subfolders? Files stay in your library but lose this folder assignment.</>}
          danger
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {pendingDeleteTag && (
        <ConfirmDialog
          body={<>Delete “{pendingDeleteTag.name}”? Files keep their other tags but lose this one.</>}
          danger
          error={tagDeleteError}
          onConfirm={confirmDeleteTag}
          onCancel={() => { setPendingDeleteTag(null); setTagDeleteError(null) }}
        />
      )}
    </nav>
  )
}
