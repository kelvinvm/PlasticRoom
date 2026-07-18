import { useEffect, useState } from 'react'
import type { Folder, ModelFile, Tag } from '../api/types'
import { fileThumbnailUrl, updateFile, type FilePatch } from '../api/client'
import { formatBytes, formatDimensions, tagColor } from '../lib/format'
import { typeLabel } from './FileGrid'
import { AssignFoldersModal } from './AssignFoldersModal'
import styles from './FileDetailPanel.module.css'

interface FileDetailPanelProps {
  file: ModelFile | null
  folders: Folder[]
  tags: Tag[]
  onAssignmentsSaved: () => void
  onFolderCreated: () => void
  onFieldSaved: (updated: ModelFile) => void
  onTagCreated: () => void
}

interface Row {
  label: string
  value: string
}

type FieldKey = 'description' | 'sourceUrl' | 'creator' | 'material' | 'estPrintTimeMin' | 'layerHeightMm'

function fieldDefaults(file: ModelFile | null): Record<FieldKey, string> {
  return {
    description: file?.description ?? '',
    sourceUrl: file?.sourceUrl ?? '',
    creator: file?.creator ?? '',
    material: file?.material ?? '',
    estPrintTimeMin: file?.estPrintTimeMin != null ? String(file.estPrintTimeMin) : '',
    layerHeightMm: file?.layerHeightMm != null ? String(file.layerHeightMm) : '',
  }
}

