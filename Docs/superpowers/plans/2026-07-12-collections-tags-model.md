# Collections + Tags Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce the three confusing organizing surfaces (Library folders, system Collections, Tags) to two clear axes — user-editable nestable **Collections** and flat **Tags** that also filter the grid.

**Architecture:** Remove the `IsSystem` folder flag entirely (delete the seeder, drop the field, delete the system guards) so all folders are ordinary editable Collections. Add an AND `tagIds` filter to `GET /api/files` and surface a clickable **Tags** section in the sidebar; the selected collection scopes the grid and the selected tags narrow within that scope. Rename all user-facing "Folders"/"Library" copy to "Collections".

**Tech Stack:** ASP.NET Core 10 Web API + DevExpress XPO/SQLite (backend, xUnit tests); React + TypeScript + Vite, CSS Modules, Vitest + Testing Library (frontend).

## Global Constraints

- **Run frontend tests from `frontend/`** — `cd frontend` first; running vitest from the repo root pulls a broken cached vitest v4 with no jsdom.
- **Backend dev URL** is `http://localhost:5102`; frontend dev is `http://localhost:5173` (proxies `/api`). Seed sample data with `$env:SEED_SAMPLE_DATA="true"` before `dotnet run`.
- **No data migration** — the DB holds only test data; a dev DB reset discards the previously-seeded system collections.
- **XPO gotcha:** a plain `Session` has no implicit transaction — `.Save()` persists immediately; never call `CommitTransaction()` without `BeginTransaction()`; after `.Delete()` you must `PurgeDeletedObjects()`. (No task here adds new delete/commit logic, but preserve the existing patterns when editing controllers.)
- **Terminology rule:** user-facing copy uses **Collections** (nestable groups) and **Tags** (flat labels). The words "Library" and "Folders" must not appear in user-facing UI copy after this work. Internal identifiers (`folderId`, `FileFolder`, `setFileFolders`, `AssignFoldersModal` filename, etc.) are **not** renamed — non-goal, to limit churn.
- **Tag filter semantics:** multiple selected tags combine with **AND** (a file must have *all* selected tags). Tag filtering is scoped by the selected collection and combines with the search box.

---

## File structure

**Backend (`backend/PlasticRoom.Api`)**
- `Controllers/FilesController.cs` — add `tagIds` query param + AND filter (Task 1).
- `Data/FolderSeeder.cs` — **deleted** (Task 2).
- `Program.cs` — remove the seeder call (Task 2).
- `Entities/Folder.cs`, `Dtos/FolderDtos.cs`, `Controllers/FoldersController.cs`, `Data/SampleDataSeeder.cs` — drop `IsSystem` (Task 2).
- `backend/PlasticRoom.Api.Tests/...` — update/remove tests referencing the deleted seeder / `IsSystem` (Tasks 1–2).

**Frontend (`frontend/src`)**
- `api/client.ts` (`getFiles`), `hooks/useFiles.ts` — add `tagIds` (Task 3).
- `api/types.ts` (`Folder`), `lib/folderTree.ts` — drop `isSystem` (Task 4).
- `components/Sidebar.tsx` + `Sidebar.module.css` — single Collections section (Task 4), new Tags section (Task 5).
- `components/AssignFoldersModal.tsx`, `components/detail/DetailInfoPanel.tsx`, `components/FileDetailPanel.tsx`, `components/BatchAssignPanel.tsx`, `components/import/ImportAssignPanel.tsx` — terminology copy + flat collection tree (Task 4).
- `views/LibraryView.tsx`, `components/LibraryToolbar.tsx` — tag-filter state + active-filter chips (Tasks 3 & 5).
- Corresponding `*.test.tsx`/`*.test.ts` files updated in each task.

---

## Task 1: Backend — `tagIds` AND filter on `GET /api/files`

**Files:**
- Modify: `backend/PlasticRoom.Api/Controllers/FilesController.cs:28-64`
- Test: `backend/PlasticRoom.Api.Tests/Controllers/FilesControllerTests.cs`

**Interfaces:**
- Produces: `FilesController.GetAll(int? folderId, List<int>? tagIds, string? q)` → `Ok(List<ModelFileDto>)`. A file is included only if it contains **every** id in `tagIds`. Empty/null `tagIds` applies no tag filter.

- [ ] **Step 1: Write the failing test**

