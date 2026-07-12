import type { Tag } from '../api/types'
import { tagColor } from '../lib/format'
import styles from './LibraryToolbar.module.css'

interface LibraryToolbarProps {
  title: string
  fileCount: number
  selectedCount: number
  search: string
  onSearchChange: (value: string) => void
  activeTags: Tag[]
  onRemoveTag: (id: number) => void
}

export function LibraryToolbar({
  title, fileCount, selectedCount, search, onSearchChange, activeTags, onRemoveTag,
}: LibraryToolbarProps) {
  return (
    <div className={styles.toolbar}>
      <div className={styles.titleGroup}>
        <h1 className={styles.title}>{title}</h1>
        <span className={styles.count}>
          {selectedCount >= 2 ? `${selectedCount} files selected of ${fileCount}` : `${fileCount} files`}
        </span>
        {activeTags.map((tag) => (
          <button
            key={tag.id}
            type="button"
            className={styles.filterChip}
            style={{ color: tagColor(tag.colorKey), borderColor: tagColor(tag.colorKey) }}
            onClick={() => onRemoveTag(tag.id)}
          >
            {tag.name} ×
          </button>
        ))}
      </div>
      <input
        type="search"
        className={styles.search}
        placeholder="Search files…"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
      />
    </div>
  )
}
