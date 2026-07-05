import { useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import type { Folder, ModelFile } from '../api/types'
import { fileThumbnailUrl, setFileFolders, createFolder } from '../api/client'
import { buildFolderTree, type FolderNode } from '../lib/folderTree'
import styles from './AssignFoldersModal.module.css'

interface AssignFoldersModalProps {
  file: { id: number; name: string; folderIds: number[] }
  folders: Folder[]
  onClose: () => void
  onSaved: (updated: ModelFile) => void
  onFolderCreated: (created: Folder) => void
}

function sameMembers(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((id) => set.has(id))
}

export function AssignFoldersModal({
  file,
  folders,
  onClose,
  onSaved,
  onFolderCreated,
}: AssignFoldersModalProps) {
  const [localFolders, setLocalFolders] = useState<Folder[]>(folders)
  const [checked, setChecked] = useState<Set<number>>(new Set(file.folderIds))
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [thumbFailed, setThumbFailed] = useState(false)

  const tree = buildFolderTree(localFolders)
  const collectionRoots = tree.filter((n) => n.isSystem)
  const libraryRoots = tree.filter((n) => !n.isSystem)

  function toggle(id: number) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleCollapse(id: number) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function save() {
    const next = [...checked]
    if (sameMembers(file.folderIds, next)) {
      onClose()
      return
    }
    setBusy(true)
    setError(null)
    try {
      const updated = await setFileFolders(file.id, next)
      onSaved(updated)
      onClose()
    } catch {
      setError('Couldn’t save — try again')
      setBusy(false)
    }
  }

  async function addFolder() {
    const name = newFolderName.trim()
    if (!name) return
    setBusy(true)
    setError(null)
    try {
      const created = await createFolder(name, null)
      setLocalFolders((prev) => [...prev, created])
      setChecked((prev) => new Set(prev).add(created.id))
      setNewFolderName('')
      setShowNewFolder(false)
      onFolderCreated(created)
    } catch {
      setError('Couldn’t create folder')
    } finally {
      setBusy(false)
    }
  }

  function onDialogKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose()
  }

  function onBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose()
  }

  function renderNode(node: FolderNode, depth: number): ReactNode {
    const hasChildren = node.children.length > 0
    const isCollapsed = collapsed.has(node.id)
    return (
      <div key={node.id}>
        <div className={styles.row} style={{ paddingLeft: depth * 22 }}>
          {hasChildren ? (
            <button
              type="button"
              className={styles.chevron}
              aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${node.name}`}
              onClick={() => toggleCollapse(node.id)}
            >
              {isCollapsed ? '▸' : '▾'}
            </button>
          ) : (
            <span className={styles.chevronSpacer} />
          )}
          <input
            type="checkbox"
            id={`assign-folder-${node.id}`}
            className={styles.checkbox}
            checked={checked.has(node.id)}
            onChange={() => toggle(node.id)}
          />
          <label htmlFor={`assign-folder-${node.id}`} className={styles.rowLabel}>
            {node.name}
          </label>
        </div>
        {hasChildren && !isCollapsed && node.children.map((c) => renderNode(c, depth + 1))}
      </div>
    )
  }

  return (
    <div className={styles.backdrop} onClick={onBackdropClick}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={`Assign folders for ${file.name}`}
        onKeyDown={onDialogKeyDown}
      >
        <header className={styles.header}>
          {thumbFailed ? (
            <span className={styles.thumbPlaceholder} />
          ) : (
            <img
              className={styles.thumb}
              src={fileThumbnailUrl(file.id)}
              alt=""
              onError={() => setThumbFailed(true)}
            />
          )}
          <h2 className={styles.title}>{file.name}</h2>
        </header>

        <div className={styles.body}>
          {collectionRoots.length > 0 && (
            <section aria-label="Collections">
              <div className={styles.groupLabel}>COLLECTIONS</div>
              {collectionRoots.map((n) => renderNode(n, 0))}
            </section>
          )}
          {libraryRoots.length > 0 && (
            <section aria-label="Library">
              <div className={styles.groupLabel}>LIBRARY</div>
              {libraryRoots.map((n) => renderNode(n, 0))}
            </section>
          )}
        </div>

        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}

        <footer className={styles.footer}>
          <div className={styles.newFolder}>
            {showNewFolder ? (
              <>
                <input
                  className={styles.newFolderInput}
                  aria-label="New folder name"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addFolder()
                  }}
                />
                <button type="button" className={styles.textButton} disabled={busy} onClick={addFolder}>
                  Add
                </button>
              </>
            ) : (
              <button type="button" className={styles.textButton} onClick={() => setShowNewFolder(true)}>
                + New folder
              </button>
            )}
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.textButton} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className={styles.primary} disabled={busy} onClick={save}>
              Save
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
