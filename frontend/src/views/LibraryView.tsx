import { useEffect, useState } from 'react'
import { Sidebar } from '../components/Sidebar'
import { LibraryToolbar } from '../components/LibraryToolbar'
import { FileGrid } from '../components/FileGrid'
import { FileDetailPanel } from '../components/FileDetailPanel'
import { BatchAssignPanel } from '../components/BatchAssignPanel'
import { useFolders } from '../hooks/useFolders'
import { useTags } from '../hooks/useTags'
import { useFiles } from '../hooks/useFiles'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { nextSelection, emptySelection, type Selection } from '../lib/gridSelection'
import { deleteFile } from '../api/client'
import { ConfirmDialog } from '../components/ConfirmDialog'
import type { ModelFile } from '../api/types'
import styles from './LibraryView.module.css'

export function LibraryView({
  onImport,
  onOpenFile,
}: {
  onImport: () => void
  onOpenFile: (fileId: number, fromFolder: { id: number; name: string } | null) => void
}) {
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null)
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([])
  const toggleTag = (id: number) =>
    setSelectedTagIds((cur) => (cur.includes(id) ? cur.filter((t) => t !== id) : [...cur, id]))
  const handleTagDeleted = (id: number) =>
    setSelectedTagIds((cur) => cur.filter((t) => t !== id))
  const [selection, setSelection] = useState<Selection>(emptySelection)
  const [pendingDeleteFile, setPendingDeleteFile] = useState<ModelFile | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, 250)

  const { folders, reload: reloadFolders } = useFolders()
  const { tags, reload: reloadTags } = useTags()
  const { files, loading, error, reload: reloadFiles } = useFiles(selectedFolderId, selectedTagIds, debouncedSearch)

  const activeTags = selectedTagIds
    .map((id) => tags.find((t) => t.id === id))
    .filter((t): t is (typeof tags)[number] => t !== undefined)

  // Esc clears the current selection while one is active.
  useEffect(() => {
    if (selection.ids.size === 0) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelection(emptySelection)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selection.ids.size])

  const title =
    selectedFolderId === null
      ? 'All Files'
      : (folders.find((f) => f.id === selectedFolderId)?.name ?? 'Folder')

  const selectedIds = [...selection.ids]
  const singleSelectedFile =
    selectedIds.length === 1 ? (files.find((f) => f.id === selectedIds[0]) ?? null) : null

  const activeFolder =
    selectedFolderId === null
      ? null
      : (() => {
          const f = folders.find((x) => x.id === selectedFolderId)
          return f ? { id: f.id, name: f.name } : null
        })()

  const handleConfirmDelete = async () => {
    if (!pendingDeleteFile) return
    const id = pendingDeleteFile.id
    setDeleteError(null)
    try {
      await deleteFile(id)
      setPendingDeleteFile(null)
      setSelection((cur) => {
        if (!cur.ids.has(id)) return cur
        const ids = new Set(cur.ids)
        ids.delete(id)
        return { ids, anchorId: cur.anchorId === id ? null : cur.anchorId }
      })
      reloadFiles()
    } catch {
      setDeleteError('Could not delete file.')
    }
  }

  let center
  if (loading) {
    center = <div className={styles.status}>Loading…</div>
  } else if (error) {
    center = <div className={styles.status}>Could not load files. Is the backend running?</div>
  } else if (files.length === 0) {
    center = (
      <div className={styles.status}>
        {debouncedSearch.trim() ? 'No files match your search' : 'No files in this view'}
      </div>
    )
  } else {
    center = (
      <FileGrid
        files={files}
        tags={tags}
        selectedFileIds={selection.ids}
        onSelectFile={(id, mods) => setSelection((cur) => nextSelection(cur, files, id, mods))}
        onOpenFile={(id) => onOpenFile(id, activeFolder)}
        onRequestDelete={setPendingDeleteFile}
      />
    )
  }

  return (
    <div className={styles.app}>
      <Sidebar
        folders={folders}
        selectedFolderId={selectedFolderId}
        onSelectFolder={setSelectedFolderId}
        onImport={onImport}
        reloadFolders={reloadFolders}
        reloadFiles={reloadFiles}
        tags={tags}
        selectedTagIds={selectedTagIds}
        onToggleTag={toggleTag}
        reloadTags={reloadTags}
        onTagDeleted={handleTagDeleted}
      />
      <main className={styles.center}>
        <LibraryToolbar
          title={title}
          fileCount={files.length}
          selectedCount={selection.ids.size}
          search={search}
          onSearchChange={setSearch}
          activeTags={activeTags}
          onRemoveTag={toggleTag}
        />
        <div
          className={styles.centerBody}
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelection(emptySelection)
          }}
        >
          {center}
        </div>
      </main>
      {selection.ids.size >= 2 ? (
        <BatchAssignPanel
          selectedFileIds={selectedIds}
          folders={folders}
          tags={tags}
          onApplied={reloadFiles}
        />
      ) : (
        <FileDetailPanel
          file={singleSelectedFile}
          folders={folders}
          tags={tags}
          onAssignmentsSaved={reloadFiles}
          onFolderCreated={reloadFolders}
        />
      )}
      {pendingDeleteFile && (
        <ConfirmDialog
          body={<>Delete “{pendingDeleteFile.name}”? This permanently removes the file.</>}
          danger
          error={deleteError}
          onConfirm={handleConfirmDelete}
          onCancel={() => { setPendingDeleteFile(null); setDeleteError(null) }}
        />
      )}
    </div>
  )
}
