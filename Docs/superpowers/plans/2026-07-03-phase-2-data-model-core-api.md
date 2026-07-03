# Phase 2 Data Model & Core API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** All XPO entities backing the PlasticRoom data model, with REST CRUD endpoints for folders, files, and tags — including server-side file upload with metadata parsing, thumbnail upload, and the many-to-many folder/tag assignment endpoints later screens build on.

**Architecture:** Five XPO persistent classes under `PlasticRoom.Api/Entities`, two static metadata parsers under `PlasticRoom.Api/Parsing`, a `FileStorage` service resolving the on-disk layout under `DATA_PATH`, and three new API controllers (`FoldersController`, `FilesController`, `TagsController`) that open a fresh `Session` per request via the existing `XpoSessionFactory`. System (collection) folders are seeded idempotently at startup.

**Tech Stack:** ASP.NET Core 10 Web API (C#), DevExpress.Xpo 24.1.6 + SQLite (already wired via `XpoSessionFactory`), xUnit for tests — same stack as Phase 1, no new dependencies.

## Global Constraints

- Spec: `Docs/superpowers/specs/2026-07-03-phase-2-data-model-core-api.md`. Every task below implements a section of that spec.
- **Naming deviation from the spec (deliberate):** the spec calls the file entity `File`. In C#, `PlasticRoom.Api.Entities.File` would collide with `System.IO.File`, which every controller needs for disk I/O. The entity class is named `ModelFile` instead; its API DTOs and JSON payloads are unaffected (the DTO type is `ModelFileDto`, but wire field names match the spec — `name`, `type`, `sizeBytes`, etc.). Do not name the class `File`.
- All XPO entities derive from `DevExpress.Xpo.XPObject`, which provides `int Oid` as the primary key — never add a separate `Id` property.
- Every controller action opens its own `Session` via the existing `XpoSessionFactory` singleton (constructor-injected), matching the pattern in `HealthController`. Never share a `Session` across requests.
- Error responses are always `{ "error": "<message>" }` with 400 (validation) or 404 (not found) — no other error shape anywhere in this phase.
- `DATA_PATH` (default `/data`) now also has two subdirectories: `{DATA_PATH}/files/` (uploaded originals) and `{DATA_PATH}/thumbs/` (PNG thumbnails), both created on startup by the new `FileStorage` service.
- System (collection) folders are exactly these four names, seeded once, idempotent on every restart: `Favorites`, `Printed`, `To Print`, `Failed Prints`.
- `IsSystem` folders reject rename/reparent/delete with 400; other fields (description, sort order, cover image) remain editable on them.
- Folder delete cascades to descendant folders and their `FileFolder` join rows; files are never deleted as a side effect of folder deletion.
- Only `.3mf` and `.stl` extensions are accepted on upload (case-insensitive); anything else is 400.
- `SourceUrl`, when present (upload or update), must parse as `Uri.TryCreate(value, UriKind.Absolute, out _)`; otherwise 400.
- No UI work, no batch endpoints, no auth — out of scope per spec.

---

## File Structure

```
backend/PlasticRoom.Api/
├── Entities/
│   ├── Folder.cs
│   ├── ModelFile.cs
│   ├── ModelFileType.cs
│   ├── FileFolder.cs
│   ├── Tag.cs
│   └── FileTag.cs
├── Parsing/
│   ├── ModelMetadata.cs
│   ├── StlMetadataParser.cs
│   └── ThreeMfMetadataParser.cs
├── Data/
│   ├── XpoSessionFactory.cs        (existing, unchanged)
│   ├── FileStorage.cs              (new)
│   └── FolderSeeder.cs             (new)
├── Dtos/
│   ├── FolderDtos.cs
│   ├── ModelFileDtos.cs
│   └── TagDtos.cs
├── Controllers/
│   ├── HealthController.cs         (existing, unchanged)
│   ├── FoldersController.cs
│   ├── FilesController.cs
│   └── TagsController.cs
└── Program.cs                      (modified: register FileStorage, run FolderSeeder)

backend/PlasticRoom.Api.Tests/
├── Entities/
│   └── EntitySchemaTests.cs
├── Data/
│   └── FolderSeederTests.cs
├── Parsing/
│   ├── StlMetadataParserTests.cs
│   └── ThreeMfMetadataParserTests.cs
└── Controllers/
    ├── FoldersControllerTests.cs
    ├── TagsControllerTests.cs
    └── FilesControllerTests.cs
```

---

### Task 1: XPO entity classes and schema verification

**Files:**
- Create: `backend/PlasticRoom.Api/Entities/ModelFileType.cs`
- Create: `backend/PlasticRoom.Api/Entities/Folder.cs`
- Create: `backend/PlasticRoom.Api/Entities/ModelFile.cs`
- Create: `backend/PlasticRoom.Api/Entities/FileFolder.cs`
- Create: `backend/PlasticRoom.Api/Entities/Tag.cs`
- Create: `backend/PlasticRoom.Api/Entities/FileTag.cs`
- Create: `backend/PlasticRoom.Api.Tests/Entities/EntitySchemaTests.cs`

**Interfaces:**
- Produces: `Folder` (properties `Name`, `ParentFolder`, `Children` (`XPCollection<Folder>`), `Description`, `CoverImageFile` (`ModelFile?`), `SortOrder`, `IsSystem`, `FileFolders` (`XPCollection<FileFolder>`)); `ModelFile` (`Name`, `Type` (`ModelFileType`), `SizeBytes`, `AddedAt`, `DimXMm/DimYMm/DimZMm` (`double?`), `PlateCount` (`int?`), `EstPrintTimeMin` (`int?`), `Material` (`string?`), `LayerHeightMm` (`double?`), `SourceUrl` (`string?`), `Creator` (`string?`), `Description` (`string?`), `StoragePath` (`string`), `ThumbnailPath` (`string?`), `FileFolders`, `FileTags` (`XPCollection<FileTag>`)); `FileFolder` (`File` → `ModelFile`, `Folder` → `Folder`); `Tag` (`Name`, `ColorKey` (`string?`), `FileTags`); `FileTag` (`File` → `ModelFile`, `Tag` → `Tag`). All used by every later task.
- Consumes: `XpoSessionFactory` (Phase 1, unchanged).

- [ ] **Step 1: Write the failing schema test**

Create `backend/PlasticRoom.Api.Tests/Entities/EntitySchemaTests.cs`:

```csharp
using System;
using System.IO;
using PlasticRoom.Api.Data;
using PlasticRoom.Api.Entities;
using Xunit;

namespace PlasticRoom.Api.Tests.Entities;

public class EntitySchemaTests : IDisposable
{
    private readonly string _tempDir;
    private readonly XpoSessionFactory _factory;

    public EntitySchemaTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), "plasticroom-entity-tests-" + Guid.NewGuid());
        _factory = new XpoSessionFactory(_tempDir);
    }

    [Fact]
    public void CanCreateAndAssociateAllEntities()
    {
        using (var session = _factory.CreateSession())
        {
            var parent = new Folder(session) { Name = "Parent" };
            var child = new Folder(session) { Name = "Child", ParentFolder = parent };
            parent.Save();
            child.Save();

            var file = new ModelFile(session)
            {
                Name = "widget.stl",
                Type = ModelFileType.Stl,
                SizeBytes = 1024,
                AddedAt = DateTime.UtcNow,
                StoragePath = "/data/files/widget.stl",
            };
            file.Save();

            var fileFolder = new FileFolder(session) { File = file, Folder = child };
            fileFolder.Save();

            var tag = new Tag(session) { Name = "PLA" };
            tag.Save();

            var fileTag = new FileTag(session) { File = file, Tag = tag };
            fileTag.Save();

            session.CommitTransaction();
        }

        using var verifySession = _factory.CreateSession();

        var allFolders = new DevExpress.Xpo.XPCollection<Folder>(verifySession);
        var childFolder = System.Linq.Enumerable.Single(allFolders, f => f.Name == "Child");
        var parentFolder = System.Linq.Enumerable.Single(allFolders, f => f.Name == "Parent");

        Assert.Equal(parentFolder.Oid, childFolder.ParentFolder!.Oid);
        Assert.Single(childFolder.FileFolders);
        Assert.Single(parentFolder.Children);

        var reloadedFile = System.Linq.Enumerable.Single(new DevExpress.Xpo.XPCollection<ModelFile>(verifySession));
        Assert.Single(reloadedFile.FileFolders);
        Assert.Single(reloadedFile.FileTags);
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

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && dotnet test PlasticRoom.Api.Tests --filter EntitySchemaTests`
Expected: FAIL to build — `Folder`, `ModelFile`, `FileFolder`, `Tag`, `FileTag` do not exist.

- [ ] **Step 3: Create `backend/PlasticRoom.Api/Entities/ModelFileType.cs`**

```csharp
namespace PlasticRoom.Api.Entities;

public enum ModelFileType
{
    ThreeMf,
    Stl,
}
```

- [ ] **Step 4: Create `backend/PlasticRoom.Api/Entities/ModelFile.cs`**

```csharp
using DevExpress.Xpo;

namespace PlasticRoom.Api.Entities;

[Persistent("File")]
public class ModelFile : XPObject
{
    public ModelFile(Session session) : base(session)
    {
    }

    private string name = string.Empty;
    public string Name
    {
        get => name;
        set => SetPropertyValue(nameof(Name), ref name, value);
    }

    private ModelFileType type;
    public ModelFileType Type
    {
        get => type;
        set => SetPropertyValue(nameof(Type), ref type, value);
    }

    private long sizeBytes;
    public long SizeBytes
    {
        get => sizeBytes;
        set => SetPropertyValue(nameof(SizeBytes), ref sizeBytes, value);
    }

    private System.DateTime addedAt;
    public System.DateTime AddedAt
    {
        get => addedAt;
        set => SetPropertyValue(nameof(AddedAt), ref addedAt, value);
    }

    private double? dimXMm;
    public double? DimXMm
    {
        get => dimXMm;
        set => SetPropertyValue(nameof(DimXMm), ref dimXMm, value);
    }

    private double? dimYMm;
    public double? DimYMm
    {
        get => dimYMm;
        set => SetPropertyValue(nameof(DimYMm), ref dimYMm, value);
    }

    private double? dimZMm;
    public double? DimZMm
    {
        get => dimZMm;
        set => SetPropertyValue(nameof(DimZMm), ref dimZMm, value);
    }

    private int? plateCount;
    public int? PlateCount
    {
        get => plateCount;
        set => SetPropertyValue(nameof(PlateCount), ref plateCount, value);
    }

    private int? estPrintTimeMin;
    public int? EstPrintTimeMin
    {
        get => estPrintTimeMin;
        set => SetPropertyValue(nameof(EstPrintTimeMin), ref estPrintTimeMin, value);
    }

    private string? material;
    public string? Material
    {
        get => material;
        set => SetPropertyValue(nameof(Material), ref material, value);
    }

    private double? layerHeightMm;
    public double? LayerHeightMm
    {
        get => layerHeightMm;
        set => SetPropertyValue(nameof(LayerHeightMm), ref layerHeightMm, value);
    }

    private string? sourceUrl;
    public string? SourceUrl
    {
        get => sourceUrl;
        set => SetPropertyValue(nameof(SourceUrl), ref sourceUrl, value);
    }

    private string? creator;
    public string? Creator
    {
        get => creator;
        set => SetPropertyValue(nameof(Creator), ref creator, value);
    }

    private string? description;
    public string? Description
    {
        get => description;
        set => SetPropertyValue(nameof(Description), ref description, value);
    }

    private string storagePath = string.Empty;
    public string StoragePath
    {
        get => storagePath;
        set => SetPropertyValue(nameof(StoragePath), ref storagePath, value);
    }

    private string? thumbnailPath;
    public string? ThumbnailPath
    {
        get => thumbnailPath;
        set => SetPropertyValue(nameof(ThumbnailPath), ref thumbnailPath, value);
    }

    [Association("File-FileFolders")]
    public XPCollection<FileFolder> FileFolders => GetCollection<FileFolder>(nameof(FileFolders));

    [Association("File-FileTags")]
    public XPCollection<FileTag> FileTags => GetCollection<FileTag>(nameof(FileTags));
}
```

- [ ] **Step 5: Create `backend/PlasticRoom.Api/Entities/Folder.cs`**

```csharp
using DevExpress.Xpo;

namespace PlasticRoom.Api.Entities;

public class Folder : XPObject
{
    public Folder(Session session) : base(session)
    {
    }

    private string name = string.Empty;
    public string Name
    {
        get => name;
        set => SetPropertyValue(nameof(Name), ref name, value);
    }

    private Folder? parentFolder;
    [Association("Folder-Children")]
    public Folder? ParentFolder
    {
        get => parentFolder;
        set => SetPropertyValue(nameof(ParentFolder), ref parentFolder, value);
    }

    [Association("Folder-Children")]
    public XPCollection<Folder> Children => GetCollection<Folder>(nameof(Children));

    private string? description;
    public string? Description
    {
        get => description;
        set => SetPropertyValue(nameof(Description), ref description, value);
    }

    private ModelFile? coverImageFile;
    public ModelFile? CoverImageFile
    {
        get => coverImageFile;
        set => SetPropertyValue(nameof(CoverImageFile), ref coverImageFile, value);
    }

    private int sortOrder;
    public int SortOrder
    {
        get => sortOrder;
        set => SetPropertyValue(nameof(SortOrder), ref sortOrder, value);
    }

    private bool isSystem;
    public bool IsSystem
    {
        get => isSystem;
        set => SetPropertyValue(nameof(IsSystem), ref isSystem, value);
    }

    [Association("Folder-FileFolders")]
    public XPCollection<FileFolder> FileFolders => GetCollection<FileFolder>(nameof(FileFolders));
}
```

- [ ] **Step 6: Create `backend/PlasticRoom.Api/Entities/FileFolder.cs`**

```csharp
using DevExpress.Xpo;

namespace PlasticRoom.Api.Entities;

public class FileFolder : XPObject
{
    public FileFolder(Session session) : base(session)
    {
    }

    private ModelFile file = null!;
    [Association("File-FileFolders")]
    public ModelFile File
    {
        get => file;
        set => SetPropertyValue(nameof(File), ref file, value);
    }

    private Folder folder = null!;
    [Association("Folder-FileFolders")]
    public Folder Folder
    {
        get => folder;
        set => SetPropertyValue(nameof(Folder), ref folder, value);
    }
}
```

- [ ] **Step 7: Create `backend/PlasticRoom.Api/Entities/Tag.cs`**

```csharp
using DevExpress.Xpo;

namespace PlasticRoom.Api.Entities;

public class Tag : XPObject
{
    public Tag(Session session) : base(session)
    {
    }

    private string name = string.Empty;
    public string Name
    {
        get => name;
        set => SetPropertyValue(nameof(Name), ref name, value);
    }

    private string? colorKey;
    public string? ColorKey
    {
        get => colorKey;
        set => SetPropertyValue(nameof(ColorKey), ref colorKey, value);
    }

    [Association("Tag-FileTags")]
    public XPCollection<FileTag> FileTags => GetCollection<FileTag>(nameof(FileTags));
}
```

- [ ] **Step 8: Create `backend/PlasticRoom.Api/Entities/FileTag.cs`**

```csharp
using DevExpress.Xpo;

namespace PlasticRoom.Api.Entities;

public class FileTag : XPObject
{
    public FileTag(Session session) : base(session)
    {
    }

    private ModelFile file = null!;
    [Association("File-FileTags")]
    public ModelFile File
    {
        get => file;
        set => SetPropertyValue(nameof(File), ref file, value);
    }

    private Tag tag = null!;
    [Association("Tag-FileTags")]
    public Tag Tag
    {
        get => tag;
        set => SetPropertyValue(nameof(Tag), ref tag, value);
    }
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `cd backend && dotnet test PlasticRoom.Api.Tests --filter EntitySchemaTests`
Expected: PASS — 1 test passing.

- [ ] **Step 10: Run the full backend test suite to confirm no regressions**

Run: `cd backend && dotnet test`
Expected: PASS — all existing Phase 1 tests plus the new schema test pass.

- [ ] **Step 11: Commit**

```bash
git add backend/PlasticRoom.Api/Entities backend/PlasticRoom.Api.Tests/Entities
git commit -m "feat: add XPO entity classes for Folder, ModelFile, Tag, and join tables"
```

---

### Task 2: System folder seeding

**Files:**
- Create: `backend/PlasticRoom.Api/Data/FolderSeeder.cs`
- Create: `backend/PlasticRoom.Api.Tests/Data/FolderSeederTests.cs`
- Modify: `backend/PlasticRoom.Api/Program.cs`

**Interfaces:**
- Produces: `FolderSeeder.SystemFolderNames` (`string[]`), `FolderSeeder.SeedSystemFolders(XpoSessionFactory sessionFactory)` — called once at startup in `Program.cs`, idempotent on every call.
- Consumes: `Folder` (Task 1), `XpoSessionFactory` (Phase 1).

- [ ] **Step 1: Write the failing test**

Create `backend/PlasticRoom.Api.Tests/Data/FolderSeederTests.cs`:

```csharp
using System;
using System.IO;
using System.Linq;
using DevExpress.Xpo;
using PlasticRoom.Api.Data;
using PlasticRoom.Api.Entities;
using Xunit;

namespace PlasticRoom.Api.Tests.Data;

public class FolderSeederTests : IDisposable
{
    private readonly string _tempDir;
    private readonly XpoSessionFactory _factory;

    public FolderSeederTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), "plasticroom-seeder-tests-" + Guid.NewGuid());
        _factory = new XpoSessionFactory(_tempDir);
    }

    [Fact]
    public void SeedsAllFourSystemFolders()
    {
        FolderSeeder.SeedSystemFolders(_factory);

        using var session = _factory.CreateSession();
        var systemFolders = new XPCollection<Folder>(session).Where(f => f.IsSystem).ToList();

        Assert.Equal(4, systemFolders.Count);
        Assert.All(systemFolders, f => Assert.Null(f.ParentFolder));
        foreach (var name in FolderSeeder.SystemFolderNames)
        {
            Assert.Contains(systemFolders, f => f.Name == name);
        }
    }

    [Fact]
    public void IsIdempotentAcrossMultipleCalls()
    {
        FolderSeeder.SeedSystemFolders(_factory);
        FolderSeeder.SeedSystemFolders(_factory);

        using var session = _factory.CreateSession();
        var systemFolders = new XPCollection<Folder>(session).Where(f => f.IsSystem).ToList();

        Assert.Equal(4, systemFolders.Count);
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

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && dotnet test PlasticRoom.Api.Tests --filter FolderSeederTests`
Expected: FAIL to build — `FolderSeeder` does not exist.

- [ ] **Step 3: Implement `backend/PlasticRoom.Api/Data/FolderSeeder.cs`**

```csharp
using System.Linq;
using DevExpress.Xpo;
using PlasticRoom.Api.Entities;

namespace PlasticRoom.Api.Data;

public static class FolderSeeder
{
    public static readonly string[] SystemFolderNames =
    {
        "Favorites",
        "Printed",
        "To Print",
        "Failed Prints",
    };

    public static void SeedSystemFolders(XpoSessionFactory sessionFactory)
    {
        using var session = sessionFactory.CreateSession();

        var existingNames = new XPCollection<Folder>(session)
            .Where(f => f.IsSystem)
            .Select(f => f.Name)
            .ToList();

        foreach (var name in SystemFolderNames)
        {
            if (!existingNames.Contains(name))
            {
                new Folder(session) { Name = name, IsSystem = true }.Save();
            }
        }

        session.CommitTransaction();
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && dotnet test PlasticRoom.Api.Tests --filter FolderSeederTests`
Expected: PASS — 2 tests passing.

- [ ] **Step 5: Wire seeding into `backend/PlasticRoom.Api/Program.cs`**

Replace the file with:

```csharp
using PlasticRoom.Api.Data;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton<XpoSessionFactory>();
builder.Services.AddSingleton<FileStorage>();
builder.Services.AddControllers();
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader();
    });
});

