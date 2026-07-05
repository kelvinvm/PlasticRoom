import { useEffect, useState } from 'react'
import { useFile } from '../hooks/useFile'
import { useFolders } from '../hooks/useFolders'
import { useTags } from '../hooks/useTags'
import { fileContentUrl } from '../api/client'
import { fileTypeFromName, loadModelFromBuffer, type LoadedModel } from '../lib/modelLoading'
import { renderPlateThumbnails } from '../lib/thumbnail'
import { ModelViewer } from '../components/viewer/ModelViewer'
import { ViewerModeToggle } from '../components/viewer/ViewerModeToggle'
import { PlateFilmstrip } from '../components/viewer/PlateFilmstrip'
import { DetailInfoPanel } from '../components/detail/DetailInfoPanel'
import type { RenderMode } from '../lib/viewerModes'
import type { ModelFile } from '../api/types'
import styles from './DetailView.module.css'

export function DetailView({
  fileId,
  fromFolder,
  onBack,
}: {
  fileId: number
  fromFolder: { id: number; name: string } | null
  onBack: () => void
}) {
  const { file, loading, error, reload } = useFile(fileId)
  const { folders } = useFolders()
  const { tags } = useTags()

  const [model, setModel] = useState<LoadedModel | null>(null)
  const [plateThumbs, setPlateThumbs] = useState<string[]>([])
  const [modelError, setModelError] = useState(false)
  const [mode, setMode] = useState<RenderMode>('solid')
  const [activePlate, setActivePlate] = useState<number | null>(null)

  // Fetch + parse the raw model bytes once we know the file.
  useEffect(() => {
    if (!file) return
    let cancelled = false
    setModel(null)
    setPlateThumbs([])
    setModelError(false)
    setActivePlate(null)
    const type = fileTypeFromName(file.name)
    if (type === null) {
      setModelError(true)
      return
    }
    fetch(fileContentUrl(file.id))
      .then((res) => {
        if (!res.ok) throw new Error(`content ${res.status}`)
        return res.arrayBuffer()
      })
      .then((buffer) => {
        if (cancelled) return
        const loaded = loadModelFromBuffer(buffer, type)
        // Generate per-plate thumbnails BEFORE the live viewer takes the model
        // (renderPlateThumbnails temporarily reparents model.object). A failure
        // here must never block the model from rendering.
        try {
          setPlateThumbs(renderPlateThumbnails(loaded))
        } catch {
          setPlateThumbs([])
        }
        setModel(loaded)
      })
      .catch(() => {
        if (!cancelled) setModelError(true)
      })
    return () => {
      cancelled = true
    }
    // Only id/name affect the fetched bytes; keying on the whole `file` object
    // would rebuild the viewer on unrelated metadata updates (e.g. description save).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.id, file?.name])

  const originName = fromFolder?.name ?? 'Library'

  let viewerBody
  if (modelError || error) {
    viewerBody = (
      <div className={styles.viewerStatus}>
        <div className={styles.statusTitle}>Couldn't load this model</div>
        <div className={styles.statusSub}>The file may be missing or unreadable.</div>
      </div>
    )
  } else if (!model) {
    viewerBody = <div className={styles.viewerStatus}>Loading model…</div>
  } else {
    viewerBody = <ModelViewer model={model} mode={mode} activePlate={activePlate} />
  }

  const plateCount = model?.objects.length ?? 0

  return (
    <div className={styles.detail}>
      <div className={styles.main}>
        <div className={styles.breadcrumb} data-testid="breadcrumb">
          <button type="button" className={styles.crumbLink} onClick={onBack}>
            {originName}
          </button>
          <span className={styles.crumbSep}>›</span>
          <span className={styles.crumbCurrent}>{file?.name ?? '…'}</span>
        </div>

        <div className={styles.viewerArea}>
          <div className={styles.toggleBar}>
            <ViewerModeToggle mode={mode} onChange={setMode} />
          </div>
          {viewerBody}
          <PlateFilmstrip
            count={plateCount}
            activeIndex={activePlate}
            onSelect={setActivePlate}
            thumbnailUrls={plateThumbs}
          />
        </div>
      </div>

      {loading && !file ? (
        <aside className={styles.sidePanelStatus}>Loading…</aside>
      ) : error || !file ? (
        <aside className={styles.sidePanelStatus}>Could not load this file.</aside>
      ) : (
        <DetailInfoPanel
          file={file}
          folders={folders}
          tags={tags}
          onDescriptionSaved={() => reload()}
        />
      )}
    </div>
  )
}

export type { ModelFile }
