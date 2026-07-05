# Phase 7 — Batch Tagging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Select multiple files in the library grid and add folders/tags to all of them at once via a batch action panel and one atomic backend endpoint.

**Architecture:** A new `POST /api/files/batch/assign` endpoint performs an atomic, add-only, de-duplicating assignment across N files and returns the updated DTOs. The frontend gains a pure `gridSelection` reducer (plain/ctrl/shift/clear), multi-select visuals in `FileGrid`, and a `BatchAssignPanel` that replaces the single-file `FileDetailPanel` while 2+ files are selected. `LibraryView` owns the selection state and swaps the right panel by selection size.

**Tech Stack:** Backend — ASP.NET Core 10 + DevExpress XPO + SQLite, xUnit. Frontend — React 19 + TypeScript + Vite, Vitest + React Testing Library.

## Global Constraints

- **Add-only semantics.** "Apply to N" ADDS staged folders/tags to each file; existing assignments are preserved; nothing is removed.
- **Atomic backend.** The batch endpoint validates every id up front (before any write) and wraps writes in an explicit XPO transaction (`BeginTransaction()`/`CommitTransaction()`). Any unknown id → the whole batch fails, nothing persisted.
- **Existing items only** in the batch panel — no inline folder/tag creation.
- **Standard file-manager selection.** Plain click → just the clicked file; Ctrl/Cmd-click → toggle; Shift-click → inclusive range from the anchor over the current visible order; Esc / empty-grid click → clear. Double-click still opens the detail view.
- **Right panel by selection size.** 0 → existing "Select a file" empty state; 1 → existing `FileDetailPanel` (unchanged); 2+ → new `BatchAssignPanel`.
- **XPO session rules (from project memory):** `session.Save()` persists immediately; `CommitTransaction()` requires a prior `BeginTransaction()`; add-only means NO `Delete()`/`PurgeDeletedObjects()`. Entity id property is `Oid`. File↔folder join is `FileFolder { File, Folder }`; file↔tag join is `FileTag { File, Tag }`. The file entity is `ModelFile`.
- **Frontend conventions:** no router / state manager / data-fetching lib; CSS Modules over `frontend/src/styles/tokens.css`. A Vitest file needs the `// @vitest-environment jsdom` docblock ONLY if it transitively imports `three` — none of this plan's test files do, so omit it (matches Phase 6). `App.test.tsx` already has the docblock (leave it).
- Frontend commands run from `frontend/`: `npm test`, `npx tsc -b`, `npm run build`. Backend commands run from `backend/`: `dotnet test`.

---

## File Structure

- Modify: `backend/PlasticRoom.Api/Dtos/ModelFileDtos.cs` — add `BatchAssignRequest`.
- Modify: `backend/PlasticRoom.Api/Controllers/FilesController.cs` — add `BatchAssign` action.
- Modify: `backend/PlasticRoom.Api.Tests/Controllers/FilesControllerTests.cs` — cover batch endpoint.
- Modify: `frontend/src/api/client.ts` (+ `client.test.ts`) — add `batchAssign`.
- Create: `frontend/src/lib/gridSelection.ts` (+ `.test.ts`) — pure selection reducer.
- Modify: `frontend/src/components/FileGrid.tsx`, `.module.css`, `.test.tsx` — multi-select API + visuals.
- Create: `frontend/src/components/BatchAssignPanel.tsx`, `.module.css`, `.test.tsx`.
- Modify: `frontend/src/components/LibraryToolbar.tsx` — selected-count label.
- Modify: `frontend/src/views/LibraryView.tsx` — selection state + panel switch + clear.
- Modify: `frontend/src/App.test.tsx` — multi-select integration test.

---

## Task 1: Backend — atomic `POST /api/files/batch/assign`

**Files:**
- Modify: `backend/PlasticRoom.Api/Dtos/ModelFileDtos.cs`
- Modify: `backend/PlasticRoom.Api/Controllers/FilesController.cs`
- Test: `backend/PlasticRoom.Api.Tests/Controllers/FilesControllerTests.cs`

**Interfaces:**
- Produces: `BatchAssignRequest(List<int> FileIds, List<int> AddFolderIds, List<int> AddTagIds)`; `FilesController.BatchAssign(BatchAssignRequest) : IActionResult` → `200 OK` with `List<ModelFileDto>` (updated files), `404` (unknown file/folder/tag id), `400` (both add-lists empty).

- [ ] **Step 1: Write the failing tests**

Append these three tests inside the `FilesControllerTests` class in `backend/PlasticRoom.Api.Tests/Controllers/FilesControllerTests.cs` (reuse the existing `_controller`, `_sessionFactory`, and `BuildStlFormFile` helper):