var app = builder.Build();

FolderSeeder.SeedSystemFolders(app.Services.GetRequiredService<XpoSessionFactory>());

app.UseCors();
app.MapControllers();

app.Run();
```

Note: this references `FileStorage`, created in Task 7. Until Task 7 lands, comment out the `AddSingleton<FileStorage>()` line so the project still builds:

```csharp
// builder.Services.AddSingleton<FileStorage>(); // uncommented in Task 7
```

- [ ] **Step 6: Run the full backend test suite**

Run: `cd backend && dotnet test`
Expected: PASS — no regressions.

- [ ] **Step 7: Commit**

```bash
git add backend/PlasticRoom.Api/Data/FolderSeeder.cs backend/PlasticRoom.Api.Tests/Data backend/PlasticRoom.Api/Program.cs
git commit -m "feat: seed system collection folders idempotently at startup"
```

---

### Task 3: STL metadata parser

**Files:**
- Create: `backend/PlasticRoom.Api/Parsing/ModelMetadata.cs`
- Create: `backend/PlasticRoom.Api/Parsing/StlMetadataParser.cs`
- Create: `backend/PlasticRoom.Api.Tests/Parsing/StlMetadataParserTests.cs`

**Interfaces:**
- Produces: `ModelMetadata(double? DimXMm, double? DimYMm, double? DimZMm, int? PlateCount)` record; `StlMetadataParser.Parse(Stream stream)` returning `ModelMetadata`. Consumed by `FilesController` (Task 7).
- Consumes: nothing from other tasks.

- [ ] **Step 1: Write the failing test**

Create `backend/PlasticRoom.Api.Tests/Parsing/StlMetadataParserTests.cs`:

```csharp
using System.IO;
using PlasticRoom.Api.Parsing;
using Xunit;