Add `using PlasticRoom.Api.Entities;` to the `using` block at the top of `FilesControllerTests.cs`, then add this test method to the class:

```csharp
[Fact]
public async System.Threading.Tasks.Task GetAll_FiltersByTagIds_WithAndSemantics()
{
    var a = Assert.IsType<ModelFileDto>(
        Assert.IsType<CreatedAtActionResult>(
            await _controller.Upload(new UploadFileRequest { File = BuildStlFormFile("a.stl") })).Value);
    var b = Assert.IsType<ModelFileDto>(
        Assert.IsType<CreatedAtActionResult>(
            await _controller.Upload(new UploadFileRequest { File = BuildStlFormFile("b.stl") })).Value);

    int tag1, tag2;
    using (var session = _sessionFactory.CreateSession())
    {
        var t1 = new Tag(session) { Name = "PLA" }; t1.Save();
        var t2 = new Tag(session) { Name = "ToPrint" }; t2.Save();
        var fa = session.GetObjectByKey<ModelFile>(a.Id);
        var fb = session.GetObjectByKey<ModelFile>(b.Id);
        new FileTag(session) { File = fa, Tag = t1 }.Save();  // a has both tags
        new FileTag(session) { File = fa, Tag = t2 }.Save();
        new FileTag(session) { File = fb, Tag = t1 }.Save();  // b has only tag1
        tag1 = t1.Oid; tag2 = t2.Oid;
    }

    // Both tags required (AND) -> only a
    var bothResult = _controller.GetAll(null, new List<int> { tag1, tag2 }, null);
    var both = Assert.IsType<List<ModelFileDto>>(Assert.IsType<OkObjectResult>(bothResult).Value);
    Assert.Single(both);
    Assert.Equal(a.Id, both[0].Id);

    // Single shared tag -> both files
    var oneResult = _controller.GetAll(null, new List<int> { tag1 }, null);
    var one = Assert.IsType<List<ModelFileDto>>(Assert.IsType<OkObjectResult>(oneResult).Value);
    Assert.Equal(2, one.Count);

    // No tag filter -> both files
    var noneResult = _controller.GetAll(null, null, null);
    var none = Assert.IsType<List<ModelFileDto>>(Assert.IsType<OkObjectResult>(noneResult).Value);
    Assert.Equal(2, none.Count);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test backend/PlasticRoom.Api.Tests --filter GetAll_FiltersByTagIds_WithAndSemantics`
Expected: FAIL to compile — `GetAll` currently takes only `(int? folderId, string? q)`.

- [ ] **Step 3: Implement the filter**

In `FilesController.cs`, change the `GetAll` signature (line 29) to add `tagIds`:

```csharp
[HttpGet]
public IActionResult GetAll([FromQuery] int? folderId, [FromQuery] List<int>? tagIds, [FromQuery] string? q)
```

Then, immediately **after** the `if (folderId is int fid) { ... } else { ... }` block that builds `files` (i.e. right before the `var trimmed = q?.Trim();` line), insert:

```csharp
        if (tagIds is { Count: > 0 })
        {
            var required = tagIds.ToHashSet();
            files = files
                .Where(f => required.All(tid => f.FileTags.Any(ft => ft.Tag.Oid == tid)))
                .ToList();
        }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `dotnet test backend/PlasticRoom.Api.Tests`
Expected: PASS (new test green, all existing tests still green — the added parameter is optional and existing callers pass none).

- [ ] **Step 5: Commit**

```bash
git add backend/PlasticRoom.Api/Controllers/FilesController.cs backend/PlasticRoom.Api.Tests/Controllers/FilesControllerTests.cs
git commit -m "feat(api): filter files by tagIds (AND) on GET /api/files"
```

---

## Task 2: Backend — remove the `IsSystem` system-collection machinery

**Files:**
- Delete: `backend/PlasticRoom.Api/Data/FolderSeeder.cs`
- Delete: `backend/PlasticRoom.Api.Tests/Data/FolderSeederTests.cs`
- Modify: `backend/PlasticRoom.Api/Program.cs:18`
- Modify: `backend/PlasticRoom.Api/Entities/Folder.cs:50-55`
- Modify: `backend/PlasticRoom.Api/Dtos/FolderDtos.cs:10`
- Modify: `backend/PlasticRoom.Api/Controllers/FoldersController.cs` (lines 50, 67-70, 138-141, 212-215, 258)
- Modify: `backend/PlasticRoom.Api/Data/SampleDataSeeder.cs:24-40,49-60`
- Modify: `backend/PlasticRoom.Api.Tests/Controllers/FoldersControllerTests.cs`
- Modify: `backend/PlasticRoom.Api.Tests/Data/SampleDataSeederTests.cs:29`

**Interfaces:**
- Produces: `FolderDto(int Id, string Name, int? ParentId, string? Description, int? CoverImageFileId, int SortOrder, int FileCount)` — **no** `IsSystem`. `Folder` entity has no `IsSystem`. All folders are editable (no system guards on Update/Order/Delete).

- [ ] **Step 1: Delete the seeder and its call**

Delete `backend/PlasticRoom.Api/Data/FolderSeeder.cs`. In `Program.cs`, delete line 18:

```csharp
FolderSeeder.SeedSystemFolders(app.Services.GetRequiredService<XpoSessionFactory>());
```

- [ ] **Step 2: Drop `IsSystem` from the entity and DTO**

In `Entities/Folder.cs`, delete the field + property (lines 50-55):

```csharp
    private bool isSystem;
    public bool IsSystem
    {
        get => isSystem;
        set => SetPropertyValue(nameof(IsSystem), ref isSystem, value);
    }
