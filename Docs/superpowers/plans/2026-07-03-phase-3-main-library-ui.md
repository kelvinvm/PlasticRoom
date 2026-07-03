# Phase 3 — Main Library UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the health-check smoke screen into the real three-pane Main Library UI (folder/collections sidebar, file-card grid, file detail panel) rendering live API data, with descendant-inclusive folder navigation and server-side search.

**Architecture:** A small backend slice extends `GET /api/files` with descendant-inclusive folder filtering and a `q` search param, plus a dev-only sample-data seeder. The frontend is plain React (component-local state + `fetch` behind small hooks), styled with CSS Modules over a global design-token stylesheet. Read-only this phase — no editing, import, or multi-assign.

**Tech Stack:** React 18 + TypeScript (Vite), Vitest + React Testing Library, CSS Modules; ASP.NET Core 10 + DevExpress XPO + SQLite, xUnit.

## Global Constraints

- Backend targets **.NET 10** (`net10.0`); XPO session pattern per project memory: `Session` (not `UnitOfWork`) — `.Save()` persists immediately, never call `CommitTransaction()`, and call `session.PurgeDeletedObjects()` after any `.Delete()`. (No deletes occur in this plan.)
- The file entity is **`ModelFile`** in code (not `File`).
- Error responses use `{ "error": "<message>" }` with an appropriate 400/404 status.
- Frontend: **no UI component library, no data-fetching library, no state manager.** Only the existing dependencies. CSS Modules (`*.module.css`) — Vite supports these natively, no new dependency.
- JSON is serialized **camelCase** (ASP.NET Core web defaults): C# `DimXMm` → JSON `dimXMm`, `FolderIds` → `folderIds`, `IsSystem` → `isSystem`, `ColorKey` → `colorKey`.
- Design tokens (colors, radii, spacing, thumbnail placeholder) are copied verbatim from `Docs/superpowers/specs/2026-07-02-plastic-room-project-overview.md` into `frontend/src/styles/tokens.css` in Task 3 and referenced via CSS variables thereafter.
- Backend test command: `dotnet test` from `backend/`. Frontend test command: `npm test` from `frontend/` (alias for `vitest run`); single file: `npx vitest run <path>`.
- Thumbnails are the **striped placeholder** only — no real thumbnail image is fetched or served this phase.

---

### Task 1: Backend — descendant-inclusive folder filtering + search on `GET /api/files`

**Files:**
- Modify: `backend/PlasticRoom.Api/Controllers/FilesController.cs` (the `GetAll` method, ~lines 28-50)
- Test: `backend/PlasticRoom.Api.Tests/Controllers/FilesControllerTests.cs`

**Interfaces:**
- Consumes: existing `XpoSessionFactory`, `FileStorage`, `FilesController`, `ToDto`, entities `Folder`/`ModelFile`/`FileFolder`.
- Produces: `GET /api/files?folderId={int}&q={string}` — folder scoping is descendant-inclusive & de-duplicated; `q` is a case-insensitive substring match on `Name` or `Description`, applied after folder scoping. Both optional and combinable. Response shape (`List<ModelFileDto>`) unchanged.

- [ ] **Step 1: Write the failing tests**

Add these four tests to `FilesControllerTests.cs` (they reuse the existing `BuildStlFormFile` helper and session pattern):

```csharp
[Fact]
public async System.Threading.Tasks.Task GetAll_IncludesFilesFromDescendantFolders()
{
    var parentFile = (ModelFileDto)Assert.IsType<CreatedAtActionResult>(
        (await _controller.Upload(new UploadFileRequest { File = BuildStlFormFile("parent.stl") }))).Value!;
    var childFile = (ModelFileDto)Assert.IsType<CreatedAtActionResult>(
        (await _controller.Upload(new UploadFileRequest { File = BuildStlFormFile("child.stl") }))).Value!;

    int parentFolderId;
    using (var session = _sessionFactory.CreateSession())
    {
        var parent = new PlasticRoom.Api.Entities.Folder(session) { Name = "Parent" };
        parent.Save();
        var child = new PlasticRoom.Api.Entities.Folder(session) { Name = "Child", ParentFolder = parent };
        child.Save();
        var pf = session.GetObjectByKey<PlasticRoom.Api.Entities.ModelFile>(parentFile.Id);
        var cf = session.GetObjectByKey<PlasticRoom.Api.Entities.ModelFile>(childFile.Id);
        new PlasticRoom.Api.Entities.FileFolder(session) { File = pf!, Folder = parent }.Save();
        new PlasticRoom.Api.Entities.FileFolder(session) { File = cf!, Folder = child }.Save();
        parentFolderId = parent.Oid;
    }

    var result = Assert.IsType<OkObjectResult>(_controller.GetAll(parentFolderId, null));
    var files = Assert.IsAssignableFrom<List<ModelFileDto>>(result.Value);

    Assert.Equal(2, files.Count);
    Assert.Contains(files, f => f.Id == parentFile.Id);
    Assert.Contains(files, f => f.Id == childFile.Id);
}

[Fact]
public async System.Threading.Tasks.Task GetAll_DeduplicatesFileInMultipleFoldersOfSubtree()
{
    var file = (ModelFileDto)Assert.IsType<CreatedAtActionResult>(
        (await _controller.Upload(new UploadFileRequest { File = BuildStlFormFile("shared.stl") }))).Value!;

    int parentFolderId;
    using (var session = _sessionFactory.CreateSession())
    {
        var parent = new PlasticRoom.Api.Entities.Folder(session) { Name = "Parent" };
        parent.Save();
        var child = new PlasticRoom.Api.Entities.Folder(session) { Name = "Child", ParentFolder = parent };
        child.Save();
        var f = session.GetObjectByKey<PlasticRoom.Api.Entities.ModelFile>(file.Id);
        new PlasticRoom.Api.Entities.FileFolder(session) { File = f!, Folder = parent }.Save();
        new PlasticRoom.Api.Entities.FileFolder(session) { File = f!, Folder = child }.Save();
        parentFolderId = parent.Oid;
    }

    var result = Assert.IsType<OkObjectResult>(_controller.GetAll(parentFolderId, null));
    var files = Assert.IsAssignableFrom<List<ModelFileDto>>(result.Value);

    Assert.Single(files);
}

[Fact]
public async System.Threading.Tasks.Task GetAll_FiltersBySearchQueryOnNameAndDescriptionCaseInsensitively()
{
    var dragon = (ModelFileDto)Assert.IsType<CreatedAtActionResult>(
        (await _controller.Upload(new UploadFileRequest { File = BuildStlFormFile("Dragon.stl") }))).Value!;
    var knight = (ModelFileDto)Assert.IsType<CreatedAtActionResult>(
        (await _controller.Upload(new UploadFileRequest { File = BuildStlFormFile("Knight.stl") }))).Value!;
    _controller.Update(knight.Id, new UpdateFileRequest("A fearsome DRAGON slayer", null, null, null, null, null));

    var result = Assert.IsType<OkObjectResult>(_controller.GetAll(null, "dragon"));
    var files = Assert.IsAssignableFrom<List<ModelFileDto>>(result.Value);

    Assert.Equal(2, files.Count); // Dragon.stl by name, Knight.stl by description
    Assert.Contains(files, f => f.Id == dragon.Id);
    Assert.Contains(files, f => f.Id == knight.Id);
}

[Fact]
public async System.Threading.Tasks.Task GetAll_CombinesFolderScopeAndSearch()
{
    var inFolder = (ModelFileDto)Assert.IsType<CreatedAtActionResult>(
        (await _controller.Upload(new UploadFileRequest { File = BuildStlFormFile("Dragon.stl") }))).Value!;
    // A second matching-name file NOT in the folder must be excluded by the folder scope.
    await _controller.Upload(new UploadFileRequest { File = BuildStlFormFile("Dragon2.stl") });

    int folderId;
    using (var session = _sessionFactory.CreateSession())
    {
        var folder = new PlasticRoom.Api.Entities.Folder(session) { Name = "Minis" };
        folder.Save();
        var f = session.GetObjectByKey<PlasticRoom.Api.Entities.ModelFile>(inFolder.Id);
        new PlasticRoom.Api.Entities.FileFolder(session) { File = f!, Folder = folder }.Save();
        folderId = folder.Oid;
    }

    var result = Assert.IsType<OkObjectResult>(_controller.GetAll(folderId, "dragon"));
    var files = Assert.IsAssignableFrom<List<ModelFileDto>>(result.Value);

    Assert.Single(files);
    Assert.Equal(inFolder.Id, files[0].Id);
}
```

