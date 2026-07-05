# Bambu Plate Metadata Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** For Bambu Studio 3MF files, show the real print plates in the detail-view filmstrip (correct count, slicer plate names, the slicer's embedded plate thumbnails, and click-to-isolate that groups a plate's objects), parsed and stored on import; non-Bambu 3MF/STL keep the existing per-build-item fallback.

**Architecture:** On import the backend parses `Metadata/model_settings.config`, resolves each plate's Bambu `object_id`s to `<build><item>` indices, extracts each plate's embedded PNG to storage, and persists a `Plate` XPO entity per plate (plus an accurate `PlateCount`). A new endpoint serves plate thumbnails. The frontend converges Bambu plates and the fallback into one `ViewerPlate` model driving the filmstrip and a generalized set-based object isolation in the viewer.

**Tech Stack:** ASP.NET Core 10 + DevExpress XPO (24.1.6) + SQLite; React 19 + TypeScript + Vite + Three.js; xUnit; Vitest + React Testing Library.

## Global Constraints

- Backend targets **net10.0**; DevExpress.Xpo **24.1.6** (public nuget.org feed).
- The file entity is **`ModelFile`** (`[Persistent("File")]`), not `File`.
- XPO `Session` from `_sessionFactory.CreateSession()` has **no implicit transaction**: `.Save()` persists immediately; **never** call `CommitTransaction()`; call `PurgeDeletedObjects()` after any `.Delete()`.
- `FileStorage` exposes `FilesDirectory` and `ThumbsDirectory` (both auto-created). Extracted plate PNGs live at `{ThumbsDirectory}/{fileId}_plate_{index}.png`.
- `Metadata/model_settings.config` is a **namespace-less** XML `<config>` document; `3D/3dmodel.model` uses the core namespace `http://schemas.microsoft.com/3dmanufacturing/core/2015/02`.
- Frontend: **no router / state manager / data-fetching lib**. CSS Modules over `styles/tokens.css`. Any Vitest file that transitively imports `three` MUST start with `// @vitest-environment jsdom`.
- Bambu-only: a file is multi-plate only when `model_settings.config` has ≥1 `<plate>`. Malformed/partial metadata must never fail an import. No backfill — existing files gain plate data only on re-import.
- Backend tests: `dotnet test` from `backend/`. Frontend: `npm test` / `npx tsc -b` from `frontend/`.

---

## File Structure

**Backend**
- Create: `backend/PlasticRoom.Api/Entities/Plate.cs` — the `Plate` XPO entity.
- Modify: `backend/PlasticRoom.Api/Entities/ModelFile.cs` — add `Plates` association.
- Create: `backend/PlasticRoom.Api/Parsing/BambuPlateParser.cs` — parse `model_settings.config` → `IReadOnlyList<PlateInfo>`.
- Create: `backend/PlasticRoom.Api/Parsing/PlateInfo.cs` — parser result record.
- Modify: `backend/PlasticRoom.Api/Dtos/ModelFileDtos.cs` — `PlateDto` + `ModelFileDto.Plates`.
- Modify: `backend/PlasticRoom.Api/Controllers/FilesController.cs` — persist plates on upload, `ToDto`, plate-thumbnail endpoint, `Delete` cleanup.
- Test: `backend/PlasticRoom.Api.Tests/Parsing/BambuPlateParserTests.cs`, `backend/PlasticRoom.Api.Tests/Controllers/FilesControllerTests.cs`.

**Frontend**
- Modify: `frontend/src/api/types.ts` — `Plate` type + `ModelFile.plates`.
- Modify: `frontend/src/api/client.ts` — `plateThumbnailUrl(id, index)`.
- Modify: `frontend/src/lib/viewerModes.ts` — add `setVisibleObjects`; remove `setActivePlate`.
- Create: `frontend/src/lib/viewerPlates.ts` (+ `.test.ts`) — `ViewerPlate` + `buildViewerPlates`.
- Modify: `frontend/src/components/viewer/PlateFilmstrip.tsx` (+ `.test.tsx`, `.module.css`) — take `ViewerPlate[]`.
- Modify: `frontend/src/components/viewer/ModelViewer.tsx` (+ `.test.tsx`) — `visibleIndices` prop.
- Modify: `frontend/src/views/DetailView.tsx` (+ `.test.tsx`) — build `ViewerPlate[]`, grouped isolation.

---

## Task 1: `Plate` entity + `ModelFile.Plates`

**Files:**
- Create: `backend/PlasticRoom.Api/Entities/Plate.cs`
- Modify: `backend/PlasticRoom.Api/Entities/ModelFile.cs`
- Test: `backend/PlasticRoom.Api.Tests/Entities/PlateEntityTests.cs`

**Interfaces:**
- Produces: `Plate` (XPObject) with `ModelFile File`, `int Index`, `string Name`, `string? ThumbnailPath`, `string BuildItemIndices`; `ModelFile.Plates` (`XPCollection<Plate>`, association `"File-Plates"`).

- [ ] **Step 1: Write the failing test**

`backend/PlasticRoom.Api.Tests/Entities/PlateEntityTests.cs`:

```csharp
using System;
using System.IO;
using System.Linq;
using PlasticRoom.Api.Data;
using PlasticRoom.Api.Entities;
using Xunit;

namespace PlasticRoom.Api.Tests.Entities;

public class PlateEntityTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "plasticroom-plate-tests-" + Guid.NewGuid());
    private readonly XpoSessionFactory _factory;

    public PlateEntityTests() => _factory = new XpoSessionFactory(_dir);

    [Fact]
    public void PlateBelongsToFileViaAssociation()
    {
        using (var session = _factory.CreateSession())
        {
            var file = new ModelFile(session) { Name = "a.3mf", Type = ModelFileType.ThreeMf };
            file.Save();
            new Plate(session) { File = file, Index = 1, Name = "Corners", ThumbnailPath = "/t/1.png", BuildItemIndices = "0,2" }.Save();
        }

        using (var session = _factory.CreateSession())
        {
            var file = new DevExpress.Xpo.XPCollection<ModelFile>(session).Single();
            var plate = file.Plates.Single();
            Assert.Equal(1, plate.Index);
            Assert.Equal("Corners", plate.Name);
            Assert.Equal("0,2", plate.BuildItemIndices);
        }
    }

    public void Dispose()
    {
        if (Directory.Exists(_dir)) Directory.Delete(_dir, true);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test --filter FullyQualifiedName~PlateEntityTests`