namespace PlasticRoom.Api.Tests.Parsing;

public class StlMetadataParserTests
{
    private static byte[] BuildSingleTriangleStl(
        (float x, float y, float z) v1,
        (float x, float y, float z) v2,
        (float x, float y, float z) v3)
    {
        using var stream = new MemoryStream();
        using (var writer = new BinaryWriter(stream, System.Text.Encoding.ASCII, leaveOpen: true))
        {
            writer.Write(new byte[80]); // header
            writer.Write((uint)1); // triangle count

            // normal vector (unused by the parser)
            writer.Write(0f);
            writer.Write(0f);
            writer.Write(0f);

            foreach (var (x, y, z) in new[] { v1, v2, v3 })
            {
                writer.Write(x);
                writer.Write(y);
                writer.Write(z);
            }

            writer.Write((ushort)0); // attribute byte count
        }

        return stream.ToArray();
    }

    [Fact]
    public void ComputesBoundingBoxFromTriangleVertices()
    {
        var bytes = BuildSingleTriangleStl((0, 0, 0), (10, 5, 0), (0, 5, 2));
        using var stream = new MemoryStream(bytes);

        var metadata = StlMetadataParser.Parse(stream);

        Assert.Equal(10, metadata.DimXMm);
        Assert.Equal(5, metadata.DimYMm);
        Assert.Equal(2, metadata.DimZMm);
        Assert.Null(metadata.PlateCount);
    }

