# Phase 8 — Folder Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user rename, reorder, re-nest, and delete LIBRARY folders directly in the existing Sidebar, with collapse/expand chevrons and a per-folder file count.

**Architecture:** Backend gains an atomic `PUT /api/folders/order` batch endpoint, a folder-cycle guard shared by `Update` and the new endpoint, and a direct `FileCount` on `FolderDto`. Frontend gains a pure `computeFolderMove` reducer plus an editable Sidebar `FolderRow` (chevron, count, inline rename, right-click menu, delete-with-confirm, native HTML5 drag-and-drop). LIBRARY (non-system) folders are editable; COLLECTIONS stay locked.

**Tech Stack:** ASP.NET Core 10 + DevExpress.Xpo 24.1.6 (SQLite) backend; React + TypeScript (Vite) + Vitest + CSS Modules frontend.

**Spec:** `Docs/superpowers/specs/2026-07-06-phase-8-folder-management.md`

## Global Constraints

- **XPO Session rules** (from project memory — apply to every controller action):
  - `session.CommitTransaction()` MUST be preceded by an explicit `session.BeginTransaction()`, else `TransactionSequenceException`. Actions that only `.Save()` must NOT call `CommitTransaction()`.
  - After `.Delete()` you MUST call `session.PurgeDeletedObjects()` for it to flush. The order endpoint does no deletes, so it must NOT call `PurgeDeletedObjects()`.
- **The file entity is `ModelFile`** in code (not `File`).
- **Backend dev port is 5102** (not 5000). Frontend dev is 5173 and proxies `/api`.
- **Frontend:** plain React, no state manager, no data-fetching lib. CSS Modules over `frontend/src/styles/tokens.css` design tokens. Per-folder file counts render in **IBM Plex Mono** (`var(--font-mono)` if defined; otherwise `font-family: 'IBM Plex Mono', monospace`). Vitest test files that transitively import `three` need a `// @vitest-environment jsdom` docblock — none of the files in this plan import `three`, so this does not apply here.
- **Only LIBRARY (`isSystem === false`) folders** get drag, rename, delete, and context menu. COLLECTIONS rows render chevron + count read-only.
- Backend tests: run from `backend/` with `dotnet test`. Frontend tests: run from `frontend/` with `npx vitest run <path>`.

---

### Task 1: Backend — `FileCount` on `FolderDto`

**Files:**
- Modify: `backend/PlasticRoom.Api/Dtos/FolderDtos.cs:3-10`
- Modify: `backend/PlasticRoom.Api/Controllers/FoldersController.cs:147-154` (the `ToDto` helper)
- Test: `backend/PlasticRoom.Api.Tests/Controllers/FoldersControllerTests.cs`

**Interfaces:**
- Produces: `FolderDto` now has a trailing `int FileCount` positional member. `ToDto(Folder)` populates it from `folder.FileFolders.Count`.

- [ ] **Step 1: Write the failing test**

Add to `FoldersControllerTests.cs` (inside the class):

```csharp
[Fact]
public void GetAll_ReportsDirectFileCount_NotDescendantInclusive()
{
    var parent = (FolderDto)Assert.IsType<CreatedAtActionResult>(
        _controller.Create(new CreateFolderRequest("Parent", null, null))).Value!;
    var child = (FolderDto)Assert.IsType<CreatedAtActionResult>(
        _controller.Create(new CreateFolderRequest("Child", parent.Id, null))).Value!;

    using (var session = _factory.CreateSession())
    {
        var parentFolder = session.GetObjectByKey<Folder>(parent.Id)!;
        var childFolder = session.GetObjectByKey<Folder>(child.Id)!;
        // One file assigned directly to the parent, one to the child.
        foreach (var (name, folder) in new[] { ("p.stl", parentFolder), ("c.stl", childFolder) })
        {
            var file = new ModelFile(session)
            {
                Name = name, Type = ModelFileType.Stl, SizeBytes = 1,
                AddedAt = DateTime.UtcNow, StoragePath = "/data/files/" + name,
            };
            file.Save();
            new FileFolder(session) { File = file, Folder = folder }.Save();
        }
    }

    var folders = Assert.IsAssignableFrom<System.Collections.Generic.List<FolderDto>>(
        Assert.IsType<OkObjectResult>(_controller.GetAll()).Value);

    Assert.Equal(1, folders.Single(f => f.Id == parent.Id).FileCount);
    Assert.Equal(1, folders.Single(f => f.Id == child.Id).FileCount);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test --filter GetAll_ReportsDirectFileCount_NotDescendantInclusive`
Expected: FAIL to compile — `FolderDto` has no `FileCount` member.

- [ ] **Step 3: Add the DTO field**

In `FolderDtos.cs`, change the `FolderDto` record to:

```csharp
public record FolderDto(
    int Id,
    string Name,
    int? ParentId,
    string? Description,
    int? CoverImageFileId,
    int SortOrder,
    bool IsSystem,
    int FileCount);
```

- [ ] **Step 4: Populate it in `ToDto`**

In `FoldersController.cs`, change `ToDto` to:

```csharp
private static FolderDto ToDto(Folder folder) => new(
    folder.Oid,
    folder.Name,
    folder.ParentFolder?.Oid,
    folder.Description,
    folder.CoverImageFile?.Oid,
    folder.SortOrder,
    folder.IsSystem,
    folder.FileFolders.Count);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `dotnet test --filter FoldersControllerTests`
Expected: PASS (all existing FoldersController tests + the new one).

- [ ] **Step 6: Commit**

```bash
git add backend/PlasticRoom.Api/Dtos/FolderDtos.cs backend/PlasticRoom.Api/Controllers/FoldersController.cs backend/PlasticRoom.Api.Tests/Controllers/FoldersControllerTests.cs
git commit -m "feat(backend): direct FileCount on FolderDto"
```

---

### Task 2: Backend — folder-cycle guard on `Update`

**Files:**
- Modify: `backend/PlasticRoom.Api/Controllers/FoldersController.cs` (add helper + wire into `Update`)
- Test: `backend/PlasticRoom.Api.Tests/Controllers/FoldersControllerTests.cs`

**Interfaces:**
- Produces: `private static bool WouldCreateCycle(Folder folder, Folder newParent)` — returns true if `newParent` is `folder` itself or a descendant of `folder`. Reused by Task 3.

- [ ] **Step 1: Write the failing test**

Add to `FoldersControllerTests.cs`:

```csharp
[Fact]
public void Update_RejectsReparentingIntoOwnDescendant()
{
    var parent = (FolderDto)Assert.IsType<CreatedAtActionResult>(
        _controller.Create(new CreateFolderRequest("Parent", null, null))).Value!;
    var child = (FolderDto)Assert.IsType<CreatedAtActionResult>(
        _controller.Create(new CreateFolderRequest("Child", parent.Id, null))).Value!;

    // Try to move Parent under its own Child -> cycle.
    var result = _controller.Update(parent.Id, new UpdateFolderRequest(null, child.Id, null, null, null));

    var badRequest = Assert.IsType<BadRequestObjectResult>(result);
    Assert.Equal(400, badRequest.StatusCode);
}