Note: the pre-existing `GetAll_FiltersByFolderId` test calls `_controller.GetAll(folderId)`. Update that call to `_controller.GetAll(folderId, null)` so it still compiles.

- [ ] **Step 2: Run tests to verify they fail**

Run: `dotnet test backend/PlasticRoom.Api.Tests --filter FullyQualifiedName~FilesControllerTests`
Expected: compile error (the new `GetAll` signature doesn't exist yet) or FAIL — the four new tests do not pass.

- [ ] **Step 3: Implement the new `GetAll` and a descendant-collection helper**

In `FilesController.cs`, replace the existing `GetAll` method (lines ~28-50) with:

```csharp
[HttpGet]
public IActionResult GetAll([FromQuery] int? folderId, [FromQuery] string? q)
{
    using var session = _sessionFactory.CreateSession();

    List<ModelFile> files;
    if (folderId is int fid)
    {
        var folder = session.GetObjectByKey<Folder>(fid);
        if (folder is null)
        {
            return NotFound(new { error = $"Folder {fid} not found" });
        }

        files = CollectSelfAndDescendants(folder)
            .SelectMany(f => f.FileFolders.Select(ff => ff.File))
            .DistinctBy(f => f.Oid)
            .ToList();
    }
    else
    {
        files = new XPCollection<ModelFile>(session).ToList();
    }

    var trimmed = q?.Trim();
    if (!string.IsNullOrEmpty(trimmed))
    {
        files = files
            .Where(f =>
                f.Name.Contains(trimmed, StringComparison.OrdinalIgnoreCase) ||
                (f.Description is not null &&
                 f.Description.Contains(trimmed, StringComparison.OrdinalIgnoreCase)))
            .ToList();
    }

    return Ok(files.Select(ToDto).ToList());
}

private static List<Folder> CollectSelfAndDescendants(Folder root)
{
    var result = new List<Folder>();
    var stack = new Stack<Folder>();
    stack.Push(root);
    while (stack.Count > 0)
    {
        var current = stack.Pop();
        result.Add(current);
        foreach (var child in current.Children)
        {
            stack.Push(child);
        }
    }
    return result;
}
```

`DistinctBy`, `SelectMany`, and the `string.Contains(string, StringComparison)` overload are all available; `System` and `System.Collections.Generic` are already imported.

- [ ] **Step 4: Run tests to verify they pass**

Run: `dotnet test backend/PlasticRoom.Api.Tests --filter FullyQualifiedName~FilesControllerTests`
Expected: PASS — all FilesControllerTests (existing + 4 new) green.

- [ ] **Step 5: Commit**

```bash
git add backend/PlasticRoom.Api/Controllers/FilesController.cs backend/PlasticRoom.Api.Tests/Controllers/FilesControllerTests.cs
git commit -m "feat: descendant-inclusive folder filtering and search on GET /api/files"
```

---

### Task 2: Backend — dev-only sample-data seeder

**Files:**
- Create: `backend/PlasticRoom.Api/Data/SampleDataSeeder.cs`
- Modify: `backend/PlasticRoom.Api/Program.cs` (after the existing `FolderSeeder` call)
- Create: `README.md` (repo root)
- Test: `backend/PlasticRoom.Api.Tests/Data/SampleDataSeederTests.cs`

**Interfaces:**
- Consumes: `XpoSessionFactory`, `FileStorage`, `StlMetadataParser`, `ThreeMfMetadataParser`, entities `Folder`/`ModelFile`/`FileFolder`/`Tag`/`FileTag`.
- Produces: `SampleDataSeeder.IsEnabled()` → `bool` (reads `SEED_SAMPLE_DATA` env var). `SampleDataSeeder.Seed(XpoSessionFactory, FileStorage)` → idempotently creates nested folders, tags, and parsed sample files; no-op if any non-system folder already exists.

- [ ] **Step 1: Write the failing tests**

Create `backend/PlasticRoom.Api.Tests/Data/SampleDataSeederTests.cs`:

```csharp
using System;
using System.IO;
using System.Linq;
using PlasticRoom.Api.Data;
using PlasticRoom.Api.Entities;
using Xunit;

namespace PlasticRoom.Api.Tests.Data;

public class SampleDataSeederTests : IDisposable
{
    private readonly string _tempDataDir;
    private readonly XpoSessionFactory _sessionFactory;
    private readonly FileStorage _fileStorage;

    public SampleDataSeederTests()
    {
        _tempDataDir = Path.Combine(Path.GetTempPath(), "plasticroom-sampleseeder-tests-" + Guid.NewGuid());
        _sessionFactory = new XpoSessionFactory(_tempDataDir);
        _fileStorage = new FileStorage(_tempDataDir);
    }

    [Fact]
    public void Seed_CreatesFoldersTagsAndParsedFilesOnDisk()
    {
        SampleDataSeeder.Seed(_sessionFactory, _fileStorage);

        using var session = _sessionFactory.CreateSession();
        Assert.True(new DevExpress.Xpo.XPCollection<Folder>(session).Any(f => !f.IsSystem));
        Assert.True(new DevExpress.Xpo.XPCollection<Tag>(session).Any());

        var files = new DevExpress.Xpo.XPCollection<ModelFile>(session).ToList();
        Assert.NotEmpty(files);
        Assert.All(files, f => Assert.True(File.Exists(f.StoragePath)));
        Assert.Contains(files, f => f.DimXMm is > 0); // metadata parsed
        Assert.Contains(files, f => f.FileFolders.Any()); // assigned to a folder
    }

    [Fact]
    public void Seed_IsIdempotent()
    {
        SampleDataSeeder.Seed(_sessionFactory, _fileStorage);
        int folderCount;
        using (var session = _sessionFactory.CreateSession())
        {
            folderCount = new DevExpress.Xpo.XPCollection<Folder>(session).Count();
        }

        SampleDataSeeder.Seed(_sessionFactory, _fileStorage);

        using var session2 = _sessionFactory.CreateSession();
        Assert.Equal(folderCount, new DevExpress.Xpo.XPCollection<Folder>(session2).Count());
    }

    [Fact]
    public void IsEnabled_ReflectsEnvironmentVariable()
    {
        var original = Environment.GetEnvironmentVariable("SEED_SAMPLE_DATA");
        try
        {
            Environment.SetEnvironmentVariable("SEED_SAMPLE_DATA", "true");
            Assert.True(SampleDataSeeder.IsEnabled());
            Environment.SetEnvironmentVariable("SEED_SAMPLE_DATA", null);
            Assert.False(SampleDataSeeder.IsEnabled());
        }
        finally
        {
            Environment.SetEnvironmentVariable("SEED_SAMPLE_DATA", original);
        }
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDataDir))
        {
            Directory.Delete(_tempDataDir, recursive: true);
        }
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `dotnet test backend/PlasticRoom.Api.Tests --filter FullyQualifiedName~SampleDataSeederTests`
Expected: compile error — `SampleDataSeeder` does not exist yet.

- [ ] **Step 3: Implement `SampleDataSeeder`**

Create `backend/PlasticRoom.Api/Data/SampleDataSeeder.cs`:

```csharp
using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using DevExpress.Xpo;
using PlasticRoom.Api.Entities;
using PlasticRoom.Api.Parsing;

namespace PlasticRoom.Api.Data;

public static class SampleDataSeeder
{
    public static bool IsEnabled() =>
        string.Equals(
            Environment.GetEnvironmentVariable("SEED_SAMPLE_DATA"),
            "true",
            StringComparison.OrdinalIgnoreCase);

    public static void Seed(XpoSessionFactory sessionFactory, FileStorage fileStorage)
    {
        using var session = sessionFactory.CreateSession();

        // Idempotency: bail if sample content (any non-system folder) already exists.
        if (new XPCollection<Folder>(session).Any(f => !f.IsSystem))
        {
            return;
        }

        var miniatures = new Folder(session) { Name = "Miniatures" };
        miniatures.Save();
        var dnd = new Folder(session) { Name = "DnD Campaign", ParentFolder = miniatures };
        dnd.Save();
        var household = new Folder(session) { Name = "Household" };
        household.Save();
        var terrain = new Folder(session) { Name = "Terrain" };
        terrain.Save();

        var favorites = new XPCollection<Folder>(session).FirstOrDefault(f => f.IsSystem && f.Name == "Favorites");
        var toPrint = new XPCollection<Folder>(session).FirstOrDefault(f => f.IsSystem && f.Name == "To Print");

        var tagResin = new Tag(session) { Name = "Resin", ColorKey = "brass" };
        var tagPla = new Tag(session) { Name = "PLA", ColorKey = "green" };
        var tagWip = new Tag(session) { Name = "WIP", ColorKey = "orange" };
        tagResin.Save();
        tagPla.Save();
        tagWip.Save();

        CreateSampleFile(session, fileStorage, "Articulated_Dragon.stl", ModelFileType.Stl,
            "Print-in-place dragon, 8 segments",
            new[] { miniatures, dnd, favorites }, new[] { tagPla });
        CreateSampleFile(session, fileStorage, "Goblin_King_Mini.stl", ModelFileType.Stl,
            "32mm scale, single piece",
            new[] { dnd, toPrint }, new[] { tagResin, tagWip });
        CreateSampleFile(session, fileStorage, "Chess_Knight_Set.3mf", ModelFileType.ThreeMf,
            "4 plates, resin optimized",
            new[] { household }, new[] { tagResin });
        CreateSampleFile(session, fileStorage, "Terrain_Ruins.3mf", ModelFileType.ThreeMf,
            "Modular 6x6in base",
            new[] { terrain }, new[] { tagPla });
    }

    private static void CreateSampleFile(
        Session session,
        FileStorage fileStorage,
        string name,
        ModelFileType type,
        string description,
        Folder?[] folders,
        Tag[] tags)
    {
        var extension = type == ModelFileType.ThreeMf ? ".3mf" : ".stl";
        var bytes = type == ModelFileType.ThreeMf ? BuildSampleThreeMf() : BuildSampleStl();

        var storedFileName = $"{Guid.NewGuid()}{extension}";
        var storagePath = Path.Combine(fileStorage.FilesDirectory, storedFileName);
        File.WriteAllBytes(storagePath, bytes);

        using var readStream = File.OpenRead(storagePath);
        var metadata = type == ModelFileType.ThreeMf
            ? ThreeMfMetadataParser.Parse(readStream)
            : StlMetadataParser.Parse(readStream);

        var file = new ModelFile(session)
        {
            Name = name,
            Type = type,
            SizeBytes = bytes.Length,
            AddedAt = DateTime.UtcNow,
            DimXMm = metadata.DimXMm,
            DimYMm = metadata.DimYMm,
            DimZMm = metadata.DimZMm,
            PlateCount = metadata.PlateCount,
            Description = description,
            StoragePath = storagePath,
        };
        file.Save();

        foreach (var folder in folders.Where(f => f is not null))
        {
            new FileFolder(session) { File = file, Folder = folder! }.Save();
        }

        foreach (var tag in tags)
        {
            new FileTag(session) { File = file, Tag = tag }.Save();
        }
    }

    private static byte[] BuildSampleStl()
    {
        using var stream = new MemoryStream();
        using (var writer = new BinaryWriter(stream, Encoding.ASCII, leaveOpen: true))
        {
            writer.Write(new byte[80]);      // header
            writer.Write((uint)1);            // triangle count
            writer.Write(0f); writer.Write(0f); writer.Write(0f); // normal
            writer.Write(0f); writer.Write(0f); writer.Write(0f); // v1
            writer.Write(42f); writer.Write(0f); writer.Write(0f); // v2
            writer.Write(0f); writer.Write(28f); writer.Write(15f); // v3
            writer.Write((ushort)0);          // attribute byte count
        }

        return stream.ToArray();
    }

    private static byte[] BuildSampleThreeMf()
    {
        const string modelXml = """
            <?xml version="1.0" encoding="UTF-8"?>
            <model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
              <resources>
                <object id="1" type="model">
                  <mesh>
                    <vertices>
                      <vertex x="0" y="0" z="0" />
                      <vertex x="60" y="0" z="0" />
                      <vertex x="0" y="60" z="0" />
                      <vertex x="0" y="0" z="40" />
                    </vertices>
                    <triangles>
                      <triangle v1="0" v2="1" v3="2" />
                      <triangle v1="0" v2="1" v3="3" />
                    </triangles>
                  </mesh>
                </object>
              </resources>
              <build>
                <item objectid="1" />
              </build>
            </model>
            """;

        using var stream = new MemoryStream();
        using (var archive = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
        {
            var entry = archive.CreateEntry("3D/3dmodel.model");
            using var entryStream = entry.Open();
            using var streamWriter = new StreamWriter(entryStream);
            streamWriter.Write(modelXml);
        }

        return stream.ToArray();
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `dotnet test backend/PlasticRoom.Api.Tests --filter FullyQualifiedName~SampleDataSeederTests`
Expected: PASS — all three tests green.

- [ ] **Step 5: Wire the seeder into `Program.cs`**

In `backend/PlasticRoom.Api/Program.cs`, after the existing `FolderSeeder.SeedSystemFolders(...)` line, add:

```csharp
if (SampleDataSeeder.IsEnabled())
{
    SampleDataSeeder.Seed(
        app.Services.GetRequiredService<XpoSessionFactory>(),
        app.Services.GetRequiredService<FileStorage>());
}
```

- [ ] **Step 6: Create the README with sample-data docs**

Create `README.md` at the repo root:

```markdown
# PlasticRoom

A Lightroom-style web app for organizing 3MF/STL 3D-printer files.

## Running

```bash
docker-compose up --build
```

The frontend is served on the mapped Nginx port; the backend API is proxied under `/api`.

## Development

Backend: `cd backend && dotnet run --project PlasticRoom.Api`
Frontend: `cd frontend && npm install && npm run dev`

### Sample data (development only)

The app auto-seeds the system collections (Favorites, Printed, To Print, Failed Prints)
on every start. To also populate example folders, tags, and parsed sample `.3mf`/`.stl`
files so the Library UI has content to render, set the `SEED_SAMPLE_DATA` environment
variable before starting the backend:

```bash
SEED_SAMPLE_DATA=true dotnet run --project PlasticRoom.Api   # bash
$env:SEED_SAMPLE_DATA = "true"; dotnet run --project PlasticRoom.Api   # PowerShell
```

Seeding is idempotent: it is skipped if any non-system folder already exists, so it
runs only against a fresh database.
```

- [ ] **Step 7: Verify the full backend suite still passes**

Run: `dotnet test backend/PlasticRoom.Api.Tests`
Expected: PASS — all tests (Phase 2 + Task 1 + Task 2) green.

- [ ] **Step 8: Commit**

```bash
git add backend/PlasticRoom.Api/Data/SampleDataSeeder.cs backend/PlasticRoom.Api/Program.cs backend/PlasticRoom.Api.Tests/Data/SampleDataSeederTests.cs README.md
git commit -m "feat: dev-only sample-data seeder behind SEED_SAMPLE_DATA"
```

---

### Task 3: Frontend foundation — types, API client, design tokens, fonts

**Files:**
- Create: `frontend/src/api/types.ts`
- Create: `frontend/src/api/client.ts`
- Create: `frontend/src/styles/tokens.css`
- Create: `frontend/src/vite-env.d.ts`
- Modify: `frontend/src/main.tsx`
- Modify: `frontend/index.html`
- Test: `frontend/src/api/client.test.ts`

**Interfaces:**
- Produces:
  - `types.ts`: `ModelFileType = 'ThreeMf' | 'Stl'`; interfaces `ModelFile`, `Folder`, `Tag` (fields below, all camelCase).
  - `client.ts`: `getFolders(): Promise<Folder[]>`, `getTags(): Promise<Tag[]>`, `getFiles(folderId: number | null, q: string): Promise<ModelFile[]>`.

- [ ] **Step 1: Write the failing test for the API client**

Create `frontend/src/api/client.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getFiles, getFolders } from './client'

describe('api client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const okJson = (value: unknown) =>
    ({ ok: true, json: () => Promise.resolve(value) }) as Response

  it('getFolders requests /api/folders', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(okJson([]))
    await getFolders()
    expect(fetch).toHaveBeenCalledWith('/api/folders')
  })

  it('getFiles with folderId and query builds the query string', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(okJson([]))
    await getFiles(7, 'dragon')
    expect(fetch).toHaveBeenCalledWith('/api/files?folderId=7&q=dragon')
  })

  it('getFiles with null folder and blank query hits the bare endpoint', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(okJson([]))
    await getFiles(null, '   ')
    expect(fetch).toHaveBeenCalledWith('/api/files')
  })

  it('throws when the response is not ok', async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 500 } as Response)
    await expect(getFolders()).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/api/client.test.ts` (from `frontend/`)
Expected: FAIL — `./client` cannot be resolved.

- [ ] **Step 3: Implement `types.ts` and `client.ts`**

Create `frontend/src/api/types.ts`:

```ts
export type ModelFileType = 'ThreeMf' | 'Stl'

export interface ModelFile {
  id: number
  name: string
  type: ModelFileType
  sizeBytes: number
  addedAt: string
  dimXMm: number | null
  dimYMm: number | null
  dimZMm: number | null
  plateCount: number | null
  estPrintTimeMin: number | null
  material: string | null
  layerHeightMm: number | null
  sourceUrl: string | null
  creator: string | null
  description: string | null
  thumbnailPath: string | null
  folderIds: number[]
  tagIds: number[]
}

export interface Folder {
  id: number
  name: string
  parentId: number | null
  description: string | null
  coverImageFileId: number | null
  sortOrder: number
  isSystem: boolean
}

export interface Tag {
  id: number
  name: string
  colorKey: string | null
}
```

Create `frontend/src/api/client.ts`:

```ts
import type { Folder, ModelFile, Tag } from './types'

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Request to ${url} failed with status ${res.status}`)
  }
  return (await res.json()) as T
}

export function getFolders(): Promise<Folder[]> {
  return getJson<Folder[]>('/api/folders')
}

export function getTags(): Promise<Tag[]> {
  return getJson<Tag[]>('/api/tags')
}

export function getFiles(folderId: number | null, q: string): Promise<ModelFile[]> {
  const params = new URLSearchParams()
  if (folderId !== null) {
    params.set('folderId', String(folderId))
  }
  const trimmed = q.trim()
  if (trimmed) {
    params.set('q', trimmed)
  }
  const query = params.toString()
  return getJson<ModelFile[]>(`/api/files${query ? `?${query}` : ''}`)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/api/client.test.ts`
Expected: PASS.

- [ ] **Step 5: Create the design-token stylesheet**

Create `frontend/src/styles/tokens.css`:

```css
:root {
  --bg-app: #0f0e0c;
  --bg-panel: #151210;
  --bg-surface: #1c1815;
  --border: rgba(255, 255, 255, 0.08);
  --text-primary: #f2ede4;
  --text-secondary: rgba(242, 237, 228, 0.55);
  --text-tertiary: rgba(242, 237, 228, 0.35);
  --accent: #ff8a3d;
  --accent-text: #1a1512;
  --accent-tint: rgba(255, 138, 61, 0.13);
  --tag-brass: #dbb55a;
  --tag-brass-tint: rgba(219, 181, 90, 0.15);
  --success: #3ddc97;
  --error: #e0654a;

  --radius-card: 9px;
  --radius-pill: 99px;
  --radius-button: 7px;
  --radius-chip: 5px;
  --grid-gap: 16px;
  --panel-padding: 20px;

  --font-ui: 'IBM Plex Sans', system-ui, sans-serif;
  --font-mono: 'IBM Plex Mono', ui-monospace, monospace;

  --thumb-placeholder: repeating-linear-gradient(
    135deg,
    #241f1a,
    #241f1a 8px,
    #2b241e 8px,
    #2b241e 16px
  );
}

* {
  box-sizing: border-box;
}

html,
body,
#root {
  margin: 0;
  height: 100%;
}

body {
  background: var(--bg-app);
  color: var(--text-primary);
  font-family: var(--font-ui);
  -webkit-font-smoothing: antialiased;
}
```

- [ ] **Step 5b: Add the Vite ambient type declaration (enables `*.module.css` imports under `tsc`)**

Create `frontend/src/vite-env.d.ts`:

```ts
/// <reference types="vite/client" />
```

Without this, `npm run build` (`tsc -b`) fails with "Cannot find module './X.module.css'" once the components import their CSS Modules in later tasks.

- [ ] **Step 6: Import tokens in `main.tsx`**

Replace `frontend/src/main.tsx` with:

```tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/tokens.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
```

- [ ] **Step 7: Add IBM Plex Mono to the font link in `index.html`**

In `frontend/index.html`, replace the existing Google Fonts stylesheet `<link>` (the one for `IBM+Plex+Sans`) with a combined link:

```html
    <link
      href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap"
      rel="stylesheet"
    />
```

- [ ] **Step 8: Verify the build still compiles**

Run: `npm run build` (from `frontend/`)
Expected: PASS — TypeScript compiles and Vite builds (the smoke-screen `App.tsx` is untouched this task).

- [ ] **Step 9: Commit**

```bash
git add frontend/src/api frontend/src/styles frontend/src/vite-env.d.ts frontend/src/main.tsx frontend/index.html
git commit -m "feat: frontend API client, types, and design-token foundation"
```

---

### Task 4: Frontend — pure utilities (folder tree + formatters)

**Files:**
- Create: `frontend/src/lib/folderTree.ts`
- Create: `frontend/src/lib/format.ts`
- Test: `frontend/src/lib/folderTree.test.ts`
- Test: `frontend/src/lib/format.test.ts`

**Interfaces:**
- Consumes: `Folder` from `../api/types`.
- Produces:
  - `folderTree.ts`: `interface FolderNode extends Folder { children: FolderNode[] }`; `buildFolderTree(folders: Folder[]): FolderNode[]` (roots = folders whose `parentId` is null or absent from the set; sorted by `sortOrder` then `name`).
  - `format.ts`: `formatBytes(bytes: number): string`, `formatDimensions(x, y, z: number | null): string | null`, `formatPrintTime(minutes: number | null): string | null`, `tagColor(colorKey: string | null): string`.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/lib/folderTree.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildFolderTree } from './folderTree'
import type { Folder } from '../api/types'

const folder = (id: number, name: string, parentId: number | null, sortOrder = 0): Folder => ({
  id,
  name,
  parentId,
  description: null,
  coverImageFileId: null,
  sortOrder,
  isSystem: false,
})

describe('buildFolderTree', () => {
  it('nests children under their parent', () => {
    const tree = buildFolderTree([
      folder(1, 'Parent', null),
      folder(2, 'Child', 1),
      folder(3, 'Grandchild', 2),
    ])
    expect(tree).toHaveLength(1)
    expect(tree[0].name).toBe('Parent')
    expect(tree[0].children[0].name).toBe('Child')
    expect(tree[0].children[0].children[0].name).toBe('Grandchild')
  })

  it('sorts siblings by sortOrder then name', () => {
    const tree = buildFolderTree([
      folder(1, 'Bravo', null, 1),
      folder(2, 'Alpha', null, 1),
      folder(3, 'First', null, 0),
    ])
    expect(tree.map((n) => n.name)).toEqual(['First', 'Alpha', 'Bravo'])
  })
})
```

Create `frontend/src/lib/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { formatBytes, formatDimensions, formatPrintTime, tagColor } from './format'

describe('formatters', () => {
  it('formats bytes into human units', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5_242_880)).toBe('5.0 MB')
  })

  it('formats dimensions, or null when any axis is missing', () => {
    expect(formatDimensions(12.5, 8, 3.25)).toBe('12.5 × 8 × 3.25 mm')
    expect(formatDimensions(10, null, 3)).toBeNull()
  })

  it('formats print time, or null when missing', () => {
    expect(formatPrintTime(45)).toBe('45m')
    expect(formatPrintTime(60)).toBe('1h')
    expect(formatPrintTime(125)).toBe('2h 5m')
    expect(formatPrintTime(null)).toBeNull()
  })

  it('maps colorKey to a color with a brass fallback', () => {
    expect(tagColor('green')).toBe('#3ddc97')
    expect(tagColor(null)).toBe('#dbb55a')
    expect(tagColor('unknown')).toBe('#dbb55a')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/folderTree.test.ts src/lib/format.test.ts`
Expected: FAIL — modules cannot be resolved.

- [ ] **Step 3: Implement the utilities**

Create `frontend/src/lib/folderTree.ts`:

```ts
import type { Folder } from '../api/types'

export interface FolderNode extends Folder {
  children: FolderNode[]
}

export function buildFolderTree(folders: Folder[]): FolderNode[] {
  const nodes = new Map<number, FolderNode>()
  for (const f of folders) {
    nodes.set(f.id, { ...f, children: [] })
  }

  const roots: FolderNode[] = []
  for (const node of nodes.values()) {
    if (node.parentId !== null && nodes.has(node.parentId)) {
      nodes.get(node.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  const sortRecursive = (list: FolderNode[]) => {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    list.forEach((n) => sortRecursive(n.children))
  }
  sortRecursive(roots)

  return roots
}
```

Create `frontend/src/lib/format.ts`:

```ts
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex++
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`
}

