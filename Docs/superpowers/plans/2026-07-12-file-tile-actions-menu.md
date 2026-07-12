# File Tile Actions Menu (kebab) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an always-visible 3-dot (kebab) actions menu to every file tile in the library grid, with Delete (guarded by a confirmation dialog) as its first action.

**Architecture:** The kebab is a sibling button overlaying each card (the card stays a `<button>`; no button-in-button). Menu open-state is lifted to `FileGrid` (single menu open, dismiss on Escape/outside-click), mirroring the Sidebar context-menu pattern. Delete bubbles to `LibraryView`, which owns selection + `reloadFiles`, shows a shared `ConfirmDialog`, calls a new `deleteFile` client fn, then refetches and drops the id from selection. The Sidebar folder-delete is migrated onto the same extracted `ConfirmDialog`.

**Tech Stack:** React + TypeScript (Vite), CSS Modules, Vitest + @testing-library/react. Backend unchanged (`DELETE /api/files/{id}` already exists).

## Global Constraints

- Frontend dir: `frontend/`. Run tests with `npx vitest run <path>`; typecheck with `npx tsc -b`. No lint script exists — `tsc -b` is the gate.
- CSS uses the design tokens in `frontend/src/styles/tokens.css` (`--bg-panel`, `--border`, `--error`, `--accent`, `--accent-text`, `--text-primary`, `--bg-surface`, `--radius-*`). Never hardcode palette values that a token exists for.
- Match existing code style: named exports, CSS Modules imported as `styles`, no default exports for components.
- Commit after each task. Work on branch `tile-actions-menu`.

---

### Task 1: Extract shared `ConfirmDialog` and migrate the Sidebar

**Files:**
- Create: `frontend/src/components/ConfirmDialog.tsx`
- Create: `frontend/src/components/ConfirmDialog.module.css`
- Create: `frontend/src/components/ConfirmDialog.test.tsx`
- Modify: `frontend/src/components/Sidebar.tsx` (replace inline delete-dialog JSX; add import)
- Modify: `frontend/src/components/Sidebar.module.css` (remove the moved dialog classes)

**Interfaces:**
- Produces: `ConfirmDialog` component with props
  ```ts
  interface ConfirmDialogProps {
    body: React.ReactNode
    confirmLabel?: string      // default 'Delete'
    danger?: boolean           // red confirm button; default false
    error?: string | null      // rendered inside the dialog; default null
    onConfirm: () => void
    onCancel: () => void
  }
  ```
  Presentational only: the owner runs the async work and decides when to unmount it (success) or keep it mounted with `error` (failure).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/ConfirmDialog.test.tsx`:
```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './ConfirmDialog'