[Fact]
public void Update_AllowsLegalReparent()
{
    var a = (FolderDto)Assert.IsType<CreatedAtActionResult>(
        _controller.Create(new CreateFolderRequest("A", null, null))).Value!;
    var b = (FolderDto)Assert.IsType<CreatedAtActionResult>(
        _controller.Create(new CreateFolderRequest("B", null, null))).Value!;

    var result = _controller.Update(a.Id, new UpdateFolderRequest(null, b.Id, null, null, null));
    var updated = Assert.IsType<FolderDto>(Assert.IsType<OkObjectResult>(result).Value);

    Assert.Equal(b.Id, updated.ParentId);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test --filter Update_RejectsReparentingIntoOwnDescendant`
Expected: FAIL — currently `Update` performs the reparent and returns `200`.

- [ ] **Step 3: Add the cycle-guard helper**

In `FoldersController.cs`, add this static method (next to `DeleteFolderRecursive`):

```csharp
// True if making newParent the parent of folder would create a cycle,
// i.e. newParent is folder itself or one of folder's descendants.
private static bool WouldCreateCycle(Folder folder, Folder newParent)
{
    for (Folder? p = newParent; p is not null; p = p.ParentFolder)
    {
        if (p.Oid == folder.Oid)
        {
            return true;
        }
    }
    return false;
}
```

- [ ] **Step 4: Wire it into `Update`**

In `FoldersController.Update`, change the reparent block (currently lines ~76-85) to:

```csharp
if (request.ParentId is int parentId)
{
    var parent = session.GetObjectByKey<Folder>(parentId);
    if (parent is null)
    {
        return NotFound(new { error = $"Parent folder {parentId} not found" });
    }

    if (WouldCreateCycle(folder, parent))
    {
        return BadRequest(new { error = "A folder cannot be moved under itself or its own descendant" });
    }

    folder.ParentFolder = parent;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `dotnet test --filter FoldersControllerTests`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/PlasticRoom.Api/Controllers/FoldersController.cs backend/PlasticRoom.Api.Tests/Controllers/FoldersControllerTests.cs
git commit -m "feat(backend): reject folder cycles in Update"
```

---

### Task 3: Backend — `PUT /api/folders/order` batch endpoint

**Files:**
- Modify: `backend/PlasticRoom.Api/Dtos/FolderDtos.cs` (add request records)
- Modify: `backend/PlasticRoom.Api/Controllers/FoldersController.cs` (add `Order` action)
- Test: `backend/PlasticRoom.Api.Tests/Controllers/FoldersControllerTests.cs`

**Interfaces:**
- Consumes: `WouldCreateCycle` (Task 2), `ToDto` (Task 1).
- Produces: `PUT /api/folders/order` accepting `ReorderFoldersRequest(List<FolderOrderItem> Items)` where `FolderOrderItem(int Id, int? ParentId, int SortOrder)`; returns `Ok(List<FolderDto>)` of all folders. Add-only reparent/reorder, atomic.

- [ ] **Step 1: Write the failing tests**

Add to `FoldersControllerTests.cs`:

```csharp
[Fact]
public void Order_ReordersAndReparents_Atomically()
{
    var a = (FolderDto)Assert.IsType<CreatedAtActionResult>(
        _controller.Create(new CreateFolderRequest("A", null, null))).Value!;
    var b = (FolderDto)Assert.IsType<CreatedAtActionResult>(
        _controller.Create(new CreateFolderRequest("B", null, null))).Value!;

    // Put B before A at root, and nest A under B.
    var result = _controller.Order(new ReorderFoldersRequest(new()
    {
        new FolderOrderItem(b.Id, null, 0),
        new FolderOrderItem(a.Id, b.Id, 0),
    }));

    var folders = Assert.IsAssignableFrom<System.Collections.Generic.List<FolderDto>>(
        Assert.IsType<OkObjectResult>(result).Value);
    var updatedA = folders.Single(f => f.Id == a.Id);
    Assert.Equal(b.Id, updatedA.ParentId);
    Assert.Equal(0, updatedA.SortOrder);
    Assert.Equal(0, folders.Single(f => f.Id == b.Id).SortOrder);
}

[Fact]
public void Order_RejectsSystemFolder_AndWritesNothing()
{
    FolderSeeder.SeedSystemFolders(_factory);
    var a = (FolderDto)Assert.IsType<CreatedAtActionResult>(
        _controller.Create(new CreateFolderRequest("A", null, null))).Value!;
    int systemId;
    using (var session = _factory.CreateSession())
    {
        systemId = new DevExpress.Xpo.XPCollection<Folder>(session).First(f => f.IsSystem).Oid;
    }

    var result = _controller.Order(new ReorderFoldersRequest(new()
    {
        new FolderOrderItem(a.Id, null, 5),
        new FolderOrderItem(systemId, null, 6),
    }));

    Assert.IsType<BadRequestObjectResult>(result);
    using var verify = _factory.CreateSession();
    // A's sortOrder was NOT changed (still 0 default) because validation failed first.
    Assert.Equal(0, verify.GetObjectByKey<Folder>(a.Id)!.SortOrder);
}

[Fact]
public void Order_UnknownFolder_Returns404()
{
    var result = _controller.Order(new ReorderFoldersRequest(new()
    {
        new FolderOrderItem(999999, null, 0),
    }));
    Assert.IsType<NotFoundObjectResult>(result);
}

[Fact]
public void Order_Cycle_Returns400_AndWritesNothing()
{
    var parent = (FolderDto)Assert.IsType<CreatedAtActionResult>(
        _controller.Create(new CreateFolderRequest("Parent", null, null))).Value!;
    var child = (FolderDto)Assert.IsType<CreatedAtActionResult>(
        _controller.Create(new CreateFolderRequest("Child", parent.Id, null))).Value!;

    var result = _controller.Order(new ReorderFoldersRequest(new()
    {
        new FolderOrderItem(parent.Id, child.Id, 0),
    }));

    Assert.IsType<BadRequestObjectResult>(result);
    using var verify = _factory.CreateSession();
    Assert.Null(verify.GetObjectByKey<Folder>(parent.Id)!.ParentFolder);
}

[Fact]
public void Order_EmptyItems_Returns400()
{
    Assert.IsType<BadRequestObjectResult>(
        _controller.Order(new ReorderFoldersRequest(new())));
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `dotnet test --filter Order_`
Expected: FAIL to compile — `ReorderFoldersRequest`, `FolderOrderItem`, and `_controller.Order` do not exist.

- [ ] **Step 3: Add the request records**

Append to `FolderDtos.cs`:

```csharp
public record FolderOrderItem(int Id, int? ParentId, int SortOrder);

public record ReorderFoldersRequest(System.Collections.Generic.List<FolderOrderItem> Items);
```

- [ ] **Step 4: Add the `Order` action**

In `FoldersController.cs`, add this action (after `Update`, before `Delete`):

```csharp
[HttpPut("order")]
public IActionResult Order([FromBody] ReorderFoldersRequest request)
{
    if (request.Items is null || request.Items.Count == 0)
    {
        return BadRequest(new { error = "No folders to reorder" });
    }

    using var session = _sessionFactory.CreateSession();

    // Validate everything before writing anything (atomic all-or-nothing).
    var resolved = new List<(Folder folder, Folder? parent, int sortOrder)>();
    foreach (var item in request.Items)
    {
        var folder = session.GetObjectByKey<Folder>(item.Id);
        if (folder is null)
        {
            return NotFound(new { error = $"Folder {item.Id} not found" });
        }

        if (folder.IsSystem)
        {
            return BadRequest(new { error = $"Folder {item.Id} is a system folder and cannot be reordered" });
        }

        Folder? parent = null;
        if (item.ParentId is int parentId)
        {
            parent = session.GetObjectByKey<Folder>(parentId);
            if (parent is null)
            {
                return NotFound(new { error = $"Parent folder {parentId} not found" });
            }

            if (WouldCreateCycle(folder, parent))
            {
                return BadRequest(new { error = $"Folder {item.Id} cannot be moved under itself or its own descendant" });
            }
        }

        resolved.Add((folder, parent, item.SortOrder));
    }

    session.BeginTransaction();
    foreach (var (folder, parent, sortOrder) in resolved)
    {
        folder.ParentFolder = parent;
        folder.SortOrder = sortOrder;
        folder.Save();
    }
    session.CommitTransaction();

    var all = new XPCollection<Folder>(session).Select(ToDto).ToList();
    return Ok(all);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `dotnet test --filter FoldersControllerTests`
Expected: PASS (all folder tests).

- [ ] **Step 6: Full backend suite + commit**

Run: `dotnet test`
Expected: PASS (all backend tests).

```bash
git add backend/PlasticRoom.Api/Dtos/FolderDtos.cs backend/PlasticRoom.Api/Controllers/FoldersController.cs backend/PlasticRoom.Api.Tests/Controllers/FoldersControllerTests.cs
git commit -m "feat(backend): atomic PUT /api/folders/order batch endpoint"
```

---

### Task 4: Frontend — `Folder.fileCount` type + folder API client functions

**Files:**
- Modify: `frontend/src/api/types.ts:31-39` (Folder) + add `FolderOrderItem`
- Modify: `frontend/src/api/client.ts:1` (import) + append three functions

**Interfaces:**
- Produces:
  - `Folder.fileCount?: number` (optional — runtime always sends it; typed optional to avoid churn in unrelated test fixtures).
  - `interface FolderOrderItem { id: number; parentId: number | null; sortOrder: number }`
  - `reorderFolders(items: FolderOrderItem[]): Promise<Folder[]>`
  - `updateFolder(id: number, patch: { name?: string; parentId?: number | null }): Promise<Folder>`
  - `deleteFolder(id: number): Promise<void>`

> Note: these are thin `fetch` wrappers; consistent with the existing client (`batchAssign`, `createFolder`) they get no isolated unit test — they are exercised via the Sidebar component tests in Tasks 6-8 with `../api/client` mocked.

- [ ] **Step 1: Add the types**

In `frontend/src/api/types.ts`, change the `Folder` interface to add `fileCount`, and add `FolderOrderItem`:

```ts
export interface Folder {
  id: number
  name: string
  parentId: number | null
  description: string | null
  coverImageFileId: number | null
  sortOrder: number
  isSystem: boolean
  fileCount?: number
}

export interface FolderOrderItem {
  id: number
  parentId: number | null
  sortOrder: number
}
```

- [ ] **Step 2: Add the client functions**

In `frontend/src/api/client.ts`, update the top import to include `FolderOrderItem`:

```ts
import type { Folder, FolderOrderItem, ModelFile, Tag, UploadFileInput } from './types'
```

Then append at the end of the file:

```ts
export async function reorderFolders(items: FolderOrderItem[]): Promise<Folder[]> {
  const url = '/api/folders/order'
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items }),
  })
  return parseJsonOrThrow<Folder[]>(res, url)
}

