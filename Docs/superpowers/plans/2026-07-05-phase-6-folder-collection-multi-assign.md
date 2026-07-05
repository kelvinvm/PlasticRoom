# Phase 6 — Folder/Collection Multi-assign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a file be assigned to any number of folders and system collections at once via a checkbox-tree modal opened from the "+ add" pill in both the detail-view info panel and the library right panel.

**Architecture:** One controlled `AssignFoldersModal` component reused by both panels. It renders a grouped (COLLECTIONS / LIBRARY) checkbox tree from the existing flat folder list, tracks a local working set of checked IDs, and commits via the existing `PUT /api/files/{id}/folders` (which already diffs server-side). Inline "+ New folder" uses the existing `POST /api/folders`. No backend changes.

**Tech Stack:** React 19 + TypeScript + Vite; Vitest + React Testing Library. Backend (unchanged): ASP.NET Core 10 + DevExpress XPO + SQLite.

## Global Constraints

- **Folders/collections only** — no tags in this modal.
- **No backend changes.** `PUT /api/files/{id}/folders` (`FilesController.SetFolders`) already deletes removed `FileFolder` rows, adds new, purges, and returns the updated `ModelFileDto`. `POST /api/folders` (`FoldersController.Create`) creates a folder and returns its DTO.
- **Request shapes:** folders PUT body is `{ "ids": number[] }` (`IdListRequest`); folder POST body is `{ "name": string, "parentId": number | null }` (`CreateFolderRequest(Name, ParentId, Description)` — Description omitted → null).
- **System collections are ordinary folders** with `isSystem: true`; they are checkable and rendered in a COLLECTIONS group above a LIBRARY group.
- **Independent checkboxes** — checking a parent does NOT cascade to children.
- **Minimal inline create** — new folders are created at root (`parentId: null`) and auto-checked.
- **Frontend conventions:** no router / state manager / data-fetching lib; CSS Modules over `frontend/src/styles/tokens.css`. A Vitest file needs the `// @vitest-environment jsdom` docblock ONLY if it transitively imports `three` — none of this plan's test files do, so omit it (matches `PlateFilmstrip.test.tsx`).
- Frontend commands run from `frontend/`: `npm test`, `npx tsc -b`, `npm run build`.

---

## File Structure

- Modify: `frontend/src/api/client.ts` — add `setFileFolders`, `createFolder`.
- Modify: `frontend/src/api/client.test.ts` — cover both.
- Modify: `frontend/src/hooks/useFolders.ts`, `frontend/src/hooks/useFiles.ts` — add `reload`.
- Modify: `frontend/src/hooks/useFolders.test.ts` (new), `frontend/src/hooks/useFiles.test.ts` (new) — cover `reload`.
- Create: `frontend/src/components/AssignFoldersModal.tsx`, `.module.css`, `.test.tsx`.
- Modify: `frontend/src/components/detail/DetailInfoPanel.tsx` (+ `.test.tsx`) — enable pill, open modal.
- Modify: `frontend/src/views/DetailView.tsx` — pass reload callbacks.
- Modify: `frontend/src/components/FileDetailPanel.tsx` (+ `.module.css`, `.test.tsx`) — add pill, open modal.
- Modify: `frontend/src/views/LibraryView.tsx` — wire `useFiles`/`useFolders` reloads.

---

## Task 1: API client — `setFileFolders` + `createFolder`

**Files:**
- Modify: `frontend/src/api/client.ts`
- Test: `frontend/src/api/client.test.ts`

**Interfaces:**
- Produces: `setFileFolders(id: number, folderIds: number[]): Promise<ModelFile>` → `PUT /api/files/{id}/folders`, body `{ ids: folderIds }`. `createFolder(name: string, parentId: number | null): Promise<Folder>` → `POST /api/folders`, body `{ name, parentId }`.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/api/client.test.ts` (inside a new `describe`, reusing the file's `okJson` pattern):

```ts
describe('folder mutations', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => vi.unstubAllGlobals())

  const okJson = (value: unknown) =>
    ({ ok: true, json: () => Promise.resolve(value) }) as Response

  it('setFileFolders PUTs the id list as JSON', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(okJson({ id: 7 }))

    await setFileFolders(7, [3, 5])

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/files/7/folders')
    expect(init.method).toBe('PUT')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ ids: [3, 5] })
  })

  it('createFolder POSTs name + parentId as JSON', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(okJson({ id: 9, name: 'Dragons', parentId: null }))

    const folder = await createFolder('Dragons', null)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/folders')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ name: 'Dragons', parentId: null })
    expect(folder.id).toBe(9)
  })
})
```

Add `setFileFolders, createFolder` to the existing top-of-file import from `./client`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/api/client.test.ts`
Expected: FAIL — `setFileFolders`/`createFolder` not exported.

