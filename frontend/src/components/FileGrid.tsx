import type { ModelFile, Tag } from '../api/types'
import { tagColor } from '../lib/format'
import styles from './FileGrid.module.css'

interface FileGridProps {
  files: ModelFile[]
  tags: Tag[]
  selectedFileId: number | null
  onSelectFile: (id: number) => void
}

export function typeLabel(type: ModelFile['type']): string {
  return type === 'ThreeMf' ? '3MF' : 'STL'
}

interface CardProps {
  file: ModelFile
  tags: Tag[]
  selected: boolean
  onSelect: (id: number) => void
}

function FileCard({ file, tags, selected, onSelect }: CardProps) {
  const fileTags = file.tagIds
    .map((id) => tags.find((t) => t.id === id))
    .filter((t): t is Tag => t !== undefined)

  return (
    <button
      type="button"
      className={`${styles.card} ${selected ? styles.cardSelected : ''}`}
      aria-current={selected ? 'true' : undefined}
      onClick={() => onSelect(file.id)}
    >
      <div className={styles.thumb}>
        <span className={styles.thumbLabel}>{typeLabel(file.type)} PREVIEW</span>
      </div>
      <div className={styles.name}>{file.name}</div>
      {file.description && <div className={styles.description}>{file.description}</div>}
      {fileTags.length > 0 && (
        <div className={styles.tags}>
          {fileTags.map((tag) => (
            <span
              key={tag.id}
              className={styles.tagPill}
              style={{ color: tagColor(tag.colorKey), borderColor: tagColor(tag.colorKey) }}
            >
              {tag.name}
            </span>
          ))}
        </div>
      )}
    </button>
  )
}

export function FileGrid({ files, tags, selectedFileId, onSelectFile }: FileGridProps) {
  return (
    <div className={styles.grid}>
      {files.map((file) => (
        <FileCard
          key={file.id}
          file={file}
          tags={tags}
          selected={file.id === selectedFileId}
          onSelect={onSelectFile}
        />
      ))}
    </div>
  )
}
