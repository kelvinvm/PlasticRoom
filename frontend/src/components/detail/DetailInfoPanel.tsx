import { useEffect, useState } from 'react'
import type { Folder, ModelFile, Tag } from '../../api/types'
import { formatBytes, formatDimensions, tagColor } from '../../lib/format'
import { updateFile, type FilePatch } from '../../api/client'
import { typeLabel } from '../FileGrid'
import { AssignFoldersModal } from '../AssignFoldersModal'
import styles from './DetailInfoPanel.module.css'

interface Row {
  label: string
  value: string
}

type FieldKey = 'description' | 'sourceUrl' | 'creator' | 'material' | 'estPrintTimeMin' | 'layerHeightMm'

function fieldDefaults(file: ModelFile): Record<FieldKey, string> {
  return {
    description: file.description ?? '',
    sourceUrl: file.sourceUrl ?? '',
    creator: file.creator ?? '',
    material: file.material ?? '',
    estPrintTimeMin: file.estPrintTimeMin != null ? String(file.estPrintTimeMin) : '',
    layerHeightMm: file.layerHeightMm != null ? String(file.layerHeightMm) : '',
  }
}

export function DetailInfoPanel({
  file,
  folders,
  tags,
  onFieldSaved,
  onAssignmentsSaved,
  onFolderCreated,
  onTagCreated,
}: {
  file: ModelFile
  folders: Folder[]
  tags: Tag[]
  onFieldSaved: (updated: ModelFile) => void
  onAssignmentsSaved: () => void
  onFolderCreated: () => void
  onTagCreated: () => void
}) {
  const [drafts, setDrafts] = useState<Record<FieldKey, string>>(() => fieldDefaults(file))
  const [savingFields, setSavingFields] = useState<Set<FieldKey>>(new Set())
  const [errorFields, setErrorFields] = useState<Set<FieldKey>>(new Set())
  const [assignOpen, setAssignOpen] = useState(false)

  // Re-sync when navigating to a different file.
  // Intentionally depends on file.id only: local `drafts` state owns the edit
  // between navigations, so it must not be clobbered when the same file's fields
  // echo back (e.g. after a save round-trip via reload()). Also resets transient
  // save state so a stale error from a previous file doesn't linger.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setDrafts(fieldDefaults(file))
    setSavingFields(new Set())
    setErrorFields(new Set())
  }, [file.id])

  async function saveField(key: FieldKey, patch: FilePatch, currentValue: string) {
    if (drafts[key] === currentValue) return
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
    saveField('description', { description: drafts.description }, file.description ?? '')
  }
  function handleSourceUrlBlur() {
    saveField('sourceUrl', { sourceUrl: drafts.sourceUrl }, file.sourceUrl ?? '')
  }
  function handleCreatorBlur() {
    saveField('creator', { creator: drafts.creator }, file.creator ?? '')
  }
  function handleMaterialBlur() {
    saveField('material', { material: drafts.material }, file.material ?? '')
  }
  function handleEstPrintTimeBlur() {
    if (drafts.estPrintTimeMin.trim() === '') return
    const parsed = parseInt(drafts.estPrintTimeMin, 10)
    if (Number.isNaN(parsed)) return
    saveField(
      'estPrintTimeMin',
      { estPrintTimeMin: parsed },
      file.estPrintTimeMin != null ? String(file.estPrintTimeMin) : '',
    )
  }
  function handleLayerHeightBlur() {
    if (drafts.layerHeightMm.trim() === '') return
    const parsed = parseFloat(drafts.layerHeightMm)
    if (Number.isNaN(parsed)) return
    saveField(
      'layerHeightMm',
      { layerHeightMm: parsed },
      file.layerHeightMm != null ? String(file.layerHeightMm) : '',
    )
  }

  function fieldHint(key: FieldKey) {
    if (savingFields.has(key)) return <span className={styles.savingHint}>Saving…</span>
    if (errorFields.has(key)) {
      return (
        <span className={styles.errorHint} role="alert">
          Couldn't save — try again
        </span>
      )
    }
    return null
  }

  const rows: Row[] = []
  const dims = formatDimensions(file.dimXMm, file.dimYMm, file.dimZMm)
  if (dims) rows.push({ label: 'Dimensions', value: dims })
  if (file.plateCount !== null) rows.push({ label: 'Plates', value: String(file.plateCount) })

  const fileFolders = file.folderIds
    .map((id) => folders.find((f) => f.id === id))
    .filter((f): f is Folder => f !== undefined)
  const fileTags = file.tagIds
    .map((id) => tags.find((t) => t.id === id))
    .filter((t): t is Tag => t !== undefined)

  return (
    <aside className={styles.panel}>
      <h2 className={styles.name}>{file.name}</h2>
      <div className={styles.subline}>
        {typeLabel(file.type)} · {formatBytes(file.sizeBytes)} · {new Date(file.addedAt).toLocaleDateString()}
      </div>

      <section className={styles.section}>
        <div className={styles.sectionLabel}>SPECS</div>
        <dl className={styles.meta}>
          {rows.map((row) => (
            <div key={row.label} className={styles.metaRow}>
              <dt className={styles.metaLabel}>{row.label}</dt>
              <dd className={styles.metaValue}>{row.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionLabel}>DESCRIPTION</div>
        <textarea
          className={styles.description}
          aria-label="Description"
          value={drafts.description}
          onChange={(e) => {
            setDrafts((d) => ({ ...d, description: e.target.value }))
            setErrorFields((prev) => {
              const next = new Set(prev)
              next.delete('description')
              return next
            })
          }}
          onBlur={handleDescriptionBlur}
          placeholder="Add a description…"
        />
        {fieldHint('description')}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionLabel}>SOURCE URL</div>
        <input
          type="url"
          aria-label="Source URL"
          className={styles.fieldInput}
          value={drafts.sourceUrl}
          onChange={(e) => setDrafts((d) => ({ ...d, sourceUrl: e.target.value }))}
          onBlur={handleSourceUrlBlur}
          placeholder="https://…"
        />
        {fieldHint('sourceUrl')}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionLabel}>CREATOR</div>
        <input
          type="text"
          aria-label="Creator"
          className={styles.fieldInput}
          value={drafts.creator}
          onChange={(e) => setDrafts((d) => ({ ...d, creator: e.target.value }))}
          onBlur={handleCreatorBlur}
        />
        {fieldHint('creator')}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionLabel}>MATERIAL</div>
        <input
          type="text"
          aria-label="Material"
          className={styles.fieldInput}
          value={drafts.material}
          onChange={(e) => setDrafts((d) => ({ ...d, material: e.target.value }))}
          onBlur={handleMaterialBlur}
        />
        {fieldHint('material')}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionLabel}>EST. PRINT TIME (MIN)</div>
        <input
          type="number"
          min="0"
          aria-label="Est. print time (min)"
          className={styles.fieldInput}
          value={drafts.estPrintTimeMin}
          onChange={(e) => setDrafts((d) => ({ ...d, estPrintTimeMin: e.target.value }))}
          onBlur={handleEstPrintTimeBlur}
        />
        {fieldHint('estPrintTimeMin')}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionLabel}>LAYER HEIGHT (MM)</div>
        <input
          type="number"
          min="0"
          step="0.01"
          aria-label="Layer height (mm)"
          className={styles.fieldInput}
          value={drafts.layerHeightMm}
          onChange={(e) => setDrafts((d) => ({ ...d, layerHeightMm: e.target.value }))}
          onBlur={handleLayerHeightBlur}
        />
        {fieldHint('layerHeightMm')}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionLabel}>COLLECTIONS</div>
        <div className={styles.chips}>
          {fileFolders.map((folder) => (
            <span key={folder.id} className={styles.chip}>
              {folder.name}
            </span>
          ))}
          {fileTags.map((tag) => (
            <span
              key={`tag-${tag.id}`}
              className={styles.chip}
              style={{ color: tagColor(tag.colorKey), borderColor: tagColor(tag.colorKey) }}
            >
              {tag.name}
            </span>
          ))}
          <button type="button" className={styles.addPill} onClick={() => setAssignOpen(true)}>
            + add
          </button>
        </div>
      </section>

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