- [ ] **Step 3: Implement the client functions**

Append to `frontend/src/api/client.ts` (the file already imports `Folder` and `ModelFile` and has `parseJsonOrThrow`):

```ts
export async function setFileFolders(id: number, folderIds: number[]): Promise<ModelFile> {
  const url = `/api/files/${id}/folders`
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: folderIds }),
  })
  return parseJsonOrThrow<ModelFile>(res, url)
}

export async function createFolder(name: string, parentId: number | null): Promise<Folder> {
  const res = await fetch('/api/folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, parentId }),
  })
  return parseJsonOrThrow<Folder>(res, '/api/folders')
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/api/client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/api/client.test.ts
git commit -m "feat(frontend): add setFileFolders + createFolder API client fns"
```

---

## Task 2: `reload` on `useFolders` and `useFiles`

**Files:**
- Modify: `frontend/src/hooks/useFolders.ts`, `frontend/src/hooks/useFiles.ts`
- Test: `frontend/src/hooks/useFolders.test.ts` (new), `frontend/src/hooks/useFiles.test.ts` (new)

**Interfaces:**
- Produces: `useFolders()` return type gains `reload: () => void`; `useFiles(folderId, q)` return type gains `reload: () => void`. Calling `reload()` re-fetches.

- [ ] **Step 1: Write the failing tests**

`frontend/src/hooks/useFolders.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useFolders } from './useFolders'
import * as client from '../api/client'

describe('useFolders', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('refetches folders when reload is called', async () => {
    const spy = vi.spyOn(client, 'getFolders').mockResolvedValue([])
    const { result } = renderHook(() => useFolders())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(spy).toHaveBeenCalledTimes(1)

    act(() => result.current.reload())
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2))
  })
})
```

`frontend/src/hooks/useFiles.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useFiles } from './useFiles'
import * as client from '../api/client'

describe('useFiles', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('refetches files when reload is called', async () => {
    const spy = vi.spyOn(client, 'getFiles').mockResolvedValue([])
    const { result } = renderHook(() => useFiles(null, ''))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(spy).toHaveBeenCalledTimes(1)

    act(() => result.current.reload())
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2))
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/hooks/useFolders.test.ts src/hooks/useFiles.test.ts`
Expected: FAIL — `result.current.reload` is not a function.

- [ ] **Step 3: Add `reload` to both hooks**

In `frontend/src/hooks/useFolders.ts`, change the signature return type and add a reload counter:

```ts
export function useFolders(): { folders: Folder[]; loading: boolean; error: boolean; reload: () => void } {
  const [folders, setFolders] = useState<Folder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [reloadIndex, setReloadIndex] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    getFolders()
      .then((data) => {
        if (!cancelled) setFolders(data)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [reloadIndex])

  return { folders, loading, error, reload: () => setReloadIndex((n) => n + 1) }
}
```

In `frontend/src/hooks/useFiles.ts`, the same pattern with `reloadIndex` added to the existing `[folderId, q]` deps:

```ts
export function useFiles(
  folderId: number | null,
  q: string,
): { files: ModelFile[]; loading: boolean; error: boolean; reload: () => void } {
  const [files, setFiles] = useState<ModelFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [reloadIndex, setReloadIndex] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    getFiles(folderId, q)
      .then((data) => {
        if (!cancelled) setFiles(data)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [folderId, q, reloadIndex])

  return { files, loading, error, reload: () => setReloadIndex((n) => n + 1) }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/hooks/useFolders.test.ts src/hooks/useFiles.test.ts` then `npx tsc -b`
