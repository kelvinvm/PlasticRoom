import type { Folder, ModelFile, Tag } from '../api/types'
import { formatBytes, formatDimensions, formatPrintTime, tagColor } from '../lib/format'
import { typeLabel } from './FileGrid'
import styles from './FileDetailPanel.module.css'

interface FileDetailPanelProps {
  file: ModelFile | null
  folders: Folder[]
  tags: Tag[]
}

interface Row {
  label: string
  value: string
}

export function FileDetailPanel({ file, folders, tags }: FileDetailPanelProps) {
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
  const printTime = formatPrintTime(file.estPrintTimeMin)
  if (printTime) rows.push({ label: 'Print time', value: printTime })
  if (file.material) rows.push({ label: 'Material', value: file.material })
  if (file.layerHeightMm !== null) rows.push({ label: 'Layer height', value: `${file.layerHeightMm} mm` })
  if (file.creator) rows.push({ label: 'Creator', value: file.creator })

  const fileFolders = file.folderIds
    .map((id) => folders.find((f) => f.id === id))
    .filter((f): f is Folder => f !== undefined)
  const fileTags = file.tagIds
    .map((id) => tags.find((t) => t.id === id))
    .filter((t): t is Tag => t !== undefined)

  return (
    <aside className={styles.panel}>
      <div className={styles.thumb}>
        <span className={styles.thumbLabel}>{typeLabel(file.type)} PREVIEW</span>
      </div>
      <h2 className={styles.name}>{file.name}</h2>
      {file.description && <p className={styles.description}>{file.description}</p>}

      <dl className={styles.meta}>
        {rows.map((row) => (
          <div key={row.label} className={styles.metaRow}>
            <dt className={styles.metaLabel}>{row.label}</dt>
            <dd className={styles.metaValue}>{row.value}</dd>
          </div>
        ))}
      </dl>

      {file.sourceUrl && (
        <a className={styles.sourceLink} href={file.sourceUrl} target="_blank" rel="noreferrer">
          Source
        </a>
      )}

      {fileFolders.length > 0 && (
        <div className={styles.chipGroup}>
          <div className={styles.chipLabel}>Folders</div>
          <div className={styles.chips}>
            {fileFolders.map((folder) => (
              <span key={folder.id} className={styles.chip}>
                {folder.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {fileTags.length > 0 && (
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
      )}
    </aside>
  )
}