```

In `Dtos/FolderDtos.cs`, remove the `bool IsSystem,` line from the `FolderDto` record so it reads:

```csharp
public record FolderDto(
    int Id,
    string Name,
    int? ParentId,
    string? Description,
    int? CoverImageFileId,
    int SortOrder,
    int FileCount);
```

- [ ] **Step 3: Remove system guards from `FoldersController`**

In `Controllers/FoldersController.cs`:

1. In `Create` (line ~45-51) remove `IsSystem = false,` from the `new Folder(session) { ... }` initializer.
2. In `Update`, delete the guard block (lines 67-70):
```csharp
        if (folder.IsSystem && (request.Name is not null || request.ParentId is not null))
        {
            return BadRequest(new { error = "System folders cannot be renamed or reparented" });
        }
```
3. In `Order`, delete the guard block (lines 138-141):
```csharp
            if (folder.IsSystem)
            {
                return BadRequest(new { error = $"Folder {item.Id} is a system folder and cannot be reordered" });
            }
```
4. In `Delete`, delete the guard block (lines 212-215):
```csharp
        if (folder.IsSystem)
        {
            return BadRequest(new { error = "System folders cannot be deleted" });
        }
```
5. In `ToDto` (line ~258), remove the `folder.IsSystem,` argument so it reads:
```csharp
    private static FolderDto ToDto(Folder folder) => new(
        folder.Oid,
        folder.Name,
        folder.ParentFolder?.Oid,
        folder.Description,
        folder.CoverImageFile?.Oid,
        folder.SortOrder,
        folder.FileFolders.Count);
```

- [ ] **Step 4: Update `SampleDataSeeder`**

In `Data/SampleDataSeeder.cs`:

1. Replace the idempotency check (lines 24-25):
```csharp
        // Idempotency: bail if sample content (any non-system folder) already exists.
        if (new XPCollection<Folder>(session).Any(f => !f.IsSystem))
        {
            return;
        }
```
with:
```csharp
        // Idempotency: bail if any folder already exists.
        if (new XPCollection<Folder>(session).Any())
        {
            return;
        }
```

2. Delete the two system-folder lookups (lines 39-40):
```csharp
        var favorites = new XPCollection<Folder>(session).FirstOrDefault(f => f.IsSystem && f.Name == "Favorites");
        var toPrint = new XPCollection<Folder>(session).FirstOrDefault(f => f.IsSystem && f.Name == "To Print");
```

3. Remove `favorites` and `toPrint` from the two `CreateSampleFile` folder arrays that reference them:
   - `new[] { miniatures, dnd, favorites }` → `new[] { miniatures, dnd }`
   - `new[] { dnd, toPrint }` → `new[] { dnd }`

- [ ] **Step 5: Remove the now-uncompilable tests**

Delete `backend/PlasticRoom.Api.Tests/Data/FolderSeederTests.cs` (the type it tests is gone).

In `FoldersControllerTests.cs`, delete every test method that calls `FolderSeeder.SeedSystemFolders(...)` or references `f.IsSystem` (they seed a system folder and assert a 400 on rename/delete/reorder — these behaviors no longer exist). These are around lines 51-70 and 190-205. Also, on line 35, change:
```csharp
        Assert.Contains(folders, f => f.Id == created.Id && f.Name == "Miniatures" && !f.IsSystem);