export function FileDetailPanel({
  file, folders, tags, onAssignmentsSaved, onFolderCreated, onFieldSaved, onTagCreated,
}: FileDetailPanelProps) {
  const [thumbFailed, setThumbFailed] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)
  const [drafts, setDrafts] = useState<Record<FieldKey, string>>(() => fieldDefaults(file))
  const [savingFields, setSavingFields] = useState<Set<FieldKey>>(new Set())
  const [errorFields, setErrorFields] = useState<Set<FieldKey>>(new Set())

  useEffect(() => {
    setThumbFailed(false)
    setDrafts(fieldDefaults(file))
    setSavingFields(new Set())
    setErrorFields(new Set())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.id])

  async function saveField(key: FieldKey, patch: FilePatch, currentValue: string) {
    if (!file || drafts[key] === currentValue) return
    setSavingFields((prev) => new Set(prev).add(key))
    setErrorFields((prev) => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })
    try {
      const updated = await updateFile(file.id, patch)
      onFieldSaved(updated)
    } catch {
      setErrorFields((prev) => new Set(prev).add(key))
    } finally {
      setSavingFields((prev) => {
        const next = new Set(prev)
        next.delete(key)
        return next
      })
    }
  }

  function handleDescriptionBlur() {
    saveField('description', { description: drafts.description }, file?.description ?? '')
  }
  function handleSourceUrlBlur() {
    saveField('sourceUrl', { sourceUrl: drafts.sourceUrl }, file?.sourceUrl ?? '')
  }
  function handleCreatorBlur() {
    saveField('creator', { creator: drafts.creator }, file?.creator ?? '')
  }
  function handleMaterialBlur() {
    saveField('material', { material: drafts.material }, file?.material ?? '')
  }
  function handleEstPrintTimeBlur() {
    if (drafts.estPrintTimeMin.trim() === '') return
    const parsed = parseInt(drafts.estPrintTimeMin, 10)
    if (Number.isNaN(parsed)) return
    saveField(
      'estPrintTimeMin',
      { estPrintTimeMin: parsed },
      file?.estPrintTimeMin != null ? String(file.estPrintTimeMin) : '',
    )
  }
  function handleLayerHeightBlur() {
    if (drafts.layerHeightMm.trim() === '') return
    const parsed = parseFloat(drafts.layerHeightMm)
    if (Number.isNaN(parsed)) return
    saveField(
      'layerHeightMm',
      { layerHeightMm: parsed },
      file?.layerHeightMm != null ? String(file.layerHeightMm) : '',
    )
  }

  if (file === null) {
    return (
      <aside className={styles.panel}>
        <div className={styles.empty}>Select a file</div>
      </aside>
    )
  }

  const rows: Row[] = []
  rows.push({ label: 'Type', value: typeLabel(file.type) })
  rows.push({ label: 'Size', value: formatBytes(file.sizeBytes) })
  const dims = formatDimensions(file.dimXMm, file.dimYMm, file.dimZMm)
  if (dims) rows.push({ label: 'Dimensions', value: dims })
  if (file.plateCount !== null) rows.push({ label: 'Plates', value: String(file.plateCount) })

  const fileFolders = file.folderIds
    .map((id) => folders.find((f) => f.id === id))
    .filter((f): f is Folder => f !== undefined)
  const fileTags = file.tagIds
    .map((id) => tags.find((t) => t.id === id))
    .filter((t): t is Tag => t !== undefined)

  const showImg = file.thumbnailPath !== null && !thumbFailed

  function fieldHint(key: FieldKey) {
    if (savingFields.has(key)) return <span className={styles.savingHint}>Saving…</span>
    if (errorFields.has(key)) return <span className={styles.errorHint}>Couldn't save — try again</span>
    return null
  }

  return (
    <aside className={styles.panel}>
      <div className={styles.thumb}>
        {showImg ? (
          <img
            className={styles.thumbImg}
            src={fileThumbnailUrl(file.id)}
            alt={`${file.name} preview`}
            onError={() => setThumbFailed(true)}
          />
        ) : (
          <span className={styles.thumbLabel}>{typeLabel(file.type)} PREVIEW</span>
        )}
      </div>
      <h2 className={styles.name}>{file.name}</h2>

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="fdp-description">Description</label>
        <textarea
          id="fdp-description"
          className={styles.description}
          value={drafts.description}
          onChange={(e) => setDrafts((d) => ({ ...d, description: e.target.value }))}
          onBlur={handleDescriptionBlur}
          placeholder="Add a description…"
        />
        {fieldHint('description')}
      </div>

      <dl className={styles.meta}>
        {rows.map((row) => (
          <div key={row.label} className={styles.metaRow}>
            <dt className={styles.metaLabel}>{row.label}</dt>
            <dd className={styles.metaValue}>{row.value}</dd>
          </div>
        ))}
      </dl>

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="fdp-source-url">Source URL</label>
        <input
          id="fdp-source-url"
          type="url"
          className={styles.fieldInput}
          value={drafts.sourceUrl}
          onChange={(e) => setDrafts((d) => ({ ...d, sourceUrl: e.target.value }))}
          onBlur={handleSourceUrlBlur}
          placeholder="https://…"
        />
        {fieldHint('sourceUrl')}
      </div>

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="fdp-creator">Creator</label>
        <input
          id="fdp-creator"
          type="text"
          className={styles.fieldInput}
          value={drafts.creator}
          onChange={(e) => setDrafts((d) => ({ ...d, creator: e.target.value }))}
          onBlur={handleCreatorBlur}
        />
        {fieldHint('creator')}
      </div>

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="fdp-material">Material</label>
        <input
          id="fdp-material"
          type="text"
          className={styles.fieldInput}
          value={drafts.material}
          onChange={(e) => setDrafts((d) => ({ ...d, material: e.target.value }))}
          onBlur={handleMaterialBlur}
        />
        {fieldHint('material')}
      </div>

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="fdp-print-time">Est. print time (min)</label>
        <input
          id="fdp-print-time"
          type="number"
          min="0"
          className={styles.fieldInput}
          value={drafts.estPrintTimeMin}
          onChange={(e) => setDrafts((d) => ({ ...d, estPrintTimeMin: e.target.value }))}
          onBlur={handleEstPrintTimeBlur}
        />
        {fieldHint('estPrintTimeMin')}
      </div>

      <div className={styles.field}>
        <label className={styles.fieldLabel} htmlFor="fdp-layer-height">Layer height (mm)</label>
        <input
          id="fdp-layer-height"
          type="number"
          min="0"
          step="0.01"
          className={styles.fieldInput}
          value={drafts.layerHeightMm}
          onChange={(e) => setDrafts((d) => ({ ...d, layerHeightMm: e.target.value }))}
          onBlur={handleLayerHeightBlur}
        />
        {fieldHint('layerHeightMm')}
      </div>

      <div className={styles.chipGroup}>
        <div className={styles.chipLabel}>Collections</div>
        <div className={styles.chips}>
          {fileFolders.map((folder) => (
            <span key={folder.id} className={styles.chip}>
              {folder.name}
            </span>
          ))}
          <button type="button" className={styles.addPill} onClick={() => setAssignOpen(true)}>
            + add
          </button>
        </div>
      </div>

      <div className={styles.chipGroup}>
        <div className={styles.chipLabel}>Tags</div>
        <div className={styles.chips}>
          {fileTags.map((tag) => (
            <span
              key={tag.id}
              className={styles.chip}
              style={{ color: tagColor(tag.colorKey), borderColor: tagColor(tag.colorKey) }}
            >
              {tag.name}
            </span>
          ))}
        </div>
      </div>

      {assignOpen && (
        <AssignFoldersModal
          file={file}
          folders={folders}
          tags={tags}
          onClose={() => setAssignOpen(false)}
          onSaved={() => onAssignmentsSaved()}
          onFolderCreated={() => onFolderCreated()}
          onTagCreated={() => onTagCreated()}
        />
      )}
    </aside>
  )
}
