import { useState } from 'react'
import type { Folder, Tag } from '../api/types'
import { batchAssign } from '../api/client'
import { tagColor } from '../lib/format'
import styles from './BatchAssignPanel.module.css'

interface BatchAssignPanelProps {
  selectedFileIds: number[]
  folders: Folder[]
  tags: Tag[]
  onApplied: () => void
}

export function BatchAssignPanel({ selectedFileIds, folders, tags, onApplied }: BatchAssignPanelProps) {
  const [stagedFolders, setStagedFolders] = useState<Set<number>>(new Set())
  const [stagedTags, setStagedTags] = useState<Set<number>>(new Set())
  const [folderQuery, setFolderQuery] = useState('')
  const [tagQuery, setTagQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<string | null>(null)

  const n = selectedFileIds.length
  const hasStaged = stagedFolders.size > 0 || stagedTags.size > 0

  const folderMatches = folders.filter((f) =>
    f.name.toLowerCase().includes(folderQuery.trim().toLowerCase()),
  )
  const tagMatches = tags.filter((t) =>
    t.name.toLowerCase().includes(tagQuery.trim().toLowerCase()),
  )

  function toggle(set: Set<number>, setter: (next: Set<number>) => void, id: number) {
    const next = new Set(set)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setter(next)
    setConfirmation(null)
  }

  async function apply() {
    if (!hasStaged) return
    setBusy(true)
    setError(null)
    setConfirmation(null)
    try {
      await batchAssign(selectedFileIds, [...stagedFolders], [...stagedTags])
      setStagedFolders(new Set())
      setStagedTags(new Set())
      setFolderQuery('')
      setTagQuery('')
      setConfirmation(`Added to ${n} files`)
      onApplied()
    } catch {
      setError('Couldn’t apply — try again')
    } finally {
      setBusy(false)
    }
  }

  return (
    <aside className={styles.panel}>
      <h2 className={styles.heading}>{n} files selected</h2>

      <section className={styles.section}>
        <div className={styles.sectionLabel}>FOLDERS</div>
        <input
          className={styles.search}
          aria-label="Search folders"
          placeholder="Search folders…"
          value={folderQuery}
          onChange={(e) => setFolderQuery(e.target.value)}
        />
        {stagedFolders.size > 0 && (
          <div className={styles.pills}>
            {[...stagedFolders].map((id) => {
              const folder = folders.find((f) => f.id === id)
              if (!folder) return null
              return (
                <button
                  key={id}
                  type="button"
                  className={styles.pill}
                  onClick={() => toggle(stagedFolders, setStagedFolders, id)}
                >
                  {folder.name} ×
                </button>
              )
            })}
          </div>
        )}
        <div className={styles.options}>
          {folderMatches.map((folder) => (
            <label key={folder.id} className={styles.option}>
              <input
                type="checkbox"
                checked={stagedFolders.has(folder.id)}
                onChange={() => toggle(stagedFolders, setStagedFolders, folder.id)}
              />
              {folder.name}
            </label>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionLabel}>TAGS</div>
        <input
          className={styles.search}
          aria-label="Search tags"
          placeholder="Search tags…"
          value={tagQuery}
          onChange={(e) => setTagQuery(e.target.value)}
        />
        {stagedTags.size > 0 && (
          <div className={styles.pills}>
            {[...stagedTags].map((id) => {
              const tag = tags.find((t) => t.id === id)
              if (!tag) return null
              return (
                <button
                  key={id}
                  type="button"
                  className={styles.pill}
                  style={{ color: tagColor(tag.colorKey), borderColor: tagColor(tag.colorKey) }}
                  onClick={() => toggle(stagedTags, setStagedTags, id)}
                >
                  {tag.name} ×
                </button>
              )
            })}
          </div>
        )}
        <div className={styles.options}>
          {tagMatches.map((tag) => (
            <label key={tag.id} className={styles.option}>
              <input
                type="checkbox"
                checked={stagedTags.has(tag.id)}
                onChange={() => toggle(stagedTags, setStagedTags, tag.id)}
              />
              <span style={{ color: tagColor(tag.colorKey) }}>{tag.name}</span>
            </label>
          ))}
        </div>
      </section>

      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
      {confirmation && (
        <div className={styles.confirmation} role="status">
          {confirmation}
        </div>
      )}

      <button type="button" className={styles.apply} disabled={busy || !hasStaged} onClick={apply}>
        Apply to {n}
      </button>
    </aside>
  )
}