```csharp
    [Fact]
    public async System.Threading.Tasks.Task BatchAssign_AddsFoldersAndTags_ToAllFiles_Deduping()
    {
        var fileA = (ModelFileDto)Assert.IsType<CreatedAtActionResult>(
            await _controller.Upload(new UploadFileRequest { File = BuildStlFormFile("a.stl") })).Value!;
        var fileB = (ModelFileDto)Assert.IsType<CreatedAtActionResult>(
            await _controller.Upload(new UploadFileRequest { File = BuildStlFormFile("b.stl") })).Value!;

        int folderId, tagId;
        using (var session = _sessionFactory.CreateSession())
        {
            var folder = new PlasticRoom.Api.Entities.Folder(session) { Name = "Terrain" };
            var tag = new PlasticRoom.Api.Entities.Tag(session) { Name = "Resin" };
            folder.Save();
            tag.Save();
            folderId = folder.Oid;
            tagId = tag.Oid;
        }

        // Pre-assign the folder to fileA so we can prove the batch de-dupes.
        _controller.SetFolders(fileA.Id, new IdListRequest(new List<int> { folderId }));

        var result = _controller.BatchAssign(new BatchAssignRequest(
            new List<int> { fileA.Id, fileB.Id },
            new List<int> { folderId },
            new List<int> { tagId }));

        var dtos = Assert.IsType<List<ModelFileDto>>(Assert.IsType<OkObjectResult>(result).Value);
        Assert.Equal(2, dtos.Count);
        Assert.All(dtos, d => Assert.Contains(folderId, d.FolderIds));
        Assert.All(dtos, d => Assert.Contains(tagId, d.TagIds));
        // De-dup: fileA still has exactly one folder link, not two.
        var dtoA = dtos.Single(d => d.Id == fileA.Id);
        Assert.Single(dtoA.FolderIds);
    }

    [Fact]
    public async System.Threading.Tasks.Task BatchAssign_UnknownTagId_RollsBack_NoLinksWritten()
    {
        var fileA = (ModelFileDto)Assert.IsType<CreatedAtActionResult>(
            await _controller.Upload(new UploadFileRequest { File = BuildStlFormFile("a.stl") })).Value!;

        int folderId;
        using (var session = _sessionFactory.CreateSession())
        {
            var folder = new PlasticRoom.Api.Entities.Folder(session) { Name = "Terrain" };
            folder.Save();
            folderId = folder.Oid;
        }

        var result = _controller.BatchAssign(new BatchAssignRequest(
            new List<int> { fileA.Id },
            new List<int> { folderId },
            new List<int> { 999999 })); // nonexistent tag

        Assert.IsType<NotFoundObjectResult>(result);

        // The valid folder must NOT have been written — validation fails before any write.
        var getResult = _controller.GetById(fileA.Id);
        var dto = Assert.IsType<ModelFileDto>(Assert.IsType<OkObjectResult>(getResult).Value);
        Assert.Empty(dto.FolderIds);
    }

    [Fact]
    public void BatchAssign_EmptyInputs_ReturnsBadRequest()
    {
        var result = _controller.BatchAssign(
            new BatchAssignRequest(new List<int>(), new List<int>(), new List<int>()));
        Assert.IsType<BadRequestObjectResult>(result);
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `dotnet test --filter BatchAssign`
Expected: FAIL — `BatchAssignRequest` / `BatchAssign` do not exist (compile error).

- [ ] **Step 3: Add the request record**

In `backend/PlasticRoom.Api/Dtos/ModelFileDtos.cs`, append after `IdListRequest`:

```csharp
public record BatchAssignRequest(List<int> FileIds, List<int> AddFolderIds, List<int> AddTagIds);
```

- [ ] **Step 4: Implement the `BatchAssign` action**

In `backend/PlasticRoom.Api/Controllers/FilesController.cs`, add this action after `SetTags` (the class already has `using ...Entities;`, so `Folder`, `Tag`, `FileFolder`, `FileTag` are in scope):

```csharp
    [HttpPost("batch/assign")]
    public IActionResult BatchAssign([FromBody] BatchAssignRequest request)
    {
        if (request.AddFolderIds.Count == 0 && request.AddTagIds.Count == 0)
        {
            return BadRequest(new { error = "No folders or tags to assign" });
        }

        using var session = _sessionFactory.CreateSession();

        // Validate every id up front — nothing is persisted until all resolve.
        var files = new List<ModelFile>();
        foreach (var fileId in request.FileIds)
        {
            var file = session.GetObjectByKey<ModelFile>(fileId);
            if (file is null)
            {
                return NotFound(new { error = $"File {fileId} not found" });
            }
            files.Add(file);
        }

        var folders = new List<Folder>();
        foreach (var folderId in request.AddFolderIds)
        {
            var folder = session.GetObjectByKey<Folder>(folderId);
            if (folder is null)
            {
                return NotFound(new { error = $"Folder {folderId} not found" });
            }
            folders.Add(folder);
        }

        var tags = new List<Tag>();
        foreach (var tagId in request.AddTagIds)
        {
            var tag = session.GetObjectByKey<Tag>(tagId);
            if (tag is null)
            {
                return NotFound(new { error = $"Tag {tagId} not found" });
            }
            tags.Add(tag);
        }

        session.BeginTransaction();
        foreach (var file in files)
        {
            var existingFolderIds = file.FileFolders.Select(ff => ff.Folder.Oid).ToHashSet();
            foreach (var folder in folders.Where(f => !existingFolderIds.Contains(f.Oid)))
            {
                new FileFolder(session) { File = file, Folder = folder }.Save();
            }

            var existingTagIds = file.FileTags.Select(ft => ft.Tag.Oid).ToHashSet();
            foreach (var tag in tags.Where(t => !existingTagIds.Contains(t.Oid)))
            {
                new FileTag(session) { File = file, Tag = tag }.Save();
            }
        }
        session.CommitTransaction();

        return Ok(files.Select(ToDto).ToList());
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `dotnet test --filter BatchAssign`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/PlasticRoom.Api/Dtos/ModelFileDtos.cs backend/PlasticRoom.Api/Controllers/FilesController.cs backend/PlasticRoom.Api.Tests/Controllers/FilesControllerTests.cs
git commit -m "feat(backend): atomic batch folder/tag assign endpoint"
```

---

## Task 2: Client `batchAssign`

**Files:**
- Modify: `frontend/src/api/client.ts`
- Test: `frontend/src/api/client.test.ts`

**Interfaces:**
- Produces: `batchAssign(fileIds: number[], addFolderIds: number[], addTagIds: number[]): Promise<ModelFile[]>` → `POST /api/files/batch/assign`, body `{ fileIds, addFolderIds, addTagIds }`.

- [ ] **Step 1: Write the failing test**

Add `batchAssign` to the existing top-of-file import from `./client`, then append this `describe` to `frontend/src/api/client.test.ts`:

```ts
describe('batch assign', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => vi.unstubAllGlobals())

  const okJson = (value: unknown) =>
    ({ ok: true, json: () => Promise.resolve(value) }) as Response

  it('batchAssign POSTs fileIds + add ids as JSON', async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>
    fetchMock.mockResolvedValue(okJson([{ id: 1 }, { id: 2 }]))

    const updated = await batchAssign([1, 2], [7], [4])

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/files/batch/assign')
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ fileIds: [1, 2], addFolderIds: [7], addTagIds: [4] })
    expect(updated).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/api/client.test.ts`
Expected: FAIL — `batchAssign` is not exported.

- [ ] **Step 3: Implement the client function**

Append to `frontend/src/api/client.ts`:

```ts
export async function batchAssign(
  fileIds: number[],
  addFolderIds: number[],
  addTagIds: number[],
): Promise<ModelFile[]> {
  const url = '/api/files/batch/assign'
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileIds, addFolderIds, addTagIds }),
  })
  return parseJsonOrThrow<ModelFile[]>(res, url)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/api/client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/api/client.test.ts
