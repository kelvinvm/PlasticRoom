import type { Folder } from '../api/types'
import { buildFolderTree, type FolderNode } from '../lib/folderTree'
import styles from './Sidebar.module.css'

interface SidebarProps {
  folders: Folder[]
  selectedFolderId: number | null
  onSelectFolder: (id: number | null) => void
}

interface RowProps {
  node: FolderNode
  depth: number
  selectedFolderId: number | null
  onSelectFolder: (id: number | null) => void
}

function FolderRow({ node, depth, selectedFolderId, onSelectFolder }: RowProps) {
  const selected = node.id === selectedFolderId
  return (
    <>
      <button
        type="button"
        className={`${styles.row} ${selected ? styles.rowSelected : ''}`}
        aria-current={selected ? 'true' : undefined}
        style={{ paddingLeft: 12 + depth * 14 }}
        onClick={() => onSelectFolder(node.id)}
      >
        <span className={styles.folderIcon} aria-hidden="true">
          📁
        </span>
        <span className={styles.rowLabel}>{node.name}</span>
      </button>
      {node.children.map((child) => (
        <FolderRow
          key={child.id}
          node={child}
          depth={depth + 1}
          selectedFolderId={selectedFolderId}
          onSelectFolder={onSelectFolder}
        />
      ))}
    </>
  )
}

export function Sidebar({ folders, selectedFolderId, onSelectFolder }: SidebarProps) {
  const libraryTree = buildFolderTree(folders.filter((f) => !f.isSystem))
  const collectionsTree = buildFolderTree(folders.filter((f) => f.isSystem))
  const allFilesSelected = selectedFolderId === null

  return (
    <nav className={styles.sidebar}>
      <div className={styles.brand}>
        <span className={styles.brandMark} aria-hidden="true" />
        <span className={styles.brandName}>PlasticRoom</span>
      </div>

      <div className={styles.sectionLabel}>Library</div>
      <button
        type="button"
        className={`${styles.row} ${allFilesSelected ? styles.rowSelected : ''}`}
        aria-current={allFilesSelected ? 'true' : undefined}
        style={{ paddingLeft: 12 }}
        onClick={() => onSelectFolder(null)}
      >
        <span className={styles.folderIcon} aria-hidden="true">
          📁
        </span>
        <span className={styles.rowLabel}>All Files</span>
      </button>
      {libraryTree.map((node) => (
        <FolderRow
          key={node.id}
          node={node}
          depth={1}
          selectedFolderId={selectedFolderId}
          onSelectFolder={onSelectFolder}
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
        />
      ))}
    </nav>
  )
}