Expected: PASS; tsc clean (existing destructures still valid — the added field is additive).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useFolders.ts frontend/src/hooks/useFiles.ts frontend/src/hooks/useFolders.test.ts frontend/src/hooks/useFiles.test.ts
git commit -m "feat(frontend): expose reload() from useFolders + useFiles"
```

---

## Task 3: `AssignFoldersModal` component

**Files:**
- Create: `frontend/src/components/AssignFoldersModal.tsx`, `frontend/src/components/AssignFoldersModal.module.css`
- Test: `frontend/src/components/AssignFoldersModal.test.tsx`

**Interfaces:**
- Consumes: `setFileFolders`, `createFolder`, `fileThumbnailUrl` (client); `buildFolderTree`, `FolderNode` (`lib/folderTree`); `Folder`, `ModelFile` (types).
- Produces:
  `AssignFoldersModal(props: { file: { id: number; name: string; folderIds: number[] }; folders: Folder[]; onClose: () => void; onSaved: (updated: ModelFile) => void; onFolderCreated: (created: Folder) => void }): JSX.Element`.
  Behavior: grouped COLLECTIONS/LIBRARY checkbox tree; pre-checks `file.folderIds`; Save with no change calls `onClose()` and does NOT hit the network; Save with changes calls `setFileFolders(file.id, checkedIds)`, then `onSaved(updated)` + `onClose()`; a failed save shows `role="alert"` and stays open; "+ New folder" calls `createFolder(name, null)`, auto-checks it, fires `onFolderCreated`; Esc / backdrop click calls `onClose()`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/components/AssignFoldersModal.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { AssignFoldersModal } from './AssignFoldersModal'
import * as client from '../api/client'
import type { Folder, ModelFile } from '../api/types'

const folders: Folder[] = [
  { id: 1, name: 'Printed', parentId: null, description: null, coverImageFileId: null, sortOrder: 0, isSystem: true },
  { id: 2, name: 'Terrain', parentId: null, description: null, coverImageFileId: null, sortOrder: 1, isSystem: false },
  { id: 3, name: 'Trees', parentId: 2, description: null, coverImageFileId: null, sortOrder: 0, isSystem: false },
]

function setup(overrides: Partial<Parameters<typeof AssignFoldersModal>[0]> = {}) {
  const props = {
    file: { id: 7, name: 'oak.3mf', folderIds: [2] },
    folders,
    onClose: vi.fn(),
    onSaved: vi.fn(),
    onFolderCreated: vi.fn(),
    ...overrides,
  }
  render(<AssignFoldersModal {...props} />)
  return props
}

describe('AssignFoldersModal', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('renders COLLECTIONS and LIBRARY groups with a checkbox per folder', () => {
    setup()
    expect(screen.getByText('COLLECTIONS')).toBeInTheDocument()
    expect(screen.getByText('LIBRARY')).toBeInTheDocument()
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
    const spy = vi.spyOn(client, 'setFileFolders')
    const props = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(spy).not.toHaveBeenCalled()
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
    const created: Folder = { id: 9, name: 'Dragons', parentId: null, description: null, coverImageFileId: null, sortOrder: 0, isSystem: false }
    vi.spyOn(client, 'createFolder').mockResolvedValue(created)
    const props = setup()

    fireEvent.click(screen.getByRole('button', { name: '+ New folder' }))
    fireEvent.change(screen.getByLabelText('New folder name'), { target: { value: 'Dragons' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => expect(props.onFolderCreated).toHaveBeenCalledWith(created))
    expect(screen.getByRole('checkbox', { name: 'Dragons' })).toBeChecked()
  })

  it('cancels on Escape', () => {
    const props = setup()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/components/AssignFoldersModal.test.tsx`
Expected: FAIL — module `./AssignFoldersModal` cannot be resolved.

- [ ] **Step 3: Implement the component**

`frontend/src/components/AssignFoldersModal.tsx`:

```tsx
import { useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import type { Folder, ModelFile } from '../api/types'
import { fileThumbnailUrl, setFileFolders, createFolder } from '../api/client'
import { buildFolderTree, type FolderNode } from '../lib/folderTree'
import styles from './AssignFoldersModal.module.css'

interface AssignFoldersModalProps {
  file: { id: number; name: string; folderIds: number[] }
  folders: Folder[]
  onClose: () => void
  onSaved: (updated: ModelFile) => void
  onFolderCreated: (created: Folder) => void
}

function sameMembers(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((id) => set.has(id))
}

export function AssignFoldersModal({
  file,
  folders,
  onClose,
  onSaved,
  onFolderCreated,
}: AssignFoldersModalProps) {
  const [localFolders, setLocalFolders] = useState<Folder[]>(folders)
  const [checked, setChecked] = useState<Set<number>>(new Set(file.folderIds))
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [thumbFailed, setThumbFailed] = useState(false)

  const tree = buildFolderTree(localFolders)
  const collectionRoots = tree.filter((n) => n.isSystem)
  const libraryRoots = tree.filter((n) => !n.isSystem)

  function toggle(id: number) {
    setChecked((prev) => {
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
    const next = [...checked]
    if (sameMembers(file.folderIds, next)) {
      onClose()
      return
    }
    setBusy(true)
    setError(null)
    try {
      const updated = await setFileFolders(file.id, next)
      onSaved(updated)
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
      setError('Couldn’t create folder')
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
        aria-label={`Assign folders for ${file.name}`}
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
          {collectionRoots.length > 0 && (
            <section aria-label="Collections">
              <div className={styles.groupLabel}>COLLECTIONS</div>
              {collectionRoots.map((n) => renderNode(n, 0))}
            </section>
          )}
          {libraryRoots.length > 0 && (
            <section aria-label="Library">
              <div className={styles.groupLabel}>LIBRARY</div>
              {libraryRoots.map((n) => renderNode(n, 0))}
            </section>
          )}
        </div>

        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}

        <footer className={styles.footer}>
          <div className={styles.newFolder}>
            {showNewFolder ? (
              <>
                <input
                  className={styles.newFolderInput}
                  aria-label="New folder name"
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
                + New folder
              </button>
            )}
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

`frontend/src/components/AssignFoldersModal.module.css`:

```css
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
}

.dialog {
  width: 760px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 64px);
  display: flex;
  flex-direction: column;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}

.header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
}

.thumb,
.thumbPlaceholder {
  width: 44px;
  height: 44px;
  border-radius: 6px;
  object-fit: cover;
  flex: 0 0 auto;
}

.thumbPlaceholder {
  background: var(--thumb-placeholder);
}

.title {
  margin: 0;
  font-size: 15px;
  color: var(--text-primary);
}

.body {
  padding: 12px 16px;
  overflow-y: auto;
}

.groupLabel {
  margin: 12px 0 6px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-secondary);
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 30px;
}

.chevron {
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
}

.chevronSpacer {
  width: 18px;
  flex: 0 0 auto;
}

.checkbox {
  accent-color: var(--accent);
  width: 15px;
  height: 15px;
}

.rowLabel {
  color: var(--text-primary);
  cursor: pointer;
}

.error {
  padding: 6px 16px;
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 12px;
}

.footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border);
}

.newFolder {
  display: flex;
  align-items: center;
  gap: 8px;
}

.newFolderInput {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-primary);
  padding: 4px 8px;
}

.actions {
  display: flex;
  gap: 8px;
}

.textButton {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 13px;
}

.primary {
  background: var(--accent);
  border: none;
  border-radius: 6px;
  color: #1b1b1b;
  cursor: pointer;
  font-size: 13px;
  padding: 6px 14px;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/components/AssignFoldersModal.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/AssignFoldersModal.tsx frontend/src/components/AssignFoldersModal.module.css frontend/src/components/AssignFoldersModal.test.tsx
git commit -m "feat(frontend): AssignFoldersModal grouped checkbox tree + save/create"
```

---

## Task 4: Wire Screen 5 (`DetailInfoPanel` + `DetailView`)

**Files:**
- Modify: `frontend/src/components/detail/DetailInfoPanel.tsx`, `frontend/src/components/detail/DetailInfoPanel.test.tsx`
- Modify: `frontend/src/views/DetailView.tsx`

**Interfaces:**
- Consumes: `AssignFoldersModal` (Task 3), `useFolders().reload` (Task 2), `useFile().reload` (existing).
- Produces: `DetailInfoPanel` props gain `onAssignmentsSaved: () => void` and `onFolderCreated: () => void`; its "+ add" pill is enabled and opens the modal.

- [ ] **Step 1: Update the test**

In `frontend/src/components/detail/DetailInfoPanel.test.tsx`, add `onAssignmentsSaved={() => {}}` and `onFolderCreated={() => {}}` to every `<DetailInfoPanel ... />` render, then add:

```tsx
it('opens the assign-folders modal from the + add pill', () => {
  render(
    <DetailInfoPanel
      file={sampleFile}
      folders={[]}
      tags={[]}
      onDescriptionSaved={() => {}}
      onAssignmentsSaved={() => {}}
      onFolderCreated={() => {}}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: '+ add' }))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
})
```

(Reuse the file’s existing `sampleFile` fixture and imports; add `fireEvent`/`screen` to the testing-library import if not already present.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/detail/DetailInfoPanel.test.tsx`
Expected: FAIL — the pill is disabled / no dialog appears; TS errors on the missing props.