export function formatDimensions(
  x: number | null,
  y: number | null,
  z: number | null,
): string | null {
  if (x === null || y === null || z === null) {
    return null
  }
  const trim = (n: number) => Number(n.toFixed(1)).toString()
  return `${trim(x)} × ${trim(y)} × ${trim(z)} mm`
}

export function formatPrintTime(minutes: number | null): string | null {
  if (minutes === null) {
    return null
  }
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  if (hours === 0) {
    return `${mins}m`
  }
  if (mins === 0) {
    return `${hours}h`
  }
  return `${hours}h ${mins}m`
}

const TAG_COLORS: Record<string, string> = {
  brass: '#dbb55a',
  orange: '#ff8a3d',
  green: '#3ddc97',
  red: '#e0654a',
}

export function tagColor(colorKey: string | null): string {
  if (colorKey && TAG_COLORS[colorKey]) {
    return TAG_COLORS[colorKey]
  }
  return TAG_COLORS.brass
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/folderTree.test.ts src/lib/format.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib
git commit -m "feat: folder-tree builder and display formatters"
```

---

### Task 5: Frontend — data hooks (folders, tags, files, debounce)

**Files:**
- Create: `frontend/src/hooks/useFolders.ts`
- Create: `frontend/src/hooks/useTags.ts`
- Create: `frontend/src/hooks/useFiles.ts`
- Create: `frontend/src/hooks/useDebouncedValue.ts`
- Test: `frontend/src/hooks/useFiles.test.ts`
- Test: `frontend/src/hooks/useDebouncedValue.test.ts`

**Interfaces:**
- Consumes: `getFolders`/`getTags`/`getFiles` from `../api/client`; `Folder`/`Tag`/`ModelFile` types.
- Produces:
  - `useFolders(): { folders: Folder[]; loading: boolean; error: boolean }`
  - `useTags(): { tags: Tag[]; loading: boolean; error: boolean }`
  - `useFiles(folderId: number | null, q: string): { files: ModelFile[]; loading: boolean; error: boolean }` — refetches whenever `folderId` or `q` changes.
  - `useDebouncedValue<T>(value: T, delayMs: number): T`

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/hooks/useFiles.test.ts`:

```ts
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useFiles } from './useFiles'
import * as client from '../api/client'
import type { ModelFile } from '../api/types'

const sampleFile: ModelFile = {
  id: 1, name: 'a.stl', type: 'Stl', sizeBytes: 10, addedAt: '2026-01-01T00:00:00Z',
  dimXMm: 1, dimYMm: 1, dimZMm: 1, plateCount: null, estPrintTimeMin: null,
  material: null, layerHeightMm: null, sourceUrl: null, creator: null,
  description: null, thumbnailPath: null, folderIds: [], tagIds: [],
}

describe('useFiles', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.restoreAllMocks())

  it('loads files and exposes them', async () => {
    vi.spyOn(client, 'getFiles').mockResolvedValue([sampleFile])
    const { result } = renderHook(() => useFiles(null, ''))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.files).toHaveLength(1)
    expect(result.current.error).toBe(false)
  })

  it('refetches when folderId changes', async () => {
    const spy = vi.spyOn(client, 'getFiles').mockResolvedValue([])
    const { rerender } = renderHook(({ id }) => useFiles(id, ''), {
      initialProps: { id: null as number | null },
    })
    await waitFor(() => expect(spy).toHaveBeenCalledWith(null, ''))
    rerender({ id: 5 })
    await waitFor(() => expect(spy).toHaveBeenCalledWith(5, ''))
  })

  it('sets error when the request rejects', async () => {
    vi.spyOn(client, 'getFiles').mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useFiles(null, ''))
    await waitFor(() => expect(result.current.error).toBe(true))
  })
})
```

Create `frontend/src/hooks/useDebouncedValue.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDebouncedValue } from './useDebouncedValue'

describe('useDebouncedValue', () => {
  afterEach(() => vi.useRealTimers())

  it('returns the latest value only after the delay elapses', () => {
    vi.useFakeTimers()
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 250), {
      initialProps: { v: 'a' },
    })
    expect(result.current).toBe('a')
    rerender({ v: 'ab' })
    expect(result.current).toBe('a') // not yet
    act(() => {
      vi.advanceTimersByTime(250)
    })
    expect(result.current).toBe('ab')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/hooks/useFiles.test.ts src/hooks/useDebouncedValue.test.ts`
Expected: FAIL — hook modules cannot be resolved.

- [ ] **Step 3: Implement the hooks**

Create `frontend/src/hooks/useFolders.ts`:

```ts
import { useEffect, useState } from 'react'
import type { Folder } from '../api/types'
import { getFolders } from '../api/client'

export function useFolders(): { folders: Folder[]; loading: boolean; error: boolean } {
  const [folders, setFolders] = useState<Folder[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

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
  }, [])

  return { folders, loading, error }
}
```

Create `frontend/src/hooks/useTags.ts`:

```ts
import { useEffect, useState } from 'react'
import type { Tag } from '../api/types'
import { getTags } from '../api/client'

export function useTags(): { tags: Tag[]; loading: boolean; error: boolean } {
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

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
  }, [])

  return { tags, loading, error }
}
```

Create `frontend/src/hooks/useFiles.ts`:

```ts
import { useEffect, useState } from 'react'
import type { ModelFile } from '../api/types'
import { getFiles } from '../api/client'

export function useFiles(
  folderId: number | null,
  q: string,
): { files: ModelFile[]; loading: boolean; error: boolean } {
  const [files, setFiles] = useState<ModelFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

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
  }, [folderId, q])

  return { files, loading, error }
}
```

Create `frontend/src/hooks/useDebouncedValue.ts`:

```ts
import { useEffect, useState } from 'react'

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])

  return debounced
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/hooks/useFiles.test.ts src/hooks/useDebouncedValue.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks
git commit -m "feat: data hooks for folders, tags, files, and debounced search"
```

---

### Task 6: Frontend — Sidebar (folder tree + collections)

**Files:**
- Create: `frontend/src/components/Sidebar.tsx`
- Create: `frontend/src/components/Sidebar.module.css`
- Test: `frontend/src/components/Sidebar.test.tsx`

**Interfaces:**
- Consumes: `Folder` type; `buildFolderTree`/`FolderNode` from `../lib/folderTree`.
- Produces: `Sidebar` component with props `{ folders: Folder[]; selectedFolderId: number | null; onSelectFolder: (id: number | null) => void }`. The selected row carries `aria-current="true"`. Non-system folders render under an "All Files" row in a LIBRARY section; system folders render in a COLLECTIONS section.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/Sidebar.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Sidebar } from './Sidebar'
import type { Folder } from '../api/types'