```
to:
```csharp
        Assert.Contains(folders, f => f.Id == created.Id && f.Name == "Miniatures");
```
Remove any now-unused `using` for `PlasticRoom.Api.Data` only if the compiler flags it as unused.

In `SampleDataSeederTests.cs`, change line 29:
```csharp
        Assert.True(new DevExpress.Xpo.XPCollection<Folder>(session).Any(f => !f.IsSystem));
```
to:
```csharp
        Assert.True(new DevExpress.Xpo.XPCollection<Folder>(session).Any());
```

- [ ] **Step 6: Verify no `IsSystem` references remain and the suite is green**

Run: `grep -rn "IsSystem\|SeedSystemFolders\|FolderSeeder" backend/`
Expected: no matches.

Run: `dotnet test backend/PlasticRoom.Api.Tests`
Expected: PASS (all green).

- [ ] **Step 7: Commit**

```bash
git add -A backend/
git commit -m "refactor(api): remove IsSystem system-collection machinery"
```

---

## Task 3: Frontend — thread `tagIds` through `getFiles` and `useFiles`

**Files:**
- Modify: `frontend/src/api/client.ts:52-63`
- Modify: `frontend/src/hooks/useFiles.ts`
- Modify: `frontend/src/views/LibraryView.tsx:33` (caller passes `[]` for now — no behavior change yet)
- Test: `frontend/src/api/client.test.ts`, `frontend/src/hooks/useFiles.test.ts`

**Interfaces:**
- Produces: `getFiles(folderId: number | null, tagIds: number[], q: string): Promise<ModelFile[]>` — appends one repeated `tagIds` query param per id.
- Produces: `useFiles(folderId: number | null, tagIds: number[], q: string)` — refetches when any change. `tagIds` must be a stable reference (React state array) from the caller.

- [ ] **Step 1: Write the failing `getFiles` test**

Add to `frontend/src/api/client.test.ts` (mirror the existing `getFiles` tests — they mock `fetch` and assert the URL). Add:

```ts
it('getFiles appends one tagIds param per id, plus folderId and q', async () => {
  const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response('[]', { status: 200 }),
  )
  await getFiles(2, [5, 7], 'chair')
  const url = fetchMock.mock.calls[0][0] as string
  expect(url).toContain('folderId=2')
  expect(url).toContain('tagIds=5')
  expect(url).toContain('tagIds=7')
  expect(url).toContain('q=chair')
  fetchMock.mockRestore()
})
```

(If `getFiles` isn't already imported in this test file, add it to the existing `import { ... } from './client'` line.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/api/client.test.ts -t "appends one tagIds"`
Expected: FAIL — `getFiles` currently takes `(folderId, q)`, so `[5, 7]` is passed as `q`.

- [ ] **Step 3: Implement `getFiles`**

Replace `getFiles` in `frontend/src/api/client.ts` (lines 52-63):

```ts
export function getFiles(folderId: number | null, tagIds: number[], q: string): Promise<ModelFile[]> {
  const params = new URLSearchParams()
  if (folderId !== null) {
    params.set('folderId', String(folderId))
  }
  for (const id of tagIds) {
    params.append('tagIds', String(id))
  }
  const trimmed = q.trim()
  if (trimmed) {
    params.set('q', trimmed)
  }
  const query = params.toString()
  return getJson<ModelFile[]>(`/api/files${query ? `?${query}` : ''}`)
}
```

- [ ] **Step 4: Update `useFiles` and its caller**

Replace `frontend/src/hooks/useFiles.ts` body with:

```ts
import { useEffect, useState } from 'react'
import type { ModelFile } from '../api/types'
import { getFiles } from '../api/client'

export function useFiles(
  folderId: number | null,
  tagIds: number[],
  q: string,
): { files: ModelFile[]; loading: boolean; error: boolean; reload: () => void } {
  const [files, setFiles] = useState<ModelFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [reloadIndex, setReloadIndex] = useState(0)
  const tagKey = tagIds.join(',')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    getFiles(folderId, tagIds, q)
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
    // tagKey is a serialized stand-in for the tagIds array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderId, tagKey, q, reloadIndex])

  return { files, loading, error, reload: () => setReloadIndex((n) => n + 1) }
}
```

