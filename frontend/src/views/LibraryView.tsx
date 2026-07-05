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
import styles from './LibraryView.module.css'

export function LibraryView({
  onImport,
  onOpenFile,
}: {
  onImport: () => void
  onOpenFile: (fileId: number, fromFolder: { id: number; name: string } | null) => void
}) {
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null)
  const [selection, setSelection] = useState<Selection>(emptySelection)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, 250)

  const { folders, reload: reloadFolders } = useFolders()
  const { tags } = useTags()
  const { files, loading, error, reload: reloadFiles } = useFiles(selectedFolderId, debouncedSearch)

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
      />
      <main className={styles.center}>
        <LibraryToolbar
          title={title}
          fileCount={files.length}
          selectedCount={selection.ids.size}
          search={search}
          onSearchChange={setSearch}
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
    </div>
  )
}