export async function updateFolder(
  id: number,
  patch: { name?: string; parentId?: number | null },
): Promise<Folder> {
  const url = `/api/folders/${id}`
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  return parseJsonOrThrow<Folder>(res, url)
}

export async function deleteFolder(id: number): Promise<void> {
  const url = `/api/folders/${id}`
  const res = await fetch(url, { method: 'DELETE' })
  if (!res.ok) {
    throw new Error(`Request to ${url} failed with status ${res.status}`)
  }
}
```

- [ ] **Step 3: Verify typecheck**

Run: `cd frontend; npx tsc -b`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/types.ts frontend/src/api/client.ts
git commit -m "feat(frontend): folder fileCount type + reorder/update/delete client fns"
```

---

### Task 5: Frontend — `lib/folderMove.ts` pure reducer

**Files:**
- Create: `frontend/src/lib/folderMove.ts`
- Test: `frontend/src/lib/folderMove.test.ts`

**Interfaces:**
- Consumes: `FolderNode` from `./folderTree`, `FolderOrderItem` from `../api/types`.
- Produces:
  - `type DropPosition = { kind: 'onto'; folderId: number } | { kind: 'between'; parentId: number | null; index: number }`
  - `computeFolderMove(tree: FolderNode[], dragId: number, drop: DropPosition): FolderOrderItem[]` — minimal `{id,parentId,sortOrder}` deltas; returns `[]` for illegal moves (onto self, onto own descendant).

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/lib/folderMove.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildFolderTree } from './folderTree'
import { computeFolderMove } from './folderMove'
import type { Folder } from '../api/types'