In `frontend/src/views/LibraryView.tsx` line 33, update the caller (temporary empty array — Task 5 wires real tag state):

```ts
  const { files, loading, error, reload: reloadFiles } = useFiles(selectedFolderId, [], debouncedSearch)
```

- [ ] **Step 5: Update the `useFiles` test**

In `frontend/src/hooks/useFiles.test.ts`, update every `useFiles(...)` render call to pass the new middle argument. For calls that previously read `useFiles(folderId, q)`, insert `[]`: e.g. `useFiles(1, 'chair')` → `useFiles(1, [], 'chair')`. Add one new test:

```ts
it('refetches when tagIds change', async () => {
  const spy = vi.spyOn(client, 'getFiles').mockResolvedValue([])
  const { rerender } = renderHook(({ t }) => useFiles(null, t, ''), {
    initialProps: { t: [1] as number[] },
  })
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(1))
  rerender({ t: [1, 2] })
  await waitFor(() => expect(spy).toHaveBeenCalledTimes(2))
  spy.mockRestore()
})
```

(Match the existing import style in the file for `client`, `renderHook`, `waitFor`. If the file imports `getFiles` by name rather than as `client.getFiles`, spy accordingly — e.g. `vi.mock('../api/client')` as the file already does.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/api/client.test.ts src/hooks/useFiles.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/api/client.test.ts frontend/src/hooks/useFiles.ts frontend/src/hooks/useFiles.test.ts frontend/src/views/LibraryView.tsx
git commit -m "feat(frontend): thread tagIds through getFiles/useFiles (no UI change yet)"
```

---

## Task 4: Frontend — drop `isSystem`, single Collections section, terminology cleanup

**Files:**
- Modify: `frontend/src/api/types.ts:31-40`
- Modify: `frontend/src/components/Sidebar.tsx` (remove the Library/Collections split)
- Modify: `frontend/src/components/AssignFoldersModal.tsx:37-39,144,161-174,183-203` (flat tree + copy)
- Modify: `frontend/src/components/detail/DetailInfoPanel.tsx:120`
- Modify: `frontend/src/components/FileDetailPanel.tsx:92`
- Modify: `frontend/src/components/BatchAssignPanel.tsx:66,69-72`
- Modify: `frontend/src/components/import/ImportAssignPanel.tsx:38,42`
- Modify: test files that construct `Folder` literals with `isSystem` (see Step 5)

**Interfaces:**
- Produces: `Folder` TS type with **no** `isSystem` field. Sidebar renders one "Collections" section (All Files + all folders); no "Library" or system "Collections" split.

- [ ] **Step 1: Drop `isSystem` from the `Folder` type**

In `frontend/src/api/types.ts`, remove the `isSystem: boolean` line from the `Folder` interface (line 37). (`FolderNode extends Folder` in `lib/folderTree.ts` needs no change — it inherits.)

- [ ] **Step 2: Collapse the Sidebar to one Collections section**

In `frontend/src/components/Sidebar.tsx`:

1. Replace the tree-building line 188:
```ts
  const libraryTreeNodes = buildFolderTree(folders.filter((f) => !f.isSystem))
```
with:
```ts
  const collectionsTree = buildFolderTree(folders)
```

2. Delete line 276 (`const collectionsTree = buildFolderTree(folders.filter((f) => f.isSystem))`) — the name is now defined above.

3. Change the section label (line 290) from `Library` to `Collections`:
```tsx
      <div className={styles.sectionLabel}>Collections</div>
```

4. Change the mapped list under "All Files" (line 308) from `libraryTreeNodes.map(...)` to `collectionsTree.map(...)` — the row props stay identical (real drag/rename/delete handlers).

5. Delete the entire second section block that rendered the system collections — the `<div className={styles.sectionLabel}>Collections</div>` at line 332 and the `collectionsTree.map(...)` block after it (lines 332-355, the one whose `FolderRow`s were passed `dragId={null}` and no-op handlers).

- [ ] **Step 3: Flatten `AssignFoldersModal` and update its copy**

In `frontend/src/components/AssignFoldersModal.tsx`:

1. Replace lines 37-39:
```ts
  const tree = buildFolderTree(localFolders)
  const collectionRoots = tree.filter((n) => n.isSystem)
  const libraryRoots = tree.filter((n) => !n.isSystem)
```
with:
```ts
  const roots = buildFolderTree(localFolders)
```

2. Replace the `<div className={styles.body}>` contents (lines 161-174) with a single flat tree:
```tsx
        <div className={styles.body}>
          {roots.map((n) => renderNode(n, 0))}
        </div>
```

3. Update the dialog `aria-label` (line 144) from `Assign folders for ${file.name}` to `Assign collections for ${file.name}`.

4. Update copy: the "+ New folder" button text (line 201) → `+ New collection`; the "New folder name" input `aria-label` (line 188) → `New collection name`; the create error (line 90) `Couldn't create folder` → `Couldn't create collection`.

- [ ] **Step 4: Terminology copy in the panels**

- `detail/DetailInfoPanel.tsx` line 120: `IN FOLDERS / COLLECTIONS` → `COLLECTIONS`.
- `FileDetailPanel.tsx` line 92: `<div className={styles.chipLabel}>Folders</div>` → `Collections`.
- `BatchAssignPanel.tsx`: line 66 `FOLDERS` → `COLLECTIONS`; line 69 `aria-label="Search folders"` → `aria-label="Search collections"`; line 71 `placeholder="Search folders…"` → `placeholder="Search collections…"`.
- `import/ImportAssignPanel.tsx`: line 38 `ADD ALL TO FOLDER` → `ADD ALL TO COLLECTION`; line 42 `placeholder="Search or pick a folder…"` → `placeholder="Search or pick a collection…"`.

- [ ] **Step 5: Fix `Folder` literals and assertions in tests**

Removing `isSystem` from the type makes every `Folder` object literal that sets it a TS error. Fix each:

- `components/Sidebar.test.tsx`: the `makeFolder` helper (lines 17-19) — remove the `isSystem = false` parameter and the `isSystem` property from the returned object.
- `components/AssignFoldersModal.test.tsx`: remove `isSystem: true`/`isSystem: false` from the folder literals (lines 8-10, 77). Rewrite the test at line 29 (`renders COLLECTIONS and LIBRARY groups...`) to assert the flat tree instead — it should check that a checkbox renders for each folder (e.g. `expect(screen.getByLabelText('Printed')).toBeInTheDocument()` and `expect(screen.getByLabelText('Terrain')).toBeInTheDocument()`) and must no longer reference the removed `COLLECTIONS`/`LIBRARY` group headings.
- Remove `isSystem` from `Folder` literals in the other test/util files that set it: `views/LibraryView.test.tsx`, `App.test.tsx`, `lib/folderMove.test.ts`, `lib/folderTree.test.ts`, `components/BatchAssignPanel.test.tsx`, `components/FileDetailPanel.test.tsx`, `views/ImportView.test.tsx`, `components/import/ImportAssignPanel.test.tsx`.

Find them all:

Run: `cd frontend && grep -rn "isSystem" src`
Expected after edits: **no matches**.

- [ ] **Step 6: Run the full frontend suite + typecheck**

Run: `cd frontend && npx vitest run && npx tsc -b`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src
git commit -m "refactor(frontend): single Collections section, drop isSystem, rename Folders->Collections copy"
```

---

## Task 5: Frontend — clickable Tags filter (sidebar + toolbar chips)

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx` (add Tags section + props)
- Modify: `frontend/src/components/Sidebar.module.css` (tag row styles)
- Modify: `frontend/src/components/LibraryToolbar.tsx` (active-tag chips)
- Modify: `frontend/src/views/LibraryView.tsx` (tag-filter state + wiring)
- Test: `frontend/src/components/Sidebar.test.tsx`, `frontend/src/components/LibraryToolbar.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `useFiles(folderId, tagIds, q)` (Task 3), `useTags()` (existing) → `{ tags: Tag[] }`, `tagColor(colorKey)` from `lib/format`.
- Produces: Sidebar props `tags: Tag[]`, `selectedTagIds: number[]`, `onToggleTag: (id: number) => void`. Toolbar props `activeTags: Tag[]`, `onRemoveTag: (id: number) => void`.

- [ ] **Step 1: Write the failing Sidebar tags test**

Add to `frontend/src/components/Sidebar.test.tsx` (extend the mocked props with the three new ones on each `render`, or add a small local helper). New test:

```ts
it('renders a Tags section and toggles a tag on click', () => {
  const onToggleTag = vi.fn()
  const tags = [
    { id: 10, name: 'PLA', colorKey: 'green' },
    { id: 11, name: 'Printed', colorKey: 'orange' },
  ]
  render(
    <Sidebar
      folders={[]}
      selectedFolderId={null}
      onSelectFolder={vi.fn()}
      onImport={vi.fn()}
      reloadFolders={vi.fn()}
      reloadFiles={vi.fn()}
      tags={tags}
      selectedTagIds={[11]}
      onToggleTag={onToggleTag}
    />,
  )
  expect(screen.getByText('Tags')).toBeInTheDocument()
  const printed = screen.getByRole('button', { name: 'Printed' })
  expect(printed).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(screen.getByRole('button', { name: 'PLA' }))
  expect(onToggleTag).toHaveBeenCalledWith(10)
})
```

(Ensure `fireEvent` is imported from `@testing-library/react` in this file.)

- [ ] **Step 2: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/components/Sidebar.test.tsx -t "Tags section"`
Expected: FAIL — Sidebar has no `tags` prop / no "Tags" section.

- [ ] **Step 3: Add the Tags section to the Sidebar**

In `frontend/src/components/Sidebar.tsx`:

1. Add the tag imports at the top:
```ts
import type { Folder, FolderOrderItem, Tag } from '../api/types'
import { tagColor } from '../lib/format'
```
(Merge the `Tag` into the existing `types` import; add the `tagColor` import line.)

2. Extend `SidebarProps`:
```ts
interface SidebarProps {
  folders: Folder[]
  selectedFolderId: number | null
  onSelectFolder: (id: number | null) => void
  onImport: () => void
  reloadFolders: () => void
  reloadFiles: () => void
  tags: Tag[]
  selectedTagIds: number[]
  onToggleTag: (id: number) => void
}
```

3. Destructure the new props in the `Sidebar({ ... })` signature: add `tags, selectedTagIds, onToggleTag`.

4. Immediately **before** the closing `{actionError && ...}` block (after the Collections `collectionsTree.map(...)`), add the Tags section:
```tsx
      <div className={styles.sectionLabel}>Tags</div>
      {tags.map((tag) => {
        const active = selectedTagIds.includes(tag.id)
        return (
          <button
            key={tag.id}
            type="button"
            className={`${styles.tagRow} ${active ? styles.tagRowActive : ''}`}
            aria-pressed={active}
            onClick={() => onToggleTag(tag.id)}
          >
            <span className={styles.tagDot} style={{ background: tagColor(tag.colorKey) }} aria-hidden="true" />
            <span className={styles.rowLabel}>{tag.name}</span>
          </button>
        )
      })}
```

- [ ] **Step 4: Add the tag row styles**

Append to `frontend/src/components/Sidebar.module.css`:

```css
.tagRow {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 12px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-family: var(--font-ui);
  font-size: 13px;
  text-align: left;
  border-radius: var(--radius-button);
  cursor: pointer;
}

.tagRow:hover {
  background: var(--bg-surface);
  color: var(--text-primary);
}

.tagRowActive {
  background: var(--accent-tint);
  color: var(--text-primary);
}

.tagDot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  flex: 0 0 9px;
}
```

- [ ] **Step 5: Run the Sidebar test to verify it passes**

Run: `cd frontend && npx vitest run src/components/Sidebar.test.tsx`
Expected: PASS.

- [ ] **Step 6: Write the failing toolbar chips test**

Create `frontend/src/components/LibraryToolbar.test.tsx` (or add to it if present):

```ts
// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { LibraryToolbar } from './LibraryToolbar'