- [ ] **Step 3: Update `DetailInfoPanel`**

Add to the imports:

```tsx
import { useState } from 'react'
import { AssignFoldersModal } from '../AssignFoldersModal'
```

Add the two props to the component's prop type and destructure them:
`onAssignmentsSaved: () => void` and `onFolderCreated: () => void`.

Add local state near the top of the component body:

```tsx
  const [assignOpen, setAssignOpen] = useState(false)
```

Replace the disabled pill:

```tsx
          <button type="button" className={styles.addPill} disabled title="Coming in Phase 6">
            + add
          </button>
```

with:

```tsx
          <button type="button" className={styles.addPill} onClick={() => setAssignOpen(true)}>
            + add
          </button>
```

And render the modal just before the closing `</aside>`:

```tsx
      {assignOpen && (
        <AssignFoldersModal
          file={file}
          folders={folders}
          onClose={() => setAssignOpen(false)}
          onSaved={() => onAssignmentsSaved()}
          onFolderCreated={() => onFolderCreated()}
        />
      )}
```

- [ ] **Step 4: Wire `DetailView`**

In `frontend/src/views/DetailView.tsx`, change:

```tsx
  const { folders } = useFolders()
```

to:

```tsx
  const { folders, reload: reloadFolders } = useFolders()
```

and pass the new callbacks to `DetailInfoPanel` (alongside the existing `onDescriptionSaved`):

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

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test -- src/components/detail/DetailInfoPanel.test.tsx src/views/DetailView.test.tsx` then `npx tsc -b`
Expected: PASS; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/detail/DetailInfoPanel.tsx frontend/src/components/detail/DetailInfoPanel.test.tsx frontend/src/views/DetailView.tsx
git commit -m "feat(frontend): detail info panel opens folder-assign modal"
```

---

## Task 5: Wire Screen 1 (`FileDetailPanel` + `LibraryView`)

**Files:**
- Modify: `frontend/src/components/FileDetailPanel.tsx`, `frontend/src/components/FileDetailPanel.module.css`, `frontend/src/components/FileDetailPanel.test.tsx`
- Modify: `frontend/src/views/LibraryView.tsx`

**Interfaces:**
- Consumes: `AssignFoldersModal` (Task 3), `useFiles().reload` + `useFolders().reload` (Task 2).
- Produces: `FileDetailPanel` props gain `onAssignmentsSaved: () => void` and `onFolderCreated: () => void`; a Folders section with an always-present "+ add" pill (the panel currently has none) opens the modal when a file is selected.

- [ ] **Step 1: Update the test**

In `frontend/src/components/FileDetailPanel.test.tsx`, add `onAssignmentsSaved={() => {}}` and `onFolderCreated={() => {}}` to every render, then add:

```tsx
it('opens the assign-folders modal from the + add pill when a file is selected', () => {
  render(
    <FileDetailPanel
      file={sampleFile}
      folders={[]}
      tags={[]}
      onAssignmentsSaved={() => {}}
      onFolderCreated={() => {}}
    />,
  )
  fireEvent.click(screen.getByRole('button', { name: '+ add' }))
  expect(screen.getByRole('dialog')).toBeInTheDocument()
})
```