git commit -m "feat(frontend): add batchAssign API client fn"
```

---

## Task 3: `gridSelection` reducer

**Files:**
- Create: `frontend/src/lib/gridSelection.ts`
- Test: `frontend/src/lib/gridSelection.test.ts`

**Interfaces:**
- Produces:
  `interface SelectModifiers { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }`
  `interface Selection { ids: Set<number>; anchorId: number | null }`
  `const emptySelection: Selection`
  `nextSelection(current: Selection, files: ModelFile[], clickedId: number, mods: SelectModifiers): Selection`.
  Plain → `{ ids: {clicked}, anchor: clicked }`; ctrl/meta → toggle clicked, anchor = clicked; shift → inclusive range from `anchor ?? clicked` to clicked over `files` order (anchor unchanged); shift with an anchor/clicked not in `files` → falls back to plain.

- [ ] **Step 1: Write the failing tests**

`frontend/src/lib/gridSelection.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { nextSelection, emptySelection } from './gridSelection'
import type { ModelFile } from '../api/types'

const f = (id: number): ModelFile => ({
  id, name: `f${id}`, type: 'Stl', sizeBytes: 0, addedAt: '2026-01-01T00:00:00Z',
  dimXMm: null, dimYMm: null, dimZMm: null, plateCount: null, estPrintTimeMin: null,
  material: null, layerHeightMm: null, sourceUrl: null, creator: null,
  description: null, thumbnailPath: null, folderIds: [], tagIds: [], plates: [],
})
const files = [f(1), f(2), f(3), f(4), f(5)]
const noMods = { metaKey: false, ctrlKey: false, shiftKey: false }