describe('LibraryToolbar', () => {
  it('renders active tag chips and removes one on click', () => {
    const onRemoveTag = vi.fn()
    render(
      <LibraryToolbar
        title="All Files"
        fileCount={3}
        selectedCount={0}
        search=""
        onSearchChange={vi.fn()}
        activeTags={[{ id: 11, name: 'Printed', colorKey: 'orange' }]}
        onRemoveTag={onRemoveTag}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Printed/ }))
    expect(onRemoveTag).toHaveBeenCalledWith(11)
  })
})
```

- [ ] **Step 7: Run it to verify it fails**

Run: `cd frontend && npx vitest run src/components/LibraryToolbar.test.tsx`
Expected: FAIL — `LibraryToolbar` has no `activeTags`/`onRemoveTag` props.

- [ ] **Step 8: Implement the toolbar chips**

Replace `frontend/src/components/LibraryToolbar.tsx` with:

```tsx
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
```

Append to `frontend/src/components/LibraryToolbar.module.css`:

```css
.filterChip {
  font-family: var(--font-mono);
  font-size: 10px;
  padding: 2px 8px;
  border: 1px solid;
  border-radius: var(--radius-pill);
  background: transparent;
  cursor: pointer;
}
```

- [ ] **Step 9: Wire tag-filter state in `LibraryView`**

In `frontend/src/views/LibraryView.tsx`:

1. Add state near the other `useState`s (after line 28):
```ts
  const [selectedTagIds, setSelectedTagIds] = useState<number[]>([])
  const toggleTag = (id: number) =>
    setSelectedTagIds((cur) => (cur.includes(id) ? cur.filter((t) => t !== id) : [...cur, id]))
