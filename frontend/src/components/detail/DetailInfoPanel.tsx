import { useEffect, useState } from 'react'
import type { Folder, ModelFile, Tag } from '../../api/types'
import { formatBytes, formatDimensions, formatPrintTime, tagColor } from '../../lib/format'
import { updateFileDescription } from '../../api/client'
import { typeLabel } from '../FileGrid'
import styles from './DetailInfoPanel.module.css'

interface Row {
  label: string
  value: string
}

export function DetailInfoPanel({
  file,
  folders,
  tags,
  onDescriptionSaved,
}: {
  file: ModelFile
  folders: Folder[]
  tags: Tag[]
  onDescriptionSaved: (updated: ModelFile) => void
}) {
  const [description, setDescription] = useState(file.description ?? '')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)

  // Re-sync when navigating to a different file.
  // Intentionally depends on file.id only: local `description` state owns the
  // edit between navigations, so it must not be clobbered when the same file's
  // description prop echoes back (e.g. after a save round-trip via reload()).
  // Also resets transient save state (saveError/saving) so a stale error from
  // a previous file doesn't linger on the newly navigated-to file's panel.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setDescription(file.description ?? '')
    setSaveError(false)
    setSaving(false)
  }, [file.id])

  const rows: Row[] = []
  const dims = formatDimensions(file.dimXMm, file.dimYMm, file.dimZMm)
  if (dims) rows.push({ label: 'Dimensions', value: dims })
  const printTime = formatPrintTime(file.estPrintTimeMin)
  if (printTime) rows.push({ label: 'Est. print time', value: printTime })
  if (file.material) rows.push({ label: 'Material', value: file.material })
  if (file.layerHeightMm !== null) rows.push({ label: 'Layer height', value: `${file.layerHeightMm} mm` })
  if (file.plateCount !== null) rows.push({ label: 'Plates', value: String(file.plateCount) })

  const fileFolders = file.folderIds
    .map((id) => folders.find((f) => f.id === id))
    .filter((f): f is Folder => f !== undefined)
  const fileTags = file.tagIds
    .map((id) => tags.find((t) => t.id === id))
    .filter((t): t is Tag => t !== undefined)

  async function handleBlur() {
    if (saving) return
    const next = description
    if (next === (file.description ?? '')) return
    setSaving(true)
    try {
      const updated = await updateFileDescription(file.id, next)
      onDescriptionSaved(updated)
      setSaveError(false)
    } catch {
      setSaveError(true)
    } finally {
      setSaving(false)
    }
  }

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
          value={description}
          onChange={(e) => {
            setDescription(e.target.value)
            setSaveError(false)
          }}
          onBlur={handleBlur}
          placeholder="Add a description…"
        />
        {saving && <span className={styles.savingHint}>Saving…</span>}
        {saveError && (
          <span className={styles.errorHint} role="alert">
            Couldn't save — try again
          </span>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionLabel}>IN FOLDERS / COLLECTIONS</div>
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
          <button type="button" className={styles.addPill} disabled title="Coming in Phase 6">
            + add
          </button>
        </div>
      </section>
    </aside>
  )
}