describe('gridSelection', () => {
  it('plain click selects only the clicked file', () => {
    const s = nextSelection({ ids: new Set([2, 3]), anchorId: 3 }, files, 5, noMods)
    expect([...s.ids]).toEqual([5])
    expect(s.anchorId).toBe(5)
  })

  it('ctrl/meta click toggles the clicked file', () => {
    const added = nextSelection({ ids: new Set([1]), anchorId: 1 }, files, 3, { ...noMods, ctrlKey: true })
    expect([...added.ids].sort()).toEqual([1, 3])
    const removed = nextSelection(added, files, 1, { ...noMods, metaKey: true })
    expect([...removed.ids]).toEqual([3])
  })

  it('shift click selects an inclusive range from the anchor', () => {
    const s = nextSelection({ ids: new Set([2]), anchorId: 2 }, files, 4, { ...noMods, shiftKey: true })
    expect([...s.ids].sort()).toEqual([2, 3, 4])
    expect(s.anchorId).toBe(2)
  })

  it('shift click with no anchor behaves like a plain click', () => {
    const s = nextSelection(emptySelection, files, 4, { ...noMods, shiftKey: true })
    expect([...s.ids]).toEqual([4])
    expect(s.anchorId).toBe(4)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/lib/gridSelection.test.ts`
Expected: FAIL — module `./gridSelection` cannot be resolved.

- [ ] **Step 3: Implement the reducer**

`frontend/src/lib/gridSelection.ts`:

```ts
import type { ModelFile } from '../api/types'

export interface SelectModifiers {
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
}

export interface Selection {
  ids: Set<number>
  anchorId: number | null
}

export const emptySelection: Selection = { ids: new Set(), anchorId: null }

export function nextSelection(
  current: Selection,
  files: ModelFile[],
  clickedId: number,
  mods: SelectModifiers,
): Selection {
  if (mods.shiftKey) {
    const anchor = current.anchorId ?? clickedId
    const order = files.map((file) => file.id)
    const a = order.indexOf(anchor)
    const b = order.indexOf(clickedId)
    if (a === -1 || b === -1) {
      return { ids: new Set([clickedId]), anchorId: clickedId }
    }
    const [lo, hi] = a <= b ? [a, b] : [b, a]
    return { ids: new Set(order.slice(lo, hi + 1)), anchorId: anchor }
  }
  if (mods.metaKey || mods.ctrlKey) {
    const ids = new Set(current.ids)
    if (ids.has(clickedId)) ids.delete(clickedId)
    else ids.add(clickedId)
    return { ids, anchorId: clickedId }
  }
  return { ids: new Set([clickedId]), anchorId: clickedId }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/lib/gridSelection.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/gridSelection.ts frontend/src/lib/gridSelection.test.ts
git commit -m "feat(frontend): pure gridSelection reducer (plain/ctrl/shift)"
```

---

## Task 4: `FileGrid` multi-select API + visuals

**Files:**
- Modify: `frontend/src/components/FileGrid.tsx`, `frontend/src/components/FileGrid.module.css`
- Test: `frontend/src/components/FileGrid.test.tsx`

**Interfaces:**
- Consumes: `SelectModifiers` (Task 3).
- Produces: `FileGrid` props change from `{ selectedFileId: number | null; onSelectFile: (id: number) => void }` to `{ selectedFileIds: ReadonlySet<number>; onSelectFile: (id: number, mods: SelectModifiers) => void }` (plus unchanged `files`, `tags`, `onOpenFile`). Selected cards keep the ring; when 2+ are selected, unselected cards dim to 50% and selected cards show a top-left ✓ badge.

- [ ] **Step 1: Rewrite the test file**

This is a prop-signature change, so replace the whole `frontend/src/components/FileGrid.test.tsx` with:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FileGrid } from './FileGrid'
import type { ModelFile, Tag } from '../api/types'

const file = (id: number, name: string, type: ModelFile['type'], tagIds: number[]): ModelFile => ({
  id, name, type, sizeBytes: 1024, addedAt: '2026-01-01T00:00:00Z',
  dimXMm: 10, dimYMm: 10, dimZMm: 10, plateCount: null, estPrintTimeMin: null,
  material: null, layerHeightMm: null, sourceUrl: null, creator: null,
  description: `${name} description`, thumbnailPath: null, folderIds: [], tagIds, plates: [],
})

const tags: Tag[] = [{ id: 1, name: 'Resin', colorKey: 'brass' }]

const sampleFile: ModelFile = {
  id: 1, name: 'widget.stl', type: 'Stl', sizeBytes: 100, addedAt: '2026-07-04T00:00:00Z',
  dimXMm: null, dimYMm: null, dimZMm: null, plateCount: null, estPrintTimeMin: null,
  material: null, layerHeightMm: null, sourceUrl: null, creator: null,
  description: null, thumbnailPath: null, folderIds: [], tagIds: [], plates: [],
}

describe('FileGrid', () => {
  it('renders a card per file with preview label, name, description, and tag pills', () => {
    const files = [file(1, 'Dragon.stl', 'Stl', [1]), file(2, 'Set.3mf', 'ThreeMf', [])]
    render(<FileGrid files={files} tags={tags} selectedFileIds={new Set()} onSelectFile={vi.fn()} onOpenFile={vi.fn()} />)
    expect(screen.getByText('Dragon.stl')).toBeInTheDocument()
    expect(screen.getByText('Dragon.stl description')).toBeInTheDocument()
    expect(screen.getByText('STL PREVIEW')).toBeInTheDocument()
    expect(screen.getByText('3MF PREVIEW')).toBeInTheDocument()
    expect(screen.getByText('Resin')).toBeInTheDocument()
  })

  it('calls onSelectFile with the click modifiers', () => {
    const onSelect = vi.fn()
    render(<FileGrid files={[file(1, 'Dragon.stl', 'Stl', [])]} tags={tags} selectedFileIds={new Set()} onSelectFile={onSelect} onOpenFile={vi.fn()} />)
    fireEvent.click(screen.getByText('Dragon.stl'), { ctrlKey: true })
    expect(onSelect).toHaveBeenCalledWith(1, expect.objectContaining({ ctrlKey: true, shiftKey: false }))
  })

  it('marks selected cards with aria-current', () => {
    render(<FileGrid files={[file(1, 'Dragon.stl', 'Stl', [])]} tags={tags} selectedFileIds={new Set([1])} onSelectFile={vi.fn()} onOpenFile={vi.fn()} />)
    expect(screen.getByText('Dragon.stl').closest('[aria-current]')).toHaveAttribute('aria-current', 'true')
  })

  it('calls onOpenFile on double-click and onSelectFile on single click', () => {
    const onSelect = vi.fn()
    const onOpen = vi.fn()
    render(
      <FileGrid files={[sampleFile]} tags={[]} selectedFileIds={new Set()} onSelectFile={onSelect} onOpenFile={onOpen} />,
    )
    const card = screen.getByRole('button', { name: /widget\.stl/i })
    fireEvent.click(card)
    expect(onSelect).toHaveBeenCalledWith(sampleFile.id, expect.objectContaining({ shiftKey: false }))
    fireEvent.doubleClick(card)
    expect(onOpen).toHaveBeenCalledWith(sampleFile.id)
  })

  it('shows a check badge on selected cards when 2+ are selected', () => {
    const files = [file(1, 'A.stl', 'Stl', []), file(2, 'B.stl', 'Stl', [])]
    render(<FileGrid files={files} tags={[]} selectedFileIds={new Set([1, 2])} onSelectFile={vi.fn()} onOpenFile={vi.fn()} />)
    expect(screen.getAllByTestId('select-badge')).toHaveLength(2)
  })

  it('renders a real thumbnail image when the file has one', () => {
    const withThumb = { ...sampleFile, thumbnailPath: 'thumbs/1.png' }
    render(<FileGrid files={[withThumb]} tags={[]} selectedFileIds={new Set()} onSelectFile={() => {}} onOpenFile={() => {}} />)
    const img = screen.getByRole('img', { name: /widget\.stl/i })
    expect(img).toHaveAttribute('src', '/api/files/1/thumbnail')
  })

  it('shows the placeholder label when the file has no thumbnail', () => {
    render(<FileGrid files={[sampleFile]} tags={[]} selectedFileIds={new Set()} onSelectFile={() => {}} onOpenFile={() => {}} />)
    expect(screen.getByText('STL PREVIEW')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/components/FileGrid.test.tsx`
Expected: FAIL — TS/prop errors (`selectedFileIds` unknown) and no `select-badge`.

- [ ] **Step 3: Update `FileGrid.tsx`**

Replace the contents of `frontend/src/components/FileGrid.tsx` with:

```tsx
import { useState } from 'react'
import type { ModelFile, Tag } from '../api/types'
import { fileThumbnailUrl } from '../api/client'
import { tagColor } from '../lib/format'
import type { SelectModifiers } from '../lib/gridSelection'
import styles from './FileGrid.module.css'

interface FileGridProps {
  files: ModelFile[]
  tags: Tag[]
  selectedFileIds: ReadonlySet<number>
  onSelectFile: (id: number, mods: SelectModifiers) => void
  onOpenFile: (id: number) => void
}

export function typeLabel(type: ModelFile['type']): string {
  return type === 'ThreeMf' ? '3MF' : 'STL'
}

interface CardProps {
  file: ModelFile
  tags: Tag[]
  selected: boolean
  multiActive: boolean
  onSelect: (id: number, mods: SelectModifiers) => void
  onOpen: (id: number) => void
}

function FileCard({ file, tags, selected, multiActive, onSelect, onOpen }: CardProps) {
  const [thumbFailed, setThumbFailed] = useState(false)
  const fileTags = file.tagIds
    .map((id) => tags.find((t) => t.id === id))
    .filter((t): t is Tag => t !== undefined)

  const showImg = file.thumbnailPath !== null && !thumbFailed

  return (
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
  )
}

export function FileGrid({ files, tags, selectedFileIds, onSelectFile, onOpenFile }: FileGridProps) {
  const multiActive = selectedFileIds.size >= 2
  return (
    <div className={styles.grid}>
      {files.map((file) => (
        <FileCard
          key={file.id}
          file={file}
          tags={tags}
          selected={selectedFileIds.has(file.id)}
          multiActive={multiActive}
          onSelect={onSelectFile}
          onOpen={onOpenFile}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Add the visual styles**

In `frontend/src/components/FileGrid.module.css`, add `position: relative;` to the existing `.card` rule (so the badge can anchor to it), then append:

```css
.cardDimmed {
  opacity: 0.5;
}

.selectBadge {
  position: absolute;
  top: 6px;
  left: 6px;
  z-index: 1;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--accent);
  color: #1b1b1b;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
}
```

Change the `.card` rule so it begins:

```css
.card {
  position: relative;
  display: flex;
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test -- src/components/FileGrid.test.tsx` then `npx tsc -b`
Expected: tests PASS (7); tsc will FAIL with errors in `LibraryView.tsx` (still passing the old `selectedFileId` prop) — that is expected and fixed in Task 6. Confirm the ONLY tsc errors are in `views/LibraryView.tsx`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/FileGrid.tsx frontend/src/components/FileGrid.module.css frontend/src/components/FileGrid.test.tsx
git commit -m "feat(frontend): multi-select FileGrid API + badge/dim visuals"
```

---

## Task 5: `BatchAssignPanel` component

**Files:**
- Create: `frontend/src/components/BatchAssignPanel.tsx`, `frontend/src/components/BatchAssignPanel.module.css`
- Test: `frontend/src/components/BatchAssignPanel.test.tsx`

**Interfaces:**
- Consumes: `batchAssign` (Task 2); `tagColor` (`lib/format`); `Folder`, `Tag` (types).
- Produces: `BatchAssignPanel(props: { selectedFileIds: number[]; folders: Folder[]; tags: Tag[]; onApplied: () => void }): JSX.Element`. Header "N files selected"; a Folders search + checkable filtered list + staged pills; a Tags search + checkable filtered list + staged pills; "Apply to N" (disabled until something is staged). Apply → `batchAssign(selectedFileIds, stagedFolderIds, stagedTagIds)`; success clears staged + searches, shows a `role="status"` confirmation, calls `onApplied()`; failure shows `role="alert"` and keeps staged.

- [ ] **Step 1: Write the failing tests**

`frontend/src/components/BatchAssignPanel.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BatchAssignPanel } from './BatchAssignPanel'
import * as client from '../api/client'
import type { Folder, Tag } from '../api/types'

const folders: Folder[] = [
  { id: 1, name: 'Terrain', parentId: null, description: null, coverImageFileId: null, sortOrder: 0, isSystem: false },
  { id: 2, name: 'Printed', parentId: null, description: null, coverImageFileId: null, sortOrder: 1, isSystem: true },
]
const tags: Tag[] = [{ id: 5, name: 'Resin', colorKey: 'brass' }]

function setup(overrides: Partial<Parameters<typeof BatchAssignPanel>[0]> = {}) {
  const props = { selectedFileIds: [7, 8, 9], folders, tags, onApplied: vi.fn(), ...overrides }
  render(<BatchAssignPanel {...props} />)
  return props
}

describe('BatchAssignPanel', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('shows the selected count and disables Apply until something is staged', () => {
    setup()
    expect(screen.getByRole('heading', { name: '3 files selected' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply to 3' })).toBeDisabled()
  })

  it('stages a folder and enables Apply', () => {
    setup()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Terrain' }))
    expect(screen.getByRole('button', { name: 'Apply to 3' })).toBeEnabled()
  })

  it('filters folders by the search box', () => {
    setup()
    fireEvent.change(screen.getByLabelText('Search folders'), { target: { value: 'terr' } })
    expect(screen.getByRole('checkbox', { name: 'Terrain' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Printed' })).not.toBeInTheDocument()
  })

  it('applies staged folders + tags, notifies, then clears + confirms', async () => {
    const spy = vi.spyOn(client, 'batchAssign').mockResolvedValue([])
    const props = setup()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Terrain' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Resin' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply to 3' }))

    await waitFor(() => expect(props.onApplied).toHaveBeenCalled())
    const [fileIds, folderIds, tagIds] = spy.mock.calls[0]
    expect(fileIds).toEqual([7, 8, 9])
    expect(folderIds).toEqual([1])
    expect(tagIds).toEqual([5])
    expect(await screen.findByText('Added to 3 files')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply to 3' })).toBeDisabled()
  })

  it('shows an alert and keeps the staged set when apply fails', async () => {
    vi.spyOn(client, 'batchAssign').mockRejectedValue(new Error('boom'))
    setup()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Terrain' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply to 3' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: 'Apply to 3' })).toBeEnabled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- src/components/BatchAssignPanel.test.tsx`
Expected: FAIL — module `./BatchAssignPanel` cannot be resolved.

- [ ] **Step 3: Implement the component**

`frontend/src/components/BatchAssignPanel.tsx`:

```tsx
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
```

`frontend/src/components/BatchAssignPanel.module.css`:

```css
.panel {
  width: 320px;
  flex-shrink: 0;
  background: var(--bg-panel);
  border-left: 1px solid var(--border);
  padding: var(--panel-padding);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.heading {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sectionLabel {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-tertiary);
}

.search {
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-primary);
  padding: 5px 8px;
  font-size: 13px;
}

.pills {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.pill {
  font-size: 11px;
  padding: 3px 9px;
  border: 1px solid var(--border);
  border-radius: var(--radius-chip);
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
}

.options {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 220px;
  overflow-y: auto;
}

.option {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-primary);
  cursor: pointer;
}

.error {
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 12px;
}

.confirmation {
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 12px;
}

.apply {
  margin-top: auto;
  background: var(--accent);
  border: none;
  border-radius: 6px;
  color: #1b1b1b;
  cursor: pointer;
  font-size: 13px;
  padding: 8px 14px;
}

.apply:disabled {
  opacity: 0.5;
  cursor: default;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/components/BatchAssignPanel.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/BatchAssignPanel.tsx frontend/src/components/BatchAssignPanel.module.css frontend/src/components/BatchAssignPanel.test.tsx
git commit -m "feat(frontend): BatchAssignPanel stage + apply folders/tags"
```

---

## Task 6: Wire `LibraryView` + `LibraryToolbar` + integration test

**Files:**
- Modify: `frontend/src/components/LibraryToolbar.tsx`
- Modify: `frontend/src/views/LibraryView.tsx`
- Test: `frontend/src/App.test.tsx`

**Interfaces:**
- Consumes: `nextSelection`, `emptySelection`, `Selection` (Task 3); `BatchAssignPanel` (Task 5); `FileGrid` new API (Task 4); `useFiles().reload`, `useFolders().reload` (Phase 6).
- Produces: `LibraryToolbar` props gain `selectedCount: number` (renders "{n} files selected of {total}" when `n >= 2`, else "{total} files"). `LibraryView` owns a `Selection`, swaps the right panel by size, and clears on Esc / empty-grid click.

- [ ] **Step 1: Update the `LibraryToolbar` (test-first via App.test in Step 4)**

In `frontend/src/components/LibraryToolbar.tsx`, add `selectedCount` to the props and use it in the count span:

```tsx
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
```

- [ ] **Step 2: Rewrite `LibraryView` selection wiring**

Replace `frontend/src/views/LibraryView.tsx` with:

```tsx
import { useEffect, useState } from 'react'
import { Sidebar } from '../components/Sidebar'
import { LibraryToolbar } from '../components/LibraryToolbar'
import { FileGrid } from '../components/FileGrid'
import { FileDetailPanel } from '../components/FileDetailPanel'
import { BatchAssignPanel } from '../components/BatchAssignPanel'
import { useFolders } from '../hooks/useFolders'
import { useTags } from '../hooks/useTags'
import { useFiles } from '../hooks/useFiles'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import { nextSelection, emptySelection, type Selection } from '../lib/gridSelection'
import styles from './LibraryView.module.css'

export function LibraryView({
  onImport,
  onOpenFile,
}: {
  onImport: () => void
  onOpenFile: (fileId: number, fromFolder: { id: number; name: string } | null) => void
}) {
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null)
  const [selection, setSelection] = useState<Selection>(emptySelection)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, 250)

  const { folders, reload: reloadFolders } = useFolders()
  const { tags } = useTags()
  const { files, loading, error, reload: reloadFiles } = useFiles(selectedFolderId, debouncedSearch)

  // Esc clears the current selection while one is active.
  useEffect(() => {
    if (selection.ids.size === 0) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelection(emptySelection)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selection.ids.size])

  const title =
    selectedFolderId === null
      ? 'All Files'
      : (folders.find((f) => f.id === selectedFolderId)?.name ?? 'Folder')

  const selectedIds = [...selection.ids]
  const singleSelectedFile =
    selectedIds.length === 1 ? (files.find((f) => f.id === selectedIds[0]) ?? null) : null

  const activeFolder =
    selectedFolderId === null
      ? null
      : (() => {
          const f = folders.find((x) => x.id === selectedFolderId)
          return f ? { id: f.id, name: f.name } : null
        })()

  let center
  if (loading) {
    center = <div className={styles.status}>Loading…</div>
  } else if (error) {
    center = <div className={styles.status}>Could not load files. Is the backend running?</div>
  } else if (files.length === 0) {
    center = (
      <div className={styles.status}>
        {debouncedSearch.trim() ? 'No files match your search' : 'No files in this view'}
      </div>
    )
  } else {
    center = (
      <FileGrid
        files={files}
        tags={tags}
        selectedFileIds={selection.ids}
        onSelectFile={(id, mods) => setSelection((cur) => nextSelection(cur, files, id, mods))}
        onOpenFile={(id) => onOpenFile(id, activeFolder)}
      />
    )
  }

  return (
    <div className={styles.app}>
      <Sidebar
        folders={folders}
        selectedFolderId={selectedFolderId}
        onSelectFolder={setSelectedFolderId}
        onImport={onImport}
      />
      <main className={styles.center}>
        <LibraryToolbar
          title={title}
          fileCount={files.length}
          selectedCount={selection.ids.size}
          search={search}
          onSearchChange={setSearch}
        />
        <div
          className={styles.centerBody}
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelection(emptySelection)
          }}
        >
          {center}
        </div>
      </main>
      {selection.ids.size >= 2 ? (
        <BatchAssignPanel
          selectedFileIds={selectedIds}
          folders={folders}
          tags={tags}
          onApplied={reloadFiles}
        />
      ) : (
        <FileDetailPanel
          file={singleSelectedFile}
          folders={folders}
          tags={tags}
          onAssignmentsSaved={reloadFiles}
          onFolderCreated={reloadFolders}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 3: Run typecheck**

Run: `npx tsc -b`
Expected: clean (0 errors) — the Task 4 `LibraryView` errors are now resolved.

- [ ] **Step 4: Add the multi-select integration test**

Append this test inside the `describe('App', ...)` block in `frontend/src/App.test.tsx` (reuse the file's `dragon`, `mockApi`):

```tsx
  it('shows the batch panel when multiple files are selected', async () => {
    const goblin: ModelFile = { ...dragon, id: 11, name: 'Goblin.stl' }
    mockApi(() => [dragon, goblin])
    render(<App />)
    await waitFor(() => expect(screen.getByText('Dragon.stl')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Dragon.stl'))
    fireEvent.click(screen.getByText('Goblin.stl'), { ctrlKey: true })

    expect(screen.getByRole('heading', { name: '2 files selected' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply to 2' })).toBeInTheDocument()
  })
```

- [ ] **Step 5: Run the affected suites + typecheck**

Run: `npm test -- src/App.test.tsx src/components/LibraryToolbar` then `npx tsc -b`
Expected: PASS; tsc clean. (The existing App test "updates the detail panel on card click" still passes — a plain click yields a 1-file selection, which renders `FileDetailPanel`.)

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/LibraryToolbar.tsx frontend/src/views/LibraryView.tsx frontend/src/App.test.tsx
git commit -m "feat(frontend): library multi-select + batch panel wiring"
```

---

## Task 7: Full-suite verification + manual check + docs

**Files:** `Docs/superpowers/specs/2026-07-02-plastic-room-project-overview.md` (status), plus any fixes found.

- [ ] **Step 1: Full frontend suite + typecheck + build**

Run from `frontend/`: `npm test` → all green; `npx tsc -b` → clean; `npm run build` → succeeds.

- [ ] **Step 2: Full backend suite**

Run from `backend/`: `dotnet test` → all green.

- [ ] **Step 3: Manual verification**

Backend: `cd backend; $env:SEED_SAMPLE_DATA="true"; dotnet run --project PlasticRoom.Api` (http://localhost:5102).
Frontend: `cd frontend; npm run dev` (http://localhost:5173).

- Ctrl/Cmd-click and Shift-click cards → selected cards show the orange ring + ✓ badge, unselected dim to 50%; toolbar shows "{n} files selected of {total}".
- With 2+ selected, the right panel becomes the batch panel. Search a folder + a tag, stage them (checkbox + pill), click "Apply to N" → confirmation appears, staged pills clear, and the grid refreshes; open the affected files to confirm the additions (and that pre-existing assignments were kept, not replaced).
- Plain-click a single card → the normal detail panel returns. Esc or clicking empty grid space clears the selection.
- Trigger a failure (e.g. stop the backend) → an alert shows and the staged set is preserved.

- [ ] **Step 4: Mark Phase 7 complete + commit**

In `Docs/superpowers/specs/2026-07-02-plastic-room-project-overview.md`, set Phase 7 **Status:** to `Complete` and point **Spec:** at `Docs/superpowers/specs/2026-07-05-phase-7-batch-tagging.md`. Commit any manual-verification fixes separately.

```bash
git add Docs/superpowers/specs/2026-07-02-plastic-room-project-overview.md
git commit -m "docs: mark Phase 7 batch tagging complete"
```

---

## Post-implementation

- Update `project-plastic-room.md` memory: Phase 7 done — new atomic `POST /api/files/batch/assign` (add-only, dedupe, transactional); `batchAssign` client fn; pure `lib/gridSelection` reducer; `FileGrid` multi-select API (`selectedFileIds` + modifier-aware `onSelectFile`) with badge/dim; `BatchAssignPanel` swaps in at 2+ selected; `LibraryView` owns `Selection` and clears on Esc/empty-click.
- Remaining deferred (unchanged): batch removal/replace; inline folder/tag create in the batch panel; tag-color editing; "shared assignments" summary; select-all / keyboard grid nav; folder-cycle guard in `FoldersController.Update` (Phase 8).
```
