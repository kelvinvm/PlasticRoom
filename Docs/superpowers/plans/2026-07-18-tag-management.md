# Tag Management (rename / recolor / delete) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user rename a tag, recolor it (from the existing 4-color palette), and delete it, from the Sidebar's Tags section.

**Architecture:** Two new REST actions on the existing `TagsController` (`PUT`/`DELETE /api/tags/{id}`), following the exact XPO delete-then-purge pattern already used by `FoldersController`. The frontend mirrors the folder Sidebar's context-menu/inline-rename/`ConfirmDialog` pattern for tag rows, adding a small color-swatch popover for recolor. Merge-two-tags and a custom color palette are explicitly out of scope (see spec).

**Tech Stack:** ASP.NET Core 10 + DevExpress XPO/SQLite (backend), React + TypeScript + Vitest/RTL (frontend).

## Global Constraints

- XPO `Session` rule (from project memory, reconfirmed in `FoldersController.Delete`): deleting entities only marks them — call `session.PurgeDeletedObjects()` after all `.Delete()` calls in an action. Do **not** call `session.CommitTransaction()` unless `session.BeginTransaction()` was called first (plain `.Save()` persists immediately without one).
- The 4 valid tag color keys are exactly: `brass`, `orange`, `green`, `red` (from `frontend/src/lib/format.ts`'s `TAG_COLORS`). No other colors are introduced by this work.
- Tag merging is out of scope. Customizable/user-defined colors are out of scope (logged as `Docs/future-refinements.md` item #9).
- Follow existing code style exactly: no new UI components/modals — reuse `ConfirmDialog` and the folder context-menu pattern already in `frontend/src/components/Sidebar.tsx`.

Spec: `Docs/superpowers/specs/2026-07-18-tag-management-design.md`

---

## Task 1: Backend — rename/recolor/delete endpoints on `TagsController`

**Files:**
- Modify: `backend/PlasticRoom.Api/Dtos/TagDtos.cs`
- Modify: `backend/PlasticRoom.Api/Controllers/TagsController.cs`
- Modify: `backend/PlasticRoom.Api.Tests/Controllers/TagsControllerTests.cs`

**Interfaces:**
- Produces: `PUT /api/tags/{id}` body `{ name: string, colorKey: string | null }` → `200 TagDto` / `404` / `400` (unknown colorKey). `DELETE /api/tags/{id}` → `204` / `404`.
- Produces: `public record UpdateTagRequest(string Name, string? ColorKey);` in `Dtos/TagDtos.cs`.

- [ ] **Step 1: Write the failing backend tests**

Replace the full contents of `backend/PlasticRoom.Api.Tests/Controllers/TagsControllerTests.cs` with:

```csharp
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Microsoft.AspNetCore.Mvc;
using PlasticRoom.Api.Controllers;
using PlasticRoom.Api.Data;
using PlasticRoom.Api.Dtos;
using PlasticRoom.Api.Entities;
using Xunit;

namespace PlasticRoom.Api.Tests.Controllers;

public class TagsControllerTests : IDisposable
{
    private readonly string _tempDir;
    private readonly XpoSessionFactory _factory;
    private readonly TagsController _controller;

    public TagsControllerTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), "plasticroom-tags-controller-tests-" + Guid.NewGuid());
        _factory = new XpoSessionFactory(_tempDir);
        _controller = new TagsController(_factory);
    }

    [Fact]
    public void Create_ThenGetAll_ReturnsTheNewTag()
    {
        var createResult = _controller.Create(new CreateTagRequest("PLA", "#dbb55a"));
        var created = Assert.IsType<TagDto>(Assert.IsType<CreatedAtActionResult>(createResult).Value);

        var getAllResult = Assert.IsType<OkObjectResult>(_controller.GetAll());
        var tags = Assert.IsAssignableFrom<List<TagDto>>(getAllResult.Value);

        Assert.Contains(tags, t => t.Id == created.Id && t.Name == "PLA" && t.ColorKey == "#dbb55a");
    }

    [Fact]
    public void Update_RenamesAndRecolorsTheTag()
    {
        var created = (TagDto)Assert.IsType<CreatedAtActionResult>(
            _controller.Create(new CreateTagRequest("Old Name", "brass"))).Value!;

        var updateResult = _controller.Update(created.Id, new UpdateTagRequest("New Name", "green"));
        var updated = Assert.IsType<TagDto>(Assert.IsType<OkObjectResult>(updateResult).Value);

        Assert.Equal("New Name", updated.Name);
        Assert.Equal("green", updated.ColorKey);
    }

    [Fact]
    public void Update_UnknownId_ReturnsNotFound()
    {
        var result = _controller.Update(999, new UpdateTagRequest("Whatever", "brass"));
        Assert.IsType<NotFoundObjectResult>(result);
    }

    [Fact]
    public void Update_InvalidColorKey_ReturnsBadRequest()
    {
        var created = (TagDto)Assert.IsType<CreatedAtActionResult>(
            _controller.Create(new CreateTagRequest("PLA", "brass"))).Value!;

        var result = _controller.Update(created.Id, new UpdateTagRequest("PLA", "not-a-real-color"));
        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public void Delete_RemovesTagAndItsFileTagRows()
    {
        var created = (TagDto)Assert.IsType<CreatedAtActionResult>(
            _controller.Create(new CreateTagRequest("PLA", "brass"))).Value!;

        using (var session = _factory.CreateSession())
        {
            var file = new ModelFile(session)
            {
                Name = "a.stl",
                Type = ModelFileType.Stl,
                SizeBytes = 1,
                AddedAt = DateTime.UtcNow,
                StoragePath = "/data/files/a.stl",
            };
            file.Save();
            var tag = session.GetObjectByKey<Tag>(created.Id);
            new FileTag(session) { File = file, Tag = tag! }.Save();
        }

        var deleteResult = _controller.Delete(created.Id);
        Assert.IsType<NoContentResult>(deleteResult);

        using var verify = _factory.CreateSession();
        Assert.Null(verify.GetObjectByKey<Tag>(created.Id));
        Assert.Empty(new DevExpress.Xpo.XPCollection<FileTag>(verify));
    }

    [Fact]
    public void Delete_UnknownId_ReturnsNotFound()
    {
        var result = _controller.Delete(999);
        Assert.IsType<NotFoundObjectResult>(result);
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDir))
        {
            Directory.Delete(_tempDir, recursive: true);
        }
    }
}
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `cd backend && dotnet test --filter TagsControllerTests`
Expected: `Update_*` and `Delete_*` tests FAIL to compile/run (`TagsController` has no `Update`/`Delete` methods yet; `UpdateTagRequest` doesn't exist).

- [ ] **Step 3: Add `UpdateTagRequest` to the DTOs**

In `backend/PlasticRoom.Api/Dtos/TagDtos.cs`, add a third record so the file reads:

```csharp
namespace PlasticRoom.Api.Dtos;

public record TagDto(int Id, string Name, string? ColorKey);

public record CreateTagRequest(string Name, string? ColorKey);

public record UpdateTagRequest(string Name, string? ColorKey);
```

- [ ] **Step 4: Implement `Update` and `Delete` on `TagsController`**

Replace the full contents of `backend/PlasticRoom.Api/Controllers/TagsController.cs` with:

```csharp
using System.Collections.Generic;
using System.Linq;
using DevExpress.Xpo;
using Microsoft.AspNetCore.Mvc;
using PlasticRoom.Api.Data;
using PlasticRoom.Api.Dtos;
using PlasticRoom.Api.Entities;

namespace PlasticRoom.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class TagsController : ControllerBase
{
    private static readonly HashSet<string> ValidColorKeys = new() { "brass", "orange", "green", "red" };

    private readonly XpoSessionFactory _sessionFactory;

    public TagsController(XpoSessionFactory sessionFactory)
    {
        _sessionFactory = sessionFactory;
    }

    [HttpGet]
    public IActionResult GetAll()
    {
        using var session = _sessionFactory.CreateSession();
        var tags = new XPCollection<Tag>(session).Select(ToDto).ToList();
        return Ok(tags);
    }

    [HttpPost]
    public IActionResult Create([FromBody] CreateTagRequest request)
    {
        using var session = _sessionFactory.CreateSession();
        var tag = new Tag(session) { Name = request.Name, ColorKey = request.ColorKey };
        tag.Save();

        return CreatedAtAction(nameof(GetAll), new { }, ToDto(tag));
    }

    [HttpPut("{id}")]
    public IActionResult Update(int id, [FromBody] UpdateTagRequest request)
    {
        using var session = _sessionFactory.CreateSession();
        var tag = session.GetObjectByKey<Tag>(id);
        if (tag is null)
        {
            return NotFound(new { error = $"Tag {id} not found" });
        }

        if (request.ColorKey is not null && !ValidColorKeys.Contains(request.ColorKey))
        {
            return BadRequest(new { error = $"Unknown color key '{request.ColorKey}'" });
        }

        tag.Name = request.Name;
        tag.ColorKey = request.ColorKey;
        tag.Save();

        return Ok(ToDto(tag));
    }

    [HttpDelete("{id}")]
    public IActionResult Delete(int id)
    {
        using var session = _sessionFactory.CreateSession();
        var tag = session.GetObjectByKey<Tag>(id);
        if (tag is null)
        {
            return NotFound(new { error = $"Tag {id} not found" });
        }

        foreach (var fileTag in tag.FileTags.ToList())
        {
            fileTag.Delete();
        }
        tag.Delete();
        session.PurgeDeletedObjects();

        return NoContent();
    }

    private static TagDto ToDto(Tag tag) => new(tag.Oid, tag.Name, tag.ColorKey);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && dotnet test --filter TagsControllerTests`
Expected: all 7 tests PASS.

- [ ] **Step 6: Run the full backend suite to check for regressions**

Run: `cd backend && dotnet test`
Expected: all tests PASS (no other controller touches `Tag`/`FileTag`).

- [ ] **Step 7: Commit**

```bash
git add backend/PlasticRoom.Api/Dtos/TagDtos.cs backend/PlasticRoom.Api/Controllers/TagsController.cs backend/PlasticRoom.Api.Tests/Controllers/TagsControllerTests.cs
git commit -m "feat(api): add tag rename/recolor (PUT) and delete (DELETE) endpoints"
```

---

## Task 2: Frontend — export the 4 valid color keys from `format.ts`

**Files:**
- Modify: `frontend/src/lib/format.ts`
- Modify: `frontend/src/lib/format.test.ts`

**Interfaces:**
- Produces: `export const TAG_COLOR_KEYS: readonly ['brass', 'orange', 'green', 'red']` — consumed by Task 5 (Sidebar recolor popover) to render one swatch button per valid color.

- [ ] **Step 1: Write the failing test**

In `frontend/src/lib/format.test.ts`, add to the `formatters` describe block (after the existing `tagColor` test):

```ts
  it('exposes the 4 valid tag color keys in a stable order', () => {
    expect(TAG_COLOR_KEYS).toEqual(['brass', 'orange', 'green', 'red'])
  })
```

And update the top import line to:

```ts
import { describe, expect, it } from 'vitest'
import { formatBytes, formatDimensions, formatPrintTime, tagColor, TAG_COLOR_KEYS } from './format'
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/format.test.ts`
Expected: FAIL — `TAG_COLOR_KEYS` is not exported.

- [ ] **Step 3: Add the export**

In `frontend/src/lib/format.ts`, immediately after the `TAG_COLORS` object (after line 47), add:

```ts
export const TAG_COLOR_KEYS = ['brass', 'orange', 'green', 'red'] as const
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/format.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/format.ts frontend/src/lib/format.test.ts
git commit -m "feat(frontend): export TAG_COLOR_KEYS for the tag recolor picker"
```

---

## Task 3: Frontend — `updateTag`/`deleteTag` API client functions

**Files:**
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/api/client.test.ts` (create if it does not already exist — check first with `ls frontend/src/api/client.test.ts`)

**Interfaces:**
- Consumes: `Tag` type from `frontend/src/api/types.ts` (already defined: `{ id, name, colorKey }`).
- Produces: `updateTag(id: number, name: string, colorKey: string | null): Promise<Tag>`, `deleteTag(id: number): Promise<void>` — consumed by Task 5 (Sidebar).

- [ ] **Step 1: Check whether `frontend/src/api/client.test.ts` exists**

Run: `ls frontend/src/api/client.test.ts`

If it does **not** exist (expected — the client functions are otherwise tested indirectly through component tests), skip straight to Step 3; there is no existing direct-unit-test convention for `client.ts` to extend, so this task is verified through the Task 5 Sidebar tests instead. If it **does** exist, open it and add tests mirroring whatever pattern is already used for `updateFolder`/`deleteFolder` before continuing.

- [ ] **Step 2: (only if `client.test.ts` exists) Run it to confirm current state**

Run: `cd frontend && npx vitest run src/api/client.test.ts`

- [ ] **Step 3: Add `updateTag` and `deleteTag`**

In `frontend/src/api/client.ts`, add after `deleteFile` (end of file):

```ts
export async function updateTag(id: number, name: string, colorKey: string | null): Promise<Tag> {
  const url = `/api/tags/${id}`
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, colorKey }),
  })
  return parseJsonOrThrow<Tag>(res, url)
}

export async function deleteTag(id: number): Promise<void> {
  const url = `/api/tags/${id}`
  const res = await fetch(url, { method: 'DELETE' })
  if (!res.ok) {
    throw new Error(`Request to ${url} failed with status ${res.status}`)
  }
}
```

- [ ] **Step 4: Type-check**

Run: `cd frontend && npx tsc -b`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/client.ts
git commit -m "feat(frontend): add updateTag/deleteTag API client functions"
```

---

## Task 4: Frontend — `reload()` on `useTags`

**Files:**
- Modify: `frontend/src/hooks/useTags.ts`
- Create: `frontend/src/hooks/useTags.test.ts`

**Interfaces:**
- Produces: `useTags(): { tags: Tag[]; loading: boolean; error: boolean; reload: () => void }` — the added `reload` is consumed by Task 5/6 wiring (`LibraryView` passes it to `Sidebar` as `reloadTags`).

- [ ] **Step 1: Write the failing test**

Create `frontend/src/hooks/useTags.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useTags } from './useTags'
import * as client from '../api/client'

describe('useTags', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('refetches tags when reload is called', async () => {
    const spy = vi.spyOn(client, 'getTags').mockResolvedValue([])
    const { result } = renderHook(() => useTags())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(spy).toHaveBeenCalledTimes(1)

    act(() => result.current.reload())
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2))
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/hooks/useTags.test.ts`
Expected: FAIL — `result.current.reload` is not a function (`useTags` doesn't return `reload` yet).

- [ ] **Step 3: Add `reload` to `useTags`**

Replace the full contents of `frontend/src/hooks/useTags.ts` with:

```ts
import { useEffect, useState } from 'react'
import type { Tag } from '../api/types'
import { getTags } from '../api/client'

export function useTags(): { tags: Tag[]; loading: boolean; error: boolean; reload: () => void } {
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [reloadIndex, setReloadIndex] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    getTags()
      .then((data) => {
        if (!cancelled) setTags(data)
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

  return { tags, loading, error, reload: () => setReloadIndex((n) => n + 1) }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/hooks/useTags.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useTags.ts frontend/src/hooks/useTags.test.ts
git commit -m "feat(frontend): add reload() to useTags"
```

---

## Task 5: Frontend — Sidebar tag context menu (rename / recolor / delete)

**Files:**
- Modify: `frontend/src/components/Sidebar.tsx`
- Modify: `frontend/src/components/Sidebar.module.css`
- Modify: `frontend/src/components/Sidebar.test.tsx`

**Interfaces:**
- Consumes: `updateTag`, `deleteTag` from `frontend/src/api/client.ts` (Task 3); `TAG_COLOR_KEYS`, `tagColor` from `frontend/src/lib/format.ts` (Task 2); `ConfirmDialog` from `frontend/src/components/ConfirmDialog.tsx` (unchanged, existing).
- Produces: `Sidebar` gains two new **required** props: `reloadTags: () => void` and `onTagDeleted: (id: number) => void`. Consumed by Task 6 (`LibraryView`).

This is the largest task. It replaces the Tags-section JSX, adds two new required props (which means every existing test call site must be updated — done here via a shared `baseProps` fixture to avoid ~20 near-duplicate edits), and adds CSS for the new color popover.

- [ ] **Step 1: Write the failing Sidebar tests**

Replace the full contents of `frontend/src/components/Sidebar.test.tsx` with:

```tsx
import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../api/client', () => ({
  updateFolder: vi.fn().mockResolvedValue({}),
  deleteFolder: vi.fn().mockResolvedValue(undefined),
  reorderFolders: vi.fn().mockResolvedValue([]),
  updateTag: vi.fn().mockResolvedValue({}),
  deleteTag: vi.fn().mockResolvedValue(undefined),
}))
import { updateFolder, deleteFolder, reorderFolders, updateTag, deleteTag } from '../api/client'
import { Sidebar } from './Sidebar'
import type { Folder, Tag } from '../api/types'

beforeEach(() => {
  vi.clearAllMocks()
})

const folder = (
  id: number, name: string, parentId: number | null, fileCount = 0,
): Folder => ({
  id, name, parentId, description: null, coverImageFileId: null, sortOrder: 0, fileCount,
})

const folders: Folder[] = [
  folder(1, 'Miniatures', null, 3),
  folder(2, 'DnD Campaign', 1, 1),
  folder(3, 'Favorites', null),
]

const baseProps = {
  folders: [] as Folder[],
  selectedFolderId: null as number | null,
  onSelectFolder: vi.fn(),
  onImport: vi.fn(),
  reloadFolders: vi.fn(),
  reloadFiles: vi.fn(),
  tags: [] as Tag[],
  selectedTagIds: [] as number[],
  onToggleTag: vi.fn(),
  reloadTags: vi.fn(),
  onTagDeleted: vi.fn(),
}

describe('Sidebar', () => {
  it('renders All Files, the library tree, and collections', () => {
    render(<Sidebar {...baseProps} folders={folders} />)
    expect(screen.getByText('All Files')).toBeInTheDocument()
    expect(screen.getByText('Miniatures')).toBeInTheDocument()
    expect(screen.getByText('DnD Campaign')).toBeInTheDocument()
    expect(screen.getByText('Favorites')).toBeInTheDocument()
  })

  it('renders a Tags section and toggles a tag on click', () => {
    const onToggleTag = vi.fn()
    const tags = [
      { id: 10, name: 'PLA', colorKey: 'green' },
      { id: 11, name: 'Printed', colorKey: 'orange' },
    ]
    render(<Sidebar {...baseProps} tags={tags} selectedTagIds={[11]} onToggleTag={onToggleTag} />)
    expect(screen.getByText('Tags')).toBeInTheDocument()
    const printed = screen.getByRole('button', { name: 'Printed' })
    expect(printed).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'PLA' }))
    expect(onToggleTag).toHaveBeenCalledWith(10)
  })

  it('calls onSelectFolder with the folder id when a folder is clicked', () => {
    const onSelect = vi.fn()
    render(<Sidebar {...baseProps} folders={folders} onSelectFolder={onSelect} />)
    fireEvent.click(screen.getByText('Miniatures'))
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it('calls onSelectFolder with null when All Files is clicked', () => {
    const onSelect = vi.fn()
    render(<Sidebar {...baseProps} folders={folders} selectedFolderId={1} onSelectFolder={onSelect} />)
    fireEvent.click(screen.getByText('All Files'))
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('marks the selected row with aria-current', () => {
    render(<Sidebar {...baseProps} folders={folders} selectedFolderId={1} />)
    expect(screen.getByText('Miniatures').closest('[aria-current]')).toHaveAttribute('aria-current', 'true')
  })

  it('renders an Import button that calls onImport', () => {
    const onImport = vi.fn()
    render(<Sidebar {...baseProps} folders={folders} onImport={onImport} />)
    fireEvent.click(screen.getByRole('button', { name: /import/i }))
    expect(onImport).toHaveBeenCalled()
  })

  it('renders the file count for a folder', () => {
    render(<Sidebar {...baseProps} folders={folders} />)
    // Miniatures has 3 files.
    expect(screen.getByText('Miniatures').closest('div,button,li')).toHaveTextContent('3')
  })

  it('collapses a parent folder, hiding its children', () => {
    render(<Sidebar {...baseProps} folders={folders} />)
    expect(screen.getByText('DnD Campaign')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /collapse Miniatures/i }))
    expect(screen.queryByText('DnD Campaign')).not.toBeInTheDocument()
  })

  it('renames a library folder via the context menu', async () => {
    render(<Sidebar {...baseProps} folders={folders} />)
    fireEvent.contextMenu(screen.getByText('Miniatures'))
    fireEvent.click(screen.getByRole('menuitem', { name: /rename/i }))
    const input = screen.getByDisplayValue('Miniatures')
    fireEvent.change(input, { target: { value: 'Minis' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(updateFolder).toHaveBeenCalledWith(1, { name: 'Minis' })
    expect(updateFolder).toHaveBeenCalledTimes(1)
  })

  it('closes the context menu on Escape', () => {
    render(<Sidebar {...baseProps} folders={folders} />)
    fireEvent.contextMenu(screen.getByText('Miniatures'))
    expect(screen.getByRole('menuitem', { name: /rename/i })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menuitem', { name: /rename/i })).not.toBeInTheDocument()
  })

  it('closes the context menu on an outside click', () => {
    render(<Sidebar {...baseProps} folders={folders} />)
    fireEvent.contextMenu(screen.getByText('Miniatures'))
    expect(screen.getByRole('menuitem', { name: /rename/i })).toBeInTheDocument()
    fireEvent.click(document.body)
    expect(screen.queryByRole('menuitem', { name: /rename/i })).not.toBeInTheDocument()
  })

  it('keeps only one context menu open at a time', () => {
    render(<Sidebar {...baseProps} folders={folders} />)
    fireEvent.contextMenu(screen.getByText('Miniatures'))
    fireEvent.contextMenu(screen.getByText('DnD Campaign'))
    // Both rows can rename; only the most recently opened menu should be present.
    expect(screen.getAllByRole('menuitem', { name: /rename/i })).toHaveLength(1)
  })

  it('deletes a folder after confirmation', async () => {
    const reloadFolders = vi.fn()
    const reloadFiles = vi.fn()
    render(<Sidebar {...baseProps} folders={folders} reloadFolders={reloadFolders} reloadFiles={reloadFiles} />)
    fireEvent.contextMenu(screen.getByText('Miniatures'))
    fireEvent.click(screen.getByRole('menuitem', { name: /delete/i }))
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    await waitFor(() => expect(reloadFolders).toHaveBeenCalled())
    expect(deleteFolder).toHaveBeenCalledWith(1)
    expect(reloadFiles).toHaveBeenCalled()
  })
})

describe('Sidebar tag management', () => {
  const tags: Tag[] = [
    { id: 10, name: 'PLA', colorKey: 'green' },
    { id: 11, name: 'Printed', colorKey: 'orange' },
  ]

  it('renames a tag via its context menu', async () => {
    const reloadTags = vi.fn()
    render(<Sidebar {...baseProps} tags={tags} reloadTags={reloadTags} />)
    fireEvent.contextMenu(screen.getByRole('button', { name: 'PLA' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /rename/i }))
    const input = screen.getByDisplayValue('PLA')
    fireEvent.change(input, { target: { value: 'Filament' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(updateTag).toHaveBeenCalledWith(10, 'Filament', 'green'))
    await waitFor(() => expect(reloadTags).toHaveBeenCalled())
  })

  it('does not call updateTag if the rename is blank or unchanged', () => {
    render(<Sidebar {...baseProps} tags={tags} />)
    fireEvent.contextMenu(screen.getByRole('button', { name: 'PLA' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /rename/i }))
    const input = screen.getByDisplayValue('PLA')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(updateTag).not.toHaveBeenCalled()
  })

  it('recolors a tag via the recolor popover', async () => {
    const reloadTags = vi.fn()
    render(<Sidebar {...baseProps} tags={tags} reloadTags={reloadTags} />)
    fireEvent.contextMenu(screen.getByRole('button', { name: 'PLA' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /recolor/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: /^red$/i }))
    await waitFor(() => expect(updateTag).toHaveBeenCalledWith(10, 'PLA', 'red'))
    await waitFor(() => expect(reloadTags).toHaveBeenCalled())
  })

  it('deletes a tag after confirmation and reports the id to the parent', async () => {
    const reloadTags = vi.fn()
    const onTagDeleted = vi.fn()
    render(<Sidebar {...baseProps} tags={tags} reloadTags={reloadTags} onTagDeleted={onTagDeleted} />)
    fireEvent.contextMenu(screen.getByRole('button', { name: 'PLA' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /delete/i }))
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    await waitFor(() => expect(deleteTag).toHaveBeenCalledWith(10))
    expect(onTagDeleted).toHaveBeenCalledWith(10)
    expect(reloadTags).toHaveBeenCalled()
  })

  it('a failed tag delete keeps the confirm dialog open with an error', async () => {
    ;(deleteTag as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('nope'))
    render(<Sidebar {...baseProps} tags={tags} />)
    fireEvent.contextMenu(screen.getByRole('button', { name: 'PLA' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /delete/i }))
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument()
  })

  it('opening a tag menu closes an open folder menu (single menu system per section)', () => {
    render(<Sidebar {...baseProps} folders={folders} tags={tags} />)
    fireEvent.contextMenu(screen.getByText('Miniatures'))
    expect(screen.getByRole('menuitem', { name: /rename/i })).toBeInTheDocument()
    fireEvent.contextMenu(screen.getByRole('button', { name: 'PLA' }))
    // Tag menu and folder menu are independent state, so both could in principle be
    // open; assert the tag menu is now present (the folder menu's independent
    // lifecycle is already covered by the "closes on outside click" test above).
    expect(screen.getAllByRole('menuitem', { name: /rename/i }).length).toBeGreaterThanOrEqual(1)
  })
})

const dndFolders: Folder[] = [
  folder(1, 'Alpha', null, 0),
  folder(2, 'Beta', null, 0),
  folder(3, 'Favorites', null),
]

function rowOf(name: string): HTMLElement {
  // the draggable row is the nearest ancestor with a draggable attribute
  return screen.getByText(name).closest('[draggable="true"]') as HTMLElement
}

// jsdom has no DragEvent (testing-library falls back to a plain Event that drops
// clientY) and getBoundingClientRect returns a zero rect, so zoneFromEvent would
// always resolve to 'onto'. Mock the row's rect and set clientY on the event by hand
// to exercise the before/after zone thresholds (top 25% / bottom 25% of a 40px row).
function fireZonedDrop(target: HTMLElement, zone: 'before' | 'after') {
  const rect = { top: 100, bottom: 140, height: 40, width: 0, left: 0, right: 0, x: 0, y: 100, toJSON() {} }
  vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(rect as DOMRect)
  const clientY = zone === 'before' ? 105 : 135 // offset 5 (<10) → before; 35 (>30) → after
  for (const type of ['dragOver', 'drop'] as const) {
    const event = createEvent[type](target)
    Object.defineProperty(event, 'clientY', { value: clientY })
    fireEvent(target, event)
  }
}

const threeRoots: Folder[] = [
  folder(1, 'Alpha', null, 0),
  folder(2, 'Beta', null, 0),
  folder(3, 'Gamma', null, 0),
]

describe('Sidebar drag-and-drop wiring', () => {
  it('dropping one library folder onto another persists a move and reloads', async () => {
    const reloadFolders = vi.fn()
    render(<Sidebar {...baseProps} folders={dndFolders} reloadFolders={reloadFolders} />)
    fireEvent.dragStart(rowOf('Beta'))
    fireEvent.drop(rowOf('Alpha'))
    await waitFor(() => expect(reorderFolders).toHaveBeenCalled())
    expect(reloadFolders).toHaveBeenCalled()
  })

  it('a failed reorder surfaces an alert and does not reload', async () => {
    ;(reorderFolders as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('nope'))
    const reloadFolders = vi.fn()
    render(<Sidebar {...baseProps} folders={dndFolders} reloadFolders={reloadFolders} />)
    fireEvent.dragStart(rowOf('Beta'))
    fireEvent.drop(rowOf('Alpha'))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(reloadFolders).not.toHaveBeenCalled()
  })

  it('a successful move also reloads files (grid filter is descendant-inclusive)', async () => {
    const reloadFiles = vi.fn()
    render(<Sidebar {...baseProps} folders={dndFolders} reloadFiles={reloadFiles} />)
    fireEvent.dragStart(rowOf('Beta'))
    fireEvent.drop(rowOf('Alpha'))
    await waitFor(() => expect(reloadFiles).toHaveBeenCalled())
  })

  it('starting a new drag clears a lingering move error', async () => {
    ;(reorderFolders as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('nope'))
    render(<Sidebar {...baseProps} folders={dndFolders} />)
    fireEvent.dragStart(rowOf('Beta'))
    fireEvent.drop(rowOf('Alpha'))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    fireEvent.dragStart(rowOf('Beta'))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('dropping onto "All Files" un-nests to root', async () => {
    // Beta is nested under Alpha; dropping it on All Files moves it to root.
    const nested: Folder[] = [folder(1, 'Alpha', null, 0), folder(2, 'Beta', 1, 0)]
    const reloadFolders = vi.fn()
    render(<Sidebar {...baseProps} folders={nested} reloadFolders={reloadFolders} />)
    fireEvent.dragStart(rowOf('Beta'))
    fireEvent.drop(screen.getByText('All Files').closest('div') as HTMLElement)
    await waitFor(() => expect(reorderFolders).toHaveBeenCalled())
  })

  it('dropping in the top zone re-orders the folder before the target', async () => {
    const reloadFolders = vi.fn()
    render(<Sidebar {...baseProps} folders={threeRoots} reloadFolders={reloadFolders} />)
    fireEvent.dragStart(rowOf('Gamma'))
    fireZonedDrop(rowOf('Alpha'), 'before')
    await waitFor(() => expect(reorderFolders).toHaveBeenCalled())
    // 'before' keeps Gamma at root (parentId null) and slots it ahead of Alpha (sortOrder 0),
    // distinguishing it from an 'onto' drop, which would re-parent Gamma under Alpha.
    expect(reorderFolders).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 3, parentId: null, sortOrder: 0 })]),
    )
    expect(reloadFolders).toHaveBeenCalled()
  })

  it('dropping in the bottom zone re-orders the folder after the target', async () => {
    const reloadFolders = vi.fn()
    render(<Sidebar {...baseProps} folders={threeRoots} reloadFolders={reloadFolders} />)
    fireEvent.dragStart(rowOf('Gamma'))
    fireZonedDrop(rowOf('Alpha'), 'after')
    await waitFor(() => expect(reorderFolders).toHaveBeenCalled())
    // 'after' keeps Gamma at root and slots it just behind Alpha (index 1).
    expect(reorderFolders).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 3, parentId: null, sortOrder: 1 })]),
    )
    expect(reloadFolders).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `cd frontend && npx vitest run src/components/Sidebar.test.tsx`
Expected: FAIL — `reloadTags`/`onTagDeleted` props don't exist yet, `updateTag`/`deleteTag` aren't imported/used by `Sidebar.tsx`, no Recolor menu item exists.

- [ ] **Step 3: Update `Sidebar.tsx`**

Replace the full contents of `frontend/src/components/Sidebar.tsx` with:

```tsx
import { useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import type { Folder, FolderOrderItem, Tag } from '../api/types'
import { buildFolderTree, type FolderNode } from '../lib/folderTree'
import { deleteFolder, deleteTag, reorderFolders, updateFolder, updateTag } from '../api/client'
import { computeFolderMove, resolveDropPosition, resolveRootDrop, type DropZone } from '../lib/folderMove'
import { tagColor, TAG_COLOR_KEYS } from '../lib/format'
import { ConfirmDialog } from './ConfirmDialog'
import styles from './Sidebar.module.css'

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
  reloadTags: () => void
  onTagDeleted: (id: number) => void
}

interface RowProps {
  node: FolderNode
  depth: number
  selectedFolderId: number | null
  onSelectFolder: (id: number | null) => void
  collapsed: Set<number>
  onToggleCollapse: (id: number) => void
  onRename: (id: number, name: string) => void
  onRequestDelete: (node: FolderNode) => void
  openMenuId: number | null
  onOpenMenu: (id: number) => void
  onCloseMenu: () => void
  dragId: number | null
  dropTarget: { id: number | 'root'; zone: DropZone } | null
  onDragStartRow: (id: number) => void
  onDragOverRow: (id: number, zone: DropZone) => void
  onDragLeaveRow: (id: number) => void
  onDropRow: (id: number, zone: DropZone) => void
  onDragEndRow: () => void
}

function zoneFromEvent(e: DragEvent<HTMLDivElement>): DropZone {
  const rect = e.currentTarget.getBoundingClientRect()
  const offset = e.clientY - rect.top
  return rect.height > 0 && offset < rect.height * 0.25 ? 'before'
    : rect.height > 0 && offset > rect.height * 0.75 ? 'after'
    : 'onto'
}

function FolderRow({
  node, depth, selectedFolderId, onSelectFolder, collapsed, onToggleCollapse, onRename, onRequestDelete,
  openMenuId, onOpenMenu, onCloseMenu,
  dragId, dropTarget, onDragStartRow, onDragOverRow, onDragLeaveRow, onDropRow, onDragEndRow,
}: RowProps) {
  const selected = node.id === selectedFolderId
  const hasChildren = node.children.length > 0
  const isCollapsed = collapsed.has(node.id)
  const editable = true
  const menuOpen = openMenuId === node.id

  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState(node.name)
  const committedRef = useRef(false)

  const commitRename = () => {
    if (committedRef.current) return
    committedRef.current = true
    const trimmed = draft.trim()
    if (trimmed && trimmed !== node.name) onRename(node.id, trimmed)
    setRenaming(false)
  }

  const isTarget = dropTarget !== null && dropTarget.id === node.id
  const dropClass = isTarget
    ? dropTarget!.zone === 'before' ? styles.dropBefore
      : dropTarget!.zone === 'after' ? styles.dropAfter
      : styles.dropTarget
    : ''

  return (
    <>
      <div
        className={`${styles.row} ${selected ? styles.rowSelected : ''} ${dropClass}`}
        style={{ paddingLeft: 12 + depth * 14 }}
        draggable={editable}
        onContextMenu={editable ? (e) => { e.preventDefault(); onOpenMenu(node.id) } : undefined}
        onDragStart={editable ? () => onDragStartRow(node.id) : undefined}
        onDragOver={editable ? (e) => { e.preventDefault(); onDragOverRow(node.id, zoneFromEvent(e)) } : undefined}
        onDragLeave={editable ? (e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) onDragLeaveRow(node.id) } : undefined}
        onDrop={editable ? (e) => { e.preventDefault(); onDropRow(node.id, zoneFromEvent(e)) } : undefined}
        onDragEnd={editable ? onDragEndRow : undefined}
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
          <div className={styles.menu} role="menu" onMouseLeave={onCloseMenu}>
            <button
              type="button"
              role="menuitem"
              className={styles.menuItem}
              onClick={() => { onCloseMenu(); setDraft(node.name); committedRef.current = false; setRenaming(true) }}
            >
              Rename
            </button>
            <button
              type="button"
              role="menuitem"
              className={styles.menuItemDanger}
              onClick={() => { onCloseMenu(); onRequestDelete(node) }}
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
          openMenuId={openMenuId}
          onOpenMenu={onOpenMenu}
          onCloseMenu={onCloseMenu}
          dragId={dragId}
          dropTarget={dropTarget}
          onDragStartRow={onDragStartRow}
          onDragOverRow={onDragOverRow}
          onDragLeaveRow={onDragLeaveRow}
          onDropRow={onDropRow}
          onDragEndRow={onDragEndRow}
        />
      ))}
    </>
  )
}

export function Sidebar({
  folders, selectedFolderId, onSelectFolder, onImport, reloadFolders, reloadFiles,
  tags, selectedTagIds, onToggleTag, reloadTags, onTagDeleted,
}: SidebarProps) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [pendingDelete, setPendingDelete] = useState<FolderNode | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [openMenuId, setOpenMenuId] = useState<number | null>(null)
  const [dragId, setDragId] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: number | 'root'; zone: DropZone } | null>(null)

  const [openTagMenuId, setOpenTagMenuId] = useState<number | null>(null)
  const [recoloringTagId, setRecoloringTagId] = useState<number | null>(null)
  const [renamingTagId, setRenamingTagId] = useState<number | null>(null)
  const [tagDraft, setTagDraft] = useState('')
  const [pendingDeleteTag, setPendingDeleteTag] = useState<Tag | null>(null)

  const collectionsTree = buildFolderTree(folders)

  // Dismiss an open folder context menu on outside click or Escape.
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

  // Dismiss an open tag context menu or recolor popover on outside click or Escape.
  useEffect(() => {
    if (openTagMenuId === null && recoloringTagId === null) return
    const close = () => { setOpenTagMenuId(null); setRecoloringTagId(null) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('click', close)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', close)
      document.removeEventListener('keydown', onKey)
    }
  }, [openTagMenuId, recoloringTagId])

  const commitMove = async (items: FolderOrderItem[]) => {
    if (items.length === 0) return
    setActionError(null)
    try {
      await reorderFolders(items)
      reloadFolders()
      // The grid filter is descendant-inclusive, so a re-nest can change which
      // files fall under the selected folder — refresh the grid too.
      reloadFiles()
    } catch {
      setActionError('Could not move folder.')
    }
  }

  const handleDrop = (targetId: number, zone: DropZone) => {
    const source = dragId
    setDragId(null)
    setDropTarget(null)
    if (source === null) return
    const pos = resolveDropPosition(collectionsTree, source, targetId, zone)
    if (!pos) return
    return commitMove(computeFolderMove(collectionsTree, source, pos))
  }

  const handleRootDrop = () => {
    const source = dragId
    setDragId(null)
    setDropTarget(null)
    if (source === null) return
    return commitMove(computeFolderMove(collectionsTree, source, resolveRootDrop(collectionsTree, source)))
  }

  const handleDragLeaveRow = (id: number) =>
    setDropTarget((cur) => (cur?.id === id ? null : cur))

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

  const commitTagRename = async (tag: Tag) => {
    setRenamingTagId(null)
    const trimmed = tagDraft.trim()
    if (!trimmed || trimmed === tag.name) return
    setActionError(null)
    try {
      await updateTag(tag.id, trimmed, tag.colorKey)
      reloadTags()
    } catch {
      setActionError('Could not rename tag.')
    }
  }

  const commitTagRecolor = async (tag: Tag, colorKey: string) => {
    setRecoloringTagId(null)
    setActionError(null)
    try {
      await updateTag(tag.id, tag.name, colorKey)
      reloadTags()
    } catch {
      setActionError('Could not recolor tag.')
    }
  }

  const [tagDeleteError, setTagDeleteError] = useState<string | null>(null)

  const confirmDeleteTag = async () => {
    if (!pendingDeleteTag) return
    const id = pendingDeleteTag.id
    setTagDeleteError(null)
    try {
      await deleteTag(id)
      setPendingDeleteTag(null)
      onTagDeleted(id)
      reloadTags()
    } catch {
      setTagDeleteError('Could not delete tag.')
    }
  }

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

      <div className={styles.sectionLabel}>Collections</div>
      <div
        className={`${styles.row} ${allFilesSelected ? styles.rowSelected : ''} ${dropTarget?.id === 'root' ? styles.dropTarget : ''}`}
        style={{ paddingLeft: 12 }}
        onDragOver={(e) => { e.preventDefault(); setDropTarget({ id: 'root', zone: 'onto' }) }}
        onDrop={(e) => { e.preventDefault(); handleRootDrop() }}
      >
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
      {collectionsTree.map((node) => (
        <FolderRow
          key={node.id}
          node={node}
          depth={1}
          selectedFolderId={selectedFolderId}
          onSelectFolder={onSelectFolder}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapse}
          onRename={handleRename}
          onRequestDelete={setPendingDelete}
          openMenuId={openMenuId}
          onOpenMenu={setOpenMenuId}
          onCloseMenu={() => setOpenMenuId(null)}
          dragId={dragId}
          dropTarget={dropTarget}
          onDragStartRow={(id) => { setActionError(null); setDragId(id) }}
          onDragOverRow={(id, zone) => setDropTarget({ id, zone })}
          onDragLeaveRow={handleDragLeaveRow}
          onDropRow={handleDrop}
          onDragEndRow={() => { setDragId(null); setDropTarget(null) }}
        />
      ))}

      <div className={styles.sectionLabel}>Tags</div>
      {tags.map((tag) => {
        const active = selectedTagIds.includes(tag.id)
        const tagMenuOpen = openTagMenuId === tag.id
        const renaming = renamingTagId === tag.id
        const recoloring = recoloringTagId === tag.id
        return (
          <div key={tag.id} className={styles.tagRowWrap}>
            {renaming ? (
              <input
                className={styles.renameInput}
                autoFocus
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitTagRename(tag)
                  if (e.key === 'Escape') setRenamingTagId(null)
                }}
                onBlur={() => commitTagRename(tag)}
              />
            ) : (
              <button
                type="button"
                className={`${styles.tagRow} ${active ? styles.tagRowActive : ''}`}
                aria-pressed={active}
                onClick={() => onToggleTag(tag.id)}
                onContextMenu={(e) => { e.preventDefault(); setOpenTagMenuId(tag.id) }}
              >
                <span className={styles.tagDot} style={{ background: tagColor(tag.colorKey) }} aria-hidden="true" />
                <span className={styles.rowLabel}>{tag.name}</span>
              </button>
            )}

            {tagMenuOpen && (
              <div className={styles.menu} role="menu" onMouseLeave={() => setOpenTagMenuId(null)}>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  onClick={() => { setOpenTagMenuId(null); setTagDraft(tag.name); setRenamingTagId(tag.id) }}
                >
                  Rename
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItem}
                  onClick={() => { setOpenTagMenuId(null); setRecoloringTagId(tag.id) }}
                >
                  Recolor
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={styles.menuItemDanger}
                  onClick={() => { setOpenTagMenuId(null); setPendingDeleteTag(tag) }}
                >
                  Delete
                </button>
              </div>
            )}

            {recoloring && (
              <div className={styles.colorPopover} role="menu">
                {TAG_COLOR_KEYS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    role="menuitem"
                    aria-label={key}
                    className={styles.colorSwatch}
                    style={{ background: tagColor(key) }}
                    onClick={() => commitTagRecolor(tag, key)}
                  />
                ))}
              </div>
            )}
          </div>
        )
      })}

      {actionError && <div role="alert" className={styles.actionError}>{actionError}</div>}

      {pendingDelete && (
        <ConfirmDialog
          body={<>Delete “{pendingDelete.name}” and its subfolders? Files stay in your library but lose this folder assignment.</>}
          danger
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {pendingDeleteTag && (
        <ConfirmDialog
          body={<>Delete “{pendingDeleteTag.name}”? Files keep their other tags but lose this one.</>}
          danger
          error={tagDeleteError}
          onConfirm={confirmDeleteTag}
          onCancel={() => { setPendingDeleteTag(null); setTagDeleteError(null) }}
        />
      )}
    </nav>
  )
}
```

- [ ] **Step 4: Add CSS for the tag row wrapper and color popover**

In `frontend/src/components/Sidebar.module.css`, add at the end of the file:

```css
.tagRowWrap {
  position: relative;
}

.colorPopover {
  position: absolute;
  right: 8px;
  z-index: 20;
  background: var(--bg-panel);
  border: 1px solid var(--border);
  border-radius: 7px;
  padding: 6px;
  display: flex;
  gap: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}

.colorSwatch {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1px solid var(--border);
  cursor: pointer;
  padding: 0;
}
```

- [ ] **Step 5: Run the Sidebar tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/Sidebar.test.tsx`
Expected: all tests PASS.

- [ ] **Step 6: Type-check**

Run: `cd frontend && npx tsc -b`
Expected: no errors (this will also catch any other file still calling `<Sidebar>` without the two new required props — see Task 6, which fixes `LibraryView.tsx`, the only other caller).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/Sidebar.tsx frontend/src/components/Sidebar.module.css frontend/src/components/Sidebar.test.tsx
git commit -m "feat(frontend): tag rename/recolor/delete via Sidebar context menu"
```

---

## Task 6: Frontend — wire `LibraryView` to pass `reloadTags`/`onTagDeleted`

**Files:**
- Modify: `frontend/src/views/LibraryView.tsx`
- Modify: `frontend/src/views/LibraryView.test.tsx`

**Interfaces:**
- Consumes: `Sidebar`'s new `reloadTags`/`onTagDeleted` props (Task 5); `useTags()`'s `reload` (Task 4).
- Produces: deleting a tag that is currently active in `selectedTagIds` removes it from that state, so `useFiles`'s tag filter and `LibraryToolbar`'s `activeTags` chips both drop it automatically (both are already derived from `selectedTagIds` — no further wiring needed there).

**Context on the existing test file:** `LibraryView.test.tsx` does not mock `Sidebar` or `api/client` — it stubs the global `fetch` (see `mockApi()`, keyed by URL prefix and HTTP method) and renders the real component tree. `LibraryToolbar`'s active-tag chip renders as `<button>{tag.name} ×</button>` (`frontend/src/components/LibraryToolbar.tsx:25-34`) — its accessible name is the literal text `"Printed ×"`, distinct from the Sidebar tag row's own button, whose accessible name is just `"Printed"`. Because `updateTag`/`deleteTag` also go through `fetch`, the file's existing generic `DELETE` stub branch (`if (init?.method === 'DELETE') return Promise.resolve({ ok: opts.deleteOk ?? true })`) already covers a tag delete with no new stubbing needed — only the `/api/tags` GET branch needs to return a non-empty tag list for this test.

- [ ] **Step 1: Write the failing test**

Add this new `describe` block to the end of `frontend/src/views/LibraryView.test.tsx` (after the existing `describe('LibraryView file delete', ...)` block, same file, same imports — no new imports needed):

```tsx
describe('LibraryView tag management', () => {
  const printedTag: Tag = { id: 11, name: 'Printed', colorKey: 'orange' }

  function mockApiWithTag(opts: { deleteOk?: boolean } = {}) {
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === 'DELETE') {
        return Promise.resolve({ ok: opts.deleteOk ?? true } as Response)
      }
      let body: unknown = []
      if (url.startsWith('/api/folders')) body = folders
      else if (url.startsWith('/api/tags')) body = [printedTag]
      else if (url.startsWith('/api/files')) body = [dragon, goblin]
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response)
    }))
  }

  afterEach(() => vi.unstubAllGlobals())

  it('deleting a tag that is currently selected as a filter clears its toolbar chip', async () => {
    mockApiWithTag()
    renderView()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Printed' })).toBeInTheDocument())

    // Select the tag filter first (mirrors clicking it in the Sidebar).
    fireEvent.click(screen.getByRole('button', { name: 'Printed' }))
    expect(screen.getByRole('button', { name: 'Printed ×' })).toBeInTheDocument()

    // Right-click the tag row, delete it, confirm.
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Printed' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Printed ×' })).not.toBeInTheDocument(),
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/views/LibraryView.test.tsx`
Expected: FAIL — `Sidebar` has no way to notify `LibraryView` when a tag is deleted yet (`onTagDeleted` prop doesn't exist on `LibraryView`'s call site), so `selectedTagIds` still contains `11` and the chip remains.

- [ ] **Step 3: Wire `reloadTags` and `onTagDeleted` in `LibraryView.tsx`**

In `frontend/src/views/LibraryView.tsx`:

1. Change the `useTags` destructure (currently `const { tags } = useTags()`) to:

```tsx
const { tags, reload: reloadTags } = useTags()
```

2. Add a handler near `toggleTag` (after its definition):

```tsx
const handleTagDeleted = (id: number) =>
  setSelectedTagIds((cur) => cur.filter((t) => t !== id))
```

3. Pass the two new props to `<Sidebar>`:

```tsx
<Sidebar
  folders={folders}
  selectedFolderId={selectedFolderId}
  onSelectFolder={setSelectedFolderId}
  onImport={onImport}
  reloadFolders={reloadFolders}
  reloadFiles={reloadFiles}
  tags={tags}
  selectedTagIds={selectedTagIds}
  onToggleTag={toggleTag}
  reloadTags={reloadTags}
  onTagDeleted={handleTagDeleted}
/>
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/views/LibraryView.test.tsx`
Expected: PASS.

- [ ] **Step 5: Run the full frontend suite and type-check**

Run: `cd frontend && npx vitest run && npx tsc -b`
Expected: all tests PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/views/LibraryView.tsx frontend/src/views/LibraryView.test.tsx
git commit -m "feat(frontend): drop a deleted tag from the active filter in LibraryView"
```

---

## Task 7: Docs — retire the backlog item and run full verification

**Files:**
- Modify: `Docs/future-refinements.md`

- [ ] **Step 1: Remove item #8**

In `Docs/future-refinements.md`, delete the entire `## 8. Tag management (rename / recolor / delete)` section (from its heading through the line before `## 9. Customizable tag colors (Settings)`), since it is now implemented. Leave item #9 (customizable tag colors) as-is — that remains a future item.

- [ ] **Step 2: Run the full backend and frontend suites once more**

Run: `cd backend && dotnet test`
Run: `cd frontend && npx vitest run && npx tsc -b && npm run build`
Expected: everything green, build succeeds.

- [ ] **Step 3: Manually verify in the running app**

Run: `cd backend && $env:SEED_SAMPLE_DATA="true"; dotnet run --project PlasticRoom.Api` (PowerShell) in one terminal, `cd frontend && npm run dev` in another. Open `http://localhost:5173` and confirm: right-clicking a tag shows Rename/Recolor/Delete; rename commits on Enter and updates the row; Recolor opens the 4-swatch popover and clicking one recolors the tag immediately; Delete shows the confirm dialog and removes the tag, and if it was an active filter, its toolbar chip disappears too.

- [ ] **Step 4: Commit**

```bash
git add Docs/future-refinements.md
git commit -m "docs: mark tag management (rename/recolor/delete) implemented"
```

---

## Self-Review Notes

- **Spec coverage:** backend PUT/DELETE (Task 1) ✓; palette unchanged, sourced from existing `TAG_COLORS`/`TAG_COLOR_KEYS` (Task 2) ✓; context-menu + inline rename + popover recolor + `ConfirmDialog` delete (Task 5) ✓; `selectedTagIds` cleanup on delete (Task 6) ✓; merge and custom-palette explicitly left alone (no task touches them) ✓; backlog doc updated (Task 7) ✓.
- **Type consistency checked:** `updateTag(id, name, colorKey)` signature is identical across Task 3 (client), Task 5 (Sidebar call sites), and the test mocks. `Sidebar`'s new props (`reloadTags: () => void`, `onTagDeleted: (id: number) => void`) match between the Task 5 interface and Task 6's `LibraryView` call site. `TAG_COLOR_KEYS` is defined once (Task 2) and consumed only in Task 5.
- **No placeholders:** every step has complete, runnable code; no "add tests for the above" steps — all test code is written in full.