// A(1) [C(3), D(4)], B(2)  — roots A,B; A has children C,D
const f = (id: number, parentId: number | null, sortOrder: number): Folder => ({
  id, name: `f${id}`, parentId, description: null, coverImageFileId: null, sortOrder, isSystem: false,
})
const tree = () => buildFolderTree([f(1, null, 0), f(2, null, 1), f(3, 1, 0), f(4, 1, 1)])

describe('computeFolderMove', () => {
  it('reorders root siblings: move B before A', () => {
    const items = computeFolderMove(tree(), 2, { kind: 'between', parentId: null, index: 0 })
    expect(items).toContainEqual({ id: 2, parentId: null, sortOrder: 0 })
    expect(items).toContainEqual({ id: 1, parentId: null, sortOrder: 1 })
  })

  it('re-nests B onto A, appended after A\'s existing children', () => {
    const items = computeFolderMove(tree(), 2, { kind: 'onto', folderId: 1 })
    expect(items).toEqual([{ id: 2, parentId: 1, sortOrder: 2 }])
  })

  it('reorders children: move D before C', () => {
    const items = computeFolderMove(tree(), 4, { kind: 'between', parentId: 1, index: 0 })
    expect(items).toContainEqual({ id: 4, parentId: 1, sortOrder: 0 })
    expect(items).toContainEqual({ id: 3, parentId: 1, sortOrder: 1 })
  })

  it('refuses dropping a folder onto itself', () => {
    expect(computeFolderMove(tree(), 1, { kind: 'onto', folderId: 1 })).toEqual([])
  })

  it('refuses dropping a folder into its own descendant', () => {
    // A(1) onto C(3), which is a child of A -> cycle
    expect(computeFolderMove(tree(), 1, { kind: 'onto', folderId: 3 })).toEqual([])
    expect(computeFolderMove(tree(), 1, { kind: 'between', parentId: 3, index: 0 })).toEqual([])
  })

  it('returns [] when the dragged folder does not exist', () => {
    expect(computeFolderMove(tree(), 999, { kind: 'onto', folderId: 1 })).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend; npx vitest run src/lib/folderMove.test.ts`
Expected: FAIL — `./folderMove` does not exist.

- [ ] **Step 3: Implement the reducer**

Create `frontend/src/lib/folderMove.ts`:

```ts
import type { FolderOrderItem } from '../api/types'
import type { FolderNode } from './folderTree'

export type DropPosition =
  | { kind: 'onto'; folderId: number }
  | { kind: 'between'; parentId: number | null; index: number }

function findNode(tree: FolderNode[], id: number): FolderNode | null {
  for (const node of tree) {
    if (node.id === id) return node
    const found = findNode(node.children, id)
    if (found) return found
  }
  return null
}

function childrenOf(tree: FolderNode[], parentId: number | null): FolderNode[] {
  if (parentId === null) return tree
  return findNode(tree, parentId)?.children ?? []
}

function collectIds(node: FolderNode, acc: Set<number>): void {
  acc.add(node.id)
  for (const child of node.children) collectIds(child, acc)
}

export function computeFolderMove(
  tree: FolderNode[],
  dragId: number,
  drop: DropPosition,
): FolderOrderItem[] {
  const dragNode = findNode(tree, dragId)
  if (!dragNode) return []

  const targetParentId = drop.kind === 'onto' ? drop.folderId : drop.parentId

  // Illegal: dropping into self or into one of the dragged node's own descendants.
  const subtree = new Set<number>()
  collectIds(dragNode, subtree)
  if (targetParentId !== null && subtree.has(targetParentId)) return []

  // Destination siblings, with the dragged node removed if already present.
  const siblings = childrenOf(tree, targetParentId).filter((n) => n.id !== dragId)

  let insertIndex: number
  if (drop.kind === 'onto') {
    insertIndex = siblings.length // append as the last child
  } else {
    insertIndex = Math.max(0, Math.min(drop.index, siblings.length))
  }

  const ordered = [...siblings]
  ordered.splice(insertIndex, 0, dragNode)

  const deltas: FolderOrderItem[] = []
  ordered.forEach((node, index) => {
    const parentChanged = node.id === dragId && (node.parentId ?? null) !== targetParentId
    if (node.id === dragId || parentChanged || node.sortOrder !== index) {
      deltas.push({ id: node.id, parentId: targetParentId, sortOrder: index })
    }
  })

  return deltas
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend; npx vitest run src/lib/folderMove.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/folderMove.ts frontend/src/lib/folderMove.test.ts
git commit -m "feat(frontend): computeFolderMove pure reducer"
```

---

### Task 6: Frontend — Sidebar chevron collapse + file count

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx` (full rewrite of `FolderRow` + `Sidebar` to add chevron/count)
- Modify: `frontend/src/components/Sidebar.module.css` (add chevron + count styles)
- Test: `frontend/src/components/Sidebar.test.tsx`

**Interfaces:**
- Produces: `Sidebar` renders a chevron toggle for rows with children (collapse hides descendants; state is ephemeral in `Sidebar`, default expanded) and a right-aligned mono file count from `folder.fileCount ?? 0`. Public `Sidebar` props are UNCHANGED in this task.

- [ ] **Step 1: Write the failing tests**

Add to `Sidebar.test.tsx` (extend the `folder` helper to accept a count, and add cases). Replace the existing `folder` helper and `folders` fixture at the top with:

```tsx
const folder = (
  id: number, name: string, parentId: number | null, isSystem = false, fileCount = 0,
): Folder => ({
  id, name, parentId, description: null, coverImageFileId: null, sortOrder: 0, isSystem, fileCount,
})

const folders: Folder[] = [
  folder(1, 'Miniatures', null, false, 3),
  folder(2, 'DnD Campaign', 1, false, 1),
  folder(3, 'Favorites', null, true),
]
```

Then add these tests inside `describe('Sidebar', ...)`:

```tsx
it('renders the file count for a folder', () => {
  render(<Sidebar folders={folders} selectedFolderId={null} onSelectFolder={vi.fn()} onImport={vi.fn()} />)
  // Miniatures has 3 files.
  expect(screen.getByText('Miniatures').closest('div,button,li')).toHaveTextContent('3')
})

it('collapses a parent folder, hiding its children', () => {
  render(<Sidebar folders={folders} selectedFolderId={null} onSelectFolder={vi.fn()} onImport={vi.fn()} />)
  expect(screen.getByText('DnD Campaign')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /collapse Miniatures/i }))
  expect(screen.queryByText('DnD Campaign')).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend; npx vitest run src/components/Sidebar.test.tsx`
Expected: FAIL — no collapse button / count rendering yet.

- [ ] **Step 3: Rewrite `Sidebar.tsx` with chevron + count**

Replace the entire contents of `frontend/src/components/Sidebar.tsx` with:

```tsx
import { useState } from 'react'
import type { Folder } from '../api/types'
import { buildFolderTree, type FolderNode } from '../lib/folderTree'
import styles from './Sidebar.module.css'

interface SidebarProps {
  folders: Folder[]
  selectedFolderId: number | null
  onSelectFolder: (id: number | null) => void
  onImport: () => void
}

interface RowProps {
  node: FolderNode
  depth: number
  selectedFolderId: number | null
  onSelectFolder: (id: number | null) => void
  collapsed: Set<number>
  onToggleCollapse: (id: number) => void
}

function FolderRow({
  node, depth, selectedFolderId, onSelectFolder, collapsed, onToggleCollapse,
}: RowProps) {
  const selected = node.id === selectedFolderId
  const hasChildren = node.children.length > 0
  const isCollapsed = collapsed.has(node.id)

  return (
    <>
      <div
        className={`${styles.row} ${selected ? styles.rowSelected : ''}`}
        style={{ paddingLeft: 12 + depth * 14 }}
      >
        {hasChildren ? (
          <button
            type="button"
            className={styles.chevron}
            aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${node.name}`}
            aria-expanded={!isCollapsed}
            onClick={() => onToggleCollapse(node.id)}
          >
            {isCollapsed ? '▸' : '▾'}
          </button>
        ) : (
          <span className={styles.chevronSpacer} aria-hidden="true" />
        )}
        <button
          type="button"
          className={styles.rowMain}
          aria-current={selected ? 'true' : undefined}
          onClick={() => onSelectFolder(node.id)}
        >
          <span className={styles.folderIcon} aria-hidden="true">📁</span>
          <span className={styles.rowLabel}>{node.name}</span>
          <span className={styles.fileCount}>{node.fileCount ?? 0}</span>
        </button>
      </div>
      {hasChildren && !isCollapsed && node.children.map((child) => (
        <FolderRow
          key={child.id}
          node={child}
          depth={depth + 1}
          selectedFolderId={selectedFolderId}
          onSelectFolder={onSelectFolder}
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
        />
      ))}
    </>
  )
}

