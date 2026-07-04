import { useState } from 'react'
import { Sidebar } from '../components/Sidebar'
import { LibraryToolbar } from '../components/LibraryToolbar'
import { FileGrid } from '../components/FileGrid'
import { FileDetailPanel } from '../components/FileDetailPanel'
import { useFolders } from '../hooks/useFolders'
import { useTags } from '../hooks/useTags'
import { useFiles } from '../hooks/useFiles'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import styles from './LibraryView.module.css'

export function LibraryView({ onImport }: { onImport: () => void }) {
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null)
  const [selectedFileId, setSelectedFileId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, 250)

  const { folders } = useFolders()
  const { tags } = useTags()
  const { files, loading, error } = useFiles(selectedFolderId, debouncedSearch)

  const title =
    selectedFolderId === null
      ? 'All Files'
      : (folders.find((f) => f.id === selectedFolderId)?.name ?? 'Folder')
  const selectedFile = files.find((f) => f.id === selectedFileId) ?? null

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
      <FileGrid files={files} tags={tags} selectedFileId={selectedFileId} onSelectFile={setSelectedFileId} />
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
        <LibraryToolbar title={title} fileCount={files.length} search={search} onSearchChange={setSearch} />
        <div className={styles.centerBody}>{center}</div>
      </main>
      <FileDetailPanel file={selectedFile} folders={folders} tags={tags} />
    </div>
  )
}