Expected: FAIL — `Plate` type / `ModelFile.Plates` not defined.

- [ ] **Step 3: Create the entity**

`backend/PlasticRoom.Api/Entities/Plate.cs`:

```csharp
using DevExpress.Xpo;

namespace PlasticRoom.Api.Entities;

public class Plate : XPObject
{
    public Plate(Session session) : base(session)
    {
    }

    private ModelFile file = null!;
    [Association("File-Plates")]
    public ModelFile File
    {
        get => file;
        set => SetPropertyValue(nameof(File), ref file, value);
    }

    private int index;
    public int Index
    {
        get => index;
        set => SetPropertyValue(nameof(Index), ref index, value);
    }

    private string name = string.Empty;
    public string Name
    {
        get => name;
        set => SetPropertyValue(nameof(Name), ref name, value);
    }

    private string? thumbnailPath;
    public string? ThumbnailPath
    {
        get => thumbnailPath;
        set => SetPropertyValue(nameof(ThumbnailPath), ref thumbnailPath, value);
    }

    // Comma-separated 0-based indices into the 3MF <build> item order, e.g. "0,2,5".
    private string buildItemIndices = string.Empty;
    public string BuildItemIndices
    {
        get => buildItemIndices;
        set => SetPropertyValue(nameof(BuildItemIndices), ref buildItemIndices, value);
    }
}
```

- [ ] **Step 4: Add the association to `ModelFile`**

In `backend/PlasticRoom.Api/Entities/ModelFile.cs`, after the existing `FileTags` collection:

```csharp
    [Association("File-Plates")]
    public XPCollection<Plate> Plates => GetCollection<Plate>(nameof(Plates));
```

- [ ] **Step 5: Run test to verify it passes**

Run: `dotnet test --filter FullyQualifiedName~PlateEntityTests`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/PlasticRoom.Api/Entities/Plate.cs backend/PlasticRoom.Api/Entities/ModelFile.cs backend/PlasticRoom.Api.Tests/Entities/PlateEntityTests.cs
git commit -m "feat(api): add Plate entity associated to ModelFile"
```

---

## Task 2: `BambuPlateParser`

**Files:**
- Create: `backend/PlasticRoom.Api/Parsing/PlateInfo.cs`
- Create: `backend/PlasticRoom.Api/Parsing/BambuPlateParser.cs`
- Test: `backend/PlasticRoom.Api.Tests/Parsing/BambuPlateParserTests.cs`

**Interfaces:**
- Produces:
  - `record PlateInfo(int Index, string Name, string? ThumbnailEntryName, IReadOnlyList<int> BuildItemIndices)`
  - `static class BambuPlateParser { IReadOnlyList<PlateInfo> Parse(Stream stream) }` — returns `[]` when there is no `Metadata/model_settings.config` or no `<plate>` nodes. Resolves each plate's `<model_instance>` `object_id` to the 0-based position of the matching `<build><item objectid=…>` in `3D/3dmodel.model`.

- [ ] **Step 1: Write the failing test**

`backend/PlasticRoom.Api.Tests/Parsing/BambuPlateParserTests.cs`:

```csharp
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using PlasticRoom.Api.Parsing;
using Xunit;

namespace PlasticRoom.Api.Tests.Parsing;

public class BambuPlateParserTests
{
    // Root model: three build items in order objectid 1, 2, 3 → indices 0, 1, 2.
    private const string ModelXml = """
        <?xml version="1.0" encoding="UTF-8"?>
        <model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
          <resources><object id="1" type="model"><components><component objectid="10"/></components></object></resources>
          <build>
            <item objectid="1" />
            <item objectid="2" />
            <item objectid="3" />
          </build>
        </model>
        """;

    // Plate 1 "Corners" holds objects 1 & 3; plate 2 "Base" holds object 2.
    private const string SettingsXml = """
        <?xml version="1.0" encoding="UTF-8"?>
        <config>
          <plate>
            <metadata key="plater_id" value="1"/>
            <metadata key="plater_name" value="Corners"/>
            <metadata key="thumbnail_file" value="Metadata/plate_1.png"/>
            <model_instance><metadata key="object_id" value="1"/></model_instance>
            <model_instance><metadata key="object_id" value="3"/></model_instance>
          </plate>
          <plate>
            <metadata key="plater_id" value="2"/>
            <metadata key="plater_name" value="Base"/>
            <metadata key="thumbnail_file" value="Metadata/plate_2.png"/>
            <model_instance><metadata key="object_id" value="2"/></model_instance>
          </plate>
        </config>
        """;

