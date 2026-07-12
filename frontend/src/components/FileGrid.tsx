import { useEffect, useState } from 'react'
import type { ModelFile, Tag } from '../api/types'
import { fileThumbnailUrl } from '../api/client'
import { tagColor } from '../lib/format'
import type { SelectModifiers } from '../lib/gridSelection'
import { TileMenu } from './TileMenu'
import styles from './FileGrid.module.css'

interface FileGridProps {
  files: ModelFile[]
  tags: Tag[]
  selectedFileIds: ReadonlySet<number>
  onSelectFile: (id: number, mods: SelectModifiers) => void
  onOpenFile: (id: number) => void
  onRequestDelete: (file: ModelFile) => void
}

export function typeLabel(type: ModelFile['type']): string {
  return type === 'ThreeMf' ? '3MF' : 'STL'
}

interface CardProps {
  file: ModelFile
  tags: Tag[]
  selected: boolean
  multiActive: boolean
  menuOpen: boolean
  onSelect: (id: number, mods: SelectModifiers) => void
  onOpen: (id: number) => void
  onToggleMenu: (id: number) => void
  onCloseMenu: () => void
  onRequestDelete: (file: ModelFile) => void
}

function FileCard({
  file, tags, selected, multiActive, menuOpen,
  onSelect, onOpen, onToggleMenu, onCloseMenu, onRequestDelete,
}: CardProps) {
  const [thumbFailed, setThumbFailed] = useState(false)
  const fileTags = file.tagIds
    .map((id) => tags.find((t) => t.id === id))
    .filter((t): t is Tag => t !== undefined)

  const showImg = file.thumbnailPath !== null && !thumbFailed

  return (
    <div className={styles.cardWrap}>
      <button
        type="button"
        className={`${styles.card} ${selected ? styles.cardSelected : ''} ${
          multiActive && !selected ? styles.cardDimmed : ''
        }`}
        aria-current={selected ? 'true' : undefined}
        onClick={(e) =>
          onSelect(file.id, { metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey })
        }
        onDoubleClick={() => onOpen(file.id)}
      >
        {selected && multiActive && (
          <span className={styles.selectBadge} data-testid="select-badge" aria-hidden="true">
            ✓
          </span>
        )}
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

      <button
        type="button"
        className={styles.kebab}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={`Actions for ${file.name}`}
        onClick={(e) => { e.stopPropagation(); onToggleMenu(file.id) }}
      >
        ⋯
      </button>

      {menuOpen && (
        <TileMenu
          items={[
            { label: 'Delete', danger: true, onClick: () => { onCloseMenu(); onRequestDelete(file) } },
          ]}
        />
      )}
    </div>
  )
}

export function FileGrid({
  files, tags, selectedFileIds, onSelectFile, onOpenFile, onRequestDelete,
}: FileGridProps) {
  const multiActive = selectedFileIds.size >= 2
  const [openMenuId, setOpenMenuId] = useState<number | null>(null)

  // Dismiss an open tile menu on outside click or Escape (single menu open at a time).
  useEffect(() => {
    if (openMenuId === null) return
    const close = () => setOpenMenuId(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenMenuId(null) }
    document.addEventListener('click', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [openMenuId])

  return (
    <div className={styles.grid}>
      {files.map((file) => (
        <FileCard
          key={file.id}
          file={file}
          tags={tags}
          selected={selectedFileIds.has(file.id)}
          multiActive={multiActive}
          menuOpen={openMenuId === file.id}
          onSelect={onSelectFile}
          onOpen={onOpenFile}
          onToggleMenu={(id) => setOpenMenuId((cur) => (cur === id ? null : id))}
          onCloseMenu={() => setOpenMenuId(null)}
          onRequestDelete={onRequestDelete}
        />
      ))}
    </div>
  )
}