export function Sidebar({ folders, selectedFolderId, onSelectFolder, onImport }: SidebarProps) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const toggleCollapse = (id: number) =>
    setCollapsed((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const libraryTree = buildFolderTree(folders.filter((f) => !f.isSystem))
  const collectionsTree = buildFolderTree(folders.filter((f) => f.isSystem))
  const allFilesSelected = selectedFolderId === null

  return (
    <nav className={styles.sidebar}>
      <div className={styles.brand}>
        <span className={styles.brandMark} aria-hidden="true" />
        <span className={styles.brandName}>PlasticRoom</span>
      </div>

      <button type="button" className={styles.importButton} onClick={onImport}>
        ⬆ Import files
      </button>

      <div className={styles.sectionLabel}>Library</div>
      <div className={`${styles.row} ${allFilesSelected ? styles.rowSelected : ''}`} style={{ paddingLeft: 12 }}>
        <span className={styles.chevronSpacer} aria-hidden="true" />
        <button
          type="button"
          className={styles.rowMain}
          aria-current={allFilesSelected ? 'true' : undefined}
          onClick={() => onSelectFolder(null)}
        >
          <span className={styles.folderIcon} aria-hidden="true">📁</span>
          <span className={styles.rowLabel}>All Files</span>
        </button>
      </div>
      {libraryTree.map((node) => (
        <FolderRow
          key={node.id}
          node={node}
          depth={1}
          selectedFolderId={selectedFolderId}
          onSelectFolder={onSelectFolder}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapse}
        />
      ))}

      <div className={styles.sectionLabel}>Collections</div>
      {collectionsTree.map((node) => (
        <FolderRow
          key={node.id}
          node={node}
          depth={0}
          selectedFolderId={selectedFolderId}
          onSelectFolder={onSelectFolder}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapse}
        />
      ))}
    </nav>
  )
}
```

- [ ] **Step 4: Add the CSS**

Append to `frontend/src/components/Sidebar.module.css`:

```css
.rowMain {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  color: inherit;
  font: inherit;
  text-align: left;
  padding: 6px 8px;
  cursor: pointer;
}