    private static byte[] BuildArchive(string? settingsXml)
    {
        using var stream = new MemoryStream();
        using (var archive = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
        {
            WriteEntry(archive, "3D/3dmodel.model", ModelXml);
            if (settingsXml != null) WriteEntry(archive, "Metadata/model_settings.config", settingsXml);
        }
        return stream.ToArray();
    }

    private static void WriteEntry(ZipArchive archive, string name, string content)
    {
        using var s = archive.CreateEntry(name).Open();
        using var w = new StreamWriter(s, new UTF8Encoding(false));
        w.Write(content);
    }

    [Fact]
    public void ParsesPlatesAndResolvesBuildItemIndices()
    {
        using var stream = new MemoryStream(BuildArchive(SettingsXml));

        var plates = BambuPlateParser.Parse(stream);

        Assert.Equal(2, plates.Count);
        Assert.Equal(1, plates[0].Index);
        Assert.Equal("Corners", plates[0].Name);
        Assert.Equal("Metadata/plate_1.png", plates[0].ThumbnailEntryName);
        Assert.Equal(new[] { 0, 2 }, plates[0].BuildItemIndices);   // objectids 1 & 3 → positions 0 & 2
        Assert.Equal(new[] { 1 }, plates[1].BuildItemIndices);       // objectid 2 → position 1
    }

    [Fact]
    public void ReturnsEmptyWhenNoSettingsConfig()
    {
        using var stream = new MemoryStream(BuildArchive(settingsXml: null));
        Assert.Empty(BambuPlateParser.Parse(stream));
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test --filter FullyQualifiedName~BambuPlateParserTests`
Expected: FAIL — `BambuPlateParser` / `PlateInfo` not defined.

- [ ] **Step 3: Create `PlateInfo`**

`backend/PlasticRoom.Api/Parsing/PlateInfo.cs`:

```csharp
using System.Collections.Generic;

namespace PlasticRoom.Api.Parsing;

public record PlateInfo(int Index, string Name, string? ThumbnailEntryName, IReadOnlyList<int> BuildItemIndices);
```

- [ ] **Step 4: Create the parser**

`backend/PlasticRoom.Api/Parsing/BambuPlateParser.cs`:

```csharp
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Xml.Linq;

namespace PlasticRoom.Api.Parsing;

// Parses Bambu Studio's Metadata/model_settings.config to recover real print
// plates. Returns [] for any 3MF without that file or without <plate> nodes.
public static class BambuPlateParser
{
    private static readonly XNamespace CoreNs = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02";

    public static IReadOnlyList<PlateInfo> Parse(Stream stream)
    {
        using var archive = new ZipArchive(stream, ZipArchiveMode.Read);
        var settingsEntry = archive.GetEntry("Metadata/model_settings.config");
        if (settingsEntry is null)
        {
            return Array.Empty<PlateInfo>();
        }

        // Ordered objectids of the root <build><item> elements → their position is the build-item index.
        var buildOrder = new List<string>();
        var modelEntry = archive.GetEntry("3D/3dmodel.model");
        if (modelEntry is not null)
        {
            using var modelStream = modelEntry.Open();
            var model = XDocument.Load(modelStream);
            var build = model.Root?.Element(CoreNs + "build");
            if (build is not null)
            {
                foreach (var item in build.Elements(CoreNs + "item"))
                {
                    buildOrder.Add(item.Attribute("objectid")?.Value ?? string.Empty);
                }
            }
        }

        using var settingsStream = settingsEntry.Open();
        var settings = XDocument.Load(settingsStream);

        var result = new List<PlateInfo>();
        foreach (var plateNode in settings.Root?.Elements("plate") ?? Enumerable.Empty<XElement>())
        {
            var index = 0;
            var name = string.Empty;
            string? thumbnail = null;

            foreach (var md in plateNode.Elements("metadata"))
            {
                var key = md.Attribute("key")?.Value;
                var value = md.Attribute("value")?.Value;
                if (key == "plater_id" && int.TryParse(value, out var pid)) index = pid;
                else if (key == "plater_name") name = value ?? string.Empty;
                else if (key == "thumbnail_file") thumbnail = value;
            }

            var objectIds = plateNode.Elements("model_instance")
                .Select(mi => mi.Elements("metadata")
                    .FirstOrDefault(m => m.Attribute("key")?.Value == "object_id")?.Attribute("value")?.Value)
                .Where(v => !string.IsNullOrEmpty(v))
                .ToHashSet();

            var indices = new List<int>();
            for (var i = 0; i < buildOrder.Count; i++)
            {
                if (objectIds.Contains(buildOrder[i])) indices.Add(i);
            }

            result.Add(new PlateInfo(index, name, thumbnail, indices));
        }

        return result;
    }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `dotnet test --filter FullyQualifiedName~BambuPlateParserTests`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add backend/PlasticRoom.Api/Parsing/PlateInfo.cs backend/PlasticRoom.Api/Parsing/BambuPlateParser.cs backend/PlasticRoom.Api.Tests/Parsing/BambuPlateParserTests.cs
git commit -m "feat(api): parse Bambu model_settings.config into plate manifest"
```

---

## Task 3: Persist plates on upload + DTO

**Files:**
- Modify: `backend/PlasticRoom.Api/Dtos/ModelFileDtos.cs`
- Modify: `backend/PlasticRoom.Api/Controllers/FilesController.cs`
- Test: `backend/PlasticRoom.Api.Tests/Controllers/FilesControllerTests.cs`

**Interfaces:**
- Consumes: `BambuPlateParser.Parse` (Task 2), `Plate` (Task 1), `_fileStorage.ThumbsDirectory`.
- Produces: `record PlateDto(int Index, string Name, IReadOnlyList<int> BuildItemIndices)`; `ModelFileDto.Plates` (`IReadOnlyList<PlateDto>`); on upload, `Plate` rows created, plate PNGs extracted, and `PlateCount` overridden to the plate count when plates exist.

- [ ] **Step 1: Write the failing test**

Add to `FilesControllerTests.cs`. Add this Bambu-archive helper near `BuildStlFormFile`:

```csharp
private static IFormFile BuildBambuThreeMfFormFile(string fileName)
{
    const string modelXml =
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>" +
        "<model unit=\"millimeter\" xmlns=\"http://schemas.microsoft.com/3dmanufacturing/core/2015/02\">" +
        "<resources><object id=\"1\" type=\"model\"><mesh><vertices>" +
        "<vertex x=\"0\" y=\"0\" z=\"0\"/><vertex x=\"10\" y=\"0\" z=\"0\"/>" +
        "<vertex x=\"0\" y=\"5\" z=\"0\"/><vertex x=\"0\" y=\"0\" z=\"2\"/></vertices>" +
        "<triangles><triangle v1=\"0\" v2=\"1\" v3=\"2\"/></triangles></mesh></object></resources>" +
        "<build><item objectid=\"1\"/><item objectid=\"2\"/></build></model>";
    const string settingsXml =
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?><config>" +
        "<plate><metadata key=\"plater_id\" value=\"1\"/><metadata key=\"plater_name\" value=\"Corners\"/>" +
        "<metadata key=\"thumbnail_file\" value=\"Metadata/plate_1.png\"/>" +
        "<model_instance><metadata key=\"object_id\" value=\"1\"/></model_instance></plate>" +
        "<plate><metadata key=\"plater_id\" value=\"2\"/><metadata key=\"plater_name\" value=\"Base\"/>" +
        "<metadata key=\"thumbnail_file\" value=\"Metadata/plate_2.png\"/>" +
        "<model_instance><metadata key=\"object_id\" value=\"2\"/></model_instance></plate></config>";
    var pngBytes = Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==");

    using var stream = new MemoryStream();
    using (var archive = new System.IO.Compression.ZipArchive(stream, System.IO.Compression.ZipArchiveMode.Create, leaveOpen: true))
    {
        WriteZipText(archive, "3D/3dmodel.model", modelXml);
        WriteZipText(archive, "Metadata/model_settings.config", settingsXml);
        WriteZipBytes(archive, "Metadata/plate_1.png", pngBytes);
        WriteZipBytes(archive, "Metadata/plate_2.png", pngBytes);
    }
    var bytes = stream.ToArray();
    return new FormFile(new MemoryStream(bytes), 0, bytes.Length, "file", fileName);
}

private static void WriteZipText(System.IO.Compression.ZipArchive a, string name, string text)
{
    using var s = a.CreateEntry(name).Open();
    using var w = new StreamWriter(s, new UTF8Encoding(false));
    w.Write(text);
}

private static void WriteZipBytes(System.IO.Compression.ZipArchive a, string name, byte[] data)
{
    using var s = a.CreateEntry(name).Open();
    s.Write(data, 0, data.Length);
}
```

Then the test:

```csharp
[Fact]
public async System.Threading.Tasks.Task Upload_ParsesBambuPlates()
{
    var request = new UploadFileRequest { File = BuildBambuThreeMfFormFile("shelf.3mf") };

    var result = await _controller.Upload(request);

    var dto = Assert.IsType<ModelFileDto>(Assert.IsType<CreatedAtActionResult>(result).Value);
    Assert.Equal(2, dto.PlateCount);
    Assert.Equal(2, dto.Plates.Count);
    Assert.Equal("Corners", dto.Plates[0].Name);
    Assert.Equal(new[] { 0 }, dto.Plates[0].BuildItemIndices);
    Assert.Equal(new[] { 1 }, dto.Plates[1].BuildItemIndices);
    // Two plate PNGs were extracted alongside the file.
    Assert.Equal(2, Directory.GetFiles(_fileStorage.ThumbsDirectory, "*_plate_*.png").Length);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test --filter FullyQualifiedName~FilesControllerTests.Upload_ParsesBambuPlates`
Expected: FAIL — `dto.Plates` does not exist / plate count wrong.

- [ ] **Step 3: Add `PlateDto` + `ModelFileDto.Plates`**

In `ModelFileDtos.cs`, add the record and a field on `ModelFileDto` (append after `TagIds`):

```csharp
public record PlateDto(int Index, string Name, IReadOnlyList<int> BuildItemIndices);
```

Change `ModelFileDto`'s parameter list to add a trailing parameter:

```csharp
    IReadOnlyList<int> FolderIds,
    IReadOnlyList<int> TagIds,
    IReadOnlyList<PlateDto> Plates);
```

- [ ] **Step 4: Extract plates on upload**

In `FilesController.Upload`, insert plate parsing/persistence **after** the existing `FolderIds`/`TagIds` loops and immediately **before** `return CreatedAtAction(...)` — so a folder/tag-not-found error (which returns early and deletes `storagePath`) never leaves orphaned plate rows or PNGs:

```csharp
        var plateInfos = ParseBambuPlates(storagePath);
        if (plateInfos.Count > 0)
        {
            modelFile.PlateCount = plateInfos.Count;
            modelFile.Save();

            using var plateZip = System.IO.Compression.ZipFile.OpenRead(storagePath);
            foreach (var info in plateInfos)
            {
                string? thumbPath = null;
                if (!string.IsNullOrEmpty(info.ThumbnailEntryName))
                {
                    var entry = plateZip.GetEntry(info.ThumbnailEntryName);
                    if (entry is not null)
                    {
                        thumbPath = Path.Combine(_fileStorage.ThumbsDirectory, $"{modelFile.Oid}_plate_{info.Index}.png");
                        using var entryStream = entry.Open();
                        using var dest = System.IO.File.Create(thumbPath);
                        entryStream.CopyTo(dest);
                    }
                }

                new Plate(session)
                {
                    File = modelFile,
                    Index = info.Index,
                    Name = info.Name,
                    ThumbnailPath = thumbPath,
                    BuildItemIndices = string.Join(",", info.BuildItemIndices),
                }.Save();
            }
        }
```

Add this private helper to `FilesController` (near `TryValidateSourceUrl`), which never throws:

```csharp
    private static IReadOnlyList<PlateInfo> ParseBambuPlates(string storagePath)
    {
        try
        {
            using var stream = System.IO.File.OpenRead(storagePath);
            return BambuPlateParser.Parse(stream);
        }
        catch
        {
            return System.Array.Empty<PlateInfo>();
        }
    }
```

- [ ] **Step 5: Include plates in `ToDto`**

In `FilesController.ToDto`, add a trailing argument mapping the plates (ordered, indices parsed from the comma-separated string):

```csharp
        file.FileFolders.Select(ff => ff.Folder.Oid).ToList(),
        file.FileTags.Select(ft => ft.Tag.Oid).ToList(),
        file.Plates.OrderBy(p => p.Index).Select(p => new PlateDto(
            p.Index,
            p.Name,
            ParseIndices(p.BuildItemIndices))).ToList());
```

And add the helper:

```csharp
    private static IReadOnlyList<int> ParseIndices(string csv) =>
        string.IsNullOrEmpty(csv)
            ? System.Array.Empty<int>()
            : csv.Split(',').Select(int.Parse).ToList();
```

- [ ] **Step 6: Run test to verify it passes**

Run: `dotnet test --filter FullyQualifiedName~FilesControllerTests.Upload_ParsesBambuPlates`
Expected: PASS. Then `dotnet test` (full) — all green (existing upload tests still pass; non-Bambu files get an empty `Plates` list and unchanged `PlateCount`).

- [ ] **Step 7: Commit**

```bash
git add backend/PlasticRoom.Api/Dtos/ModelFileDtos.cs backend/PlasticRoom.Api/Controllers/FilesController.cs backend/PlasticRoom.Api.Tests/Controllers/FilesControllerTests.cs
git commit -m "feat(api): persist Bambu plates + PNGs on upload, expose in DTO"
```

---

## Task 4: Plate thumbnail endpoint

**Files:**
- Modify: `backend/PlasticRoom.Api/Controllers/FilesController.cs`
- Test: `backend/PlasticRoom.Api.Tests/Controllers/FilesControllerTests.cs`

**Interfaces:**
- Produces: `IActionResult GetPlateThumbnail(int id, int index)` → `PhysicalFileResult` (`image/png`) or `NotFoundObjectResult`.

- [ ] **Step 1: Write the failing tests**

```csharp
[Fact]
public async System.Threading.Tasks.Task GetPlateThumbnail_ReturnsPng()
{
    var dto = (ModelFileDto)Assert.IsType<CreatedAtActionResult>(
        await _controller.Upload(new UploadFileRequest { File = BuildBambuThreeMfFormFile("shelf.3mf") })).Value!;

    var result = _controller.GetPlateThumbnail(dto.Id, 1);

    var file = Assert.IsType<PhysicalFileResult>(result);
    Assert.Equal("image/png", file.ContentType);
    Assert.True(System.IO.File.Exists(file.FileName));
}

[Fact]
public async System.Threading.Tasks.Task GetPlateThumbnail_Returns404_ForUnknownPlate()
{
    var dto = (ModelFileDto)Assert.IsType<CreatedAtActionResult>(
        await _controller.Upload(new UploadFileRequest { File = BuildBambuThreeMfFormFile("shelf.3mf") })).Value!;

    Assert.IsType<NotFoundObjectResult>(_controller.GetPlateThumbnail(dto.Id, 99));
}

[Fact]
public void GetPlateThumbnail_Returns404_ForUnknownFile()
{
    Assert.IsType<NotFoundObjectResult>(_controller.GetPlateThumbnail(999999, 1));
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `dotnet test --filter FullyQualifiedName~FilesControllerTests.GetPlateThumbnail`
Expected: FAIL — `GetPlateThumbnail` not defined.

- [ ] **Step 3: Implement the endpoint**

Add after `GetThumbnail` in `FilesController`:

```csharp
[HttpGet("{id}/plates/{index}/thumbnail")]
public IActionResult GetPlateThumbnail(int id, int index)
{
    using var session = _sessionFactory.CreateSession();
    var file = session.GetObjectByKey<ModelFile>(id);
    if (file is null)
    {
        return NotFound(new { error = $"File {id} not found" });
    }

    var plate = file.Plates.FirstOrDefault(p => p.Index == index);
    if (plate is null || string.IsNullOrEmpty(plate.ThumbnailPath) || !System.IO.File.Exists(plate.ThumbnailPath))
    {
        return NotFound(new { error = $"Plate {index} thumbnail for file {id} not found" });
    }

    return PhysicalFile(plate.ThumbnailPath, "image/png");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `dotnet test --filter FullyQualifiedName~FilesControllerTests.GetPlateThumbnail`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/PlasticRoom.Api/Controllers/FilesController.cs backend/PlasticRoom.Api.Tests/Controllers/FilesControllerTests.cs
git commit -m "feat(api): serve plate thumbnail via GET /api/files/{id}/plates/{index}/thumbnail"
```

---

## Task 5: Delete cleans up plates + PNGs

**Files:**
- Modify: `backend/PlasticRoom.Api/Controllers/FilesController.cs`
- Test: `backend/PlasticRoom.Api.Tests/Controllers/FilesControllerTests.cs`

**Interfaces:**
- Consumes: `ModelFile.Plates`, existing `Delete` action.

- [ ] **Step 1: Write the failing test**

```csharp
[Fact]
public async System.Threading.Tasks.Task Delete_RemovesPlatesAndPngs()
{
    var dto = (ModelFileDto)Assert.IsType<CreatedAtActionResult>(
        await _controller.Upload(new UploadFileRequest { File = BuildBambuThreeMfFormFile("shelf.3mf") })).Value!;
    Assert.Equal(2, Directory.GetFiles(_fileStorage.ThumbsDirectory, "*_plate_*.png").Length);

    _controller.Delete(dto.Id);

    Assert.Empty(Directory.GetFiles(_fileStorage.ThumbsDirectory, "*_plate_*.png"));
    Assert.IsType<NotFoundObjectResult>(_controller.GetById(dto.Id));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `dotnet test --filter FullyQualifiedName~FilesControllerTests.Delete_RemovesPlatesAndPngs`
Expected: FAIL — plate PNGs remain (Delete doesn't touch them).

- [ ] **Step 3: Extend `Delete`**

In `FilesController.Delete`, before `file.Delete();`, capture and delete plate rows + files. Replace the section that captures `storagePath`/`thumbnailPath` and deletes with:

```csharp
        var plateThumbPaths = file.Plates
            .Select(p => p.ThumbnailPath)
            .Where(p => !string.IsNullOrEmpty(p))
            .ToList();

        foreach (var plate in file.Plates.ToList())
        {
            plate.Delete();
        }

        var storagePath = file.StoragePath;
        var thumbnailPath = file.ThumbnailPath;

        file.Delete();
        session.PurgeDeletedObjects();

        if (System.IO.File.Exists(storagePath))
        {
            System.IO.File.Delete(storagePath);
        }

        if (thumbnailPath is not null && System.IO.File.Exists(thumbnailPath))
        {
            System.IO.File.Delete(thumbnailPath);
        }

        foreach (var platePath in plateThumbPaths)
        {
            if (System.IO.File.Exists(platePath)) System.IO.File.Delete(platePath!);
        }
```

(Keep the existing `FileFolders`/`FileTags` delete loops above this block unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `dotnet test --filter FullyQualifiedName~FilesControllerTests.Delete_RemovesPlatesAndPngs`
Expected: PASS. Then `dotnet test` (full) — all green.

- [ ] **Step 5: Commit**

```bash
git add backend/PlasticRoom.Api/Controllers/FilesController.cs backend/PlasticRoom.Api.Tests/Controllers/FilesControllerTests.cs
git commit -m "feat(api): delete plate rows + PNGs when a file is deleted"
```

---

## Task 6: Frontend types + client URL

**Files:**
- Modify: `frontend/src/api/types.ts`
- Modify: `frontend/src/api/client.ts`
- Test: `frontend/src/api/client.test.ts`

**Interfaces:**
- Produces: `interface Plate { index: number; name: string; buildItemIndices: number[] }`; `ModelFile.plates: Plate[]`; `plateThumbnailUrl(id: number, index: number): string`.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/api/client.test.ts`:

```ts
import { plateThumbnailUrl } from './client'

describe('plateThumbnailUrl', () => {
  it('builds the plate thumbnail path', () => {
    expect(plateThumbnailUrl(7, 3)).toBe('/api/files/7/plates/3/thumbnail')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/api/client.test.ts`
Expected: FAIL — `plateThumbnailUrl` is not exported.

- [ ] **Step 3: Add the type + client function**

In `frontend/src/api/types.ts`, add the `Plate` interface and a `plates` field on `ModelFile`:

```ts
export interface Plate {
  index: number
  name: string
  buildItemIndices: number[]
}
```

Add `plates: Plate[]` to the `ModelFile` interface (after `tagIds`).

In `frontend/src/api/client.ts`, add:

```ts
export function plateThumbnailUrl(id: number, index: number): string {
  return `/api/files/${id}/plates/${index}/thumbnail`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/api/client.test.ts` then `npx tsc -b`
Expected: test PASS; `tsc` fails only where `ModelFile` literals now need `plates`. Fix each by adding `plates: []` to `ModelFile` test fixtures (App.test.tsx, DetailView.test.tsx, DetailInfoPanel.test.tsx, useFile.test.ts, FileGrid.test.tsx — any object typed `ModelFile`). Re-run `npx tsc -b` until clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/types.ts frontend/src/api/client.ts frontend/src/api/client.test.ts frontend/src/**/*.test.tsx frontend/src/**/*.test.ts
git commit -m "feat(frontend): Plate type + plateThumbnailUrl; add plates:[] to fixtures"
```

---

## Task 7: `setVisibleObjects` (generalized isolation)

**Files:**
- Modify: `frontend/src/lib/viewerModes.ts`
- Modify: `frontend/src/lib/viewerModes.test.ts`

**Interfaces:**
- Produces: `setVisibleObjects(objects: THREE.Object3D[], indices: number[] | null): void` — `null` shows all; otherwise only objects whose index is in `indices` are visible.
- Removes: `setActivePlate` (superseded).

- [ ] **Step 1: Replace the `setActivePlate` tests**

In `frontend/src/lib/viewerModes.test.ts`, replace the `describe('setActivePlate', …)` block with:

```ts
describe('setVisibleObjects', () => {
  it('shows only the objects whose index is listed', () => {
    const objs = meshObjects(4)
    setVisibleObjects(objs, [1, 3])
    expect(objs.map((o) => o.visible)).toEqual([false, true, false, true])
  })

  it('null shows every object', () => {
    const objs = meshObjects(3)
    setVisibleObjects(objs, [0])
    setVisibleObjects(objs, null)
    expect(objs.every((o) => o.visible)).toBe(true)
  })
})
```

Update the import at the top of the test from `setActivePlate` to `setVisibleObjects`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/viewerModes.test.ts`
Expected: FAIL — `setVisibleObjects` not exported.

- [ ] **Step 3: Implement it (replacing `setActivePlate`)**

In `frontend/src/lib/viewerModes.ts`, replace the `setActivePlate` function with:

```ts
export function setVisibleObjects(objects: THREE.Object3D[], indices: number[] | null): void {
  objects.forEach((object, index) => {
    object.visible = indices === null || indices.includes(index)
  })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/viewerModes.test.ts`
Expected: PASS. (`tsc` will now flag the old `setActivePlate` callers in `ModelViewer.tsx`/`DetailView.tsx`; those are fixed in Tasks 9–10. If running the full suite now, expect those two files to fail typecheck until then — that's acceptable mid-plan, or implement 7→9→10 back-to-back before the full-suite run.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/viewerModes.ts frontend/src/lib/viewerModes.test.ts
git commit -m "feat(frontend): replace single-index setActivePlate with set-based setVisibleObjects"
```

---

## Task 8: `buildViewerPlates`

**Files:**
- Create: `frontend/src/lib/viewerPlates.ts`
- Test: `frontend/src/lib/viewerPlates.test.ts`

**Interfaces:**
- Consumes: `ModelFile`, `Plate` (types); `plateThumbnailUrl` (Task 6).
- Produces:
  - `interface ViewerPlate { label: string; thumbnailUrl: string | null; objectIndices: number[] }`
  - `buildViewerPlates(file: ModelFile, objectCount: number, fallbackThumbs: string[]): ViewerPlate[]`

- [ ] **Step 1: Write the failing test**

`frontend/src/lib/viewerPlates.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildViewerPlates } from './viewerPlates'
import type { ModelFile } from '../api/types'

function file(partial: Partial<ModelFile>): ModelFile {
  return {
    id: 7, name: 'x.3mf', type: 'ThreeMf', sizeBytes: 1, addedAt: '2026-07-04T00:00:00Z',
    dimXMm: null, dimYMm: null, dimZMm: null, plateCount: null, estPrintTimeMin: null,
    material: null, layerHeightMm: null, sourceUrl: null, creator: null, description: null,
    thumbnailPath: null, folderIds: [], tagIds: [], plates: [], ...partial,
  }
}

describe('buildViewerPlates', () => {
  it('maps Bambu plates to server thumbnails + grouped indices', () => {
    const f = file({
      plates: [
        { index: 1, name: 'Corners', buildItemIndices: [0, 2] },
        { index: 2, name: '', buildItemIndices: [1] },
      ],
    })
    const plates = buildViewerPlates(f, 3, [])
    expect(plates).toEqual([
      { label: 'Corners', thumbnailUrl: '/api/files/7/plates/1/thumbnail', objectIndices: [0, 2] },
      { label: 'Plate 2', thumbnailUrl: '/api/files/7/plates/2/thumbnail', objectIndices: [1] },
    ])
  })

  it('falls back to one plate per build item with client thumbnails', () => {
    const plates = buildViewerPlates(file({}), 2, ['data:a', 'data:b'])
    expect(plates).toEqual([
      { label: 'Plate 1', thumbnailUrl: 'data:a', objectIndices: [0] },
      { label: 'Plate 2', thumbnailUrl: 'data:b', objectIndices: [1] },
    ])
  })

  it('returns [] for a single-object non-Bambu model', () => {
    expect(buildViewerPlates(file({}), 1, [])).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/viewerPlates.test.ts`
Expected: FAIL — cannot resolve `./viewerPlates`.

- [ ] **Step 3: Implement it**

`frontend/src/lib/viewerPlates.ts`:

```ts
import type { ModelFile } from '../api/types'
import { plateThumbnailUrl } from '../api/client'

export interface ViewerPlate {
  label: string
  thumbnailUrl: string | null
  objectIndices: number[]
}

// Converges the two plate sources into one model the viewer/filmstrip consume:
// Bambu files use the server-stored plate manifest + embedded thumbnails; other
// multi-object 3MF fall back to one plate per build item with client-rendered
// thumbnails. Single-object / STL yield [] (filmstrip hidden).
export function buildViewerPlates(
  file: ModelFile,
  objectCount: number,
  fallbackThumbs: string[],
): ViewerPlate[] {
  if (file.plates.length > 0) {
    return file.plates.map((p) => ({
      label: p.name || `Plate ${p.index}`,
      thumbnailUrl: plateThumbnailUrl(file.id, p.index),
      objectIndices: p.buildItemIndices,
    }))
  }

  if (objectCount <= 1) return []

  return Array.from({ length: objectCount }, (_, i) => ({
    label: `Plate ${i + 1}`,
    thumbnailUrl: fallbackThumbs[i] ?? null,
    objectIndices: [i],
  }))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/viewerPlates.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/viewerPlates.ts frontend/src/lib/viewerPlates.test.ts
git commit -m "feat(frontend): buildViewerPlates unifies Bambu plates + fallback"
```

---

## Task 9: `PlateFilmstrip` takes `ViewerPlate[]`

**Files:**
- Modify: `frontend/src/components/viewer/PlateFilmstrip.tsx`
- Modify: `frontend/src/components/viewer/PlateFilmstrip.test.tsx`
- Modify: `frontend/src/components/viewer/PlateFilmstrip.module.css` (no change expected; verify)

**Interfaces:**
- Consumes: `ViewerPlate` (Task 8).
- Produces: `PlateFilmstrip(props: { plates: ViewerPlate[]; activeIndex: number | null; onSelect: (index: number | null) => void }): JSX.Element | null` — hidden when `plates.length <= 1`; each cell shows the plate thumbnail (or stripe placeholder), the 1-based ordinal, and the plate `label` as `title` + accessible name.

- [ ] **Step 1: Rewrite the test**

Replace `frontend/src/components/viewer/PlateFilmstrip.test.tsx` with:

```tsx
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PlateFilmstrip } from './PlateFilmstrip'
import type { ViewerPlate } from '../../lib/viewerPlates'

const plates: ViewerPlate[] = [
  { label: 'Corners', thumbnailUrl: '/api/files/7/plates/1/thumbnail', objectIndices: [0, 2] },
  { label: 'Base', thumbnailUrl: null, objectIndices: [1] },
]

describe('PlateFilmstrip', () => {
  it('renders nothing for a single plate', () => {
    const { container } = render(
      <PlateFilmstrip plates={[plates[0]]} activeIndex={null} onSelect={() => {}} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders an All control plus one cell per plate, labelled by plate name', () => {
    render(<PlateFilmstrip plates={plates} activeIndex={null} onSelect={() => {}} />)
    expect(screen.getByRole('button', { name: 'All plates' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Corners' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Base' })).toBeInTheDocument()
  })

  it('shows a thumbnail image when a url is given, placeholder otherwise', () => {
    const { container } = render(
      <PlateFilmstrip plates={plates} activeIndex={null} onSelect={() => {}} />,
    )
    const imgs = container.querySelectorAll('img')
    expect(imgs).toHaveLength(1)
    expect(imgs[0]).toHaveAttribute('src', '/api/files/7/plates/1/thumbnail')
  })

  it('marks the active plate pressed and emits its index; All emits null', () => {
    const onSelect = vi.fn()
    render(<PlateFilmstrip plates={plates} activeIndex={0} onSelect={onSelect} />)
    expect(screen.getByRole('button', { name: 'Corners' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Base' }))
    expect(onSelect).toHaveBeenCalledWith(1)
    fireEvent.click(screen.getByRole('button', { name: 'All plates' }))
    expect(onSelect).toHaveBeenCalledWith(null)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/viewer/PlateFilmstrip.test.tsx`
Expected: FAIL — component still expects `count`/`thumbnailUrls`, not `plates`.

- [ ] **Step 3: Rewrite the component**

Replace `frontend/src/components/viewer/PlateFilmstrip.tsx`:

```tsx
import type { ViewerPlate } from '../../lib/viewerPlates'
import styles from './PlateFilmstrip.module.css'

export function PlateFilmstrip({
  plates,
  activeIndex,
  onSelect,
}: {
  plates: ViewerPlate[]
  activeIndex: number | null
  onSelect: (index: number | null) => void
}) {
  if (plates.length <= 1) return null

  return (
    <div className={styles.strip} role="group" aria-label="Plates">
      <button
        type="button"
        className={`${styles.cell} ${activeIndex === null ? styles.active : ''}`}
        aria-pressed={activeIndex === null}
        aria-label="All plates"
        onClick={() => onSelect(null)}
      >
        <span className={styles.allLabel}>ALL</span>
      </button>
      {plates.map((plate, i) => (
        <button
          key={i}
          type="button"
          className={`${styles.cell} ${activeIndex === i ? styles.active : ''}`}
          aria-pressed={activeIndex === i}
          aria-label={plate.label}
          title={plate.label}
          onClick={() => onSelect(i)}
        >
          {plate.thumbnailUrl ? (
            <img className={styles.thumb} src={plate.thumbnailUrl} alt="" />
          ) : (
            <span className={styles.placeholder} />
          )}
          <span className={styles.index}>{i + 1}</span>
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/components/viewer/PlateFilmstrip.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/viewer/PlateFilmstrip.tsx frontend/src/components/viewer/PlateFilmstrip.test.tsx
git commit -m "feat(frontend): PlateFilmstrip renders ViewerPlate[] with named cells"
```

---

## Task 10: `ModelViewer` takes `visibleIndices`

**Files:**
- Modify: `frontend/src/components/viewer/ModelViewer.tsx`
- Modify: `frontend/src/components/viewer/ModelViewer.test.tsx`

**Interfaces:**
- Consumes: `setVisibleObjects` (Task 7).
- Produces: `ModelViewer(props: { model: LoadedModel; mode: RenderMode; visibleIndices: number[] | null }): JSX.Element` (replaces the `activePlate: number | null` prop).

- [ ] **Step 1: Update the test**

In `frontend/src/components/viewer/ModelViewer.test.tsx`, change both `<ModelViewer ... activePlate={null} />` usages to `visibleIndices={null}`, and the rerender in the mode-change test to `visibleIndices={null}`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/viewer/ModelViewer.test.tsx`
Expected: FAIL — `visibleIndices` not a prop / `setActivePlate` import broken.

- [ ] **Step 3: Update the component**

In `ModelViewer.tsx`: change the import `setActivePlate` → `setVisibleObjects`; change the prop `activePlate: number | null` → `visibleIndices: number[] | null`; in the mode/plate effect replace `setActivePlate(model.objects, activePlate)` with `setVisibleObjects(model.objects, visibleIndices)`; and update that effect's dependency array from `[model, mode, activePlate]` to `[model, mode, visibleIndices]`.

```tsx
import { applyRenderMode, setVisibleObjects, type RenderMode } from '../../lib/viewerModes'
```

```tsx
export function ModelViewer({
  model,
  mode,
  visibleIndices,
}: {
  model: LoadedModel
  mode: RenderMode
  visibleIndices: number[] | null
}) {
```

```tsx
  useEffect(() => {
    applyRenderMode(model.objects, mode)
    setVisibleObjects(model.objects, visibleIndices)
    if (rendererRef.current && sceneRef.current && cameraRef.current) {
      rendererRef.current.render(sceneRef.current, cameraRef.current)
    }
  }, [model, mode, visibleIndices])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/components/viewer/ModelViewer.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/viewer/ModelViewer.tsx frontend/src/components/viewer/ModelViewer.test.tsx
git commit -m "feat(frontend): ModelViewer isolates a set of objects via visibleIndices"
```

---

## Task 11: `DetailView` wiring

**Files:**
- Modify: `frontend/src/views/DetailView.tsx`
- Modify: `frontend/src/views/DetailView.test.tsx`

**Interfaces:**
- Consumes: `buildViewerPlates` (Task 8), `PlateFilmstrip` (Task 9), `ModelViewer` (Task 10), `renderPlateThumbnails` (existing).

- [ ] **Step 1: Update `DetailView`**

Changes:
1. Import: add `import { buildViewerPlates, type ViewerPlate } from '../lib/viewerPlates'`.
2. In the content-fetch `.then`, only client-render fallback thumbnails when the file has **no** server plates; otherwise skip that work:

```tsx
      .then((buffer) => {
        if (cancelled) return
        const loaded = loadModelFromBuffer(buffer, type)
        if (file.plates.length === 0) {
          try {
            setPlateThumbs(renderPlateThumbnails(loaded))
          } catch {
            setPlateThumbs([])
          }
        } else {
          setPlateThumbs([])
        }
        setModel(loaded)
      })
```

3. Replace the `activePlate`/`plateCount` wiring. After `const plateCount = ...` (remove that line) compute the plates and the active visibility:

```tsx
  const viewerPlates: ViewerPlate[] = file && model ? buildViewerPlates(file, model.objects.length, plateThumbs) : []
  const visibleIndices = activePlate === null ? null : (viewerPlates[activePlate]?.objectIndices ?? null)
```

4. Pass the new props to the viewer and filmstrip:

```tsx
          {viewerBody}
          <PlateFilmstrip plates={viewerPlates} activeIndex={activePlate} onSelect={setActivePlate} />
```

and in `viewerBody`'s ModelViewer branch:

```tsx
    viewerBody = <ModelViewer model={model} mode={mode} visibleIndices={visibleIndices} />
```

(`viewerBody` is computed before `viewerPlates`/`visibleIndices` today — move the `viewerBody` assignment to AFTER the `viewerPlates`/`visibleIndices` computation so `visibleIndices` is in scope. The `activePlate` state and `setActivePlate` setter are unchanged; `activePlate` is now an index into `viewerPlates`.)

- [ ] **Step 2: Update the test**

`DetailView.test.tsx` mocks `ModelViewer`, so the prop rename needs no test change for the existing 3 tests (they never load a model — fetch is stubbed to 404). Verify they still pass. Add one test that a Bambu file's plates drive the filmstrip. Because the content fetch + WebGL can't run in jsdom, assert via the fallback-free path is not feasible here; instead keep coverage at the unit level (Tasks 8–9) and rely on manual verification for the composed flow. No new DetailView test is required; confirm the existing 3 still pass.

- [ ] **Step 3: Run tests + typecheck**

Run: `npm test -- src/views/DetailView.test.tsx` then `npx tsc -b`
Expected: 3 tests PASS; `tsc` clean (all `setActivePlate`/`activePlate`/`count` references resolved).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/views/DetailView.tsx frontend/src/views/DetailView.test.tsx
git commit -m "feat(frontend): DetailView drives filmstrip + isolation from ViewerPlate[]"
```

---

## Task 12: Full-suite verification + manual check + README

**Files:**
- Modify: `README.md` (re-import note).

- [ ] **Step 1: Full suites + build**

Run from `backend/`: `dotnet test` → all green (existing + new plate/entity/controller tests).
Run from `frontend/`: `npm test` → all green; `npx tsc -b` → clean; `npm run build` → succeeds.

- [ ] **Step 2: Add the re-import note to `README.md`**

Add a short note under the relevant section:

```markdown
### Bambu plate metadata

3MF files sliced in Bambu Studio carry real print-plate data (`Metadata/model_settings.config`).
On import, PlasticRoom records each plate (name, embedded thumbnail, object grouping) and the
detail view's filmstrip shows those plates. **Files imported before this feature must be
re-imported** to gain plate data; until then they fall back to one cell per 3MF build item.
```

- [ ] **Step 3: Manual verification**

Backend: `cd backend; $env:SEED_SAMPLE_DATA="true"; dotnet run --project PlasticRoom.Api` (http://localhost:5102).
Frontend: `cd frontend; npm run dev` (http://localhost:5173).
Import `D:\Creative\3DModels\Modunizer\Projects\BathroomShelf-5x13.3mf`, open it, and verify:
- SPECS shows **Plates: 7** (not 21).
- The filmstrip shows **7 cells** with the slicer's plate thumbnails; hovering a cell shows its name ("Corners", "Borders (6M & 6F)", …).
- Clicking a plate isolates **all objects on that plate** in the viewer; "ALL" restores; Solid/Wireframe/Plates still work.
- Import a plain STL → no filmstrip. Import a non-Bambu multi-object 3MF (if available) → per-build-item fallback with client-rendered thumbnails.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: note Bambu plate re-import requirement"
```

(Commit any manual-verification fixes separately if needed.)

---

## Post-implementation

- Update `project-plastic-room.md` memory: real Bambu plates now parsed/stored (`Plate` entity, `BambuPlateParser`, plate-thumbnail endpoint), the "plate == build item" note now qualified (accurate for Bambu, fallback otherwise), and the re-import requirement.
- Deferred (unchanged): other slicers (Prusa etc.); library grid plate thumbnails; in-place backfill of existing files; per-plate print time/filament metadata.