```

2. Replace the temporary `useFiles(selectedFolderId, [], debouncedSearch)` call (from Task 3) with:
```ts
  const { files, loading, error, reload: reloadFiles } = useFiles(selectedFolderId, selectedTagIds, debouncedSearch)
```

3. Compute the active tags (after `const { tags } = useTags()`):
```ts
  const activeTags = selectedTagIds
    .map((id) => tags.find((t) => t.id === id))
    .filter((t): t is (typeof tags)[number] => t !== undefined)
```

4. Pass the new props to `<Sidebar>` (add after `reloadFiles={reloadFiles}`):
```tsx
        tags={tags}
        selectedTagIds={selectedTagIds}
        onToggleTag={toggleTag}
```

5. Pass the new props to `<LibraryToolbar>` (add after `onSearchChange={setSearch}`):
```tsx
          activeTags={activeTags}
          onRemoveTag={toggleTag}
```

- [ ] **Step 10: Run the full frontend suite + typecheck**

Run: `cd frontend && npx vitest run && npx tsc -b`
Expected: PASS. (If `LibraryView.test.tsx` or `App.test.tsx` render `LibraryToolbar`/`Sidebar` directly and now miss required props, add the new props to those renders — `activeTags={[]}`, `onRemoveTag={vi.fn()}`, `tags={[]}`, `selectedTagIds={[]}`, `onToggleTag={vi.fn()}`.)

- [ ] **Step 11: Commit**

```bash
git add frontend/src
git commit -m "feat(frontend): clickable Tags filter in sidebar with active-filter chips"
```

---

## Task 6: Full verification + manual walkthrough

**Files:** none (verification only)

- [ ] **Step 1: Backend suite**

Run: `dotnet test backend/PlasticRoom.Api.Tests`
Expected: PASS, all green.

- [ ] **Step 2: Frontend suite + typecheck + prod build**

Run: `cd frontend && npx vitest run && npx tsc -b && npm run build`
Expected: all PASS, build succeeds.

- [ ] **Step 3: Run the app and walk through the flows**

Backend: `cd backend; $env:SEED_SAMPLE_DATA="true"; dotnet run --project PlasticRoom.Api` (http://localhost:5102).
Frontend: `cd frontend; npm run dev` (http://localhost:5173).

**If a dev SQLite DB from before this change exists, delete it first** so the removed system collections don't linger. Confirm in the browser:
- Sidebar shows one **Collections** section (All Files + sample collections, all rename/drag/delete-able) and a **Tags** section — **no** Favorites/Printed/To Print/Failed Prints collections.
- Clicking a tag filters the grid; the tag shows as an active chip in the toolbar; clicking a second tag narrows further (AND); clicking the chip or the tag again removes it.
- Selecting a collection scopes the grid, and an active tag filter narrows within it; switching collections keeps the tag filter.
- Detail panel, batch panel (2+ selected), assign modal, and import panel all say "Collections" — no "Folders"/"Library" copy.

- [ ] **Step 4: Update the project overview + memory**

Mark this work complete in `Docs/superpowers/specs/2026-07-12-collections-tags-model.md` (append a short "IMPLEMENTED" note with the final test counts) and update the PlasticRoom project memory with the outcome.

- [ ] **Step 5: Final commit + open PR**

```bash
git add -A
git commit -m "docs: mark Collections+Tags model implemented"
git push -u origin collections-tags-model
gh pr create --title "Collections + Tags organizing model" --body "Reduces the three confusing organizing surfaces to two clear axes: user-editable nestable Collections (IsSystem removed) and flat Tags that filter the grid (AND, scoped by collection)."
```