const folder = (id: number, name: string, parentId: number | null, isSystem = false): Folder => ({
  id, name, parentId, description: null, coverImageFileId: null, sortOrder: 0, isSystem,
})

const folders: Folder[] = [
  folder(1, 'Miniatures', null),
  folder(2, 'DnD Campaign', 1),
  folder(3, 'Favorites', null, true),
]

describe('Sidebar', () => {
  it('renders All Files, the library tree, and collections', () => {
    render(<Sidebar folders={folders} selectedFolderId={null} onSelectFolder={vi.fn()} />)
    expect(screen.getByText('All Files')).toBeInTheDocument()
    expect(screen.getByText('Miniatures')).toBeInTheDocument()
    expect(screen.getByText('DnD Campaign')).toBeInTheDocument()
    expect(screen.getByText('Favorites')).toBeInTheDocument()
  })

  it('calls onSelectFolder with the folder id when a folder is clicked', () => {
    const onSelect = vi.fn()
    render(<Sidebar folders={folders} selectedFolderId={null} onSelectFolder={onSelect} />)
    fireEvent.click(screen.getByText('Miniatures'))
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it('calls onSelectFolder with null when All Files is clicked', () => {
    const onSelect = vi.fn()
    render(<Sidebar folders={folders} selectedFolderId={1} onSelectFolder={onSelect} />)
    fireEvent.click(screen.getByText('All Files'))
    expect(onSelect).toHaveBeenCalledWith(null)
  })

  it('marks the selected row with aria-current', () => {
    render(<Sidebar folders={folders} selectedFolderId={1} onSelectFolder={vi.fn()} />)
    expect(screen.getByText('Miniatures').closest('[aria-current]')).toHaveAttribute('aria-current', 'true')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/Sidebar.test.tsx`
Expected: FAIL — `./Sidebar` cannot be resolved.

- [ ] **Step 3: Implement the Sidebar**

Create `frontend/src/components/Sidebar.tsx`:

```tsx
import type { Folder } from '../api/types'
import { buildFolderTree, type FolderNode } from '../lib/folderTree'
import styles from './Sidebar.module.css'

interface SidebarProps {
  folders: Folder[]
  selectedFolderId: number | null
  onSelectFolder: (id: number | null) => void
}

interface RowProps {
  node: FolderNode
  depth: number
  selectedFolderId: number | null
  onSelectFolder: (id: number | null) => void
}

function FolderRow({ node, depth, selectedFolderId, onSelectFolder }: RowProps) {
  const selected = node.id === selectedFolderId
  return (
    <>
      <button
        type="button"
        className={`${styles.row} ${selected ? styles.rowSelected : ''}`}
        aria-current={selected ? 'true' : undefined}
        style={{ paddingLeft: 12 + depth * 14 }}
        onClick={() => onSelectFolder(node.id)}
      >
        <span className={styles.folderIcon} aria-hidden="true">
          📁
        </span>
        <span className={styles.rowLabel}>{node.name}</span>
      </button>
      {node.children.map((child) => (
        <FolderRow
          key={child.id}
          node={child}
          depth={depth + 1}
          selectedFolderId={selectedFolderId}
          onSelectFolder={onSelectFolder}
        />
      ))}
    </>
  )
}

export function Sidebar({ folders, selectedFolderId, onSelectFolder }: SidebarProps) {
  const libraryTree = buildFolderTree(folders.filter((f) => !f.isSystem))
  const collectionsTree = buildFolderTree(folders.filter((f) => f.isSystem))
  const allFilesSelected = selectedFolderId === null

  return (
    <nav className={styles.sidebar}>
      <div className={styles.brand}>
        <span className={styles.brandMark} aria-hidden="true" />
        <span className={styles.brandName}>PlasticRoom</span>
      </div>

      <div className={styles.sectionLabel}>Library</div>
      <button
        type="button"
        className={`${styles.row} ${allFilesSelected ? styles.rowSelected : ''}`}
        aria-current={allFilesSelected ? 'true' : undefined}
        style={{ paddingLeft: 12 }}
        onClick={() => onSelectFolder(null)}
      >
        <span className={styles.folderIcon} aria-hidden="true">
          📁
        </span>
        <span className={styles.rowLabel}>All Files</span>
      </button>
      {libraryTree.map((node) => (
        <FolderRow
          key={node.id}
          node={node}
          depth={1}
          selectedFolderId={selectedFolderId}
          onSelectFolder={onSelectFolder}
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
        />
      ))}
    </nav>
  )
}
```

Create `frontend/src/components/Sidebar.module.css`:

```css
.sidebar {
  width: 260px;
  flex-shrink: 0;
  background: var(--bg-panel);
  border-right: 1px solid var(--border);
  padding: 16px 10px;
  overflow-y: auto;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 8px 16px;
}

.brandMark {
  width: 20px;
  height: 20px;
  border-radius: 6px;
  background: var(--accent);
}

.brandName {
  font-weight: 600;
  font-size: 15px;
}

.sectionLabel {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-tertiary);
  padding: 16px 8px 6px;
}

.row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 12px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-family: var(--font-ui);
  font-size: 13px;
  text-align: left;
  border-radius: var(--radius-button);
  cursor: pointer;
}

.row:hover {
  background: var(--bg-surface);
  color: var(--text-primary);
}

.rowSelected {
  background: var(--accent-tint);
  color: var(--text-primary);
}

.folderIcon {
  font-size: 12px;
}

.rowLabel {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/Sidebar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Sidebar.tsx frontend/src/components/Sidebar.module.css frontend/src/components/Sidebar.test.tsx
git commit -m "feat: sidebar with library folder tree and collections"
```

---

### Task 7: Frontend — FileGrid + FileCard

**Files:**
- Create: `frontend/src/components/FileGrid.tsx`
- Create: `frontend/src/components/FileGrid.module.css`
- Test: `frontend/src/components/FileGrid.test.tsx`

**Interfaces:**
- Consumes: `ModelFile`, `Tag` types; `tagColor` from `../lib/format`.
- Produces: `FileGrid` component with props `{ files: ModelFile[]; tags: Tag[]; selectedFileId: number | null; onSelectFile: (id: number) => void }`. Each card shows a placeholder thumbnail labelled `"3MF PREVIEW"`/`"STL PREVIEW"`, the file name, description, and tag pills; the selected card carries `aria-current="true"`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/FileGrid.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FileGrid } from './FileGrid'
import type { ModelFile, Tag } from '../api/types'

const file = (id: number, name: string, type: ModelFile['type'], tagIds: number[]): ModelFile => ({
  id, name, type, sizeBytes: 1024, addedAt: '2026-01-01T00:00:00Z',
  dimXMm: 10, dimYMm: 10, dimZMm: 10, plateCount: null, estPrintTimeMin: null,
  material: null, layerHeightMm: null, sourceUrl: null, creator: null,
  description: `${name} description`, thumbnailPath: null, folderIds: [], tagIds,
})

const tags: Tag[] = [{ id: 1, name: 'Resin', colorKey: 'brass' }]

describe('FileGrid', () => {
  it('renders a card per file with preview label, name, description, and tag pills', () => {
    const files = [file(1, 'Dragon.stl', 'Stl', [1]), file(2, 'Set.3mf', 'ThreeMf', [])]
    render(<FileGrid files={files} tags={tags} selectedFileId={null} onSelectFile={vi.fn()} />)
    expect(screen.getByText('Dragon.stl')).toBeInTheDocument()
    expect(screen.getByText('Dragon.stl description')).toBeInTheDocument()
    expect(screen.getByText('STL PREVIEW')).toBeInTheDocument()
    expect(screen.getByText('3MF PREVIEW')).toBeInTheDocument()
    expect(screen.getByText('Resin')).toBeInTheDocument()
  })

  it('calls onSelectFile when a card is clicked', () => {
    const onSelect = vi.fn()
    render(<FileGrid files={[file(1, 'Dragon.stl', 'Stl', [])]} tags={tags} selectedFileId={null} onSelectFile={onSelect} />)
    fireEvent.click(screen.getByText('Dragon.stl'))
    expect(onSelect).toHaveBeenCalledWith(1)
  })

  it('marks the selected card with aria-current', () => {
    render(<FileGrid files={[file(1, 'Dragon.stl', 'Stl', [])]} tags={tags} selectedFileId={1} onSelectFile={vi.fn()} />)
    expect(screen.getByText('Dragon.stl').closest('[aria-current]')).toHaveAttribute('aria-current', 'true')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/FileGrid.test.tsx`
Expected: FAIL — `./FileGrid` cannot be resolved.

- [ ] **Step 3: Implement FileGrid + FileCard**

Create `frontend/src/components/FileGrid.tsx`:

```tsx
import type { ModelFile, Tag } from '../api/types'
import { tagColor } from '../lib/format'
import styles from './FileGrid.module.css'

interface FileGridProps {
  files: ModelFile[]
  tags: Tag[]
  selectedFileId: number | null
  onSelectFile: (id: number) => void
}

export function typeLabel(type: ModelFile['type']): string {
  return type === 'ThreeMf' ? '3MF' : 'STL'
}

interface CardProps {
  file: ModelFile
  tags: Tag[]
  selected: boolean
  onSelect: (id: number) => void
}

function FileCard({ file, tags, selected, onSelect }: CardProps) {
  const fileTags = file.tagIds
    .map((id) => tags.find((t) => t.id === id))
    .filter((t): t is Tag => t !== undefined)

  return (
    <button
      type="button"
      className={`${styles.card} ${selected ? styles.cardSelected : ''}`}
      aria-current={selected ? 'true' : undefined}
      onClick={() => onSelect(file.id)}
    >
      <div className={styles.thumb}>
        <span className={styles.thumbLabel}>{typeLabel(file.type)} PREVIEW</span>
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

export function FileGrid({ files, tags, selectedFileId, onSelectFile }: FileGridProps) {
  return (
    <div className={styles.grid}>
      {files.map((file) => (
        <FileCard
          key={file.id}
          file={file}
          tags={tags}
          selected={file.id === selectedFileId}
          onSelect={onSelectFile}
        />
      ))}
    </div>
  )
}
```

Create `frontend/src/components/FileGrid.module.css`:

```css
.grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--grid-gap);
  padding: 20px;
}

@media (max-width: 1100px) {
  .grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 800px) {
  .grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

.card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 0 12px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-family: var(--font-ui);
  text-align: left;
  cursor: pointer;
  border-radius: var(--radius-card);
}

.cardSelected {
  box-shadow: 0 0 0 2px var(--accent);
}

.thumb {
  aspect-ratio: 4 / 3;
  border-radius: var(--radius-card);
  background: var(--thumb-placeholder);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 6px;
}

.thumbLabel {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--text-tertiary);
}

.name {
  font-size: 13px;
  font-weight: 600;
  padding: 0 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.description {
  font-size: 11px;
  color: var(--text-secondary);
  padding: 0 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  padding: 2px 4px 0;
}

.tagPill {
  font-family: var(--font-mono);
  font-size: 10px;
  padding: 2px 7px;
  border: 1px solid;
  border-radius: var(--radius-pill);
  opacity: 0.9;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/FileGrid.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/FileGrid.tsx frontend/src/components/FileGrid.module.css frontend/src/components/FileGrid.test.tsx
git commit -m "feat: file card grid with placeholder thumbnails and tag pills"
```

---

### Task 8: Frontend — LibraryToolbar + FileDetailPanel

**Files:**
- Create: `frontend/src/components/LibraryToolbar.tsx`
- Create: `frontend/src/components/LibraryToolbar.module.css`
- Create: `frontend/src/components/FileDetailPanel.tsx`
- Create: `frontend/src/components/FileDetailPanel.module.css`
- Test: `frontend/src/components/LibraryToolbar.test.tsx`
- Test: `frontend/src/components/FileDetailPanel.test.tsx`

**Interfaces:**
- Consumes: `ModelFile`, `Folder`, `Tag` types; `formatBytes`/`formatDimensions`/`formatPrintTime`/`tagColor` from `../lib/format`; `typeLabel` from `./FileGrid`.
- Produces:
  - `LibraryToolbar` props `{ title: string; fileCount: number; search: string; onSearchChange: (value: string) => void }`.
  - `FileDetailPanel` props `{ file: ModelFile | null; folders: Folder[]; tags: Tag[] }` — renders an empty state when `file` is null, otherwise thumbnail + metadata rows + folder chips + tag chips.

- [ ] **Step 1: Write the failing tests**

Create `frontend/src/components/LibraryToolbar.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LibraryToolbar } from './LibraryToolbar'

describe('LibraryToolbar', () => {
  it('renders the title and file count', () => {
    render(<LibraryToolbar title="Miniatures" fileCount={42} search="" onSearchChange={vi.fn()} />)
    expect(screen.getByText('Miniatures')).toBeInTheDocument()
    expect(screen.getByText('42 files')).toBeInTheDocument()
  })

  it('calls onSearchChange as the user types', () => {
    const onChange = vi.fn()
    render(<LibraryToolbar title="Miniatures" fileCount={0} search="" onSearchChange={onChange} />)
    fireEvent.change(screen.getByPlaceholderText('Search files…'), { target: { value: 'dragon' } })
    expect(onChange).toHaveBeenCalledWith('dragon')
  })
})
```

Create `frontend/src/components/FileDetailPanel.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FileDetailPanel } from './FileDetailPanel'
import type { Folder, ModelFile, Tag } from '../api/types'

const folders: Folder[] = [
  { id: 1, name: 'Miniatures', parentId: null, description: null, coverImageFileId: null, sortOrder: 0, isSystem: false },
]
const tags: Tag[] = [{ id: 1, name: 'Resin', colorKey: 'brass' }]

const file: ModelFile = {
  id: 9, name: 'Dragon.stl', type: 'Stl', sizeBytes: 5_242_880, addedAt: '2026-01-01T00:00:00Z',
  dimXMm: 42, dimYMm: 28, dimZMm: 15, plateCount: null, estPrintTimeMin: 125,
  material: 'PLA', layerHeightMm: 0.2, sourceUrl: null, creator: 'Jane',
  description: 'A dragon', thumbnailPath: null, folderIds: [1], tagIds: [1],
}

describe('FileDetailPanel', () => {
  it('shows an empty state when no file is selected', () => {
    render(<FileDetailPanel file={null} folders={folders} tags={tags} />)
    expect(screen.getByText('Select a file')).toBeInTheDocument()
  })

  it('renders name, formatted metadata, folder chips and tag chips', () => {
    render(<FileDetailPanel file={file} folders={folders} tags={tags} />)
    expect(screen.getByText('Dragon.stl')).toBeInTheDocument()
    expect(screen.getByText('5.0 MB')).toBeInTheDocument()
    expect(screen.getByText('42 × 28 × 15 mm')).toBeInTheDocument()
    expect(screen.getByText('2h 5m')).toBeInTheDocument()
    expect(screen.getByText('Miniatures')).toBeInTheDocument()
    expect(screen.getByText('Resin')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/LibraryToolbar.test.tsx src/components/FileDetailPanel.test.tsx`
Expected: FAIL — modules cannot be resolved.

- [ ] **Step 3: Implement the two components**

Create `frontend/src/components/LibraryToolbar.tsx`:

```tsx
import styles from './LibraryToolbar.module.css'

interface LibraryToolbarProps {
  title: string
  fileCount: number
  search: string
  onSearchChange: (value: string) => void
}

export function LibraryToolbar({ title, fileCount, search, onSearchChange }: LibraryToolbarProps) {
  return (
    <div className={styles.toolbar}>
      <div className={styles.titleGroup}>
        <h1 className={styles.title}>{title}</h1>
        <span className={styles.count}>{fileCount} files</span>
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

Create `frontend/src/components/LibraryToolbar.module.css`:

```css
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px;
  border-bottom: 1px solid var(--border);
}

.titleGroup {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.count {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-tertiary);
}

.search {
  width: 260px;
  max-width: 40vw;
  padding: 8px 12px;
  background: var(--bg-surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-button);
  color: var(--text-primary);
  font-family: var(--font-ui);
  font-size: 13px;
}

.search::placeholder {
  color: var(--text-tertiary);
}
```

Create `frontend/src/components/FileDetailPanel.tsx`:

```tsx
import type { Folder, ModelFile, Tag } from '../api/types'
import { formatBytes, formatDimensions, formatPrintTime, tagColor } from '../lib/format'
import { typeLabel } from './FileGrid'
import styles from './FileDetailPanel.module.css'

interface FileDetailPanelProps {
  file: ModelFile | null
  folders: Folder[]
  tags: Tag[]
}

interface Row {
  label: string
  value: string
}

export function FileDetailPanel({ file, folders, tags }: FileDetailPanelProps) {
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
  const printTime = formatPrintTime(file.estPrintTimeMin)
  if (printTime) rows.push({ label: 'Print time', value: printTime })
  if (file.material) rows.push({ label: 'Material', value: file.material })
  if (file.layerHeightMm !== null) rows.push({ label: 'Layer height', value: `${file.layerHeightMm} mm` })
  if (file.creator) rows.push({ label: 'Creator', value: file.creator })

  const fileFolders = file.folderIds
    .map((id) => folders.find((f) => f.id === id))
    .filter((f): f is Folder => f !== undefined)
  const fileTags = file.tagIds
    .map((id) => tags.find((t) => t.id === id))
    .filter((t): t is Tag => t !== undefined)

  return (
    <aside className={styles.panel}>
      <div className={styles.thumb}>
        <span className={styles.thumbLabel}>{typeLabel(file.type)} PREVIEW</span>
      </div>
      <h2 className={styles.name}>{file.name}</h2>
      {file.description && <p className={styles.description}>{file.description}</p>}

      <dl className={styles.meta}>
        {rows.map((row) => (
          <div key={row.label} className={styles.metaRow}>
            <dt className={styles.metaLabel}>{row.label}</dt>
            <dd className={styles.metaValue}>{row.value}</dd>
          </div>
        ))}
      </dl>

      {file.sourceUrl && (
        <a className={styles.sourceLink} href={file.sourceUrl} target="_blank" rel="noreferrer">
          Source
        </a>
      )}

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

      {fileTags.length > 0 && (
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
      )}
    </aside>
  )
}
```

Create `frontend/src/components/FileDetailPanel.module.css`:

```css
.panel {
  width: 320px;
  flex-shrink: 0;
  background: var(--bg-panel);
  border-left: 1px solid var(--border);
  padding: var(--panel-padding);
  overflow-y: auto;
}

.empty {
  color: var(--text-tertiary);
  font-family: var(--font-mono);
  font-size: 11px;
  text-align: center;
  padding-top: 40px;
}

.thumb {
  aspect-ratio: 4 / 3;
  border-radius: var(--radius-card);
  background: var(--thumb-placeholder);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 14px;
}

.thumbLabel {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--text-tertiary);
}

.name {
  margin: 0 0 6px;
  font-size: 15px;
  font-weight: 600;
}

.description {
  margin: 0 0 14px;
  font-size: 12px;
  color: var(--text-secondary);
}

.meta {
  margin: 0 0 14px;
}

.metaRow {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
  border-bottom: 1px solid var(--border);
}

.metaLabel {
  font-size: 11px;
  color: var(--text-tertiary);
}

.metaValue {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-primary);
}

.sourceLink {
  display: inline-block;
  margin-bottom: 14px;
  font-size: 12px;
  color: var(--accent);
  text-decoration: none;
}

.chipGroup {
  margin-bottom: 14px;
}

.chipLabel {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-tertiary);
  margin-bottom: 6px;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  font-size: 11px;
  padding: 3px 9px;
  border: 1px solid var(--border);
  border-radius: var(--radius-chip);
  color: var(--text-secondary);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/components/LibraryToolbar.test.tsx src/components/FileDetailPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/LibraryToolbar.tsx frontend/src/components/LibraryToolbar.module.css frontend/src/components/FileDetailPanel.tsx frontend/src/components/FileDetailPanel.module.css frontend/src/components/LibraryToolbar.test.tsx frontend/src/components/FileDetailPanel.test.tsx
git commit -m "feat: library toolbar and read-only file detail panel"
```

---

### Task 9: Frontend — App integration (three-pane shell, state, states)

**Files:**
- Modify (rewrite): `frontend/src/App.tsx`
- Create: `frontend/src/App.module.css`
- Modify (rewrite): `frontend/src/App.test.tsx`

**Interfaces:**
- Consumes: `useFolders`/`useTags`/`useFiles`/`useDebouncedValue` hooks; `Sidebar`, `LibraryToolbar`, `FileGrid`, `FileDetailPanel` components; `Folder` type.
- Produces: the composed `App` — owns `selectedFolderId` (null = All Files), `selectedFileId`, `search`; wires debounced search into `useFiles`; renders loading / empty / no-results / error states in the center pane.

- [ ] **Step 1: Write the failing integration tests**

Replace `frontend/src/App.test.tsx` with:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { Folder, ModelFile, Tag } from './api/types'

const folders: Folder[] = [
  { id: 1, name: 'Miniatures', parentId: null, description: null, coverImageFileId: null, sortOrder: 0, isSystem: false },
  { id: 2, name: 'Favorites', parentId: null, description: null, coverImageFileId: null, sortOrder: 0, isSystem: true },
]
const tags: Tag[] = [{ id: 1, name: 'Resin', colorKey: 'brass' }]
const dragon: ModelFile = {
  id: 10, name: 'Dragon.stl', type: 'Stl', sizeBytes: 1024, addedAt: '2026-01-01T00:00:00Z',
  dimXMm: 10, dimYMm: 10, dimZMm: 10, plateCount: null, estPrintTimeMin: null,
  material: null, layerHeightMm: null, sourceUrl: null, creator: null,
  description: 'A dragon', thumbnailPath: null, folderIds: [1], tagIds: [1],
}

function mockApi(filesForCall: () => ModelFile[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => {
      let body: unknown = []
      if (url.startsWith('/api/folders')) body = folders
      else if (url.startsWith('/api/tags')) body = tags
      else if (url.startsWith('/api/files')) body = filesForCall()
      return Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response)
    }),
  )
}

describe('App', () => {
  beforeEach(() => {
    mockApi(() => [dragon])
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('renders the sidebar, the grid, and updates the detail panel on card click', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('Miniatures')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByText('Dragon.stl')).toBeInTheDocument())

    fireEvent.click(screen.getByText('Dragon.stl'))
    // Detail panel now shows the file's formatted size (unique to the panel).
    await waitFor(() => expect(screen.getByText('1.0 KB')).toBeInTheDocument())
  })

  it('refetches with folderId when a folder is selected', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('Miniatures')).toBeInTheDocument())
    fireEvent.click(screen.getByText('Miniatures'))
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/files?folderId=1')),
    )
  })

  it('shows an empty state when a folder has no files', async () => {
    mockApi(() => [])
    render(<App />)
    await waitFor(() => expect(screen.getByText(/no files/i)).toBeInTheDocument())
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/App.test.tsx`
Expected: FAIL — the current smoke-screen `App` renders none of these.

- [ ] **Step 3: Rewrite `App.tsx`**

Replace `frontend/src/App.tsx` with:

```tsx
import { useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { LibraryToolbar } from './components/LibraryToolbar'
import { FileGrid } from './components/FileGrid'
import { FileDetailPanel } from './components/FileDetailPanel'
import { useFolders } from './hooks/useFolders'
import { useTags } from './hooks/useTags'
import { useFiles } from './hooks/useFiles'
import { useDebouncedValue } from './hooks/useDebouncedValue'
import styles from './App.module.css'

export default function App() {
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null)
  const [selectedFileId, setSelectedFileId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, 250)

  const { folders } = useFolders()
  const { tags } = useTags()
  const { files, loading, error } = useFiles(selectedFolderId, debouncedSearch)

  const title =
    selectedFolderId === null
      ? 'All Files'
      : (folders.find((f) => f.id === selectedFolderId)?.name ?? 'Folder')

  const selectedFile = files.find((f) => f.id === selectedFileId) ?? null

  const handleSelectFolder = (id: number | null) => {
    setSelectedFolderId(id)
  }

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
        selectedFileId={selectedFileId}
        onSelectFile={setSelectedFileId}
      />
    )
  }

  return (
    <div className={styles.app}>
      <Sidebar
        folders={folders}
        selectedFolderId={selectedFolderId}
        onSelectFolder={handleSelectFolder}
      />
      <main className={styles.center}>
        <LibraryToolbar
          title={title}
          fileCount={files.length}
          search={search}
          onSearchChange={setSearch}
        />
        <div className={styles.centerBody}>{center}</div>
      </main>
      <FileDetailPanel file={selectedFile} folders={folders} tags={tags} />
    </div>
  )
}
```

- [ ] **Step 4: Create `App.module.css`**

Create `frontend/src/App.module.css`:

```css
.app {
  display: flex;
  height: 100%;
  overflow: hidden;
}

.center {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-app);
}

.centerBody {
  flex: 1;
  overflow-y: auto;
}

.status {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-tertiary);
  text-align: center;
  padding-top: 60px;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/App.test.tsx`
Expected: PASS.

- [ ] **Step 6: Run the full frontend suite and the type build**

Run: `npm test` then `npm run build` (from `frontend/`)
Expected: PASS — all frontend tests green and the production build compiles with no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/App.tsx frontend/src/App.module.css frontend/src/App.test.tsx
git commit -m "feat: compose three-pane Main Library UI with navigation and search"
```

---

## Final Verification

- [ ] **Backend:** `dotnet test backend/PlasticRoom.Api.Tests` — all green.
- [ ] **Frontend:** `npm test` (from `frontend/`) — all green; `npm run build` compiles.
- [ ] **End-to-end smoke:** with `SEED_SAMPLE_DATA=true`, run the backend and `npm run dev`; confirm the sidebar shows the LIBRARY tree + COLLECTIONS, the grid shows seeded cards, clicking a parent folder shows descendant files, clicking a card fills the detail panel, and typing in search filters the grid. (This is manual verification via the `superpowers:verify` / `run` skills at execution time.)
```