.chevron,
.chevronSpacer {
  width: 16px;
  flex: 0 0 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.chevron {
  background: transparent;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 10px;
  padding: 0;
}

.fileCount {
  margin-left: auto;
  padding-left: 8px;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 10px;
  color: var(--text-tertiary);
}
```

> The existing `.row` rule may set `display`/padding assuming a `<button>`; if the rows now render misaligned, adjust `.row` to `display: flex; align-items: center;` and move its click padding onto `.rowMain` (already included above). Keep `.rowSelected` as-is.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd frontend; npx vitest run src/components/Sidebar.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/Sidebar.tsx frontend/src/components/Sidebar.module.css frontend/src/components/Sidebar.test.tsx
git commit -m "feat(frontend): Sidebar chevron collapse + file counts"
```

---

### Task 7: Frontend — inline rename, context menu, delete-with-confirm

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx` (add rename/menu/delete to `FolderRow`; new props)
- Modify: `frontend/src/components/Sidebar.module.css` (menu + rename input styles)
- Modify: `frontend/src/views/LibraryView.tsx:82-87` (pass new props)
- Test: `frontend/src/components/Sidebar.test.tsx`

**Interfaces:**
- Consumes: `updateFolder`, `deleteFolder` from `../api/client` (Task 4); `folder.isSystem`.
- Produces: `Sidebar` gains two required props — `reloadFolders: () => void` and `reloadFiles: () => void`. LIBRARY rows expose a right-click context menu (Rename, Delete); rename swaps the label for an input (Enter/blur commit via `updateFolder`, Esc cancel); Delete opens a confirm dialog then calls `deleteFolder`. COLLECTIONS rows expose none of these. On deleting the currently-selected folder (or an ancestor of it), selection resets to All Files.

- [ ] **Step 1: Write the failing tests**

Add to `Sidebar.test.tsx`. First add the client mock at the top of the file (after the imports):

```tsx
import { vi } from 'vitest'
vi.mock('../api/client', () => ({
  updateFolder: vi.fn().mockResolvedValue({}),
  deleteFolder: vi.fn().mockResolvedValue(undefined),
  reorderFolders: vi.fn().mockResolvedValue([]),
}))
import { updateFolder, deleteFolder } from '../api/client'
```

> Note: `vi` is already imported in the existing file — merge, don't duplicate the import. Also update EVERY existing `render(<Sidebar ... />)` call in this file to add `reloadFolders={vi.fn()} reloadFiles={vi.fn()}` props.

Then add these tests:

```tsx
it('renames a library folder via the context menu', async () => {
  render(<Sidebar folders={folders} selectedFolderId={null} onSelectFolder={vi.fn()} onImport={vi.fn()} reloadFolders={vi.fn()} reloadFiles={vi.fn()} />)
  fireEvent.contextMenu(screen.getByText('Miniatures'))
  fireEvent.click(screen.getByRole('menuitem', { name: /rename/i }))
  const input = screen.getByDisplayValue('Miniatures')
  fireEvent.change(input, { target: { value: 'Minis' } })
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(updateFolder).toHaveBeenCalledWith(1, { name: 'Minis' })
})

it('does not open a context menu on a system (collections) folder', () => {
  render(<Sidebar folders={folders} selectedFolderId={null} onSelectFolder={vi.fn()} onImport={vi.fn()} reloadFolders={vi.fn()} reloadFiles={vi.fn()} />)
  fireEvent.contextMenu(screen.getByText('Favorites'))
  expect(screen.queryByRole('menuitem', { name: /rename/i })).not.toBeInTheDocument()
})

it('deletes a folder after confirmation', async () => {
  const reloadFolders = vi.fn()
  render(<Sidebar folders={folders} selectedFolderId={null} onSelectFolder={vi.fn()} onImport={vi.fn()} reloadFolders={reloadFolders} reloadFiles={vi.fn()} />)
  fireEvent.contextMenu(screen.getByText('Miniatures'))
  fireEvent.click(screen.getByRole('menuitem', { name: /delete/i }))
  fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))
  expect(deleteFolder).toHaveBeenCalledWith(1)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend; npx vitest run src/components/Sidebar.test.tsx`
Expected: FAIL — no context menu / rename input / confirm dialog.

- [ ] **Step 3: Extend `Sidebar.tsx`**

Update `frontend/src/components/Sidebar.tsx`:

(a) Update imports:

```tsx
import { useState } from 'react'
import type { Folder } from '../api/types'
import { buildFolderTree, type FolderNode } from '../lib/folderTree'
import { deleteFolder, updateFolder } from '../api/client'
import styles from './Sidebar.module.css'
```

(b) Add the two new props to `SidebarProps`:

```tsx
interface SidebarProps {
  folders: Folder[]
  selectedFolderId: number | null
  onSelectFolder: (id: number | null) => void
  onImport: () => void
  reloadFolders: () => void
  reloadFiles: () => void
}
```

(c) Add these to `RowProps`:

```tsx
interface RowProps {
  node: FolderNode
  depth: number
  selectedFolderId: number | null
  onSelectFolder: (id: number | null) => void
  collapsed: Set<number>
  onToggleCollapse: (id: number) => void
  onRename: (id: number, name: string) => void
  onRequestDelete: (node: FolderNode) => void
}
```

(d) Replace the `FolderRow` body with a version that adds a context menu + inline rename (LIBRARY only):

```tsx
function FolderRow({
  node, depth, selectedFolderId, onSelectFolder, collapsed, onToggleCollapse, onRename, onRequestDelete,
}: RowProps) {
  const selected = node.id === selectedFolderId
  const hasChildren = node.children.length > 0
  const isCollapsed = collapsed.has(node.id)
  const editable = !node.isSystem

  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(node.name)

  const commitRename = () => {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== node.name) onRename(node.id, trimmed)
    setRenaming(false)
  }

  return (
    <>
      <div
        className={`${styles.row} ${selected ? styles.rowSelected : ''}`}
        style={{ paddingLeft: 12 + depth * 14 }}
        onContextMenu={editable ? (e) => { e.preventDefault(); setMenuOpen(true) } : undefined}
      >
        {hasChildren ? (
          <button
            type="button"
            className={styles.chevron}
            aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${node.name}`}
            aria-expanded={!isCollapsed}
            onClick={() => onToggleCollapse(node.id)}
          >
            {isCollapsed ? '▸' : '▾'}
          </button>
        ) : (
          <span className={styles.chevronSpacer} aria-hidden="true" />
        )}

        {renaming ? (
          <input
            className={styles.renameInput}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename()
              if (e.key === 'Escape') { setDraft(node.name); setRenaming(false) }
            }}
            onBlur={commitRename}
          />
        ) : (
          <button
            type="button"
            className={styles.rowMain}
            aria-current={selected ? 'true' : undefined}
            onClick={() => onSelectFolder(node.id)}
          >
            <span className={styles.folderIcon} aria-hidden="true">📁</span>
            <span className={styles.rowLabel}>{node.name}</span>
            <span className={styles.fileCount}>{node.fileCount ?? 0}</span>
          </button>
        )}

        {menuOpen && (
          <div className={styles.menu} role="menu" onMouseLeave={() => setMenuOpen(false)}>
            <button
              type="button"
              role="menuitem"
              className={styles.menuItem}
              onClick={() => { setMenuOpen(false); setDraft(node.name); setRenaming(true) }}
            >
              Rename
            </button>
            <button
              type="button"
              role="menuitem"
              className={styles.menuItemDanger}
              onClick={() => { setMenuOpen(false); onRequestDelete(node) }}
            >
              Delete
            </button>
          </div>
        )}
      </div>
      {hasChildren && !isCollapsed && node.children.map((child) => (
        <FolderRow
          key={child.id}
          node={child}
          depth={depth + 1}
          selectedFolderId={selectedFolderId}
          onSelectFolder={onSelectFolder}
          collapsed={collapsed}
          onToggleCollapse={onToggleCollapse}
          onRename={onRename}
          onRequestDelete={onRequestDelete}
        />
      ))}
    </>
  )
}
```

(e) Update the `Sidebar` function: destructure the new props, add rename/delete handlers + a delete-confirm dialog, and pass `onRename`/`onRequestDelete` to every `FolderRow`. Replace the `Sidebar` function signature line and add handlers after the `toggleCollapse` definition:

```tsx
export function Sidebar({
  folders, selectedFolderId, onSelectFolder, onImport, reloadFolders, reloadFiles,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [pendingDelete, setPendingDelete] = useState<FolderNode | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const toggleCollapse = (id: number) =>
    setCollapsed((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const handleRename = async (id: number, name: string) => {
    setActionError(null)
    try {
      await updateFolder(id, { name })
      reloadFolders()
    } catch {
      setActionError('Could not rename folder.')
    }
  }

  const subtreeIds = (node: FolderNode): number[] =>
    [node.id, ...node.children.flatMap(subtreeIds)]

  const confirmDelete = async () => {
    if (!pendingDelete) return
    const removed = new Set(subtreeIds(pendingDelete))
    setActionError(null)
    try {
      await deleteFolder(pendingDelete.id)
      setPendingDelete(null)
      if (selectedFolderId !== null && removed.has(selectedFolderId)) {
        onSelectFolder(null)
      }
      reloadFolders()
      reloadFiles()
    } catch {
      setActionError('Could not delete folder.')
    }
  }
```

Add `onRename={handleRename}` and `onRequestDelete={setPendingDelete}` to all three `FolderRow` usages (both library and collections maps — collections rows won't invoke them since they render no menu). Then, just before the closing `</nav>`, add the confirm dialog + error region:

```tsx
      {actionError && <div role="alert" className={styles.actionError}>{actionError}</div>}

      {pendingDelete && (
        <div className={styles.dialogBackdrop} onClick={() => setPendingDelete(null)}>
          <div className={styles.dialog} role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <p className={styles.dialogBody}>
              Delete “{pendingDelete.name}” and its subfolders? Files stay in your library but
              lose this folder assignment.
            </p>
            <div className={styles.dialogActions}>
              <button type="button" className={styles.dialogCancel} onClick={() => setPendingDelete(null)}>
                Cancel
              </button>
              <button type="button" className={styles.dialogDelete} onClick={confirmDelete}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 4: Add the CSS**

Append to `frontend/src/components/Sidebar.module.css`:

```css
.renameInput {
  flex: 1;
  min-width: 0;
  background: var(--bg-surface);
  border: 1px solid var(--accent);
  border-radius: 5px;
  color: var(--text-primary);
  font: inherit;
  padding: 4px 6px;
}

.menu {
  position: absolute;
  right: 8px;
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

.menuItem,
.menuItemDanger {
  background: transparent;
  border: none;
  color: var(--text-primary);
  font: inherit;
  text-align: left;
  padding: 6px 8px;
  border-radius: 5px;
  cursor: pointer;
}

.menuItemDanger { color: var(--error); }
.menuItem:hover,
.menuItemDanger:hover { background: var(--bg-surface); }

.dialogBackdrop {
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

.dialogBody { color: var(--text-primary); font-size: 13px; margin: 0 0 16px; }
.dialogActions { display: flex; justify-content: flex-end; gap: 8px; }

.dialogCancel,
.dialogDelete {
  border-radius: 7px;
  padding: 7px 14px;
  font: inherit;
  cursor: pointer;
  border: 1px solid var(--border);
}

.dialogCancel { background: transparent; color: var(--text-primary); }
.dialogDelete { background: var(--error); color: #fff; border-color: var(--error); }
.actionError { color: var(--error); font-size: 11px; padding: 8px 12px; }
```

> `.row` needs `position: relative` for the absolutely-positioned `.menu` to anchor correctly. If it isn't already, add `position: relative;` to the existing `.row` rule.

- [ ] **Step 5: Wire the new props in `LibraryView.tsx`**

In `frontend/src/views/LibraryView.tsx`, update the `<Sidebar>` usage (lines ~82-87) to pass the reload callbacks:

```tsx
      <Sidebar
        folders={folders}
        selectedFolderId={selectedFolderId}
        onSelectFolder={setSelectedFolderId}
        onImport={onImport}
        reloadFolders={reloadFolders}
        reloadFiles={reloadFiles}
      />
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd frontend; npx vitest run src/components/Sidebar.test.tsx`
Expected: PASS.

- [ ] **Step 7: Typecheck the whole frontend**

Run: `cd frontend; npx tsc -b`
Expected: no errors (confirms `LibraryView` and any other `Sidebar` consumer supply the new props).

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/Sidebar.tsx frontend/src/components/Sidebar.module.css frontend/src/components/Sidebar.test.tsx frontend/src/views/LibraryView.tsx
git commit -m "feat(frontend): Sidebar inline rename + context-menu delete"
```

---

### Task 8: Frontend — Sidebar drag-and-drop reorder/re-nest

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx` (drag handlers on `FolderRow`, reorder handler in `Sidebar`)
- Modify: `frontend/src/components/Sidebar.module.css` (drop-target highlight)

**Interfaces:**
- Consumes: `computeFolderMove` + `DropPosition` from `../lib/folderMove` (Task 5); `reorderFolders` from `../api/client` (Task 4); the LIBRARY `FolderNode[]` tree.
- Produces: LIBRARY rows are `draggable`; dropping onto a row re-nests, and the native drag reorders/re-nests via `computeFolderMove` → `reorderFolders` → `reloadFolders`. COLLECTIONS rows are not draggable and are not drop targets.

> The HTML5 drag gestures cannot be exercised in jsdom, so this task has no new unit tests — it is verified in the in-browser walkthrough (final verification gate). Keep the move math in the already-tested `computeFolderMove`; this task only wires DOM drag events to it.

- [ ] **Step 1: Add drag state + reorder handler to `Sidebar`**

In the `Sidebar` function, add drag state near the other `useState` calls:

```tsx
  const [dragId, setDragId] = useState<number | null>(null)
  const [dropTargetId, setDropTargetId] = useState<number | null>(null)

  const libraryTreeNodes = buildFolderTree(folders.filter((f) => !f.isSystem))

  const handleDrop = async (targetFolderId: number) => {
    const source = dragId
    setDragId(null)
    setDropTargetId(null)
    if (source === null || source === targetFolderId) return
    const items = computeFolderMove(libraryTreeNodes, source, { kind: 'onto', folderId: targetFolderId })
    if (items.length === 0) return
    setActionError(null)
    try {
      await reorderFolders(items)
      reloadFolders()
    } catch {
      setActionError('Could not move folder.')
    }
  }
```

Replace the existing `const libraryTree = buildFolderTree(...)` line with a reference to `libraryTreeNodes` (use `libraryTreeNodes` in the library `.map`), so the tree is computed once.

Update the imports:

```tsx
import { deleteFolder, reorderFolders, updateFolder } from '../api/client'
import { computeFolderMove } from '../lib/folderMove'
```

- [ ] **Step 2: Thread drag props into `FolderRow`**

Add to `RowProps`:

```tsx
  draggable: boolean
  dragId: number | null
  dropTargetId: number | null
  onDragStartRow: (id: number) => void
  onDragOverRow: (id: number) => void
  onDropRow: (id: number) => void
  onDragEndRow: () => void
```

In `FolderRow`, put drag handlers on the row `<div>` (only when `editable`), and apply a drop-target class:

```tsx
      <div
        className={`${styles.row} ${selected ? styles.rowSelected : ''} ${dropTargetId === node.id ? styles.dropTarget : ''}`}
        style={{ paddingLeft: 12 + depth * 14 }}
        draggable={editable}
        onContextMenu={editable ? (e) => { e.preventDefault(); setMenuOpen(true) } : undefined}
        onDragStart={editable ? (e) => { e.stopPropagation(); onDragStartRow(node.id) } : undefined}
        onDragOver={editable ? (e) => { e.preventDefault(); onDragOverRow(node.id) } : undefined}
        onDrop={editable ? (e) => { e.preventDefault(); onDropRow(node.id) } : undefined}
        onDragEnd={editable ? onDragEndRow : undefined}
      >
```

Pass the new props through both the parent usage and the recursive child usage of `FolderRow` (library map only — collections pass `draggable={false}` and no-op handlers, or simply guard in the map). For the collections `.map`, pass `draggable={false}` and `onDragStartRow={() => {}}` etc. For the library `.map`, pass:

```tsx
          draggable
          dragId={dragId}
          dropTargetId={dropTargetId}
          onDragStartRow={setDragId}
          onDragOverRow={setDropTargetId}
          onDropRow={handleDrop}
          onDragEndRow={() => { setDragId(null); setDropTargetId(null) }}
```

- [ ] **Step 3: Add the drop-target CSS**

Append to `frontend/src/components/Sidebar.module.css`:

```css
.dropTarget {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
  border-radius: 5px;
}
```

- [ ] **Step 4: Typecheck + run the full frontend suite**

Run: `cd frontend; npx tsc -b; npx vitest run`
Expected: `tsc` clean; all tests pass (existing Sidebar tests still green — drag props have safe defaults).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Sidebar.tsx frontend/src/components/Sidebar.module.css
git commit -m "feat(frontend): Sidebar drag-and-drop folder reorder/re-nest"
```

---

### Task 9: Full verification + docs

**Files:**
- Modify: `Docs/superpowers/specs/2026-07-02-plastic-room-project-overview.md` (Phase 8 status + spec link)

- [ ] **Step 1: Full backend suite**

Run: `cd backend; dotnet test`
Expected: PASS (all tests, including the new folder tests).

- [ ] **Step 2: Full frontend suite + build**

Run: `cd frontend; npx tsc -b; npx vitest run; npm run build`
Expected: `tsc` clean, all Vitest tests pass, production build succeeds.

- [ ] **Step 3: In-browser walkthrough (human-verified)**

Start backend with seed data and the frontend dev server (see project memory: backend on `http://localhost:5102`, frontend on `http://localhost:5173`):

```bash
cd backend; $env:SEED_SAMPLE_DATA="true"; dotnet run --project PlasticRoom.Api
# separate shell:
cd frontend; npm run dev
```

Verify in the browser:
- A library folder shows a mono file count; a parent's chevron collapses/expands its children.
- Right-click a library folder → Rename → type → Enter commits; the new name persists after refresh.
- Drag a folder onto another → it re-nests under it; drag to a sibling position → it reorders. Reload the page and confirm the order/nesting persisted.
- Attempt to drop a folder onto its own child → nothing happens (no cycle).
- Right-click → Delete → confirm dialog copy is correct → Delete → the folder and its subfolders disappear; its files remain visible under All Files.
- COLLECTIONS folders show chevron + count but offer NO right-click menu and cannot be dragged.

- [ ] **Step 4: Update the project overview**

In `Docs/superpowers/specs/2026-07-02-plastic-room-project-overview.md`, update the Phase 8 entry `**Status:** Not started` → `**Status:** Complete` and set its `**Spec:**` line to `[Phase 8 — Folder Management](2026-07-06-phase-8-folder-management.md)`. Update the top-of-file `**Status:**` line to note all phases complete.

- [ ] **Step 5: Commit**

```bash
git add Docs/superpowers/specs/2026-07-02-plastic-room-project-overview.md
git commit -m "docs: mark Phase 8 folder management complete"
```

---

## Notes for the implementer

- **Server is the source of truth.** After every mutation (rename, reorder, delete) the Sidebar calls `reloadFolders()` (and `reloadFiles()` on delete); do not maintain a separate optimistic tree.
- **`buildFolderTree` already sorts by `sortOrder` then name** — no change needed there for reorders to render; persisted `SortOrder` from the batch endpoint flows through on reload.
- **Deferred (do not build):** keyboard/screen-reader move, cover images, per-folder description editing, descendant-inclusive counts, persisted collapse state, the dedicated full-screen Screen 6a layout. These are logged in `Docs/future-refinements.md`.
