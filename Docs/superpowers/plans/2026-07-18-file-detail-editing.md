# Editable File Metadata + Tag Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Description, Source URL, Creator, Material, Est. print time, and Layer height editable (auto-save on blur) in both file-detail panels, and let a single file's tags be assigned via the existing folder-assignment modal.

**Architecture:** Pure frontend change — `PUT /api/files/{id}` already accepts all six fields and `PUT /api/files/{id}/tags` already exists and mirrors the folders endpoint, so no backend code changes at all. `AssignFoldersModal` gains a second checklist section for Tags. Both `FileDetailPanel` and `DetailInfoPanel` gain the same six editable fields via a small shared-by-copy (not shared-by-import) per-field save pattern.

**Tech Stack:** React + TypeScript (Vite) frontend, Vitest/RTL for tests. No backend changes.

## Global Constraints

- No backend changes — `UpdateFileRequest`/`FilesController.Update`/`FilesController.SetTags` already support everything needed (verified while brainstorming).
- Only one "+ add" button per panel — it opens the same dual-purpose (folders + tags) modal; no second button is added anywhere.
- Auto-parsing any of these six fields from the 3MF/STL file is out of scope (logged separately as `Docs/future-refinements.md` #10).
- A failed field save keeps the typed value in the input (never reverts it) and shows an inline error hint next to that field.
- Component/file names stay the same (no renames to `AssignFoldersModal`, `FileDetailPanel`, `DetailInfoPanel`) even though their scope grows — matches the project's established "limit churn" precedent.

Spec: `Docs/superpowers/specs/2026-07-18-file-detail-editing-design.md`

---

## Task 1: `api/client.ts` — generalize file updates, add tag assignment

**Files:**
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/api/client.test.ts`

**Interfaces:**
- Produces: `export interface FilePatch { description?: string; sourceUrl?: string; creator?: string; material?: string; estPrintTimeMin?: number; layerHeightMm?: number }`
- Produces: `updateFile(id: number, patch: FilePatch): Promise<ModelFile>` — replaces `updateFileDescription`, consumed by Tasks 3 and 4.
- Produces: `setFileTags(id: number, tagIds: number[]): Promise<ModelFile>` — consumed by Task 2.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/api/client.test.ts`, add a new `describe` block right before the final `describe('plateThumbnailUrl', ...)` block:

```tsx
describe('file field + tag mutations', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => vi.unstubAllGlobals())

  const okJson = (value: unknown) =>
    ({ ok: true, json: () => Promise.resolve(value) }) as Response

  it('updateFile PUTs the given patch as JSON', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(okJson({ id: 5, description: 'new' }))

    await updateFile(5, { description: 'new', material: 'PETG' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/files/5')
    expect(init.method).toBe('PUT')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ description: 'new', material: 'PETG' })
  })

  it('setFileTags PUTs the id list as JSON', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(okJson({ id: 5, tagIds: [2, 3] }))

    await setFileTags(5, [2, 3])

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/files/5/tags')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ ids: [2, 3] })
  })
})
```

And update the top import line to add the two new names:

```ts
import { batchAssign, createFolder, createTag, deleteTag, getFiles, getFolders, plateThumbnailUrl, setFileFolders, setFileTags, updateFile, updateTag, uploadFile, uploadThumbnail } from './client'
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/api/client.test.ts`
Expected: FAIL — `updateFile`/`setFileTags` are not exported.

- [ ] **Step 3: Replace `updateFileDescription` with `updateFile`, add `setFileTags`**

In `frontend/src/api/client.ts`, replace this existing function:

```ts
export async function updateFileDescription(id: number, description: string): Promise<ModelFile> {
  const url = `/api/files/${id}`
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  })
  return parseJsonOrThrow<ModelFile>(res, url)
}
```

with:

```ts
export interface FilePatch {
  description?: string
  sourceUrl?: string
  creator?: string
  material?: string
  estPrintTimeMin?: number
  layerHeightMm?: number
}

export async function updateFile(id: number, patch: FilePatch): Promise<ModelFile> {
  const url = `/api/files/${id}`
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  return parseJsonOrThrow<ModelFile>(res, url)
}
```

Then add, right after `setFileFolders`:

```ts
export async function setFileTags(id: number, tagIds: number[]): Promise<ModelFile> {
  const url = `/api/files/${id}/tags`
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: tagIds }),
  })
  return parseJsonOrThrow<ModelFile>(res, url)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/api/client.test.ts`
Expected: PASS (this file's tests only — `DetailInfoPanel.test.tsx`, which also references the now-removed `updateFileDescription`, is fixed in Task 4).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/api/client.test.ts
git commit -m "feat(frontend): generalize file field updates and add setFileTags"
```

---

## Task 2: `AssignFoldersModal` — add a Tags checklist section

**Files:**
- Modify: `frontend/src/components/AssignFoldersModal.tsx`
- Modify: `frontend/src/components/AssignFoldersModal.module.css`
- Modify: `frontend/src/components/AssignFoldersModal.test.tsx`

**Interfaces:**
- Consumes: `setFileTags`, `createTag` from `frontend/src/api/client.ts` (Task 1 / pre-existing); `tagColor` from `frontend/src/lib/format.ts`.
- Produces: `AssignFoldersModalProps` gains `tags: Tag[]`, `onTagCreated: (created: Tag) => void`; `file` prop widens to `{ id, name, folderIds, tagIds }`. Consumed by Tasks 3 and 4.

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `frontend/src/components/AssignFoldersModal.test.tsx` with:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AssignFoldersModal } from './AssignFoldersModal'
import * as client from '../api/client'
import type { Folder, ModelFile, Tag } from '../api/types'

const folders: Folder[] = [
  { id: 1, name: 'Printed', parentId: null, description: null, coverImageFileId: null, sortOrder: 0 },
  { id: 2, name: 'Terrain', parentId: null, description: null, coverImageFileId: null, sortOrder: 1 },
  { id: 3, name: 'Trees', parentId: 2, description: null, coverImageFileId: null, sortOrder: 0 },
]

const tags: Tag[] = [
  { id: 10, name: 'PLA', colorKey: 'green' },
  { id: 11, name: 'Resin', colorKey: 'brass' },
]

function setup(overrides: Partial<Parameters<typeof AssignFoldersModal>[0]> = {}) {
  const props = {
    file: { id: 7, name: 'oak.3mf', folderIds: [2], tagIds: [10] },
    folders,
    tags,
    onClose: vi.fn(),
    onSaved: vi.fn(),
    onFolderCreated: vi.fn(),
    onTagCreated: vi.fn(),
    ...overrides,
  }
  render(<AssignFoldersModal {...props} />)
  return props
}

describe('AssignFoldersModal', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('renders a flat collection tree with a checkbox per folder', () => {
    setup()
    expect(screen.getByRole('checkbox', { name: 'Printed' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Terrain' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Trees' })).toBeInTheDocument()
  })

  it('pre-checks the file’s current folders', () => {
    setup()
    expect(screen.getByRole('checkbox', { name: 'Terrain' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Printed' })).not.toBeChecked()
  })

  it('saves the new set and notifies + closes when changed', async () => {
    const updated = { id: 7, folderIds: [1, 2] } as ModelFile
    const spy = vi.spyOn(client, 'setFileFolders').mockResolvedValue(updated)
    const props = setup()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Printed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(props.onSaved).toHaveBeenCalledWith(updated))
    const [id, ids] = spy.mock.calls[0]
    expect(id).toBe(7)
    expect([...ids].sort()).toEqual([1, 2])
    expect(props.onClose).toHaveBeenCalled()
  })

  it('closes without a network call when nothing changed', () => {
    const foldersSpy = vi.spyOn(client, 'setFileFolders')
    const tagsSpy = vi.spyOn(client, 'setFileTags')
    const props = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(foldersSpy).not.toHaveBeenCalled()
    expect(tagsSpy).not.toHaveBeenCalled()
    expect(props.onClose).toHaveBeenCalled()
  })

  it('shows an alert and stays open when save fails', async () => {
    vi.spyOn(client, 'setFileFolders').mockRejectedValue(new Error('boom'))
    const props = setup()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Printed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('alert')
    expect(props.onClose).not.toHaveBeenCalled()
  })

  it('creates a folder, auto-checks it, and notifies', async () => {
    const created: Folder = { id: 9, name: 'Dragons', parentId: null, description: null, coverImageFileId: null, sortOrder: 0 }
    vi.spyOn(client, 'createFolder').mockResolvedValue(created)
    const props = setup()

    fireEvent.click(screen.getByRole('button', { name: '+ New collection' }))
    fireEvent.change(screen.getByLabelText('New collection name'), { target: { value: 'Dragons' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(props.onFolderCreated).toHaveBeenCalledWith(created))
    expect(screen.getByRole('checkbox', { name: 'Dragons' })).toBeChecked()
  })

  it('cancels on Escape', () => {
    const props = setup()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalled()
  })

  it('renders a flat tag checklist, pre-checked with the file’s current tags', () => {
    setup()
    expect(screen.getByRole('checkbox', { name: 'PLA' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Resin' })).not.toBeChecked()
  })

  it('saves changed tags via setFileTags, independent of folders', async () => {
    const updated = { id: 7, tagIds: [10, 11] } as ModelFile
    const foldersSpy = vi.spyOn(client, 'setFileFolders')
    const tagsSpy = vi.spyOn(client, 'setFileTags').mockResolvedValue(updated)
    const props = setup()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Resin' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(props.onSaved).toHaveBeenCalledWith(updated))
    expect(foldersSpy).not.toHaveBeenCalled()
    const [id, ids] = tagsSpy.mock.calls[0]
    expect(id).toBe(7)
    expect([...ids].sort()).toEqual([10, 11])
  })

  it('creates a tag, auto-checks it, and notifies', async () => {
    const created: Tag = { id: 12, name: 'Custom', colorKey: 'red' }
    vi.spyOn(client, 'createTag').mockResolvedValue(created)
    const props = setup()

    fireEvent.click(screen.getByRole('button', { name: '+ New tag' }))
    fireEvent.change(screen.getByLabelText('New tag name'), { target: { value: 'Custom' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(props.onTagCreated).toHaveBeenCalledWith(created))
    expect(screen.getByRole('checkbox', { name: 'Custom' })).toBeChecked()
  })
})
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `cd frontend && npx vitest run src/components/AssignFoldersModal.test.tsx`
Expected: FAIL — `tags` prop, tag checklist, `+ New tag`, and `setFileTags` wiring don't exist yet.

- [ ] **Step 3: Update `AssignFoldersModal.tsx`**

Replace the full contents of `frontend/src/components/AssignFoldersModal.tsx` with:

```tsx
import { useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import type { Folder, ModelFile, Tag } from '../api/types'
import { fileThumbnailUrl, setFileFolders, setFileTags, createFolder, createTag } from '../api/client'
import { buildFolderTree, type FolderNode } from '../lib/folderTree'
import { tagColor } from '../lib/format'
import styles from './AssignFoldersModal.module.css'

interface AssignFoldersModalProps {
  file: { id: number; name: string; folderIds: number[]; tagIds: number[] }
  folders: Folder[]
  tags: Tag[]
  onClose: () => void
  onSaved: (updated: ModelFile) => void
  onFolderCreated: (created: Folder) => void
  onTagCreated: (created: Tag) => void
}

function sameMembers(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((id) => set.has(id))
}

export function AssignFoldersModal({
  file,
  folders,
  tags,
  onClose,
  onSaved,
  onFolderCreated,
  onTagCreated,
}: AssignFoldersModalProps) {
  const [localFolders, setLocalFolders] = useState<Folder[]>(folders)
  const [checked, setChecked] = useState<Set<number>>(new Set(file.folderIds))
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')

  const [localTags, setLocalTags] = useState<Tag[]>(tags)
  const [checkedTags, setCheckedTags] = useState<Set<number>>(new Set(file.tagIds))
  const [showNewTag, setShowNewTag] = useState(false)
  const [newTagName, setNewTagName] = useState('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [thumbFailed, setThumbFailed] = useState(false)

  const roots = buildFolderTree(localFolders)

  function toggle(id: number) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleTag(id: number) {
    setCheckedTags((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleCollapse(id: number) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function save() {
    const nextFolders = [...checked]
    const nextTags = [...checkedTags]
    const foldersChanged = !sameMembers(file.folderIds, nextFolders)
    const tagsChanged = !sameMembers(file.tagIds, nextTags)

    if (!foldersChanged && !tagsChanged) {
      onClose()
      return
    }

    setBusy(true)
    setError(null)
    try {
      let updated: ModelFile | undefined
      if (foldersChanged) {
        updated = await setFileFolders(file.id, nextFolders)
      }
      if (tagsChanged) {
        updated = await setFileTags(file.id, nextTags)
      }
      onSaved(updated!)
      onClose()
    } catch {
      setError('Couldn’t save — try again')
      setBusy(false)
    }
  }

  async function addFolder() {
    const name = newFolderName.trim()
    if (!name) return
    setBusy(true)
    setError(null)
    try {
      const created = await createFolder(name, null)
      setLocalFolders((prev) => [...prev, created])
      setChecked((prev) => new Set(prev).add(created.id))
      setNewFolderName('')
      setShowNewFolder(false)
      onFolderCreated(created)
    } catch {
      setError('Couldn’t create collection')
    } finally {
      setBusy(false)
    }
  }

  async function addTag() {
    const name = newTagName.trim()
    if (!name) return
    setBusy(true)
    setError(null)
    try {
      const created = await createTag(name, null)
      setLocalTags((prev) => [...prev, created])
      setCheckedTags((prev) => new Set(prev).add(created.id))
      setNewTagName('')
      setShowNewTag(false)
      onTagCreated(created)
    } catch {
      setError('Couldn’t create tag')
    } finally {
      setBusy(false)
    }
  }

  function onDialogKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose()
  }

  function onBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose()
  }

  function renderNode(node: FolderNode, depth: number): ReactNode {
    const hasChildren = node.children.length > 0
    const isCollapsed = collapsed.has(node.id)
    return (
      <div key={node.id}>
        <div className={styles.row} style={{ paddingLeft: depth * 22 }}>
          {hasChildren ? (
            <button
              type="button"
              className={styles.chevron}
              aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${node.name}`}
              onClick={() => toggleCollapse(node.id)}
            >
              {isCollapsed ? '▸' : '▾'}
            </button>
          ) : (
            <span className={styles.chevronSpacer} />
          )}
          <input
            type="checkbox"
            id={`assign-folder-${node.id}`}
            className={styles.checkbox}
            checked={checked.has(node.id)}
            onChange={() => toggle(node.id)}
          />
          <label htmlFor={`assign-folder-${node.id}`} className={styles.rowLabel}>
            {node.name}
          </label>
        </div>
        {hasChildren && !isCollapsed && node.children.map((c) => renderNode(c, depth + 1))}
      </div>
    )
  }

  return (
    <div className={styles.backdrop} onClick={onBackdropClick}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={`Assign collections for ${file.name}`}
        onKeyDown={onDialogKeyDown}
      >
        <header className={styles.header}>
          {thumbFailed ? (
            <span className={styles.thumbPlaceholder} />
          ) : (
            <img
              className={styles.thumb}
              src={fileThumbnailUrl(file.id)}
              alt=""
              onError={() => setThumbFailed(true)}
            />
          )}
          <h2 className={styles.title}>{file.name}</h2>
        </header>

        <div className={styles.body}>
          {roots.map((n) => renderNode(n, 0))}

          <div className={styles.groupLabel}>Tags</div>
          {localTags.map((tag) => (
            <label key={tag.id} className={styles.tagOption}>
              <input
                type="checkbox"
                className={styles.checkbox}
                checked={checkedTags.has(tag.id)}
                onChange={() => toggleTag(tag.id)}
              />
              <span className={styles.tagDot} style={{ background: tagColor(tag.colorKey) }} aria-hidden="true" />
              <span className={styles.rowLabel}>{tag.name}</span>
            </label>
          ))}
        </div>

        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}

        <footer className={styles.footer}>
          <div className={styles.newControls}>
            <div className={styles.newFolder}>
              {showNewFolder ? (
                <>
                  <input
                    className={styles.newFolderInput}
                    aria-label="New collection name"
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addFolder()
                    }}
                  />
                  <button type="button" className={styles.textButton} disabled={busy} onClick={addFolder}>
                    Add
                  </button>
                </>
              ) : (
                <button type="button" className={styles.textButton} onClick={() => setShowNewFolder(true)}>
                  + New collection
                </button>
              )}
            </div>
            <div className={styles.newFolder}>
              {showNewTag ? (
                <>
                  <input
                    className={styles.newFolderInput}
                    aria-label="New tag name"
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addTag()
                    }}
                  />
                  <button type="button" className={styles.textButton} disabled={busy} onClick={addTag}>
                    Add
                  </button>
                </>
              ) : (
                <button type="button" className={styles.textButton} onClick={() => setShowNewTag(true)}>
                  + New tag
                </button>
              )}
            </div>
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.textButton} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className={styles.primary} disabled={busy} onClick={save}>
              Save
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Add CSS for the tag checklist and stacked new-item controls**

In `frontend/src/components/AssignFoldersModal.module.css`, add at the end of the file:

```css
.tagOption {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
  cursor: pointer;
}

.tagDot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex: 0 0 9px;
}

.newControls {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/AssignFoldersModal.test.tsx`
Expected: all tests PASS.

- [ ] **Step 6: Type-check**

Run: `cd frontend && npx tsc -b`
Expected: errors only in `FileDetailPanel.tsx`/`DetailInfoPanel.tsx` (missing new required props on `<AssignFoldersModal>` call sites) and their test files — both fixed in Tasks 3 and 4.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/AssignFoldersModal.tsx frontend/src/components/AssignFoldersModal.module.css frontend/src/components/AssignFoldersModal.test.tsx
git commit -m "feat(frontend): add tag checklist + inline tag create to AssignFoldersModal"
```

---

## Task 3: `FileDetailPanel` — editable fields + tag assignment wiring

**Files:**
- Modify: `frontend/src/components/FileDetailPanel.tsx`
- Modify: `frontend/src/components/FileDetailPanel.module.css`
- Modify: `frontend/src/components/FileDetailPanel.test.tsx`

**Interfaces:**
- Consumes: `updateFile`, `FilePatch` from `frontend/src/api/client.ts` (Task 1); `AssignFoldersModal`'s widened props (Task 2).
- Produces: `FileDetailPanelProps` gains `onFieldSaved: (updated: ModelFile) => void` and `onTagCreated: () => void`. Consumed by Task 5 (`LibraryView.tsx`).

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `frontend/src/components/FileDetailPanel.test.tsx` with:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { FileDetailPanel } from './FileDetailPanel'
import * as client from '../api/client'
import type { Folder, ModelFile, Tag } from '../api/types'

const folders: Folder[] = [
  { id: 1, name: 'Miniatures', parentId: null, description: null, coverImageFileId: null, sortOrder: 0 },
]
const tags: Tag[] = [{ id: 1, name: 'Resin', colorKey: 'brass' }]

const file: ModelFile = {
  id: 9, name: 'Dragon.stl', type: 'Stl', sizeBytes: 5_242_880, addedAt: '2026-01-01T00:00:00Z',
  dimXMm: 42, dimYMm: 28, dimZMm: 15, plateCount: null, estPrintTimeMin: 125,
  material: 'PLA', layerHeightMm: 0.2, sourceUrl: 'https://example.com/a', creator: 'Jane',
  description: 'A dragon', thumbnailPath: null, folderIds: [1], tagIds: [1], plates: [],
}

function renderPanel(overrides: Partial<Parameters<typeof FileDetailPanel>[0]> = {}) {
  const props = {
    file,
    folders,
    tags,
    onAssignmentsSaved: vi.fn(),
    onFolderCreated: vi.fn(),
    onFieldSaved: vi.fn(),
    onTagCreated: vi.fn(),
    ...overrides,
  }
  render(<FileDetailPanel {...props} />)
  return props
}

describe('FileDetailPanel', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('shows an empty state when no file is selected', () => {
    renderPanel({ file: null })
    expect(screen.getByText('Select a file')).toBeInTheDocument()
  })

  it('renders name, formatted metadata, folder chips and tag chips', () => {
    renderPanel()
    expect(screen.getByText('Dragon.stl')).toBeInTheDocument()
    expect(screen.getByText('5.0 MB')).toBeInTheDocument()
    expect(screen.getByText('42 × 28 × 15 mm')).toBeInTheDocument()
    expect(screen.getByText('Miniatures')).toBeInTheDocument()
    expect(screen.getByText('Resin')).toBeInTheDocument()
  })

  it('opens the assign-folders modal from the + add pill when a file is selected', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: '+ add' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('resets the thumbnail-failed state when a new file is selected', () => {
    const fileA: ModelFile = { ...file, id: 1, name: 'A.stl', thumbnailPath: '/thumbs/a.png' }
    const fileB: ModelFile = { ...file, id: 2, name: 'B.stl', thumbnailPath: '/thumbs/b.png' }

    const { rerender } = render(
      <FileDetailPanel
        file={fileA}
        folders={folders}
        tags={tags}
        onAssignmentsSaved={() => {}}
        onFolderCreated={() => {}}
        onFieldSaved={() => {}}
        onTagCreated={() => {}}
      />,
    )
    expect(screen.getByRole('img')).toBeInTheDocument()

    fireEvent.error(screen.getByRole('img'))
    expect(screen.getByText(/PREVIEW/)).toBeInTheDocument()

    rerender(
      <FileDetailPanel
        file={fileB}
        folders={folders}
        tags={tags}
        onAssignmentsSaved={() => {}}
        onFolderCreated={() => {}}
        onFieldSaved={() => {}}
        onTagCreated={() => {}}
      />,
    )
    expect(screen.getByRole('img')).toBeInTheDocument()
  })

  it('saves the description on blur when changed', async () => {
    const updated = { ...file, description: 'edited' }
    const spy = vi.spyOn(client, 'updateFile').mockResolvedValue(updated)
    const props = renderPanel()
    const box = screen.getByLabelText('Description')
    fireEvent.change(box, { target: { value: 'edited' } })
    fireEvent.blur(box)
    await waitFor(() => expect(spy).toHaveBeenCalledWith(9, { description: 'edited' }))
    await waitFor(() => expect(props.onFieldSaved).toHaveBeenCalledWith(updated))
  })

  it('does not save on blur when a field is unchanged', () => {
    const spy = vi.spyOn(client, 'updateFile')
    renderPanel()
    fireEvent.blur(screen.getByLabelText('Description'))
    fireEvent.blur(screen.getByLabelText('Source URL'))
    fireEvent.blur(screen.getByLabelText('Creator'))
    fireEvent.blur(screen.getByLabelText('Material'))
    fireEvent.blur(screen.getByLabelText('Est. print time (min)'))
    fireEvent.blur(screen.getByLabelText('Layer height (mm)'))
    expect(spy).not.toHaveBeenCalled()
  })

  it('saves source URL on blur when changed', async () => {
    const updated = { ...file, sourceUrl: 'https://example.com/b' }
    const spy = vi.spyOn(client, 'updateFile').mockResolvedValue(updated)
    renderPanel()
    const input = screen.getByLabelText('Source URL')
    fireEvent.change(input, { target: { value: 'https://example.com/b' } })
    fireEvent.blur(input)
    await waitFor(() => expect(spy).toHaveBeenCalledWith(9, { sourceUrl: 'https://example.com/b' }))
  })

  it('saves creator, material, est. print time, and layer height on blur', async () => {
    const spy = vi.spyOn(client, 'updateFile').mockResolvedValue(file)
    renderPanel()

    fireEvent.change(screen.getByLabelText('Creator'), { target: { value: 'Bob' } })
    fireEvent.blur(screen.getByLabelText('Creator'))
    await waitFor(() => expect(spy).toHaveBeenCalledWith(9, { creator: 'Bob' }))

    fireEvent.change(screen.getByLabelText('Material'), { target: { value: 'PETG' } })
    fireEvent.blur(screen.getByLabelText('Material'))
    await waitFor(() => expect(spy).toHaveBeenCalledWith(9, { material: 'PETG' }))

    fireEvent.change(screen.getByLabelText('Est. print time (min)'), { target: { value: '90' } })
    fireEvent.blur(screen.getByLabelText('Est. print time (min)'))
    await waitFor(() => expect(spy).toHaveBeenCalledWith(9, { estPrintTimeMin: 90 }))

    fireEvent.change(screen.getByLabelText('Layer height (mm)'), { target: { value: '0.28' } })
    fireEvent.blur(screen.getByLabelText('Layer height (mm)'))
    await waitFor(() => expect(spy).toHaveBeenCalledWith(9, { layerHeightMm: 0.28 }))
  })

  it('ignores a blank number field instead of sending it', () => {
    const spy = vi.spyOn(client, 'updateFile')
    renderPanel()
    const input = screen.getByLabelText('Est. print time (min)')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.blur(input)
    expect(spy).not.toHaveBeenCalled()
  })

  it('shows an error hint when a field save fails and keeps the typed value', async () => {
    const spy = vi.spyOn(client, 'updateFile').mockRejectedValue(new Error('boom'))
    renderPanel()
    const input = screen.getByLabelText('Creator')
    fireEvent.change(input, { target: { value: 'Bob' } })
    fireEvent.blur(input)
    await waitFor(() => expect(spy).toHaveBeenCalled())
    expect(await screen.findByText(/couldn't save/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Creator')).toHaveValue('Bob')
  })
})
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `cd frontend && npx vitest run src/components/FileDetailPanel.test.tsx`
Expected: FAIL — no editable fields exist yet, `onFieldSaved`/`onTagCreated` props don't exist.

- [ ] **Step 3: Update `FileDetailPanel.tsx`**

Replace the full contents of `frontend/src/components/FileDetailPanel.tsx` with:

```tsx
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
```

Note: `formatPrintTime` and `formatDimensions`'s print-time import is no longer used for a read-only row (print time is now an editable input), so `formatPrintTime` is dropped from the import line — only `formatBytes`, `formatDimensions`, `tagColor` remain imported from `lib/format`.

- [ ] **Step 4: Add CSS for the new editable fields**

In `frontend/src/components/FileDetailPanel.module.css`, replace the existing `.description` rule:

```css
.description {
  margin: 0 0 14px;
  font-size: 12px;
  color: var(--text-secondary);
}
```

with a textarea-appropriate version, and add the new field/hint classes at the end of the file:

```css
.description {
  width: 100%;
  min-height: 70px;
  resize: vertical;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-chip);
  padding: 8px;
  color: var(--text-primary);
  font-family: var(--font-ui, inherit);
  font-size: 12px;
}

.field {
  margin-bottom: 14px;
}

.fieldLabel {
  display: block;
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-tertiary);
  margin-bottom: 6px;
}

.fieldInput {
  width: 100%;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-chip);
  padding: 6px 8px;
  color: var(--text-primary);
  font-family: var(--font-ui, inherit);
  font-size: 12px;
}

.savingHint {
  display: inline-block;
  margin-top: 6px;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-tertiary);
}

.errorHint {
  display: inline-block;
  margin-top: 6px;
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--error);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/FileDetailPanel.test.tsx`
Expected: all tests PASS.

- [ ] **Step 6: Type-check**

Run: `cd frontend && npx tsc -b`
Expected: errors only remaining in `LibraryView.tsx` (missing new required `onFieldSaved`/`onTagCreated` props on `<FileDetailPanel>`) and `DetailInfoPanel.tsx`/its call sites — both fixed in Tasks 4 and 5.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/FileDetailPanel.tsx frontend/src/components/FileDetailPanel.module.css frontend/src/components/FileDetailPanel.test.tsx
git commit -m "feat(frontend): editable file metadata fields + tag assignment in FileDetailPanel"
```

---

## Task 4: `DetailInfoPanel` — same editable fields + tag assignment wiring

**Files:**
- Modify: `frontend/src/components/detail/DetailInfoPanel.tsx`
- Modify: `frontend/src/components/detail/DetailInfoPanel.module.css`
- Modify: `frontend/src/components/detail/DetailInfoPanel.test.tsx`

**Interfaces:**
- Consumes: `updateFile`, `FilePatch` from `frontend/src/api/client.ts` (Task 1); `AssignFoldersModal`'s widened props (Task 2).
- Produces: `onDescriptionSaved` prop **renamed** to `onFieldSaved: (updated: ModelFile) => void`; new prop `onTagCreated: () => void`. Consumed by Task 5 (`DetailView.tsx`).

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `frontend/src/components/detail/DetailInfoPanel.test.tsx` with:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DetailInfoPanel } from './DetailInfoPanel'
import * as client from '../../api/client'
import type { ModelFile, Tag } from '../../api/types'

const tags: Tag[] = [{ id: 1, name: 'Resin', colorKey: 'brass' }]

const file: ModelFile = {
  id: 5, name: 'dragon.3mf', type: 'ThreeMf', sizeBytes: 2048, addedAt: '2026-07-04T00:00:00Z',
  dimXMm: 10, dimYMm: 20, dimZMm: 30, plateCount: 2, estPrintTimeMin: 90, material: 'PLA',
  layerHeightMm: 0.2, sourceUrl: 'https://example.com/a', creator: 'Jane', description: 'orig', thumbnailPath: 't',
  folderIds: [], tagIds: [], plates: [],
}

function renderPanel(overrides: Partial<Parameters<typeof DetailInfoPanel>[0]> = {}) {
  const props = {
    file,
    folders: [],
    tags,
    onFieldSaved: vi.fn(),
    onAssignmentsSaved: vi.fn(),
    onFolderCreated: vi.fn(),
    onTagCreated: vi.fn(),
    ...overrides,
  }
  render(<DetailInfoPanel {...props} />)
  return props
}

describe('DetailInfoPanel', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('renders spec rows including plate count', () => {
    renderPanel()
    expect(screen.getByText('Dimensions')).toBeInTheDocument()
    expect(screen.getByText('10 × 20 × 30 mm')).toBeInTheDocument()
    expect(screen.getByText('Plates')).toBeInTheDocument()
  })

  it('saves the description on blur when changed', async () => {
    const updated = { ...file, description: 'edited' }
    const spy = vi.spyOn(client, 'updateFile').mockResolvedValue(updated)
    const props = renderPanel()
    const box = screen.getByLabelText('Description')
    fireEvent.change(box, { target: { value: 'edited' } })
    fireEvent.blur(box)
    await waitFor(() => expect(spy).toHaveBeenCalledWith(5, { description: 'edited' }))
    await waitFor(() => expect(props.onFieldSaved).toHaveBeenCalledWith(updated))
  })

  it('does not save on blur when a field is unchanged', () => {
    const spy = vi.spyOn(client, 'updateFile')
    renderPanel()
    fireEvent.blur(screen.getByLabelText('Description'))
    fireEvent.blur(screen.getByLabelText('Source URL'))
    fireEvent.blur(screen.getByLabelText('Creator'))
    fireEvent.blur(screen.getByLabelText('Material'))
    fireEvent.blur(screen.getByLabelText('Est. print time (min)'))
    fireEvent.blur(screen.getByLabelText('Layer height (mm)'))
    expect(spy).not.toHaveBeenCalled()
  })

  it('saves source URL, creator, material, print time, and layer height on blur', async () => {
    const spy = vi.spyOn(client, 'updateFile').mockResolvedValue(file)
    renderPanel()

    fireEvent.change(screen.getByLabelText('Source URL'), { target: { value: 'https://example.com/b' } })
    fireEvent.blur(screen.getByLabelText('Source URL'))
    await waitFor(() => expect(spy).toHaveBeenCalledWith(5, { sourceUrl: 'https://example.com/b' }))

    fireEvent.change(screen.getByLabelText('Creator'), { target: { value: 'Bob' } })
    fireEvent.blur(screen.getByLabelText('Creator'))
    await waitFor(() => expect(spy).toHaveBeenCalledWith(5, { creator: 'Bob' }))

    fireEvent.change(screen.getByLabelText('Material'), { target: { value: 'PETG' } })
    fireEvent.blur(screen.getByLabelText('Material'))
    await waitFor(() => expect(spy).toHaveBeenCalledWith(5, { material: 'PETG' }))

    fireEvent.change(screen.getByLabelText('Est. print time (min)'), { target: { value: '77' } })
    fireEvent.blur(screen.getByLabelText('Est. print time (min)'))
    await waitFor(() => expect(spy).toHaveBeenCalledWith(5, { estPrintTimeMin: 77 }))

    fireEvent.change(screen.getByLabelText('Layer height (mm)'), { target: { value: '0.16' } })
    fireEvent.blur(screen.getByLabelText('Layer height (mm)'))
    await waitFor(() => expect(spy).toHaveBeenCalledWith(5, { layerHeightMm: 0.16 }))
  })

  it('opens the assign-folders modal from the + add pill', () => {
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: '+ add' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('shows an error hint when saving the description fails', async () => {
    const spy = vi.spyOn(client, 'updateFile').mockRejectedValue(new Error('boom'))
    const props = renderPanel()
    const box = screen.getByLabelText('Description')
    fireEvent.change(box, { target: { value: 'edited' } })
    fireEvent.blur(box)
    await waitFor(() => expect(spy).toHaveBeenCalledWith(5, { description: 'edited' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/couldn't save/i))
    expect(props.onFieldSaved).not.toHaveBeenCalled()
  })

  it('clears a stale save error when navigating to a different file', async () => {
    vi.spyOn(client, 'updateFile').mockRejectedValue(new Error('boom'))
    const { rerender } = render(
      <DetailInfoPanel
        file={file}
        folders={[]}
        tags={tags}
        onFieldSaved={() => {}}
        onAssignmentsSaved={() => {}}
        onFolderCreated={() => {}}
        onTagCreated={() => {}}
      />,
    )
    const box = screen.getByLabelText('Description')
    fireEvent.change(box, { target: { value: 'edited' } })
    fireEvent.blur(box)
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())

    const other = { ...file, id: file.id + 1, description: 'other' }
    rerender(
      <DetailInfoPanel
        file={other}
        folders={[]}
        tags={tags}
        onFieldSaved={() => {}}
        onAssignmentsSaved={() => {}}
        onFolderCreated={() => {}}
        onTagCreated={() => {}}
      />,
    )

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `cd frontend && npx vitest run src/components/detail/DetailInfoPanel.test.tsx`
Expected: FAIL — `updateFileDescription` no longer exists (Task 1 removed it), new fields/props don't exist.

- [ ] **Step 3: Update `DetailInfoPanel.tsx`**

Replace the full contents of `frontend/src/components/detail/DetailInfoPanel.tsx` with:

```tsx
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
```

Note: the pre-existing `formatPrintTime` and `material`/`layerHeightMm` read-only-row rendering that used to live in `rows` is removed from the generic `rows` array (they're now editable inputs), so `formatPrintTime` is dropped from the `lib/format` import.

- [ ] **Step 4: Add CSS for the new editable fields**

In `frontend/src/components/detail/DetailInfoPanel.module.css`, add at the end of the file (the file already has `.description`, `.savingHint`, `.errorHint`, which are reused as-is):

```css
.fieldInput {
  width: 100%;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-chip);
  padding: 6px 8px;
  color: var(--text-primary);
  font-family: var(--font-ui, inherit);
  font-size: 12px;
}
```

Also, separately, fix the pre-existing stale-disabled look on `.addPill` (it currently renders `cursor: not-allowed` and a muted color from when this pill was a disabled Phase-6 placeholder, even though it has been fully clickable/wired since Phase 6 shipped) so a real "+ add" button doesn't visually read as disabled:

```css
.addPill {
  font-family: var(--font-mono);
  font-size: 10px;
  padding: 2px 8px;
  border: 1px dashed var(--text-tertiary);
  border-radius: 99px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}
```

(This replaces the existing `.addPill` rule, which had `color: var(--text-tertiary)` and `cursor: not-allowed`.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/detail/DetailInfoPanel.test.tsx`
Expected: all tests PASS.

- [ ] **Step 6: Type-check**

Run: `cd frontend && npx tsc -b`
Expected: errors only remaining in `DetailView.tsx` (missing new required props / renamed prop on `<DetailInfoPanel>`) — fixed in Task 5.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/detail/DetailInfoPanel.tsx frontend/src/components/detail/DetailInfoPanel.module.css frontend/src/components/detail/DetailInfoPanel.test.tsx
git commit -m "feat(frontend): editable file metadata fields + tag assignment in DetailInfoPanel"
```

---

## Task 5: Wire `LibraryView.tsx` and `DetailView.tsx`

**Files:**
- Modify: `frontend/src/views/LibraryView.tsx`
- Modify: `frontend/src/views/DetailView.tsx`

**Interfaces:**
- Consumes: `FileDetailPanel`'s new `onFieldSaved`/`onTagCreated` props (Task 3); `DetailInfoPanel`'s renamed `onFieldSaved` + new `onTagCreated` props (Task 4); `useTags()`'s existing `reload` (already added to the hook in the prior tag-management work).

- [ ] **Step 1: Update `LibraryView.tsx`**

In `frontend/src/views/LibraryView.tsx`, find the `<FileDetailPanel>` call site:

```tsx
<FileDetailPanel
  file={singleSelectedFile}
  folders={folders}
  tags={tags}
  onAssignmentsSaved={reloadFiles}
  onFolderCreated={reloadFolders}
/>
```

and add the two new props:

```tsx
<FileDetailPanel
  file={singleSelectedFile}
  folders={folders}
  tags={tags}
  onAssignmentsSaved={reloadFiles}
  onFolderCreated={reloadFolders}
  onFieldSaved={reloadFiles}
  onTagCreated={reloadTags}
/>
```

(`reloadTags` is already destructured from `useTags()` in this file from the prior tag-management work — `const { tags, reload: reloadTags } = useTags()`. No other change needed here.)

- [ ] **Step 2: Update `DetailView.tsx`**

In `frontend/src/views/DetailView.tsx`:

1. Change:

```tsx
const { tags } = useTags()
```

to:

```tsx
const { tags, reload: reloadTags } = useTags()
```

2. Change the `<DetailInfoPanel>` call site from:

```tsx
<DetailInfoPanel
  file={file}
  folders={folders}
  tags={tags}
  onDescriptionSaved={() => reload()}
  onAssignmentsSaved={() => reload()}
  onFolderCreated={() => reloadFolders()}
/>
```

to:

```tsx
<DetailInfoPanel
  file={file}
  folders={folders}
  tags={tags}
  onFieldSaved={() => reload()}
  onAssignmentsSaved={() => reload()}
  onFolderCreated={() => reloadFolders()}
  onTagCreated={() => reloadTags()}
/>
```

- [ ] **Step 3: Type-check and run the full frontend suite**

Run: `cd frontend && npx tsc -b`
Expected: no errors anywhere.

Run: `cd frontend && npx vitest run`
Expected: all tests PASS, including `LibraryView.test.tsx` and `DetailView.test.tsx` (neither directly asserts on `FileDetailPanel`'s or `DetailInfoPanel`'s prop names, so they should pass unchanged — if either fails, read the failure and fix the call site to match, don't change the panel components).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/views/LibraryView.tsx frontend/src/views/DetailView.tsx
git commit -m "feat(frontend): wire editable-field and tag-assignment callbacks through both file-detail views"
```

---

## Task 6: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full frontend suite, type-check, and production build**

Run: `cd frontend && npx vitest run && npx tsc -b && npm run build`
Expected: all tests PASS, no type errors, build succeeds.

- [ ] **Step 2: Manually verify against the real running app**

Run: `cd backend && $env:SEED_SAMPLE_DATA="true"; dotnet run --project PlasticRoom.Api` (PowerShell) in one terminal, `cd frontend && npm run dev` in another. Open the printed local URL and confirm, for a file in the grid view (`FileDetailPanel`) and a file opened full-screen (`DetailInfoPanel`):
- Editing Description, Source URL, Creator, Material, Est. print time, and Layer height and blurring each saves it (re-selecting the file or reloading shows the new value persisted).
- The "+ add" pill opens a modal with both a Collections tree and a Tags checklist; checking/unchecking a tag and clicking Save persists it and the file's Tags chips update.
- "+ New tag" in the modal creates a tag, auto-checks it, and it appears in the Sidebar's Tags section afterward.
- A deliberately invalid Source URL (e.g. `not a url`) shows the inline error hint after blur rather than silently failing.

- [ ] **Step 3: Report status**

Backend: no changes, so no backend test run needed for this task specifically (already covered — no backend files were touched by this plan). If desired, `cd backend && dotnet test` can still be run as a sanity check that nothing broke; expected: unchanged pass count from before this branch.

## Self-Review Notes

- **Spec coverage:** all six fields editable in both panels (Tasks 3, 4) ✓; single combined "+ add" modal with Tags checklist (Task 2) ✓; wiring through both call sites (Task 5) ✓; no backend changes (confirmed throughout) ✓; error hints keep typed value and show inline (Tasks 3, 4) ✓.
- **Type consistency checked:** `FilePatch` fields match `ModelFile`'s field names/types exactly across Tasks 1, 3, 4. `AssignFoldersModalProps.file.tagIds`/`tags`/`onTagCreated` match between Task 2's definition and Tasks 3/4's call sites. `onFieldSaved`/`onTagCreated` signatures match between each panel's prop interface (Tasks 3, 4) and their respective call sites (Task 5).
- **No placeholders:** every step has complete, runnable code; all test code is written in full, not described.