(Reuse the file’s existing sample file fixture; add `fireEvent`/`screen` imports if missing.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/FileDetailPanel.test.tsx`
Expected: FAIL — no "+ add" button; TS errors on missing props.

- [ ] **Step 3: Update `FileDetailPanel`**

Add to imports:

```tsx
import { AssignFoldersModal } from './AssignFoldersModal'
```

Extend the props interface and destructure:

```tsx
interface FileDetailPanelProps {
  file: ModelFile | null
  folders: Folder[]
  tags: Tag[]
  onAssignmentsSaved: () => void
  onFolderCreated: () => void
}
```

```tsx
export function FileDetailPanel({ file, folders, tags, onAssignmentsSaved, onFolderCreated }: FileDetailPanelProps) {
  const [thumbFailed, setThumbFailed] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)
```

Replace the conditional Folders block:

```tsx
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
```

with an always-present Folders section that includes the pill:

```tsx
      <div className={styles.chipGroup}>
        <div className={styles.chipLabel}>Folders</div>
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
```

And render the modal just before the closing `</aside>`:

```tsx
      {assignOpen && (
        <AssignFoldersModal
          file={file}
          folders={folders}
          onClose={() => setAssignOpen(false)}
          onSaved={() => onAssignmentsSaved()}
          onFolderCreated={() => onFolderCreated()}
        />
      )}
```

(`file` is non-null here — this markup is inside the `file !== null` render path that begins after the early `return` for the empty state.)

Add the pill style to `frontend/src/components/FileDetailPanel.module.css`:

```css
.addPill {
  border: 1px dashed var(--border);
  border-radius: var(--radius-chip, 6px);
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 12px;
  padding: 2px 8px;
}
```

- [ ] **Step 4: Wire `LibraryView`**

In `frontend/src/views/LibraryView.tsx`, change the hook destructures:

```tsx
  const { folders, reload: reloadFolders } = useFolders()
  const { tags } = useTags()
  const { files, loading, error, reload: reloadFiles } = useFiles(selectedFolderId, debouncedSearch)
```

and pass callbacks to the panel:

```tsx
      <FileDetailPanel
        file={selectedFile}
        folders={folders}
        tags={tags}
        onAssignmentsSaved={reloadFiles}
        onFolderCreated={reloadFolders}
      />
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test -- src/components/FileDetailPanel.test.tsx` then `npx tsc -b`
Expected: PASS; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/FileDetailPanel.tsx frontend/src/components/FileDetailPanel.module.css frontend/src/components/FileDetailPanel.test.tsx frontend/src/views/LibraryView.tsx
git commit -m "feat(frontend): library detail panel opens folder-assign modal"
```

---

## Task 6: Full-suite verification + manual check

**Files:** none (verification only; commit any fixes found).

- [ ] **Step 1: Full frontend suite + typecheck + build**

Run from `frontend/`: `npm test` → all green; `npx tsc -b` → clean; `npm run build` → succeeds.

- [ ] **Step 2: Backend sanity (unchanged, but confirm nothing drifted)**

Run from `backend/`: `dotnet test` → all green.

- [ ] **Step 3: Manual verification**

Backend: `cd backend; $env:SEED_SAMPLE_DATA="true"; dotnet run --project PlasticRoom.Api` (http://localhost:5102).
Frontend: `cd frontend; npm run dev` (http://localhost:5173).

- In the library, select a file → right panel shows a Folders section with a "+ add" pill → click it. The modal (760px) shows the file thumbnail + name, a COLLECTIONS group and a LIBRARY group, current folders pre-checked.
- Check a collection (e.g. Printed) and an additional folder → Save. The panel’s chips update; if a folder filter is active and you removed the file’s only matching folder, it leaves the grid.
- Reopen; use "+ New folder", type a name, Add → it appears checked and shows up in the Sidebar tree after Save.
- Open a file’s full detail view (double-click) → the info panel’s "+ add" pill opens the same modal; Save updates the chips there too.
- Cancel / Esc / backdrop click discards changes.

- [ ] **Step 4: Commit any fixes**

Commit separately if manual verification surfaces adjustments, e.g.:

```bash
git commit -am "fix(frontend): <manual-verification fix>"
```

---

## Post-implementation

- Mark Phase 6 status **complete** in `Docs/superpowers/specs/2026-07-02-plastic-room-project-overview.md`.
- Update `project-plastic-room.md` memory: Phase 6 done — `AssignFoldersModal` reused by both panels, `setFileFolders`/`createFolder` client fns, `reload()` added to `useFolders`/`useFiles`, backend untouched.
- Remaining deferred (unchanged): tags in the modal; nested folder create; parent↔child cascades; Phase 7 batch tagging; folder-cycle guard in `FoldersController.Update` (Phase 8).
```
