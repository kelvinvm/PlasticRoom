import { useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import type { Folder, ModelFile, Tag } from '../api/types'
import { fileThumbnailUrl, setFileFolders, setFileTags, createFolder, createTag } from '../api/client'
import { buildFolderTree, type FolderNode } from '../lib/folderTree'
import { tagColor } from '../lib/format'
import styles from './AssignFoldersModal.module.css'

interface AssignFoldersModalProps {
  file: { id: number; name: string; folderIds: number[]; tagIds: number[] }
  folders: Folder[]
  tags: Tag[]
  onClose: () => void
  onSaved: (updated: ModelFile) => void
  onFolderCreated: (created: Folder) => void
  onTagCreated: (created: Tag) => void
}

function sameMembers(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((id) => set.has(id))
}

export function AssignFoldersModal({
  file,
  folders,
  tags,
  onClose,
  onSaved,
  onFolderCreated,
  onTagCreated,
}: AssignFoldersModalProps) {
  const [localFolders, setLocalFolders] = useState<Folder[]>(folders)
  const [checked, setChecked] = useState<Set<number>>(new Set(file.folderIds))
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')

  const [localTags, setLocalTags] = useState<Tag[]>(tags)
  const [checkedTags, setCheckedTags] = useState<Set<number>>(new Set(file.tagIds))
  const [showNewTag, setShowNewTag] = useState(false)
  const [newTagName, setNewTagName] = useState('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [thumbFailed, setThumbFailed] = useState(false)

  const roots = buildFolderTree(localFolders)

  function toggle(id: number) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleTag(id: number) {
    setCheckedTags((prev) => {
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
    const nextFolders = [...checked]
    const nextTags = [...checkedTags]
    const foldersChanged = !sameMembers(file.folderIds, nextFolders)
    const tagsChanged = !sameMembers(file.tagIds, nextTags)

    if (!foldersChanged && !tagsChanged) {
      onClose()
      return
    }

    setBusy(true)
    setError(null)
    try {
      let updated: ModelFile | undefined
      if (foldersChanged) {
        updated = await setFileFolders(file.id, nextFolders)
      }
      if (tagsChanged) {
        updated = await setFileTags(file.id, nextTags)
      }
      onSaved(updated!)
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
      setError('Couldn’t create collection')
    } finally {
      setBusy(false)
    }
  }

  async function addTag() {
    const name = newTagName.trim()
    if (!name) return
    setBusy(true)
    setError(null)
    try {
      const created = await createTag(name, null)
      setLocalTags((prev) => [...prev, created])
      setCheckedTags((prev) => new Set(prev).add(created.id))
      setNewTagName('')
      setShowNewTag(false)
      onTagCreated(created)
    } catch {
      setError('Couldn’t create tag')
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
        aria-label={`Assign collections for ${file.name}`}
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
          {roots.map((n) => renderNode(n, 0))}

          <div className={styles.groupLabel}>Tags</div>
          {localTags.map((tag) => (
            <label key={tag.id} className={styles.tagOption}>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={checkedTags.has(tag.id)}
                onChange={() => toggleTag(tag.id)}
              />
              <span className={styles.tagDot} style={{ background: tagColor(tag.colorKey) }} aria-hidden="true" />
              <span className={styles.rowLabel}>{tag.name}</span>
            </label>
          ))}
        </div>

        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}

        <footer className={styles.footer}>
          <div className={styles.newControls}>
            <div className={styles.newFolder}>
              {showNewFolder ? (
                <>
                  <input
                    className={styles.newFolderInput}
                    aria-label="New collection name"
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
                  + New collection
                </button>
              )}
            </div>
            <div className={styles.newFolder}>
              {showNewTag ? (
                <>
                  <input
                    className={styles.newFolderInput}
                    aria-label="New tag name"
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addTag()
                    }}
                  />
                  <button type="button" className={styles.textButton} disabled={busy} onClick={addTag}>
                    Add
                  </button>
                </>
              ) : (
                <button type="button" className={styles.textButton} onClick={() => setShowNewTag(true)}>
                  + New tag
                </button>
              )}
            </div>
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
