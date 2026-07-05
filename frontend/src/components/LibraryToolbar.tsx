import styles from './LibraryToolbar.module.css'

interface LibraryToolbarProps {
  title: string
  fileCount: number
  selectedCount: number
  search: string
  onSearchChange: (value: string) => void
}

export function LibraryToolbar({ title, fileCount, selectedCount, search, onSearchChange }: LibraryToolbarProps) {
  return (
    <div className={styles.toolbar}>
      <div className={styles.titleGroup}>
        <h1 className={styles.title}>{title}</h1>
        <span className={styles.count}>
          {selectedCount >= 2 ? `${selectedCount} files selected of ${fileCount}` : `${fileCount} files`}
        </span>
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
