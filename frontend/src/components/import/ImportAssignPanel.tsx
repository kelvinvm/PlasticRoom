import { useState } from 'react'
import type { Folder, Tag } from '../../api/types'
import { tagColor } from '../../lib/format'
import styles from './ImportAssignPanel.module.css'

interface Props {
  folders: Folder[]
  tags: Tag[]
  selectedFolderIds: number[]
  onToggleFolder: (id: number) => void
  selectedTagIds: number[]
  onToggleTag: (id: number) => void
  onCreateTag: (name: string) => void
  detectedCount: number
  readyCount: number
  failedParseCount: number
  importing: boolean
  onImport: () => void
}

export function ImportAssignPanel(props: Props) {
  const [folderQuery, setFolderQuery] = useState('')
  const [tagQuery, setTagQuery] = useState('')

  const folderMatches = props.folders.filter(
    (f) => !props.selectedFolderIds.includes(f.id) && f.name.toLowerCase().includes(folderQuery.trim().toLowerCase()),
  )
  const tagMatches = props.tags.filter(
    (t) => !props.selectedTagIds.includes(t.id) && t.name.toLowerCase().includes(tagQuery.trim().toLowerCase()),
  )
  const trimmedTag = tagQuery.trim()
  const exactTag = props.tags.some((t) => t.name.toLowerCase() === trimmedTag.toLowerCase())
  const selectedFolders = props.folders.filter((f) => props.selectedFolderIds.includes(f.id))
  const selectedTags = props.tags.filter((t) => props.selectedTagIds.includes(t.id))

  return (
    <aside className={styles.panel}>
      <div className={styles.label}>ADD ALL TO FOLDER</div>
      <input
        className={styles.input}
        placeholder="Search or pick a folder…"
        value={folderQuery}
        onChange={(e) => setFolderQuery(e.target.value)}
      />
      {folderQuery.trim() && folderMatches.length > 0 ? (
        <ul className={styles.results}>
          {folderMatches.map((f) => (
            <li key={f.id}>
              <button className={styles.result} onClick={() => { props.onToggleFolder(f.id); setFolderQuery('') }}>
                {f.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className={styles.pills}>
        {selectedFolders.map((f) => (
          <button key={f.id} className={styles.pill} onClick={() => props.onToggleFolder(f.id)}>
            {f.name} ✕
          </button>
        ))}
      </div>

      <div className={styles.label}>TAGS FOR ALL</div>
      <input
        className={styles.input}
        placeholder="Add a tag…"
        value={tagQuery}
        onChange={(e) => setTagQuery(e.target.value)}
      />
      {trimmedTag ? (
        <ul className={styles.results}>
          {tagMatches.map((t) => (
            <li key={t.id}>
              <button className={styles.result} onClick={() => { props.onToggleTag(t.id); setTagQuery('') }}>
                {t.name}
              </button>
            </li>
          ))}
          {!exactTag ? (
            <li>
              <button className={styles.result} onClick={() => { props.onCreateTag(trimmedTag); setTagQuery('') }}>
                Create “{trimmedTag}”
              </button>
            </li>
          ) : null}
        </ul>
      ) : null}
      <div className={styles.pills}>
        {selectedTags.map((t) => (
          <button
            key={t.id}
            className={styles.pill}
            style={{ color: tagColor(t.colorKey) }}
            onClick={() => props.onToggleTag(t.id)}
          >
            {t.name} ✕
          </button>
        ))}
      </div>

      {props.failedParseCount > 0 ? (
        <div className={styles.warn}>
          {props.failedParseCount} file{props.failedParseCount > 1 ? 's' : ''} couldn’t be parsed — import the other {props.readyCount}.
        </div>
      ) : null}

      <button
        className={styles.importBtn}
        disabled={props.readyCount === 0 || props.importing}
        onClick={props.onImport}
      >
        {props.importing ? 'Importing…' : `Import ${props.readyCount} files`}
      </button>
    </aside>
  )
}
