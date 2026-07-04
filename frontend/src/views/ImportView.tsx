import { useEffect, useMemo } from 'react'
import { useFolders } from '../hooks/useFolders'
import { useTags } from '../hooks/useTags'
import { useImportStaging, type UseImportStagingDeps } from '../hooks/useImportStaging'
import { generateThumbnail } from '../lib/thumbnail'
import { uploadFile, uploadThumbnail, createTag } from '../api/client'
import { DropZone } from '../components/import/DropZone'
import { StagingRow } from '../components/import/StagingRow'
import { ImportAssignPanel } from '../components/import/ImportAssignPanel'
import styles from './ImportView.module.css'

const DEFAULT_DEPS: UseImportStagingDeps = {
  generate: generateThumbnail,
  api: { uploadFile, uploadThumbnail, createTag },
}

interface ImportViewProps {
  onBack: () => void
  onImported: () => void
  deps?: UseImportStagingDeps
}

export function ImportView({ onBack, onImported, deps = DEFAULT_DEPS }: ImportViewProps) {
  const { folders } = useFolders()
  const { tags } = useTags()
  const staging = useImportStaging(deps)

  const mergedTags = useMemo(() => [...tags, ...staging.createdTags], [tags, staging.createdTags])

  useEffect(() => {
    if (staging.allDone && !staging.importing) onImported()
  }, [staging.allDone, staging.importing, onImported])

  return (
    <div className={styles.view}>
      <header className={styles.header}>
        <h1 className={styles.title}>Import files</h1>
        <span className={styles.counts}>
          {staging.detectedCount} detected · {staging.readyCount} ready
        </span>
        <button className={styles.cancel} onClick={onBack}>Cancel</button>
      </header>
      <div className={styles.body}>
        <main className={styles.main}>
          <DropZone onFiles={staging.addFiles} disabled={staging.importing} />
          <div className={styles.list}>
            {staging.items.map((item) => (
              <StagingRow key={item.id} item={item} />
            ))}
          </div>
        </main>
        <ImportAssignPanel
          folders={folders}
          tags={mergedTags}
          selectedFolderIds={staging.selectedFolderIds}
          onToggleFolder={staging.toggleFolder}
          selectedTagIds={staging.selectedTagIds}
          onToggleTag={staging.toggleTag}
          onCreateTag={(name) => { void staging.createAndSelectTag(name) }}
          detectedCount={staging.detectedCount}
          readyCount={staging.readyCount}
          failedParseCount={staging.failedParseCount}
          importing={staging.importing}
          onImport={() => { void staging.importAll() }}
        />
      </div>
    </div>
  )
}