    [Fact]
    public void ReturnsNullDimensionsForZeroTriangles()
    {
        using var stream = new MemoryStream();
        using (var writer = new BinaryWriter(stream, System.Text.Encoding.ASCII, leaveOpen: true))
        {
            writer.Write(new byte[80]);
            writer.Write((uint)0);
        }

        stream.Position = 0;
        var metadata = StlMetadataParser.Parse(stream);

        Assert.Null(metadata.DimXMm);
        Assert.Null(metadata.DimYMm);
        Assert.Null(metadata.DimZMm);
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && dotnet test PlasticRoom.Api.Tests --filter StlMetadataParserTests`
Expected: FAIL to build — `StlMetadataParser` and `ModelMetadata` do not exist.

- [ ] **Step 3: Create `backend/PlasticRoom.Api/Parsing/ModelMetadata.cs`**

```csharp
namespace PlasticRoom.Api.Parsing;

public record ModelMetadata(double? DimXMm, double? DimYMm, double? DimZMm, int? PlateCount);
```

- [ ] **Step 4: Implement `backend/PlasticRoom.Api/Parsing/StlMetadataParser.cs`**

```csharp
using System.IO;

namespace PlasticRoom.Api.Parsing;

public static class StlMetadataParser
{
    public static ModelMetadata Parse(Stream stream)
    {
        using var reader = new BinaryReader(stream, System.Text.Encoding.ASCII, leaveOpen: true);
        reader.ReadBytes(80); // header, unused
        var triangleCount = reader.ReadUInt32();

        if (triangleCount == 0)
        {
            return new ModelMetadata(null, null, null, null);
        }

        var minX = double.MaxValue;
        var minY = double.MaxValue;
        var minZ = double.MaxValue;
        var maxX = double.MinValue;
        var maxY = double.MinValue;
        var maxZ = double.MinValue;

        for (var i = 0; i < triangleCount; i++)
        {
            reader.ReadBytes(12); // normal vector, unused

            for (var v = 0; v < 3; v++)
            {
                var x = reader.ReadSingle();
                var y = reader.ReadSingle();
                var z = reader.ReadSingle();

                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
                if (z < minZ) minZ = z;
                if (z > maxZ) maxZ = z;
            }

            reader.ReadUInt16(); // attribute byte count, unused
        }

        return new ModelMetadata(maxX - minX, maxY - minY, maxZ - minZ, null);
    }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && dotnet test PlasticRoom.Api.Tests --filter StlMetadataParserTests`
Expected: PASS — 2 tests passing.

- [ ] **Step 6: Commit**

```bash
git add backend/PlasticRoom.Api/Parsing/ModelMetadata.cs backend/PlasticRoom.Api/Parsing/StlMetadataParser.cs backend/PlasticRoom.Api.Tests/Parsing/StlMetadataParserTests.cs
git commit -m "feat: parse STL bounding-box dimensions from binary STL files"
```

---

### Task 4: 3MF metadata parser

**Files:**
- Create: `backend/PlasticRoom.Api/Parsing/ThreeMfMetadataParser.cs`
- Create: `backend/PlasticRoom.Api.Tests/Parsing/ThreeMfMetadataParserTests.cs`

**Interfaces:**
- Produces: `ThreeMfMetadataParser.Parse(Stream stream)` returning `ModelMetadata` (Task 3). Consumed by `FilesController` (Task 7).
- Consumes: `ModelMetadata` (Task 3).

- [ ] **Step 1: Write the failing test**

Create `backend/PlasticRoom.Api.Tests/Parsing/ThreeMfMetadataParserTests.cs`:

```csharp
using System.IO;
using System.IO.Compression;
using PlasticRoom.Api.Parsing;
using Xunit;

namespace PlasticRoom.Api.Tests.Parsing;

public class ThreeMfMetadataParserTests
{
    private const string ModelXml = """
        <?xml version="1.0" encoding="UTF-8"?>
        <model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
          <resources>
            <object id="1" type="model">
              <mesh>
                <vertices>
                  <vertex x="0" y="0" z="0" />
                  <vertex x="12.5" y="0" z="0" />
                  <vertex x="0" y="8" z="0" />
                  <vertex x="0" y="0" z="3.25" />
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

    private static byte[] BuildThreeMfArchive(string modelXml)
    {
        using var stream = new MemoryStream();
        using (var archive = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
        {
            var entry = archive.CreateEntry("3D/3dmodel.model");
            using var entryStream = entry.Open();
            using var writer = new StreamWriter(entryStream);
            writer.Write(modelXml);
        }

        return stream.ToArray();
    }

    [Fact]
    public void ComputesBoundingBoxAndPlateCountFromModelXml()
    {
        var bytes = BuildThreeMfArchive(ModelXml);
        using var stream = new MemoryStream(bytes);

        var metadata = ThreeMfMetadataParser.Parse(stream);

        Assert.Equal(12.5, metadata.DimXMm);
        Assert.Equal(8, metadata.DimYMm);
        Assert.Equal(3.25, metadata.DimZMm);
        Assert.Equal(1, metadata.PlateCount);
    }

    [Fact]
    public void ThrowsWhenModelEntryIsMissing()
    {
        using var stream = new MemoryStream();
        using (var archive = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
        {
            archive.CreateEntry("Metadata/unrelated.txt");
        }

        stream.Position = 0;

        Assert.Throws<InvalidDataException>(() => ThreeMfMetadataParser.Parse(stream));
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && dotnet test PlasticRoom.Api.Tests --filter ThreeMfMetadataParserTests`
Expected: FAIL to build — `ThreeMfMetadataParser` does not exist.

- [ ] **Step 3: Implement `backend/PlasticRoom.Api/Parsing/ThreeMfMetadataParser.cs`**

```csharp
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Xml.Linq;

namespace PlasticRoom.Api.Parsing;

public static class ThreeMfMetadataParser
{
    private static readonly XNamespace CoreNs = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02";

    public static ModelMetadata Parse(Stream stream)
    {
        using var archive = new ZipArchive(stream, ZipArchiveMode.Read);
        var modelEntry = archive.GetEntry("3D/3dmodel.model")
            ?? throw new InvalidDataException("3D/3dmodel.model not found in 3MF archive");

        using var modelStream = modelEntry.Open();
        var doc = XDocument.Load(modelStream);
        var root = doc.Root ?? throw new InvalidDataException("3MF model file has no root element");

        var minX = double.MaxValue;
        var minY = double.MaxValue;
        var minZ = double.MaxValue;
        var maxX = double.MinValue;
        var maxY = double.MinValue;
        var maxZ = double.MinValue;
        var anyVertex = false;

        foreach (var vertex in root.Descendants(CoreNs + "vertex"))
        {
            anyVertex = true;
            var x = double.Parse(vertex.Attribute("x")!.Value, CultureInfo.InvariantCulture);
            var y = double.Parse(vertex.Attribute("y")!.Value, CultureInfo.InvariantCulture);
            var z = double.Parse(vertex.Attribute("z")!.Value, CultureInfo.InvariantCulture);

            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            if (z < minZ) minZ = z;
            if (z > maxZ) maxZ = z;
        }

        var plateCount = root.Element(CoreNs + "build")?.Elements(CoreNs + "item").Count() ?? 0;

        if (!anyVertex)
        {
            return new ModelMetadata(null, null, null, plateCount);
        }

        return new ModelMetadata(maxX - minX, maxY - minY, maxZ - minZ, plateCount);
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && dotnet test PlasticRoom.Api.Tests --filter ThreeMfMetadataParserTests`
Expected: PASS — 2 tests passing.

- [ ] **Step 5: Commit**

```bash
git add backend/PlasticRoom.Api/Parsing/ThreeMfMetadataParser.cs backend/PlasticRoom.Api.Tests/Parsing/ThreeMfMetadataParserTests.cs
git commit -m "feat: parse 3MF bounding-box dimensions and plate count"
```

---

### Task 5: FoldersController

**Files:**
- Create: `backend/PlasticRoom.Api/Dtos/FolderDtos.cs`
- Create: `backend/PlasticRoom.Api/Controllers/FoldersController.cs`
- Create: `backend/PlasticRoom.Api.Tests/Controllers/FoldersControllerTests.cs`

**Interfaces:**
- Produces: `FolderDto(int Id, string Name, int? ParentId, string? Description, int? CoverImageFileId, int SortOrder, bool IsSystem)`, `CreateFolderRequest(string Name, int? ParentId, string? Description)`, `UpdateFolderRequest(string? Name, int? ParentId, string? Description, int? SortOrder, int? CoverImageFileId)`. Routes: `GET/POST /api/folders`, `PUT/DELETE /api/folders/{id}`.
- Consumes: `Folder`, `ModelFile`, `FileFolder` (Task 1); `XpoSessionFactory` (Phase 1).

- [ ] **Step 1: Write the failing tests**

Create `backend/PlasticRoom.Api.Tests/Controllers/FoldersControllerTests.cs`:

```csharp
using System;
using System.IO;
using System.Linq;
using Microsoft.AspNetCore.Mvc;
using PlasticRoom.Api.Controllers;
using PlasticRoom.Api.Data;
using PlasticRoom.Api.Dtos;
using PlasticRoom.Api.Entities;
using Xunit;

namespace PlasticRoom.Api.Tests.Controllers;

public class FoldersControllerTests : IDisposable
{
    private readonly string _tempDir;
    private readonly XpoSessionFactory _factory;
    private readonly FoldersController _controller;

    public FoldersControllerTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), "plasticroom-folders-controller-tests-" + Guid.NewGuid());
        _factory = new XpoSessionFactory(_tempDir);
        _controller = new FoldersController(_factory);
    }

    [Fact]
    public void Create_ThenGetAll_ReturnsTheNewFolder()
    {
        var createResult = _controller.Create(new CreateFolderRequest("Miniatures", null, "Small stuff"));
        var created = Assert.IsType<FolderDto>(Assert.IsType<CreatedAtActionResult>(createResult).Value);

        var getAllResult = Assert.IsType<OkObjectResult>(_controller.GetAll());
        var folders = Assert.IsAssignableFrom<System.Collections.Generic.List<FolderDto>>(getAllResult.Value);

        Assert.Contains(folders, f => f.Id == created.Id && f.Name == "Miniatures" && !f.IsSystem);
    }

    [Fact]
    public void Update_RenamesNonSystemFolder()
    {
        var created = (FolderDto)Assert.IsType<CreatedAtActionResult>(
            _controller.Create(new CreateFolderRequest("Old Name", null, null))).Value!;

        var updateResult = _controller.Update(created.Id, new UpdateFolderRequest("New Name", null, null, null, null));
        var updated = Assert.IsType<FolderDto>(Assert.IsType<OkObjectResult>(updateResult).Value);

        Assert.Equal("New Name", updated.Name);
    }

    [Fact]
    public void Update_RejectsRenameOfSystemFolder()
    {
        FolderSeeder.SeedSystemFolders(_factory);
        using var session = _factory.CreateSession();
        var systemFolder = new DevExpress.Xpo.XPCollection<Folder>(session).First(f => f.IsSystem);

        var result = _controller.Update(systemFolder.Oid, new UpdateFolderRequest("Renamed", null, null, null, null));

        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal(400, badRequest.StatusCode);
    }

    [Fact]
    public void Delete_RejectsSystemFolder()
    {
        FolderSeeder.SeedSystemFolders(_factory);
        using var session = _factory.CreateSession();
        var systemFolder = new DevExpress.Xpo.XPCollection<Folder>(session).First(f => f.IsSystem);

        var result = _controller.Delete(systemFolder.Oid);

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public void Delete_CascadesToChildFoldersAndFileFolderRows()
    {
        var parent = (FolderDto)Assert.IsType<CreatedAtActionResult>(
            _controller.Create(new CreateFolderRequest("Parent", null, null))).Value!;
        var child = (FolderDto)Assert.IsType<CreatedAtActionResult>(
            _controller.Create(new CreateFolderRequest("Child", parent.Id, null))).Value!;

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
            var childFolder = session.GetObjectByKey<Folder>(child.Id);
            new FileFolder(session) { File = file, Folder = childFolder! }.Save();
            session.CommitTransaction();
        }

        var deleteResult = _controller.Delete(parent.Id);
        Assert.IsType<NoContentResult>(deleteResult);

        using var verifySession = _factory.CreateSession();
        Assert.Null(verifySession.GetObjectByKey<Folder>(parent.Id));
        Assert.Null(verifySession.GetObjectByKey<Folder>(child.Id));
        Assert.Empty(new DevExpress.Xpo.XPCollection<FileFolder>(verifySession));
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

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && dotnet test PlasticRoom.Api.Tests --filter FoldersControllerTests`
Expected: FAIL to build — `FoldersController`, `FolderDto`, `CreateFolderRequest`, `UpdateFolderRequest` do not exist.

- [ ] **Step 3: Create `backend/PlasticRoom.Api/Dtos/FolderDtos.cs`**

```csharp
namespace PlasticRoom.Api.Dtos;

public record FolderDto(
    int Id,
    string Name,
    int? ParentId,
    string? Description,
    int? CoverImageFileId,
    int SortOrder,
    bool IsSystem);

public record CreateFolderRequest(string Name, int? ParentId, string? Description);

public record UpdateFolderRequest(
    string? Name,
    int? ParentId,
    string? Description,
    int? SortOrder,
    int? CoverImageFileId);
```

- [ ] **Step 4: Implement `backend/PlasticRoom.Api/Controllers/FoldersController.cs`**

```csharp
using System.Linq;
using DevExpress.Xpo;
using Microsoft.AspNetCore.Mvc;
using PlasticRoom.Api.Data;
using PlasticRoom.Api.Dtos;
using PlasticRoom.Api.Entities;

namespace PlasticRoom.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class FoldersController : ControllerBase
{
    private readonly XpoSessionFactory _sessionFactory;

    public FoldersController(XpoSessionFactory sessionFactory)
    {
        _sessionFactory = sessionFactory;
    }

    [HttpGet]
    public IActionResult GetAll()
    {
        using var session = _sessionFactory.CreateSession();
        var folders = new XPCollection<Folder>(session).Select(ToDto).ToList();
        return Ok(folders);
    }

    [HttpPost]
    public IActionResult Create([FromBody] CreateFolderRequest request)
    {
        using var session = _sessionFactory.CreateSession();

        Folder? parent = null;
        if (request.ParentId is int parentId)
        {
            parent = session.GetObjectByKey<Folder>(parentId);
            if (parent is null)
            {
                return NotFound(new { error = $"Parent folder {parentId} not found" });
            }
        }

        var folder = new Folder(session)
        {
            Name = request.Name,
            ParentFolder = parent,
            Description = request.Description,
            IsSystem = false,
        };
        folder.Save();
        session.CommitTransaction();

        return CreatedAtAction(nameof(GetAll), new { }, ToDto(folder));
    }

    [HttpPut("{id}")]
    public IActionResult Update(int id, [FromBody] UpdateFolderRequest request)
    {
        using var session = _sessionFactory.CreateSession();
        var folder = session.GetObjectByKey<Folder>(id);
        if (folder is null)
        {
            return NotFound(new { error = $"Folder {id} not found" });
        }

        if (folder.IsSystem && (request.Name is not null || request.ParentId is not null))
        {
            return BadRequest(new { error = "System folders cannot be renamed or reparented" });
        }

        if (request.Name is not null)
        {
            folder.Name = request.Name;
        }

        if (request.ParentId is int parentId)
        {
            var parent = session.GetObjectByKey<Folder>(parentId);
            if (parent is null)
            {
                return NotFound(new { error = $"Parent folder {parentId} not found" });
            }

            folder.ParentFolder = parent;
        }

        if (request.Description is not null)
        {
            folder.Description = request.Description;
        }

        if (request.SortOrder is int sortOrder)
        {
            folder.SortOrder = sortOrder;
        }

        if (request.CoverImageFileId is int coverId)
        {
            var cover = session.GetObjectByKey<ModelFile>(coverId);
            if (cover is null)
            {
                return NotFound(new { error = $"File {coverId} not found" });
            }

            folder.CoverImageFile = cover;
        }

        folder.Save();
        session.CommitTransaction();
        return Ok(ToDto(folder));
    }

    [HttpDelete("{id}")]
    public IActionResult Delete(int id)
    {
        using var session = _sessionFactory.CreateSession();
        var folder = session.GetObjectByKey<Folder>(id);
        if (folder is null)
        {
            return NotFound(new { error = $"Folder {id} not found" });
        }

        if (folder.IsSystem)
        {
            return BadRequest(new { error = "System folders cannot be deleted" });
        }

        DeleteFolderRecursive(folder);
        session.CommitTransaction();
        return NoContent();
    }

    private static void DeleteFolderRecursive(Folder folder)
    {
        foreach (var child in folder.Children.ToList())
        {
            DeleteFolderRecursive(child);
        }

        foreach (var fileFolder in folder.FileFolders.ToList())
        {
            fileFolder.Delete();
        }

        folder.Delete();
    }

    private static FolderDto ToDto(Folder folder) => new(
        folder.Oid,
        folder.Name,
        folder.ParentFolder?.Oid,
        folder.Description,
        folder.CoverImageFile?.Oid,
        folder.SortOrder,
        folder.IsSystem);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && dotnet test PlasticRoom.Api.Tests --filter FoldersControllerTests`
Expected: PASS — 5 tests passing.

- [ ] **Step 6: Run the full backend test suite**

Run: `cd backend && dotnet test`
Expected: PASS — no regressions.

- [ ] **Step 7: Commit**

```bash
git add backend/PlasticRoom.Api/Dtos/FolderDtos.cs backend/PlasticRoom.Api/Controllers/FoldersController.cs backend/PlasticRoom.Api.Tests/Controllers/FoldersControllerTests.cs
git commit -m "feat: add folder CRUD endpoints with system-folder protection and cascade delete"
```

---

### Task 6: TagsController

**Files:**
- Create: `backend/PlasticRoom.Api/Dtos/TagDtos.cs`
- Create: `backend/PlasticRoom.Api/Controllers/TagsController.cs`
- Create: `backend/PlasticRoom.Api.Tests/Controllers/TagsControllerTests.cs`

**Interfaces:**
- Produces: `TagDto(int Id, string Name, string? ColorKey)`, `CreateTagRequest(string Name, string? ColorKey)`. Routes: `GET/POST /api/tags`. Consumed by `FilesController` (Task 9) for tag-id lookups.
- Consumes: `Tag` (Task 1); `XpoSessionFactory` (Phase 1).

- [ ] **Step 1: Write the failing tests**

Create `backend/PlasticRoom.Api.Tests/Controllers/TagsControllerTests.cs`:

```csharp
using System;
using System.Collections.Generic;
using System.IO;
using Microsoft.AspNetCore.Mvc;
using PlasticRoom.Api.Controllers;
using PlasticRoom.Api.Data;
using PlasticRoom.Api.Dtos;
using Xunit;

namespace PlasticRoom.Api.Tests.Controllers;

public class TagsControllerTests : IDisposable
{
    private readonly string _tempDir;
    private readonly TagsController _controller;

    public TagsControllerTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), "plasticroom-tags-controller-tests-" + Guid.NewGuid());
        _controller = new TagsController(new XpoSessionFactory(_tempDir));
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

    public void Dispose()
    {
        if (Directory.Exists(_tempDir))
        {
            Directory.Delete(_tempDir, recursive: true);
        }
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && dotnet test PlasticRoom.Api.Tests --filter TagsControllerTests`
Expected: FAIL to build — `TagsController`, `TagDto`, `CreateTagRequest` do not exist.

- [ ] **Step 3: Create `backend/PlasticRoom.Api/Dtos/TagDtos.cs`**

```csharp
namespace PlasticRoom.Api.Dtos;

public record TagDto(int Id, string Name, string? ColorKey);

public record CreateTagRequest(string Name, string? ColorKey);
```

- [ ] **Step 4: Implement `backend/PlasticRoom.Api/Controllers/TagsController.cs`**

```csharp
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
        session.CommitTransaction();

        return CreatedAtAction(nameof(GetAll), new { }, ToDto(tag));
    }

    private static TagDto ToDto(Tag tag) => new(tag.Oid, tag.Name, tag.ColorKey);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && dotnet test PlasticRoom.Api.Tests --filter TagsControllerTests`
Expected: PASS — 1 test passing.

- [ ] **Step 6: Commit**

```bash
git add backend/PlasticRoom.Api/Dtos/TagDtos.cs backend/PlasticRoom.Api/Controllers/TagsController.cs backend/PlasticRoom.Api.Tests/Controllers/TagsControllerTests.cs
git commit -m "feat: add tag list/create endpoints"
```

---

### Task 7: FileStorage service and file upload/list/get endpoints

**Files:**
- Create: `backend/PlasticRoom.Api/Data/FileStorage.cs`
- Create: `backend/PlasticRoom.Api/Dtos/ModelFileDtos.cs`
- Create: `backend/PlasticRoom.Api/Controllers/FilesController.cs`
- Create: `backend/PlasticRoom.Api.Tests/Controllers/FilesControllerTests.cs`
- Modify: `backend/PlasticRoom.Api/Program.cs`

**Interfaces:**
- Produces: `FileStorage` (`FilesDirectory`, `ThumbsDirectory` — both created on construction); `ModelFileDto` (full field list per spec, plus `FolderIds`/`TagIds`); `UploadFileRequest` (`IFormFile File`, `string? SourceUrl`, `string? Creator`, `List<int>? FolderIds`, `List<int>? TagIds`); `UpdateFileRequest`; `IdListRequest(List<int> Ids)`. Routes: `GET /api/files`, `GET /api/files/{id}`, `POST /api/files`.
- Consumes: `ModelFile`, `Folder`, `FileFolder`, `Tag`, `FileTag` (Task 1); `ModelMetadata`, `StlMetadataParser`, `ThreeMfMetadataParser` (Tasks 3–4); `XpoSessionFactory` (Phase 1).

- [ ] **Step 1: Write the failing tests**

Create `backend/PlasticRoom.Api.Tests/Controllers/FilesControllerTests.cs`:

```csharp
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using PlasticRoom.Api.Controllers;
using PlasticRoom.Api.Data;
using PlasticRoom.Api.Dtos;
using Xunit;

namespace PlasticRoom.Api.Tests.Controllers;

public class FilesControllerTests : IDisposable
{
    private readonly string _tempDataDir;
    private readonly XpoSessionFactory _sessionFactory;
    private readonly FileStorage _fileStorage;
    private readonly FilesController _controller;

    public FilesControllerTests()
    {
        _tempDataDir = Path.Combine(Path.GetTempPath(), "plasticroom-files-controller-tests-" + Guid.NewGuid());
        _sessionFactory = new XpoSessionFactory(_tempDataDir);
        _fileStorage = new FileStorage(_tempDataDir);
        _controller = new FilesController(_sessionFactory, _fileStorage);
    }

    private static IFormFile BuildStlFormFile(string fileName)
    {
        using var stream = new MemoryStream();
        using (var writer = new BinaryWriter(stream, Encoding.ASCII, leaveOpen: true))
        {
            writer.Write(new byte[80]);
            writer.Write((uint)1);
            writer.Write(0f); writer.Write(0f); writer.Write(0f); // normal
            writer.Write(0f); writer.Write(0f); writer.Write(0f);
            writer.Write(10f); writer.Write(0f); writer.Write(0f);
            writer.Write(0f); writer.Write(5f); writer.Write(0f);
            writer.Write((ushort)0);
        }

        var bytes = stream.ToArray();
        return new FormFile(new MemoryStream(bytes), 0, bytes.Length, "file", fileName);
    }

    [Fact]
    public async System.Threading.Tasks.Task Upload_ParsesStlAndCreatesFileRecord()
    {
        var request = new UploadFileRequest { File = BuildStlFormFile("widget.stl") };

        var result = await _controller.Upload(request);

        var dto = Assert.IsType<ModelFileDto>(Assert.IsType<CreatedAtActionResult>(result).Value);
        Assert.Equal("widget.stl", dto.Name);
        Assert.Equal("Stl", dto.Type);
        Assert.Equal(10, dto.DimXMm);
        Assert.Equal(5, dto.DimYMm);
        Assert.Single(Directory.GetFiles(_fileStorage.FilesDirectory));
    }

    [Fact]
    public async System.Threading.Tasks.Task Upload_RejectsUnsupportedExtension()
    {
        var bytes = new byte[] { 1, 2, 3 };
        var formFile = new FormFile(new MemoryStream(bytes), 0, bytes.Length, "file", "model.obj");
        var request = new UploadFileRequest { File = formFile };

        var result = await _controller.Upload(request);

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async System.Threading.Tasks.Task Upload_RejectsMalformedSourceUrl()
    {
        var request = new UploadFileRequest { File = BuildStlFormFile("widget.stl"), SourceUrl = "not a url" };

        var result = await _controller.Upload(request);

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async System.Threading.Tasks.Task GetAll_FiltersByFolderId()
    {
        await _controller.Upload(new UploadFileRequest { File = BuildStlFormFile("a.stl") });
        var uploadedB = (ModelFileDto)Assert.IsType<CreatedAtActionResult>(
            (await _controller.Upload(new UploadFileRequest { File = BuildStlFormFile("b.stl") }))).Value!;

        int folderId;
        using (var session = _sessionFactory.CreateSession())
        {
            var folder = new PlasticRoom.Api.Entities.Folder(session) { Name = "Bucket" };
            folder.Save();
            var file = session.GetObjectByKey<PlasticRoom.Api.Entities.ModelFile>(uploadedB.Id);
            new PlasticRoom.Api.Entities.FileFolder(session) { File = file!, Folder = folder }.Save();
            session.CommitTransaction();
            folderId = folder.Oid;
        }

        var result = Assert.IsType<OkObjectResult>(_controller.GetAll(folderId));
        var files = Assert.IsAssignableFrom<List<ModelFileDto>>(result.Value);

        Assert.Single(files);
        Assert.Equal(uploadedB.Id, files[0].Id);
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

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && dotnet test PlasticRoom.Api.Tests --filter FilesControllerTests`
Expected: FAIL to build — `FileStorage`, `FilesController`, `ModelFileDto`, `UploadFileRequest` do not exist.

- [ ] **Step 3: Create `backend/PlasticRoom.Api/Data/FileStorage.cs`**

```csharp
using System;
using System.IO;

namespace PlasticRoom.Api.Data;

public class FileStorage
{
    public string FilesDirectory { get; }

    public string ThumbsDirectory { get; }

    public FileStorage(string? dataPath = null)
    {
        var resolvedDataPath = dataPath
            ?? Environment.GetEnvironmentVariable("DATA_PATH")
            ?? "/data";

        FilesDirectory = Path.Combine(resolvedDataPath, "files");
        ThumbsDirectory = Path.Combine(resolvedDataPath, "thumbs");

        Directory.CreateDirectory(FilesDirectory);
        Directory.CreateDirectory(ThumbsDirectory);
    }
}
```

- [ ] **Step 4: Create `backend/PlasticRoom.Api/Dtos/ModelFileDtos.cs`**

```csharp
using System;
using System.Collections.Generic;
using Microsoft.AspNetCore.Http;

namespace PlasticRoom.Api.Dtos;

public record ModelFileDto(
    int Id,
    string Name,
    string Type,
    long SizeBytes,
    DateTime AddedAt,
    double? DimXMm,
    double? DimYMm,
    double? DimZMm,
    int? PlateCount,
    int? EstPrintTimeMin,
    string? Material,
    double? LayerHeightMm,
    string? SourceUrl,
    string? Creator,
    string? Description,
    string? ThumbnailPath,
    IReadOnlyList<int> FolderIds,
    IReadOnlyList<int> TagIds);

public class UploadFileRequest
{
    public IFormFile File { get; set; } = null!;

    public string? SourceUrl { get; set; }

    public string? Creator { get; set; }

    public List<int>? FolderIds { get; set; }

    public List<int>? TagIds { get; set; }
}

public record UpdateFileRequest(
    string? Description,
    string? Material,
    int? EstPrintTimeMin,
    double? LayerHeightMm,
    string? SourceUrl,
    string? Creator);

public record IdListRequest(List<int> Ids);
```

- [ ] **Step 5: Implement `backend/PlasticRoom.Api/Controllers/FilesController.cs`**

```csharp
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using DevExpress.Xpo;
using Microsoft.AspNetCore.Mvc;
using PlasticRoom.Api.Data;
using PlasticRoom.Api.Dtos;
using PlasticRoom.Api.Entities;
using PlasticRoom.Api.Parsing;

namespace PlasticRoom.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class FilesController : ControllerBase
{
    private readonly XpoSessionFactory _sessionFactory;
    private readonly FileStorage _fileStorage;

    public FilesController(XpoSessionFactory sessionFactory, FileStorage fileStorage)
    {
        _sessionFactory = sessionFactory;
        _fileStorage = fileStorage;
    }

    [HttpGet]
    public IActionResult GetAll([FromQuery] int? folderId)
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

            files = folder.FileFolders.Select(ff => ff.File).ToList();
        }
        else
        {
            files = new XPCollection<ModelFile>(session).ToList();
        }

        return Ok(files.Select(ToDto).ToList());
    }

    [HttpGet("{id}")]
    public IActionResult GetById(int id)
    {
        using var session = _sessionFactory.CreateSession();
        var file = session.GetObjectByKey<ModelFile>(id);
        if (file is null)
        {
            return NotFound(new { error = $"File {id} not found" });
        }

        return Ok(ToDto(file));
    }

    [HttpPost]
    public async Task<IActionResult> Upload([FromForm] UploadFileRequest request)
    {
        if (request.File is null || request.File.Length == 0)
        {
            return BadRequest(new { error = "A file is required" });
        }

        var extension = Path.GetExtension(request.File.FileName).ToLowerInvariant();
        ModelFileType type;
        if (extension == ".3mf")
        {
            type = ModelFileType.ThreeMf;
        }
        else if (extension == ".stl")
        {
            type = ModelFileType.Stl;
        }
        else
        {
            return BadRequest(new { error = "Only .3mf and .stl files are supported" });
        }

        if (!TryValidateSourceUrl(request.SourceUrl, out var sourceUrlError))
        {
            return BadRequest(new { error = sourceUrlError });
        }

        var storedFileName = $"{Guid.NewGuid()}{extension}";
        var storagePath = Path.Combine(_fileStorage.FilesDirectory, storedFileName);

        using (var destination = System.IO.File.Create(storagePath))
        {
            await request.File.CopyToAsync(destination);
        }

        ModelMetadata metadata;
        try
        {
            using var readStream = System.IO.File.OpenRead(storagePath);
            metadata = type == ModelFileType.ThreeMf
                ? ThreeMfMetadataParser.Parse(readStream)
                : StlMetadataParser.Parse(readStream);
        }
        catch (InvalidDataException ex)
        {
            System.IO.File.Delete(storagePath);
            return BadRequest(new { error = ex.Message });
        }

        using var session = _sessionFactory.CreateSession();

        var modelFile = new ModelFile(session)
        {
            Name = request.File.FileName,
            Type = type,
            SizeBytes = request.File.Length,
            AddedAt = DateTime.UtcNow,
            DimXMm = metadata.DimXMm,
            DimYMm = metadata.DimYMm,
            DimZMm = metadata.DimZMm,
            PlateCount = metadata.PlateCount,
            SourceUrl = request.SourceUrl,
            Creator = request.Creator,
            StoragePath = storagePath,
        };
        modelFile.Save();

        if (request.FolderIds is { Count: > 0 })
        {
            foreach (var folderId in request.FolderIds)
            {
                var folder = session.GetObjectByKey<Folder>(folderId);
                if (folder is null)
                {
                    System.IO.File.Delete(storagePath);
                    return NotFound(new { error = $"Folder {folderId} not found" });
                }

                new FileFolder(session) { File = modelFile, Folder = folder }.Save();
            }
        }

        if (request.TagIds is { Count: > 0 })
        {
            foreach (var tagId in request.TagIds)
            {
                var tag = session.GetObjectByKey<Tag>(tagId);
                if (tag is null)
                {
                    System.IO.File.Delete(storagePath);
                    return NotFound(new { error = $"Tag {tagId} not found" });
                }

                new FileTag(session) { File = modelFile, Tag = tag }.Save();
            }
        }

        session.CommitTransaction();

        return CreatedAtAction(nameof(GetById), new { id = modelFile.Oid }, ToDto(modelFile));
    }

    private static bool TryValidateSourceUrl(string? sourceUrl, out string? error)
    {
        error = null;
        if (string.IsNullOrEmpty(sourceUrl))
        {
            return true;
        }

        if (!Uri.TryCreate(sourceUrl, UriKind.Absolute, out _))
        {
            error = "sourceUrl must be a well-formed absolute URL";
            return false;
        }

        return true;
    }

    private static ModelFileDto ToDto(ModelFile file) => new(
        file.Oid,
        file.Name,
        file.Type.ToString(),
        file.SizeBytes,
        file.AddedAt,
        file.DimXMm,
        file.DimYMm,
        file.DimZMm,
        file.PlateCount,
        file.EstPrintTimeMin,
        file.Material,
        file.LayerHeightMm,
        file.SourceUrl,
        file.Creator,
        file.Description,
        file.ThumbnailPath,
        file.FileFolders.Select(ff => ff.Folder.Oid).ToList(),
        file.FileTags.Select(ft => ft.Tag.Oid).ToList());
}
```

- [ ] **Step 6: Uncomment `FileStorage` registration in `backend/PlasticRoom.Api/Program.cs`**

Change:
```csharp
// builder.Services.AddSingleton<FileStorage>(); // uncommented in Task 7
```
to:
```csharp
builder.Services.AddSingleton<FileStorage>();
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd backend && dotnet test PlasticRoom.Api.Tests --filter FilesControllerTests`
Expected: PASS — 4 tests passing.

- [ ] **Step 8: Run the full backend test suite**

Run: `cd backend && dotnet test`
Expected: PASS — no regressions.

- [ ] **Step 9: Commit**

```bash
git add backend/PlasticRoom.Api/Data/FileStorage.cs backend/PlasticRoom.Api/Dtos/ModelFileDtos.cs backend/PlasticRoom.Api/Controllers/FilesController.cs backend/PlasticRoom.Api.Tests/Controllers/FilesControllerTests.cs backend/PlasticRoom.Api/Program.cs
git commit -m "feat: add file upload, list, and get endpoints with metadata parsing"
```

---

### Task 8: File update, delete, and thumbnail upload endpoints

**Files:**
- Modify: `backend/PlasticRoom.Api/Controllers/FilesController.cs`
- Modify: `backend/PlasticRoom.Api.Tests/Controllers/FilesControllerTests.cs`

**Interfaces:**
- Produces: `PUT /api/files/{id}`, `DELETE /api/files/{id}`, `POST /api/files/{id}/thumbnail` on `FilesController`.
- Consumes: `UpdateFileRequest` (Task 7), `ModelFile` (Task 1), `FileStorage` (Task 7).

- [ ] **Step 1: Add the failing tests**

Append to `backend/PlasticRoom.Api.Tests/Controllers/FilesControllerTests.cs`, inside the `FilesControllerTests` class (before the closing `Dispose` region is fine — add as new `[Fact]` methods):

```csharp
    [Fact]
    public async System.Threading.Tasks.Task Update_SetsEditableFieldsOnly()
    {
        var uploaded = (ModelFileDto)Assert.IsType<CreatedAtActionResult>(
            (await _controller.Upload(new UploadFileRequest { File = BuildStlFormFile("a.stl") }))).Value!;

        var result = _controller.Update(uploaded.Id, new UpdateFileRequest(
            "A nice widget", "PLA", 120, 0.2, "https://example.com/model", "Jane Doe"));

        var dto = Assert.IsType<ModelFileDto>(Assert.IsType<OkObjectResult>(result).Value);
        Assert.Equal("A nice widget", dto.Description);
        Assert.Equal("PLA", dto.Material);
        Assert.Equal(120, dto.EstPrintTimeMin);
        Assert.Equal(0.2, dto.LayerHeightMm);
        Assert.Equal("https://example.com/model", dto.SourceUrl);
        Assert.Equal("Jane Doe", dto.Creator);
        Assert.Equal(10, dto.DimXMm); // unchanged, not editable
    }

    [Fact]
    public async System.Threading.Tasks.Task Update_RejectsMalformedSourceUrl()
    {
        var uploaded = (ModelFileDto)Assert.IsType<CreatedAtActionResult>(
            (await _controller.Upload(new UploadFileRequest { File = BuildStlFormFile("a.stl") }))).Value!;

        var result = _controller.Update(uploaded.Id, new UpdateFileRequest(null, null, null, null, "not a url", null));

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async System.Threading.Tasks.Task Delete_RemovesFileRecordAndBlobFromDisk()
    {
        var uploaded = (ModelFileDto)Assert.IsType<CreatedAtActionResult>(
            (await _controller.Upload(new UploadFileRequest { File = BuildStlFormFile("a.stl") }))).Value!;
        var storedFilePath = Directory.GetFiles(_fileStorage.FilesDirectory).Single();

        var result = _controller.Delete(uploaded.Id);

        Assert.IsType<NoContentResult>(result);
        Assert.False(System.IO.File.Exists(storedFilePath));
        Assert.IsType<NotFoundObjectResult>(_controller.GetById(uploaded.Id));
    }

    [Fact]
    public async System.Threading.Tasks.Task UploadThumbnail_WritesPngAndSetsThumbnailPath()
    {
        var uploaded = (ModelFileDto)Assert.IsType<CreatedAtActionResult>(
            (await _controller.Upload(new UploadFileRequest { File = BuildStlFormFile("a.stl") }))).Value!;

        var pngBytes = new byte[] { 0x89, 0x50, 0x4E, 0x47 };
        var pngFile = new FormFile(new MemoryStream(pngBytes), 0, pngBytes.Length, "file", "thumb.png");

        var result = await _controller.UploadThumbnail(uploaded.Id, pngFile);

        var dto = Assert.IsType<ModelFileDto>(Assert.IsType<OkObjectResult>(result).Value);
        Assert.NotNull(dto.ThumbnailPath);
        Assert.True(System.IO.File.Exists(dto.ThumbnailPath));
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && dotnet test PlasticRoom.Api.Tests --filter FilesControllerTests`
Expected: FAIL to build — `FilesController.Update`, `.Delete`, `.UploadThumbnail` do not exist.

- [ ] **Step 3: Add the endpoints to `backend/PlasticRoom.Api/Controllers/FilesController.cs`**

Add these three methods to the `FilesController` class, after `Upload`:

```csharp
    [HttpPut("{id}")]
    public IActionResult Update(int id, [FromBody] UpdateFileRequest request)
    {
        using var session = _sessionFactory.CreateSession();
        var file = session.GetObjectByKey<ModelFile>(id);
        if (file is null)
        {
            return NotFound(new { error = $"File {id} not found" });
        }

        if (!TryValidateSourceUrl(request.SourceUrl, out var sourceUrlError))
        {
            return BadRequest(new { error = sourceUrlError });
        }

        if (request.Description is not null)
        {
            file.Description = request.Description;
        }

        if (request.Material is not null)
        {
            file.Material = request.Material;
        }

        if (request.EstPrintTimeMin is int est)
        {
            file.EstPrintTimeMin = est;
        }

        if (request.LayerHeightMm is double lh)
        {
            file.LayerHeightMm = lh;
        }

        if (request.SourceUrl is not null)
        {
            file.SourceUrl = request.SourceUrl;
        }

        if (request.Creator is not null)
        {
            file.Creator = request.Creator;
        }

        file.Save();
        session.CommitTransaction();
        return Ok(ToDto(file));
    }

    [HttpDelete("{id}")]
    public IActionResult Delete(int id)
    {
        using var session = _sessionFactory.CreateSession();
        var file = session.GetObjectByKey<ModelFile>(id);
        if (file is null)
        {
            return NotFound(new { error = $"File {id} not found" });
        }

        foreach (var fileFolder in file.FileFolders.ToList())
        {
            fileFolder.Delete();
        }

        foreach (var fileTag in file.FileTags.ToList())
        {
            fileTag.Delete();
        }

        var storagePath = file.StoragePath;
        var thumbnailPath = file.ThumbnailPath;

        file.Delete();
        session.CommitTransaction();

        if (System.IO.File.Exists(storagePath))
        {
            System.IO.File.Delete(storagePath);
        }

        if (thumbnailPath is not null && System.IO.File.Exists(thumbnailPath))
        {
            System.IO.File.Delete(thumbnailPath);
        }

        return NoContent();
    }

    [HttpPost("{id}/thumbnail")]
    public async Task<IActionResult> UploadThumbnail(int id, IFormFile file)
    {
        if (file is null || file.Length == 0)
        {
            return BadRequest(new { error = "A thumbnail file is required" });
        }

        using var session = _sessionFactory.CreateSession();
        var modelFile = session.GetObjectByKey<ModelFile>(id);
        if (modelFile is null)
        {
            return NotFound(new { error = $"File {id} not found" });
        }

        var thumbnailPath = Path.Combine(_fileStorage.ThumbsDirectory, $"{id}.png");
        using (var destination = System.IO.File.Create(thumbnailPath))
        {
            await file.CopyToAsync(destination);
        }

        modelFile.ThumbnailPath = thumbnailPath;
        modelFile.Save();
        session.CommitTransaction();

        return Ok(ToDto(modelFile));
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && dotnet test PlasticRoom.Api.Tests --filter FilesControllerTests`
Expected: PASS — 8 tests passing.

- [ ] **Step 5: Run the full backend test suite**

Run: `cd backend && dotnet test`
Expected: PASS — no regressions.

- [ ] **Step 6: Commit**

```bash
git add backend/PlasticRoom.Api/Controllers/FilesController.cs backend/PlasticRoom.Api.Tests/Controllers/FilesControllerTests.cs
git commit -m "feat: add file update, delete, and thumbnail upload endpoints"
```

---

### Task 9: File folder/tag assignment endpoints

**Files:**
- Modify: `backend/PlasticRoom.Api/Controllers/FilesController.cs`
- Modify: `backend/PlasticRoom.Api.Tests/Controllers/FilesControllerTests.cs`

**Interfaces:**
- Produces: `PUT /api/files/{id}/folders`, `PUT /api/files/{id}/tags` on `FilesController`.
- Consumes: `IdListRequest` (Task 7), `Folder`, `FileFolder`, `Tag`, `FileTag` (Task 1).

- [ ] **Step 1: Add the failing tests**

Append to the `FilesControllerTests` class in `backend/PlasticRoom.Api.Tests/Controllers/FilesControllerTests.cs`:

```csharp
    [Fact]
    public async System.Threading.Tasks.Task SetFolders_DiffsAddedAndRemovedAssignments()
    {
        var uploaded = (ModelFileDto)Assert.IsType<CreatedAtActionResult>(
            (await _controller.Upload(new UploadFileRequest { File = BuildStlFormFile("a.stl") }))).Value!;

        int folderAId;
        int folderBId;
        using (var session = _sessionFactory.CreateSession())
        {
            var folderA = new PlasticRoom.Api.Entities.Folder(session) { Name = "A" };
            var folderB = new PlasticRoom.Api.Entities.Folder(session) { Name = "B" };
            folderA.Save();
            folderB.Save();
            session.CommitTransaction();
            folderAId = folderA.Oid;
            folderBId = folderB.Oid;
        }

        var firstResult = _controller.SetFolders(uploaded.Id, new IdListRequest(new List<int> { folderAId }));
        var firstDto = Assert.IsType<ModelFileDto>(Assert.IsType<OkObjectResult>(firstResult).Value);
        Assert.Equal(new[] { folderAId }, firstDto.FolderIds);

        var secondResult = _controller.SetFolders(uploaded.Id, new IdListRequest(new List<int> { folderBId }));
        var secondDto = Assert.IsType<ModelFileDto>(Assert.IsType<OkObjectResult>(secondResult).Value);
        Assert.Equal(new[] { folderBId }, secondDto.FolderIds);
    }

    [Fact]
    public async System.Threading.Tasks.Task SetTags_DiffsAddedAndRemovedAssignments()
    {
        var uploaded = (ModelFileDto)Assert.IsType<CreatedAtActionResult>(
            (await _controller.Upload(new UploadFileRequest { File = BuildStlFormFile("a.stl") }))).Value!;

        int tagAId;
        int tagBId;
        using (var session = _sessionFactory.CreateSession())
        {
            var tagA = new PlasticRoom.Api.Entities.Tag(session) { Name = "PLA" };
            var tagB = new PlasticRoom.Api.Entities.Tag(session) { Name = "PETG" };
            tagA.Save();
            tagB.Save();
            session.CommitTransaction();
            tagAId = tagA.Oid;
            tagBId = tagB.Oid;
        }

        _controller.SetTags(uploaded.Id, new IdListRequest(new List<int> { tagAId, tagBId }));
        var result = _controller.SetTags(uploaded.Id, new IdListRequest(new List<int> { tagBId }));

        var dto = Assert.IsType<ModelFileDto>(Assert.IsType<OkObjectResult>(result).Value);
        Assert.Equal(new[] { tagBId }, dto.TagIds);
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && dotnet test PlasticRoom.Api.Tests --filter FilesControllerTests`
Expected: FAIL to build — `FilesController.SetFolders` and `.SetTags` do not exist.

- [ ] **Step 3: Add the endpoints to `backend/PlasticRoom.Api/Controllers/FilesController.cs`**

Add these two methods to the `FilesController` class, after `UploadThumbnail`:

```csharp
    [HttpPut("{id}/folders")]
    public IActionResult SetFolders(int id, [FromBody] IdListRequest request)
    {
        using var session = _sessionFactory.CreateSession();
        var file = session.GetObjectByKey<ModelFile>(id);
        if (file is null)
        {
            return NotFound(new { error = $"File {id} not found" });
        }

        var desiredIds = request.Ids.ToHashSet();
        var current = file.FileFolders.ToList();
        var currentIds = current.Select(ff => ff.Folder.Oid).ToHashSet();

        foreach (var fileFolder in current.Where(ff => !desiredIds.Contains(ff.Folder.Oid)))
        {
            fileFolder.Delete();
        }

        foreach (var folderId in desiredIds.Where(fid => !currentIds.Contains(fid)))
        {
            var folder = session.GetObjectByKey<Folder>(folderId);
            if (folder is null)
            {
                return NotFound(new { error = $"Folder {folderId} not found" });
            }

            new FileFolder(session) { File = file, Folder = folder }.Save();
        }

        session.CommitTransaction();
        return Ok(ToDto(file));
    }

    [HttpPut("{id}/tags")]
    public IActionResult SetTags(int id, [FromBody] IdListRequest request)
    {
        using var session = _sessionFactory.CreateSession();
        var file = session.GetObjectByKey<ModelFile>(id);
        if (file is null)
        {
            return NotFound(new { error = $"File {id} not found" });
        }

        var desiredIds = request.Ids.ToHashSet();
        var current = file.FileTags.ToList();
        var currentIds = current.Select(ft => ft.Tag.Oid).ToHashSet();

        foreach (var fileTag in current.Where(ft => !desiredIds.Contains(ft.Tag.Oid)))
        {
            fileTag.Delete();
        }

        foreach (var tagId in desiredIds.Where(tid => !currentIds.Contains(tid)))
        {
            var tag = session.GetObjectByKey<Tag>(tagId);
            if (tag is null)
            {
                return NotFound(new { error = $"Tag {tagId} not found" });
            }

            new FileTag(session) { File = file, Tag = tag }.Save();
        }

        session.CommitTransaction();
        return Ok(ToDto(file));
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && dotnet test PlasticRoom.Api.Tests --filter FilesControllerTests`
Expected: PASS — 10 tests passing.

- [ ] **Step 5: Run the full backend test suite**

Run: `cd backend && dotnet test`
Expected: PASS — all tests across the whole backend pass, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add backend/PlasticRoom.Api/Controllers/FilesController.cs backend/PlasticRoom.Api.Tests/Controllers/FilesControllerTests.cs
git commit -m "feat: add diff-based folder and tag assignment endpoints for files"
```

---

### Task 10: End-to-end manual verification

**Files:** none created — this task runs the real app and exercises every endpoint over HTTP.

**Interfaces:**
- Consumes: every endpoint from Tasks 2, 5, 6, 7, 8, 9.

- [ ] **Step 1: Start the API locally**

Run: `cd backend/PlasticRoom.Api && DATA_PATH=/tmp/plasticroom-phase2-check dotnet run --urls http://localhost:5000 &`

Expected: starts without errors.

- [ ] **Step 2: Verify system folders were seeded**

Run: `curl -s http://localhost:5000/api/folders`
Expected: a JSON array containing exactly 4 objects with `"isSystem":true` named Favorites, Printed, To Print, and Failed Prints.

- [ ] **Step 3: Verify a normal folder can be created and nested**

Run:
```bash
curl -s -X POST http://localhost:5000/api/folders -H "Content-Type: application/json" -d '{"name":"Miniatures"}'
```
Expected: 201 with the new folder's JSON, `"isSystem":false`.

- [ ] **Step 4: Verify a system folder rejects rename and delete**

Run: `curl -s -o /dev/null -w "%{http_code}" -X PUT http://localhost:5000/api/folders/1 -H "Content-Type: application/json" -d '{"name":"Renamed"}'`
Expected: `400` (assuming folder id 1 is a seeded system folder — confirm via Step 2's output first).

Run: `curl -s -o /dev/null -w "%{http_code}" -X DELETE http://localhost:5000/api/folders/1`
Expected: `400`.

- [ ] **Step 5: Verify file upload with a real STL**

Create a minimal test STL locally (any valid binary STL — e.g. export a small cube from any slicer, or reuse a fixture from the test project), then:

Run: `curl -s -F "file=@/path/to/test.stl" http://localhost:5000/api/files`
Expected: 201 with a JSON body showing non-null `dimXMm`/`dimYMm`/`dimZMm`, `"type":"Stl"`, `"plateCount":null`.

- [ ] **Step 6: Verify folder assignment**

Using the file id from Step 5 (call it `FILE_ID`) and the folder id from Step 3 (call it `FOLDER_ID`):

Run: `curl -s -X PUT http://localhost:5000/api/files/FILE_ID/folders -H "Content-Type: application/json" -d '{"ids":[FOLDER_ID]}'`
Expected: 200 with `"folderIds":[FOLDER_ID]`.

Run: `curl -s "http://localhost:5000/api/files?folderId=FOLDER_ID"`
Expected: a JSON array containing exactly the uploaded file.

- [ ] **Step 7: Verify thumbnail upload**

Run: `curl -s -F "file=@/path/to/any.png" http://localhost:5000/api/files/FILE_ID/thumbnail`
Expected: 200 with a non-null `thumbnailPath`; confirm the file exists: `ls /tmp/plasticroom-phase2-check/thumbs/`.

- [ ] **Step 8: Verify file delete removes the blob**

Run: `curl -s -o /dev/null -w "%{http_code}" -X DELETE http://localhost:5000/api/files/FILE_ID`
Expected: `204`.

Run: `ls /tmp/plasticroom-phase2-check/files/`
Expected: the uploaded STL is gone.

- [ ] **Step 9: Tear down**

Run: `kill %1` (stops the background `dotnet run` process), then `rm -rf /tmp/plasticroom-phase2-check`.

- [ ] **Step 10: Commit (only if fixes were needed)**

If Steps 1–9 all passed with no code changes, no commit is needed — report DONE with a summary of the verification output. If a fix was required:

```bash
git add -A
git commit -m "fix: correct issue found during Phase 2 end-to-end verification"
```

---

## Self-Review Notes

- **Spec coverage:** all deliverables from `Docs/superpowers/specs/2026-07-03-phase-2-data-model-core-api.md` map to a task — entities (Task 1), system folder seeding (Task 2), STL/3MF parsing (Tasks 3–4), folder CRUD + cascade delete + system-folder protection (Task 5), tag CRUD (Task 6), file upload/list/get with parsing (Task 7), file update/delete/thumbnail (Task 8), folder/tag assignment diffing (Task 9), and every Success Criteria item is exercised end-to-end in Task 10.
- **Naming deviation flagged up front:** `ModelFile` vs. the spec's `File`, called out in Global Constraints so no task author is confused when cross-referencing the spec.
- **Type/name consistency checked:** `ModelFileDto`, `UploadFileRequest`, `UpdateFileRequest`, `IdListRequest` are defined once in Task 7 and reused with identical names/shapes in Tasks 8–9; `FolderDto`/`CreateFolderRequest`/`UpdateFolderRequest` defined in Task 5 are not redefined elsewhere; `ModelMetadata` from Task 3 is the exact return type both parsers in Tasks 3–4 use and the only type `FilesController` (Task 7) consumes from parsing.
- **Not In Scope items respected:** no batch endpoints, no descendant-inclusive folder filtering, no slicer-specific metadata parsing, no UI anywhere in the plan.