describe('ConfirmDialog', () => {
  it('renders the body and default Delete/Cancel buttons', () => {
    render(<ConfirmDialog body="Delete X?" onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByText('Delete X?')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('is an accessible modal dialog described by its body', () => {
    render(<ConfirmDialog body="Delete X?" onConfirm={vi.fn()} onCancel={vi.fn()} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    const descId = dialog.getAttribute('aria-describedby')
    expect(screen.getByText('Delete X?')).toHaveAttribute('id', descId!)
  })

  it('fires onConfirm from the confirm button (respecting confirmLabel)', () => {
    const onConfirm = vi.fn()
    render(<ConfirmDialog body="x" confirmLabel="Remove" onConfirm={onConfirm} onCancel={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('fires onCancel on Cancel, backdrop click, and Escape', () => {
    const onCancel = vi.fn()
    const { container } = render(<ConfirmDialog body="x" onConfirm={vi.fn()} onCancel={onCancel} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(container.firstChild as HTMLElement) // backdrop
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(3)
  })

  it('renders an error message when provided', () => {
    render(<ConfirmDialog body="x" error="Could not delete." onConfirm={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByText('Could not delete.')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/ConfirmDialog.test.tsx`
Expected: FAIL — cannot resolve `./ConfirmDialog`.

- [ ] **Step 3: Create the component**

Create `frontend/src/components/ConfirmDialog.tsx`:
```tsx
import { useEffect, useId } from 'react'
import type { ReactNode } from 'react'
import styles from './ConfirmDialog.module.css'

interface ConfirmDialogProps {
  body: ReactNode
  confirmLabel?: string
  danger?: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  body, confirmLabel = 'Delete', danger = false, error = null, onConfirm, onCancel,
}: ConfirmDialogProps) {
  const bodyId = useId()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className={styles.backdrop} onClick={onCancel}>
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-describedby={bodyId}
        onClick={(e) => e.stopPropagation()}
      >
        <p id={bodyId} className={styles.body}>{body}</p>
        {error && <p className={styles.error} role="alert">{error}</p>}
        <div className={styles.actions}>
          <button type="button" className={styles.cancel} onClick={onCancel}>Cancel</button>
          <button
            type="button"
            className={danger ? styles.confirmDanger : styles.confirm}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
```

Create `frontend/src/components/ConfirmDialog.module.css` (values moved verbatim from `Sidebar.module.css`):
```css
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 30;
}

.dialog {
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 20px;
  max-width: 340px;
}

.body { color: var(--text-primary); font-size: 13px; margin: 0 0 16px; }
.error { color: var(--error); font-size: 11px; margin: 0 0 12px; }
.actions { display: flex; justify-content: flex-end; gap: 8px; }

.cancel,
.confirm,
.confirmDanger {
  border-radius: 7px;
  padding: 7px 14px;
  font: inherit;
  cursor: pointer;
  border: 1px solid var(--border);
}

.cancel { background: transparent; color: var(--text-primary); }
.confirm { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }
.confirmDanger { background: var(--error); color: #fff; border-color: var(--error); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/ConfirmDialog.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Migrate the Sidebar onto ConfirmDialog**

In `frontend/src/components/Sidebar.tsx`, add the import near the other component imports:
```tsx
import { ConfirmDialog } from './ConfirmDialog'
```

Replace the inline dialog block (the `{pendingDelete && ( <div className={styles.dialogBackdrop} ...> ... </div> )}` JSX) with:
```tsx
      {pendingDelete && (
        <ConfirmDialog
          body={<>Delete “{pendingDelete.name}” and its subfolders? Files stay in your library but lose this folder assignment.</>}
          danger
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
```
Leave the existing `{actionError && <div role="alert" ...>}` line and the `confirmDelete`/`pendingDelete` logic unchanged.

In `frontend/src/components/Sidebar.module.css`, delete the now-unused classes: `.dialogBackdrop`, `.dialog`, `.dialogBody`, `.dialogActions`, `.dialogCancel`, `.dialogDelete`. Keep `.actionError` and everything else.

- [ ] **Step 6: Run the affected suites + typecheck**

Run: `cd frontend && npx vitest run src/components/Sidebar.test.tsx src/components/ConfirmDialog.test.tsx && npx tsc -b`
Expected: PASS (Sidebar 21 tests + ConfirmDialog 5), tsc exit 0.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/ConfirmDialog.tsx frontend/src/components/ConfirmDialog.module.css frontend/src/components/ConfirmDialog.test.tsx frontend/src/components/Sidebar.tsx frontend/src/components/Sidebar.module.css
git commit -m "refactor(frontend): extract shared ConfirmDialog; migrate Sidebar delete"
```

---

### Task 2: `TileMenu` presentational menu component

**Files:**
- Create: `frontend/src/components/TileMenu.tsx`
- Create: `frontend/src/components/TileMenu.module.css`
- Create: `frontend/src/components/TileMenu.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export interface TileMenuItem { label: string; onClick: () => void; danger?: boolean }
  export function TileMenu(props: { items: TileMenuItem[] }): JSX.Element
  ```
  Renders a `role="menu"` with one `role="menuitem"` button per item. Open/close and dismissal are the caller's concern (see Task 3).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/TileMenu.test.tsx`:
```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TileMenu } from './TileMenu'

describe('TileMenu', () => {
  it('renders a menuitem per item', () => {
    render(<TileMenu items={[{ label: 'Delete', onClick: vi.fn() }, { label: 'Rename', onClick: vi.fn() }]} />)
    expect(screen.getAllByRole('menuitem')).toHaveLength(2)
  })

  it('fires an item onClick when clicked', () => {
    const onClick = vi.fn()
    render(<TileMenu items={[{ label: 'Delete', onClick, danger: true }]} />)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/TileMenu.test.tsx`
Expected: FAIL — cannot resolve `./TileMenu`.

- [ ] **Step 3: Create the component**

Create `frontend/src/components/TileMenu.tsx`:
```tsx
import styles from './TileMenu.module.css'

export interface TileMenuItem {
  label: string
  onClick: () => void
  danger?: boolean
}

export function TileMenu({ items }: { items: TileMenuItem[] }) {
  return (
    <div className={styles.menu} role="menu">
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={item.danger ? styles.itemDanger : styles.item}
          onClick={item.onClick}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
```

Create `frontend/src/components/TileMenu.module.css`:
```css
.menu {
  position: absolute;
  top: 32px;
  right: 6px;
  z-index: 20;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 4px;
  display: flex;
  flex-direction: column;
  min-width: 120px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}

.item,
.itemDanger {
  background: transparent;
  border: none;
  color: var(--text-primary);
  font: inherit;
  text-align: left;
  padding: 6px 8px;
  border-radius: 5px;
  cursor: pointer;
}

.itemDanger { color: var(--error); }
.item:hover,
.itemDanger:hover { background: var(--bg-surface); }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/TileMenu.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/TileMenu.tsx frontend/src/components/TileMenu.module.css frontend/src/components/TileMenu.test.tsx
git commit -m "feat(frontend): TileMenu presentational actions menu"
```

---

### Task 3: Wire the kebab + menu into `FileGrid`

**Files:**
- Modify: `frontend/src/components/FileGrid.tsx`
- Modify: `frontend/src/components/FileGrid.module.css`
- Create: `frontend/src/components/FileGrid.test.tsx`
- Modify: `frontend/src/views/LibraryView.tsx` (pass a temporary no-op `onRequestDelete` so the app still compiles; replaced in Task 4)
- Modify: `frontend/src/App.test.tsx` (disambiguate one card query from the new kebab)

**Interfaces:**
- Consumes: `TileMenu`, `TileMenuItem` from Task 2.
- Produces: `FileGrid` gains a required prop `onRequestDelete: (file: ModelFile) => void`. Kebab accessible name is exactly `Actions for {file.name}`; the menu's Delete item calls `onRequestDelete(file)`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/FileGrid.test.tsx`:
```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FileGrid } from './FileGrid'
import type { ModelFile, Tag } from '../api/types'

const tags: Tag[] = []
const file = (id: number, name: string): ModelFile => ({
  id, name, type: 'Stl', sizeBytes: 0, addedAt: '2026-01-01T00:00:00Z',
  dimXMm: null, dimYMm: null, dimZMm: null, plateCount: null, estPrintTimeMin: null,
  material: null, layerHeightMm: null, sourceUrl: null, creator: null,
  description: null, thumbnailPath: null, folderIds: [], tagIds: [], plates: [],
})
const files = [file(1, 'Alpha.stl'), file(2, 'Beta.stl')]

function renderGrid() {
  const props = {
    files, tags, selectedFileIds: new Set<number>(),
    onSelectFile: vi.fn(), onOpenFile: vi.fn(), onRequestDelete: vi.fn(),
  }
  render(<FileGrid {...props} />)
  return props
}

describe('FileGrid kebab menu', () => {
  it('renders an actions button on every tile', () => {
    renderGrid()
    expect(screen.getAllByRole('button', { name: /actions for/i })).toHaveLength(2)
  })

  it('opens the menu with a Delete item on kebab click', () => {
    renderGrid()
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Alpha.stl' }))
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
  })

  it('raises onRequestDelete with the file when Delete is clicked', () => {
    const props = renderGrid()
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Alpha.stl' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    expect(props.onRequestDelete).toHaveBeenCalledWith(files[0])
  })

  it('does not select the card when the kebab is clicked', () => {
    const props = renderGrid()
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Alpha.stl' }))
    expect(props.onSelectFile).not.toHaveBeenCalled()
  })

  it('closes the menu on Escape', () => {
    renderGrid()
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Alpha.stl' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('closes the menu on an outside click', () => {
    renderGrid()
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Alpha.stl' }))
    fireEvent.click(document.body)
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument()
  })

  it('keeps only one tile menu open at a time', () => {
    renderGrid()
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Alpha.stl' }))
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Beta.stl' }))
    expect(screen.getAllByRole('menuitem', { name: 'Delete' })).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/FileGrid.test.tsx`
Expected: FAIL — no `Actions for …` button / `onRequestDelete` not wired.

- [ ] **Step 3: Rewrite `FileGrid.tsx`**

Replace the full contents of `frontend/src/components/FileGrid.tsx` with:
```tsx
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
```

- [ ] **Step 4: Add the kebab CSS**

Append to `frontend/src/components/FileGrid.module.css`:
```css
.cardWrap {
  position: relative;
}

.kebab {
  position: absolute;
  top: 6px;
  right: 6px;
  z-index: 2;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 6px;
  background: rgba(21, 18, 16, 0.72);
  color: var(--text-primary);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}

.kebab:hover {
  background: var(--bg-surface);
}
```

- [ ] **Step 5: Keep the app compiling — temporary no-op in LibraryView**

In `frontend/src/views/LibraryView.tsx`, the `<FileGrid ... />` render (in the `else` branch) is missing the new required prop. Add a temporary no-op (Task 4 replaces it):
```tsx
      <FileGrid
        files={files}
        tags={tags}
        selectedFileIds={selection.ids}
        onSelectFile={(id, mods) => setSelection((cur) => nextSelection(cur, files, id, mods))}
        onOpenFile={(id) => onOpenFile(id, activeFolder)}
        onRequestDelete={() => {}}
      />
```

- [ ] **Step 6: Fix the one colliding query in App.test.tsx**

The new kebab's accessible name (`Actions for Dragon.stl`) matches `/\.stl/i`, making the role+name query on line ~85 ambiguous. In `frontend/src/App.test.tsx`, in the test "opens the detail layer when a file is opened and closes on back", replace:
```tsx
    const card = await screen.findByRole('button', { name: /\.stl|\.3mf/i })
```
with:
```tsx
    const card = (await screen.findByText('Dragon.stl')).closest('button') as HTMLElement
```

- [ ] **Step 7: Run tests + typecheck**

Run: `cd frontend && npx vitest run src/components/FileGrid.test.tsx src/App.test.tsx && npx tsc -b`
Expected: FileGrid 7 tests PASS, App 6 tests PASS, tsc exit 0.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/FileGrid.tsx frontend/src/components/FileGrid.module.css frontend/src/components/FileGrid.test.tsx frontend/src/views/LibraryView.tsx frontend/src/App.test.tsx
git commit -m "feat(frontend): always-visible kebab actions menu on file tiles"
```

---

### Task 4: `deleteFile` client fn + LibraryView delete flow

**Files:**
- Modify: `frontend/src/api/client.ts` (add `deleteFile`)
- Modify: `frontend/src/views/LibraryView.tsx`
- Create: `frontend/src/views/LibraryView.test.tsx`

**Interfaces:**
- Consumes: `ConfirmDialog` (Task 1), `FileGrid` `onRequestDelete` (Task 3).
- Produces: `deleteFile(id: number): Promise<void>` in `api/client.ts`. LibraryView owns `pendingDeleteFile` + `deleteError`, calls `deleteFile`, then `reloadFiles()` and drops the id from `selection`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/views/LibraryView.test.tsx`:
```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LibraryView } from './LibraryView'
import type { Folder, ModelFile, Tag } from '../api/types'

const folders: Folder[] = [
  { id: 1, name: 'Miniatures', parentId: null, description: null, coverImageFileId: null, sortOrder: 0, isSystem: false },
]
const tags: Tag[] = []
const dragon: ModelFile = {
  id: 10, name: 'Dragon.stl', type: 'Stl', sizeBytes: 1024, addedAt: '2026-01-01T00:00:00Z',
  dimXMm: 10, dimYMm: 10, dimZMm: 10, plateCount: null, estPrintTimeMin: null,
  material: null, layerHeightMm: null, sourceUrl: null, creator: null,
  description: null, thumbnailPath: null, folderIds: [1], tagIds: [], plates: [],
}
const goblin: ModelFile = { ...dragon, id: 11, name: 'Goblin.stl' }

let deleted = false
function mockApi(opts: { deleteOk?: boolean } = {}) {
  deleted = false
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === 'DELETE') {
      deleted = true
      return Promise.resolve({ ok: opts.deleteOk ?? true } as Response)
    }
    let body: unknown = []
    if (url.startsWith('/api/folders')) body = folders
    else if (url.startsWith('/api/tags')) body = tags
    else if (url.startsWith('/api/files')) body = deleted ? [goblin] : [dragon, goblin]
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response)
  }))
}

function renderView() {
  render(<LibraryView onImport={vi.fn()} onOpenFile={vi.fn()} />)
}

async function openDeleteFor(name: string) {
  fireEvent.click(screen.getByRole('button', { name: `Actions for ${name}` }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
}

describe('LibraryView file delete', () => {
  beforeEach(() => mockApi())
  afterEach(() => vi.unstubAllGlobals())

  it('deletes a file after confirmation and refetches', async () => {
    renderView()
    await waitFor(() => expect(screen.getByText('Dragon.stl')).toBeInTheDocument())
    await openDeleteFor('Dragon.stl')
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith('/api/files/10', expect.objectContaining({ method: 'DELETE' })),
    )
    await waitFor(() => expect(screen.queryByText('Dragon.stl')).not.toBeInTheDocument())
  })

  it('does not delete when cancelled', async () => {
    renderView()
    await waitFor(() => expect(screen.getByText('Dragon.stl')).toBeInTheDocument())
    await openDeleteFor('Dragon.stl')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(fetch).not.toHaveBeenCalledWith('/api/files/10', expect.objectContaining({ method: 'DELETE' }))
    expect(screen.getByText('Dragon.stl')).toBeInTheDocument()
  })

  it('drops the deleted file from a multi-selection', async () => {
    renderView()
    await waitFor(() => expect(screen.getByText('Dragon.stl')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Dragon.stl'))
    fireEvent.click(screen.getByText('Goblin.stl'), { ctrlKey: true })
    expect(screen.getByRole('heading', { name: '2 files selected' })).toBeInTheDocument()
    await openDeleteFor('Dragon.stl')
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: '2 files selected' })).not.toBeInTheDocument(),
    )
  })

  it('keeps the dialog open and shows an error when delete fails', async () => {
    mockApi({ deleteOk: false })
    renderView()
    await waitFor(() => expect(screen.getByText('Dragon.stl')).toBeInTheDocument())
    await openDeleteFor('Dragon.stl')
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Could not delete file.')).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/views/LibraryView.test.tsx`
Expected: FAIL — no DELETE call happens (the no-op from Task 3 is still in place); no confirm dialog.

- [ ] **Step 3: Add `deleteFile` to the API client**

In `frontend/src/api/client.ts`, add next to `deleteFolder`:
```ts
export async function deleteFile(id: number): Promise<void> {
  const res = await fetch(`/api/files/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(`Delete failed: ${res.status}`)
}
```

- [ ] **Step 4: Wire the delete flow into LibraryView**

In `frontend/src/views/LibraryView.tsx`:

Add imports:
```tsx
import type { ModelFile } from '../api/types'
import { deleteFile } from '../api/client'
import { ConfirmDialog } from '../components/ConfirmDialog'
```

Add state near the other `useState` hooks:
```tsx
  const [pendingDeleteFile, setPendingDeleteFile] = useState<ModelFile | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
```

Add the handler (place it after `activeFolder` is defined, before `let center`):
```tsx
  const handleConfirmDelete = async () => {
    if (!pendingDeleteFile) return
    const id = pendingDeleteFile.id
    setDeleteError(null)
    try {
      await deleteFile(id)
      setPendingDeleteFile(null)
      setSelection((cur) => {
        if (!cur.ids.has(id)) return cur
        const ids = new Set(cur.ids)
        ids.delete(id)
        return { ids, anchorId: cur.anchorId === id ? null : cur.anchorId }
      })
      reloadFiles()
    } catch {
      setDeleteError('Could not delete file.')
    }
  }
```

Replace the temporary `onRequestDelete={() => {}}` on `<FileGrid>` with:
```tsx
        onRequestDelete={setPendingDeleteFile}
```

Add the dialog just before the final closing `</div>` of the returned tree (after the `FileDetailPanel`/`BatchAssignPanel` ternary block):
```tsx
      {pendingDeleteFile && (
        <ConfirmDialog
          body={<>Delete “{pendingDeleteFile.name}”? This permanently removes the file.</>}
          danger
          error={deleteError}
          onConfirm={handleConfirmDelete}
          onCancel={() => { setPendingDeleteFile(null); setDeleteError(null) }}
        />
      )}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `cd frontend && npx vitest run src/views/LibraryView.test.tsx && npx tsc -b`
Expected: LibraryView 4 tests PASS, tsc exit 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/views/LibraryView.tsx frontend/src/views/LibraryView.test.tsx
git commit -m "feat(frontend): delete a file from the tile menu with confirm"
```

---

### Task 5: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full frontend suite**

Run: `cd frontend && npx vitest run`
Expected: all test files PASS. New counts vs. the 159 baseline: +5 ConfirmDialog, +2 TileMenu, +7 FileGrid, +4 LibraryView; Sidebar unchanged at 21; App unchanged at 6. Total ≈ 177.

- [ ] **Step 2: Typecheck + production build**

Run: `cd frontend && npx tsc -b && npm run build`
Expected: exit 0, build succeeds.

- [ ] **Step 3: Manual in-browser check (recommended, not gating)**

Start dev (`cd backend; $env:SEED_SAMPLE_DATA="true"; dotnet run --project PlasticRoom.Api` and `cd frontend; npm run dev`), then verify: every tile shows a kebab; clicking it opens a menu with Delete; Escape / clicking elsewhere / opening another tile's menu dismisses it; Delete opens the confirm dialog; Cancel/backdrop/Esc dismiss without deleting; Delete removes the file from the grid; deleting a selected tile updates the selection/toolbar count. jsdom can't cover the real overlay/z-index or pointer behavior, so this pass is worth doing before merge.

- [ ] **Step 4: Commit (if any doc/status updates)**

No code changes expected here. If notes were updated, commit them; otherwise nothing to do.

---

## Self-Review

**Spec coverage:**
- Kebab always visible, top-right → Task 3 (`.kebab` CSS, always rendered). ✅
- Menu extensible via items array → Task 2 `TileMenuItem[]`, Task 3 builds the array. ✅
- Single-open + Esc/outside-click dismiss → Task 3 `openMenuId` + effect. ✅
- Kebab doesn't select/open card → Task 3 `stopPropagation`; tested. ✅
- Delete scoped to that tile (selection-independent) → Task 3 passes `file`; Task 4 acts on `pendingDeleteFile.id`. ✅
- Confirm dialog before delete → Task 4 `ConfirmDialog`. ✅
- `deleteFile` client fn; backend unchanged → Task 4. ✅
- Success: reloadFiles + drop id from selection → Task 4 `handleConfirmDelete`. ✅
- Failure: dialog stays open with error → Task 4 (`deleteError` + `error` prop); tested. ✅
- Extract shared `ConfirmDialog` + migrate Sidebar → Task 1. ✅
- Tests for FileGrid / LibraryView / ConfirmDialog; Sidebar stays green → Tasks 1,3,4 + Task 5. ✅

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✅

**Type consistency:** `onRequestDelete: (file: ModelFile) => void` consistent across FileGrid props, CardProps, LibraryView (`setPendingDeleteFile`). `ConfirmDialogProps` identical in Task 1 definition and Task 4 usage (`body`, `danger`, `error`, `onConfirm`, `onCancel`). `TileMenuItem` (`label`/`onClick`/`danger`) consistent Task 2 ↔ Task 3. `Selection` drop matches `{ ids: Set<number>; anchorId: number | null }`. ✅

**Cross-task compile safety:** Task 3 adds the required `onRequestDelete` prop and immediately supplies a no-op in LibraryView so the tree compiles; Task 4 replaces it with the real handler. ✅
