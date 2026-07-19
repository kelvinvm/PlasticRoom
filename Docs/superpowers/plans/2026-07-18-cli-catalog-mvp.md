# CLI Catalog MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a CLI tool that imports zipped 3D-model downloads into a searchable catalog (Designer → Model → files, tagged), replacing the current folder/collection UI-driven workflow with a fast, no-UI import/tag/find/export loop.

**Architecture:** New `PlasticRoom.Cli` console project reuses the existing `PlasticRoom.Api` project's XPO entities, `XpoSessionFactory`, and 3MF/STL parsing logic directly (no HTTP hop). Three new XPO entities — `Designer`, `Model`, `ModelTag` — are added additively alongside the existing schema; nothing existing is deleted or migrated. Each CLI command is a static class with a `Run`/action method taking explicit dependencies (session factory, an `IConsoleIO` abstraction, library paths), so commands are testable by direct method call without spawning a process.

**Tech Stack:** .NET 10 console app, DevExpress XPO (existing ORM), SQLite (existing `plasticroom.db`), xunit for tests.

## Global Constraints

- Target framework: `net10.0`, `<Nullable>enable</Nullable>`, `<ImplicitUsings>enable</ImplicitUsings>` — matches `PlasticRoom.Api.csproj`.
- No migration of existing data; existing `Folder`/`FileFolder`/`FileTag`/`FilesController`/etc. are left untouched (out of scope, not deleted).
- `import` is zip-only — no loose-file/folder import in this plan.
- Files are referenced in place after extraction (moved into the user's own library tree), never copied into app-managed storage.
- Tagging is skippable at import time; `list untagged` and `tag` exist to complete it later.
- No thumbnail display — this is a text-only CLI.

---

## Task 1: Designer, Model, ModelTag entities

**Files:**
- Create: `backend/PlasticRoom.Api/Entities/Designer.cs`
- Create: `backend/PlasticRoom.Api/Entities/Model.cs`
- Create: `backend/PlasticRoom.Api/Entities/ModelTag.cs`
- Modify: `backend/PlasticRoom.Api/Entities/Tag.cs`
- Modify: `backend/PlasticRoom.Api/Entities/ModelFile.cs`
- Test: `backend/PlasticRoom.Api.Tests/Entities/CatalogEntitySchemaTests.cs`

**Interfaces:**
- Produces: `Designer { string Name; XPCollection<Model> Models }`, `Model { string Name; Designer Designer; string DestinationPath; XPCollection<ModelFile> Files; XPCollection<ModelTag> ModelTags }`, `ModelTag { Model Model; Tag Tag }`, `ModelFile.Model` (nullable `Model?` association), `Tag.ModelTags` (`XPCollection<ModelTag>`).

- [ ] **Step 1: Write the failing schema test**

```csharp
// backend/PlasticRoom.Api.Tests/Entities/CatalogEntitySchemaTests.cs
using System;
using System.IO;
using System.Linq;
using DevExpress.Xpo;
using PlasticRoom.Api.Data;
using PlasticRoom.Api.Entities;
using Xunit;

namespace PlasticRoom.Api.Tests.Entities;

public class CatalogEntitySchemaTests : IDisposable
{
    private readonly string _tempDir;
    private readonly XpoSessionFactory _factory;

    public CatalogEntitySchemaTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), "plasticroom-catalog-entity-tests-" + Guid.NewGuid());
        _factory = new XpoSessionFactory(_tempDir);
    }

    [Fact]
    public void CanCreateDesignerModelAndAssociateFilesAndTags()
    {
        using (var session = _factory.CreateSession())
        {
            var designer = new Designer(session) { Name = "LeHa Designs" };
            designer.Save();

            var model = new Model(session)
            {
                Name = "Bramble",
                Designer = designer,
                DestinationPath = "/library/LeHa Designs/Bramble",
            };
            model.Save();

            var file = new ModelFile(session)
            {
                Name = "bramble.3mf",
                Type = ModelFileType.ThreeMf,
                SizeBytes = 2048,
                AddedAt = DateTime.UtcNow,
                StoragePath = "/library/LeHa Designs/Bramble/bramble.3mf",
                Model = model,
            };
            file.Save();

            var tag = new Tag(session) { Name = "pint holder" };
            tag.Save();

            var modelTag = new ModelTag(session) { Model = model, Tag = tag };
            modelTag.Save();
        }

        using var verifySession = _factory.CreateSession();

        var designers = new XPCollection<Designer>(verifySession);
        var reloadedDesigner = designers.Single(d => d.Name == "LeHa Designs");
        Assert.Single(reloadedDesigner.Models);

        var reloadedModel = reloadedDesigner.Models.Single();
        Assert.Equal("Bramble", reloadedModel.Name);
        Assert.Single(reloadedModel.Files);
        Assert.Single(reloadedModel.ModelTags);
        Assert.Equal("pint holder", reloadedModel.ModelTags.Single().Tag.Name);
        Assert.Equal(reloadedModel.Oid, reloadedModel.Files.Single().Model!.Oid);
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

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && dotnet test PlasticRoom.Api.Tests --filter CanCreateDesignerModelAndAssociateFilesAndTags`
Expected: FAIL — compile error, `Designer`/`Model`/`ModelTag` types don't exist yet.

- [ ] **Step 3: Create the `Designer` entity**

```csharp
// backend/PlasticRoom.Api/Entities/Designer.cs
using DevExpress.Xpo;

namespace PlasticRoom.Api.Entities;

public class Designer : XPObject
{
    public Designer(Session session) : base(session)
    {
    }

    private string name = string.Empty;
    public string Name
    {
        get => name;
        set => SetPropertyValue(nameof(Name), ref name, value);
    }

    [Association("Designer-Models")]
    public XPCollection<Model> Models => GetCollection<Model>(nameof(Models));
}
```

- [ ] **Step 4: Create the `Model` entity**

```csharp
// backend/PlasticRoom.Api/Entities/Model.cs
using DevExpress.Xpo;

namespace PlasticRoom.Api.Entities;

public class Model : XPObject
{
    public Model(Session session) : base(session)
    {
    }

    private string name = string.Empty;
    public string Name
    {
        get => name;
        set => SetPropertyValue(nameof(Name), ref name, value);
    }

    private Designer designer = null!;
    [Association("Designer-Models")]
    public Designer Designer
    {
        get => designer;
        set => SetPropertyValue(nameof(Designer), ref designer, value);
    }

    private string destinationPath = string.Empty;
    public string DestinationPath
    {
        get => destinationPath;
        set => SetPropertyValue(nameof(DestinationPath), ref destinationPath, value);
    }

    [Association("Model-ModelFiles")]
    public XPCollection<ModelFile> Files => GetCollection<ModelFile>(nameof(Files));

    [Association("Model-ModelTags")]
    public XPCollection<ModelTag> ModelTags => GetCollection<ModelTag>(nameof(ModelTags));
}
```

- [ ] **Step 5: Create the `ModelTag` join entity**

```csharp
// backend/PlasticRoom.Api/Entities/ModelTag.cs
using DevExpress.Xpo;

namespace PlasticRoom.Api.Entities;

public class ModelTag : XPObject
{
    public ModelTag(Session session) : base(session)
    {
    }

    private Model model = null!;
    [Association("Model-ModelTags")]
    public Model Model
    {
        get => model;
        set => SetPropertyValue(nameof(Model), ref model, value);
    }

    private Tag tag = null!;
    [Association("Tag-ModelTags")]
    public Tag Tag
    {
        get => tag;
        set => SetPropertyValue(nameof(Tag), ref tag, value);
    }
}
```

- [ ] **Step 6: Add the `ModelTags` collection to `Tag`**

In `backend/PlasticRoom.Api/Entities/Tag.cs`, add after the existing `FileTags` collection:

```csharp
    [Association("Tag-ModelTags")]
    public XPCollection<ModelTag> ModelTags => GetCollection<ModelTag>(nameof(ModelTags));
```

- [ ] **Step 7: Add the `Model` association to `ModelFile`**

In `backend/PlasticRoom.Api/Entities/ModelFile.cs`, add after the existing `Plates` collection:

```csharp
    private Model? model;
    [Association("Model-ModelFiles")]
    public Model? Model
    {
        get => model;
        set => SetPropertyValue(nameof(Model), ref model, value);
    }
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd backend && dotnet test PlasticRoom.Api.Tests --filter CanCreateDesignerModelAndAssociateFilesAndTags`
Expected: PASS

- [ ] **Step 9: Run full existing test suite to confirm no regression**

Run: `cd backend && dotnet test`
Expected: All tests PASS (existing `Folder`/`FileTag` entities and controllers are untouched and unaffected).

- [ ] **Step 10: Commit**

```bash
git add backend/PlasticRoom.Api/Entities/Designer.cs backend/PlasticRoom.Api/Entities/Model.cs backend/PlasticRoom.Api/Entities/ModelTag.cs backend/PlasticRoom.Api/Entities/Tag.cs backend/PlasticRoom.Api/Entities/ModelFile.cs backend/PlasticRoom.Api.Tests/Entities/CatalogEntitySchemaTests.cs
git commit -m "feat(backend): add Designer/Model/ModelTag entities for the CLI catalog"
```

---

## Task 2: `PlasticRoom.Cli` and `PlasticRoom.Cli.Tests` project scaffolding

**Files:**
- Create: `backend/PlasticRoom.Cli/PlasticRoom.Cli.csproj`
- Create: `backend/PlasticRoom.Cli/Program.cs`
- Create: `backend/PlasticRoom.Cli/IConsoleIO.cs`
- Create: `backend/PlasticRoom.Cli/SystemConsoleIO.cs`
- Create: `backend/PlasticRoom.Cli.Tests/PlasticRoom.Cli.Tests.csproj`
- Create: `backend/PlasticRoom.Cli.Tests/FakeConsoleIO.cs`
- Create: `backend/PlasticRoom.Cli.Tests/ProgramDispatchTests.cs`
- Modify: `backend/PlasticRoom.sln`

**Interfaces:**
- Produces: `IConsoleIO { void WriteLine(string); string? ReadLine(); }`, `SystemConsoleIO : IConsoleIO`, `Cli.Dispatch(string[] args, XpoSessionFactory sessionFactory, LibraryPaths libraryPaths, IConsoleIO io) : int` (the testable entry point `Program.cs`'s `Main` delegates to).
- Consumes: `PlasticRoom.Api.Data.XpoSessionFactory` (Task 1's dependency, already exists).

- [ ] **Step 1: Write the failing dispatch test**

```csharp
// backend/PlasticRoom.Cli.Tests/FakeConsoleIO.cs
using System.Collections.Generic;
using PlasticRoom.Cli;

namespace PlasticRoom.Cli.Tests;

public class FakeConsoleIO : IConsoleIO
{
    private readonly Queue<string?> _inputs;
    public List<string> Output { get; } = new();

    public FakeConsoleIO(params string?[] inputs)
    {
        _inputs = new Queue<string?>(inputs);
    }

    public void WriteLine(string message) => Output.Add(message);

    public string? ReadLine() => _inputs.Count > 0 ? _inputs.Dequeue() : null;
}
```

```csharp
// backend/PlasticRoom.Cli.Tests/ProgramDispatchTests.cs
using System;
using System.IO;
using System.Linq;
using PlasticRoom.Api.Data;
using PlasticRoom.Cli;
using Xunit;

namespace PlasticRoom.Cli.Tests;

public class ProgramDispatchTests : IDisposable
{
    private readonly string _tempDir;
    private readonly XpoSessionFactory _sessionFactory;
    private readonly LibraryPaths _libraryPaths;

    public ProgramDispatchTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), "plasticroom-cli-dispatch-tests-" + Guid.NewGuid());
        _sessionFactory = new XpoSessionFactory(Path.Combine(_tempDir, "data"));
        _libraryPaths = new LibraryPaths(Path.Combine(_tempDir, "library"));
    }

    [Fact]
    public void UnknownCommandPrintsUsageAndReturnsNonZero()
    {
        var io = new FakeConsoleIO();
        var exitCode = Cli.Dispatch(new[] { "bogus" }, _sessionFactory, _libraryPaths, io);

        Assert.NotEqual(0, exitCode);
        Assert.Contains(io.Output, line => line.Contains("Unknown command", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void NoArgsPrintsUsageAndReturnsNonZero()
    {
        var io = new FakeConsoleIO();
        var exitCode = Cli.Dispatch(Array.Empty<string>(), _sessionFactory, _libraryPaths, io);

        Assert.NotEqual(0, exitCode);
        Assert.Contains(io.Output, line => line.Contains("Usage", StringComparison.OrdinalIgnoreCase));
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

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && dotnet test PlasticRoom.Cli.Tests`
Expected: FAIL — projects don't exist yet.

- [ ] **Step 3: Create the CLI console project file**

```xml
<!-- backend/PlasticRoom.Cli/PlasticRoom.Cli.csproj -->
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <Nullable>enable</Nullable>
    <ImplicitUsings>enable</ImplicitUsings>
    <AssemblyName>plasticroom</AssemblyName>
  </PropertyGroup>

  <ItemGroup>
    <ProjectReference Include="..\PlasticRoom.Api\PlasticRoom.Api.csproj" />
  </ItemGroup>

</Project>
```

- [ ] **Step 4: Create `IConsoleIO` and `SystemConsoleIO`**

```csharp
// backend/PlasticRoom.Cli/IConsoleIO.cs
namespace PlasticRoom.Cli;

public interface IConsoleIO
{
    void WriteLine(string message);
    string? ReadLine();
}
```

```csharp
// backend/PlasticRoom.Cli/SystemConsoleIO.cs
namespace PlasticRoom.Cli;

public class SystemConsoleIO : IConsoleIO
{
    public void WriteLine(string message) => System.Console.WriteLine(message);
    public string? ReadLine() => System.Console.ReadLine();
}
```

- [ ] **Step 5: Create `LibraryPaths`**

```csharp
// backend/PlasticRoom.Cli/LibraryPaths.cs
using System;
using System.IO;

namespace PlasticRoom.Cli;

public class LibraryPaths
{
    public string RootDirectory { get; }

    public LibraryPaths(string? root = null)
    {
        RootDirectory = root
            ?? Environment.GetEnvironmentVariable("LIBRARY_ROOT")
            ?? throw new InvalidOperationException(
                "LIBRARY_ROOT must be set (or pass a root path) so the CLI knows where to file imported models.");

        Directory.CreateDirectory(RootDirectory);
    }
}
```

- [ ] **Step 6: Create `Program.cs` with a testable `Dispatch` entry point**

```csharp
// backend/PlasticRoom.Cli/Program.cs
using PlasticRoom.Api.Data;
using PlasticRoom.Cli;

var sessionFactory = new XpoSessionFactory();
var libraryPaths = new LibraryPaths();
var io = new SystemConsoleIO();

return Cli.Dispatch(args, sessionFactory, libraryPaths, io);

namespace PlasticRoom.Cli
{
    public static class Cli
    {
        public static int Dispatch(string[] args, XpoSessionFactory sessionFactory, LibraryPaths libraryPaths, IConsoleIO io)
        {
            if (args.Length == 0)
            {
                PrintUsage(io);
                return 1;
            }

            var rest = args[1..];
            switch (args[0])
            {
                case "import":
                    return ImportCommand.Run(rest, sessionFactory, libraryPaths, io);
                case "find":
                    return QueryCommands.Find(rest, sessionFactory, io);
                case "list":
                    return QueryCommands.List(rest, sessionFactory, io);
                case "show":
                    return QueryCommands.Show(rest, sessionFactory, io);
                case "tag":
                    return TagCommand.Run(rest, sessionFactory, io);
                case "export":
                    return ExportCommand.Run(rest, sessionFactory, io);
                default:
                    io.WriteLine($"Unknown command: {args[0]}");
                    PrintUsage(io);
                    return 1;
            }
        }

        private static void PrintUsage(IConsoleIO io)
        {
            io.WriteLine("Usage: plasticroom <command> [args]");
            io.WriteLine("Commands:");
            io.WriteLine("  import <zip-path>");
            io.WriteLine("  find <term>");
            io.WriteLine("  list designers");
            io.WriteLine("  list models --designer <name> | --tag <name>");
            io.WriteLine("  list untagged");
            io.WriteLine("  show <model-name>");
            io.WriteLine("  tag <model-name> <tag...>");
            io.WriteLine("  export <model-name> [--dest <path>]");
        }
    }
}
```

Note: `ImportCommand`, `QueryCommands`, `TagCommand`, `ExportCommand` don't exist yet — this project will not compile until Tasks 3–8 add them. That's expected; this task's test project only needs `Cli.Dispatch` to compile, so add temporary minimal stub classes now (each command's real body lands in its own task):

```csharp
// backend/PlasticRoom.Cli/ImportCommand.cs
namespace PlasticRoom.Cli;

public static class ImportCommand
{
    public static int Run(string[] args, PlasticRoom.Api.Data.XpoSessionFactory sessionFactory, LibraryPaths libraryPaths, IConsoleIO io)
    {
        io.WriteLine("import: not implemented yet");
        return 1;
    }
}
```

```csharp
// backend/PlasticRoom.Cli/QueryCommands.cs
namespace PlasticRoom.Cli;

public static class QueryCommands
{
    public static int Find(string[] args, PlasticRoom.Api.Data.XpoSessionFactory sessionFactory, IConsoleIO io)
    {
        io.WriteLine("find: not implemented yet");
        return 1;
    }

    public static int List(string[] args, PlasticRoom.Api.Data.XpoSessionFactory sessionFactory, IConsoleIO io)
    {
        io.WriteLine("list: not implemented yet");
        return 1;
    }

    public static int Show(string[] args, PlasticRoom.Api.Data.XpoSessionFactory sessionFactory, IConsoleIO io)
    {
        io.WriteLine("show: not implemented yet");
        return 1;
    }
}
```

```csharp
// backend/PlasticRoom.Cli/TagCommand.cs
namespace PlasticRoom.Cli;

public static class TagCommand
{
    public static int Run(string[] args, PlasticRoom.Api.Data.XpoSessionFactory sessionFactory, IConsoleIO io)
    {
        io.WriteLine("tag: not implemented yet");
        return 1;
    }
}
```

```csharp
// backend/PlasticRoom.Cli/ExportCommand.cs
namespace PlasticRoom.Cli;

public static class ExportCommand
{
    public static int Run(string[] args, PlasticRoom.Api.Data.XpoSessionFactory sessionFactory, IConsoleIO io)
    {
        io.WriteLine("export: not implemented yet");
        return 1;
    }
}
```

- [ ] **Step 7: Create the CLI test project file**

```xml
<!-- backend/PlasticRoom.Cli.Tests/PlasticRoom.Cli.Tests.csproj -->
<Project Sdk="Microsoft.NET.Sdk">

  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <IsPackable>false</IsPackable>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="coverlet.collector" Version="6.0.4" />
    <PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.14.1" />
    <PackageReference Include="xunit" Version="2.9.3" />
    <PackageReference Include="xunit.runner.visualstudio" Version="3.1.4" />
  </ItemGroup>

  <ItemGroup>
    <Using Include="Xunit" />
  </ItemGroup>

  <ItemGroup>
    <ProjectReference Include="..\PlasticRoom.Cli\PlasticRoom.Cli.csproj" />
  </ItemGroup>

</Project>
```

- [ ] **Step 8: Add both new projects to the solution**

Run:
```bash
cd backend
dotnet sln PlasticRoom.sln add PlasticRoom.Cli/PlasticRoom.Cli.csproj
dotnet sln PlasticRoom.sln add PlasticRoom.Cli.Tests/PlasticRoom.Cli.Tests.csproj
```

- [ ] **Step 9: Run test to verify it passes**

Run: `cd backend && dotnet test PlasticRoom.Cli.Tests`
Expected: PASS (both `ProgramDispatchTests` pass; stub commands return 1 with "not implemented yet" but that's not exercised by these two tests).

- [ ] **Step 10: Run full solution build to confirm no regressions**

Run: `cd backend && dotnet build`
Expected: Build succeeds for all four projects.

- [ ] **Step 11: Commit**

```bash
git add backend/PlasticRoom.Cli backend/PlasticRoom.Cli.Tests backend/PlasticRoom.sln
git commit -m "feat(cli): scaffold PlasticRoom.Cli console project with command dispatch"
```

---

## Task 3: `ZipInspector` — guess Designer/Model name from a zip

**Files:**
- Create: `backend/PlasticRoom.Cli/ZipInspector.cs`
- Test: `backend/PlasticRoom.Cli.Tests/ZipInspectorTests.cs`

**Interfaces:**
- Produces: `ZipInspector.Inspect(string zipPath) : ZipInspector.InspectionResult` where `InspectionResult(string GuessedDesigner, string GuessedModelName, IReadOnlyList<string> ThreeMfEntries, IReadOnlyList<string> StlEntries, IReadOnlyList<string> DocEntries)`.
- Consumes: nothing beyond `System.IO.Compression.ZipFile`.

Guessing algorithm (exact, for the implementer):
1. Determine the "name source": if every entry in the zip shares one common top-level folder segment, use that folder name; otherwise use the zip's filename (without extension); if that's empty, use `"unknown"`.
2. Split the name source into (designer, model) by trying separators in order `" - "`, `"_"`, `"-"`: the first separator found that yields two non-empty trimmed halves wins (designer = left half, model = right half). If none match, designer = `"unknown"`, model = the full name source.

- [ ] **Step 1: Write the failing test**

```csharp
// backend/PlasticRoom.Cli.Tests/ZipInspectorTests.cs
using System;
using System.IO;
using System.IO.Compression;
using PlasticRoom.Cli;
using Xunit;

namespace PlasticRoom.Cli.Tests;

public class ZipInspectorTests : IDisposable
{
    private readonly string _tempDir;

    public ZipInspectorTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), "plasticroom-zip-inspector-tests-" + Guid.NewGuid());
        Directory.CreateDirectory(_tempDir);
    }

    private string CreateZip(string zipFileName, params (string entryName, string content)[] entries)
    {
        var zipPath = Path.Combine(_tempDir, zipFileName);
        using var stream = File.Create(zipPath);
        using var archive = new ZipArchive(stream, ZipArchiveMode.Create);
        foreach (var (entryName, content) in entries)
        {
            var entry = archive.CreateEntry(entryName);
            using var writer = new StreamWriter(entry.Open());
            writer.Write(content);
        }
        return zipPath;
    }

    [Fact]
    public void PrefersInternalFolderNameOverZipFilename()
    {
        var zipPath = CreateZip(
            "download123.zip",
            ("LeHa Designs - Bramble/bramble.3mf", "3mf-content"),
            ("LeHa Designs - Bramble/instructions.pdf", "pdf-content"));

        var result = ZipInspector.Inspect(zipPath);

        Assert.Equal("LeHa Designs", result.GuessedDesigner);
        Assert.Equal("Bramble", result.GuessedModelName);
        Assert.Single(result.ThreeMfEntries);
        Assert.Single(result.DocEntries);
    }

    [Fact]
    public void FallsBackToZipFilenameWhenNoSingleInternalFolder()
    {
        var zipPath = CreateZip(
            "FilamentRack_Model.zip",
            ("part1.stl", "stl-content"),
            ("part2.stl", "stl-content"));

        var result = ZipInspector.Inspect(zipPath);

        Assert.Equal("FilamentRack", result.GuessedDesigner);
        Assert.Equal("Model", result.GuessedModelName);
        Assert.Equal(2, result.StlEntries.Count);
    }

    [Fact]
    public void FallsBackToUnknownDesignerWhenNameHasNoSeparator()
    {
        var zipPath = CreateZip(
            "brambleponholder.zip",
            ("brambleponholder/model.stl", "stl-content"));

        var result = ZipInspector.Inspect(zipPath);

        Assert.Equal("unknown", result.GuessedDesigner);
        Assert.Equal("brambleponholder", result.GuessedModelName);
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

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && dotnet test PlasticRoom.Cli.Tests --filter ZipInspectorTests`
Expected: FAIL — `ZipInspector` doesn't exist.

- [ ] **Step 3: Implement `ZipInspector`**

```csharp
// backend/PlasticRoom.Cli/ZipInspector.cs
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;

namespace PlasticRoom.Cli;

public static class ZipInspector
{
    public record InspectionResult(
        string GuessedDesigner,
        string GuessedModelName,
        IReadOnlyList<string> ThreeMfEntries,
        IReadOnlyList<string> StlEntries,
        IReadOnlyList<string> DocEntries);

    private static readonly string[] Separators = { " - ", "_", "-" };

    public static InspectionResult Inspect(string zipPath)
    {
        using var archive = ZipFile.OpenRead(zipPath);
        var fileEntries = archive.Entries.Where(e => !string.IsNullOrEmpty(e.Name)).ToList();

        var threeMf = fileEntries
            .Where(e => e.FullName.EndsWith(".3mf", StringComparison.OrdinalIgnoreCase))
            .Select(e => e.FullName).ToList();
        var stl = fileEntries
            .Where(e => e.FullName.EndsWith(".stl", StringComparison.OrdinalIgnoreCase))
            .Select(e => e.FullName).ToList();
        var docs = fileEntries
            .Where(e =>
                e.FullName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase) ||
                e.FullName.EndsWith(".txt", StringComparison.OrdinalIgnoreCase) ||
                e.Name.Contains("readme", StringComparison.OrdinalIgnoreCase))
            .Select(e => e.FullName).ToList();

        var nameSource = DetermineNameSource(fileEntries, zipPath);
        var (designer, model) = SplitDesignerAndModel(nameSource);

        return new InspectionResult(designer, model, threeMf, stl, docs);
    }

    private static string DetermineNameSource(List<ZipArchiveEntry> fileEntries, string zipPath)
    {
        if (fileEntries.Count > 0 && fileEntries.All(e => e.FullName.Contains('/')))
        {
            var topLevelFolders = fileEntries
                .Select(e => e.FullName.Split('/')[0])
                .Distinct()
                .ToList();

            if (topLevelFolders.Count == 1 && topLevelFolders[0].Length > 0)
            {
                return topLevelFolders[0];
            }
        }

        var fromFilename = Path.GetFileNameWithoutExtension(zipPath);
        return string.IsNullOrWhiteSpace(fromFilename) ? "unknown" : fromFilename;
    }

    private static (string Designer, string Model) SplitDesignerAndModel(string source)
    {
        foreach (var separator in Separators)
        {
            var idx = source.IndexOf(separator, StringComparison.Ordinal);
            if (idx <= 0)
            {
                continue;
            }

            var designer = source[..idx].Trim();
            var model = source[(idx + separator.Length)..].Trim();
            if (designer.Length > 0 && model.Length > 0)
            {
                return (designer, model);
            }
        }

        return ("unknown", source);
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && dotnet test PlasticRoom.Cli.Tests --filter ZipInspectorTests`
Expected: PASS (all 3 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/PlasticRoom.Cli/ZipInspector.cs backend/PlasticRoom.Cli.Tests/ZipInspectorTests.cs
git commit -m "feat(cli): guess Designer/Model name from zip contents"
```

---

## Task 4: `import` command

**Files:**
- Modify: `backend/PlasticRoom.Cli/ImportCommand.cs` (replace stub body)
- Test: `backend/PlasticRoom.Cli.Tests/ImportCommandTests.cs`

**Interfaces:**
- Consumes: `ZipInspector.Inspect` (Task 3), `Designer`/`Model`/`ModelFile`/`ModelTag`/`Tag` entities (Task 1), `XpoSessionFactory`, `LibraryPaths`, `IConsoleIO`.
- Produces: `ImportCommand.Run(string[] args, XpoSessionFactory sessionFactory, LibraryPaths libraryPaths, IConsoleIO io) : int`.

Interactive flow (exact, for the implementer):
1. `args[0]` is the zip path. If missing or the file doesn't exist, print an error and return 1.
2. Extract the zip to a temp directory (`Path.Combine(Path.GetTempPath(), "plasticroom-import-" + Guid.NewGuid())`).
3. Call `ZipInspector.Inspect(zipPath)` for the guess (reuse the same temp-extraction logic isn't required — `Inspect` reads the zip directly).
4. Print the summary: guessed Designer, Model name, proposed destination `Path.Combine(libraryPaths.RootDirectory, designer, modelName)`, and counts of 3MF/STL/doc files found.
5. Prompt (via `io.ReadLine()`) for each of Designer, Model name, and destination folder, pre-filled with the guess — an empty response (just Enter) keeps the guess; the destination folder is always re-derived from the confirmed Designer+Model unless overridden with a non-empty response containing a `/` or `\`.
6. On confirm (a final "y/n" prompt defaulting to "y" on empty input), extract the zip contents to the destination folder (`Directory.CreateDirectory` + copy files from the temp extraction, preserving relative paths), find-or-create the `Designer` row, create the `Model` row, and create one `ModelFile` row per 3MF/STL file found (parsing dims via `ThreeMfMetadataParser`/`StlMetadataParser` the same way `FilesController.Upload` does, wrapped in try/catch — a parse failure is logged via `io.WriteLine` and that file is still recorded with null metadata, not skipped).
7. Prompt for comma-separated tags; empty input skips tagging. Non-empty input finds-or-creates each `Tag` by name and links it via `ModelTag`.
8. On decline at step 6, delete the temp extraction directory and return 1 without touching the DB or the destination folder.

- [ ] **Step 1: Write the failing test**

```csharp
// backend/PlasticRoom.Cli.Tests/ImportCommandTests.cs
using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
using DevExpress.Xpo;
using PlasticRoom.Api.Data;
using PlasticRoom.Api.Entities;
using PlasticRoom.Cli;
using Xunit;

namespace PlasticRoom.Cli.Tests;

public class ImportCommandTests : IDisposable
{
    private readonly string _tempDir;
    private readonly XpoSessionFactory _sessionFactory;
    private readonly LibraryPaths _libraryPaths;

    public ImportCommandTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), "plasticroom-import-cmd-tests-" + Guid.NewGuid());
        _sessionFactory = new XpoSessionFactory(Path.Combine(_tempDir, "data"));
        _libraryPaths = new LibraryPaths(Path.Combine(_tempDir, "library"));
    }

    private string CreateSampleZip()
    {
        var zipPath = Path.Combine(_tempDir, "download.zip");
        using var stream = File.Create(zipPath);
        using var archive = new ZipArchive(stream, ZipArchiveMode.Create);

        var modelXml =
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>" +
            "<model unit=\"millimeter\" xmlns=\"http://schemas.microsoft.com/3dmanufacturing/core/2015/02\">" +
            "<resources><object id=\"1\" type=\"model\"><mesh><vertices>" +
            "<vertex x=\"0\" y=\"0\" z=\"0\"/><vertex x=\"10\" y=\"0\" z=\"0\"/>" +
            "<vertex x=\"0\" y=\"5\" z=\"0\"/><vertex x=\"0\" y=\"0\" z=\"2\"/></vertices>" +
            "<triangles><triangle v1=\"0\" v2=\"1\" v3=\"2\"/></triangles></mesh></object></resources>" +
            "<build><item objectid=\"1\"/></build></model>";

        var threeMfEntry = archive.CreateEntry("LeHa Designs - Bramble/bramble.3mf");
        using (var entryStream = threeMfEntry.Open())
        using (var threeMfZip = new ZipArchive(entryStream, ZipArchiveMode.Create))
        {
            var modelEntry = threeMfZip.CreateEntry("3D/3dmodel.model");
            using var writer = new StreamWriter(modelEntry.Open());
            writer.Write(modelXml);
        }

        var docEntry = archive.CreateEntry("LeHa Designs - Bramble/instructions.pdf");
        using (var writer = new StreamWriter(docEntry.Open()))
        {
            writer.Write("fake pdf content");
        }

        return zipPath;
    }

    [Fact]
    public void ConfirmingImportCreatesDesignerModelAndFiles()
    {
        var zipPath = CreateSampleZip();
        // Accept every prompt's default (Designer, Model name, destination, confirm) then skip tags.
        var io = new FakeConsoleIO("", "", "", "y", "");

        var exitCode = ImportCommand.Run(new[] { zipPath }, _sessionFactory, _libraryPaths, io);

        Assert.Equal(0, exitCode);

        using var session = _sessionFactory.CreateSession();
        var designer = new XPCollection<Designer>(session).Single();
        Assert.Equal("LeHa Designs", designer.Name);

        var model = designer.Models.Single();
        Assert.Equal("Bramble", model.Name);
        // Only .3mf/.stl become ModelFile rows; the PDF stays on disk as a document (see show command).
        Assert.Equal(1, model.Files.Count);
        Assert.Empty(model.ModelTags);

        var destinationDir = Path.Combine(_libraryPaths.RootDirectory, "LeHa Designs", "Bramble");
        Assert.True(Directory.Exists(destinationDir));
        Assert.True(File.Exists(Path.Combine(destinationDir, "bramble.3mf")));
        Assert.True(File.Exists(Path.Combine(destinationDir, "instructions.pdf")));
    }

    [Fact]
    public void ConfirmingWithTagsLinksThem()
    {
        var zipPath = CreateSampleZip();
        var io = new FakeConsoleIO("", "", "", "y", "pint holder, 3D Printing");

        ImportCommand.Run(new[] { zipPath }, _sessionFactory, _libraryPaths, io);

        using var session = _sessionFactory.CreateSession();
        var model = new XPCollection<Model>(session).Single();
        var tagNames = model.ModelTags.Select(mt => mt.Tag.Name).OrderBy(n => n).ToList();
        Assert.Equal(new[] { "3D Printing", "pint holder" }, tagNames);
    }

    [Fact]
    public void DecliningImportCreatesNothing()
    {
        var zipPath = CreateSampleZip();
        var io = new FakeConsoleIO("", "", "", "n");

        var exitCode = ImportCommand.Run(new[] { zipPath }, _sessionFactory, _libraryPaths, io);

        Assert.Equal(1, exitCode);
        using var session = _sessionFactory.CreateSession();
        Assert.Empty(new XPCollection<Designer>(session));
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

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && dotnet test PlasticRoom.Cli.Tests --filter ImportCommandTests`
Expected: FAIL — stub `ImportCommand.Run` always returns 1 with "not implemented yet"; assertions on created entities fail.

- [ ] **Step 3: Implement `ImportCommand`**

```csharp
// backend/PlasticRoom.Cli/ImportCommand.cs
using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
using DevExpress.Xpo;
using PlasticRoom.Api.Data;
using PlasticRoom.Api.Entities;
using PlasticRoom.Api.Parsing;

namespace PlasticRoom.Cli;

public static class ImportCommand
{
    public static int Run(string[] args, XpoSessionFactory sessionFactory, LibraryPaths libraryPaths, IConsoleIO io)
    {
        if (args.Length == 0 || !File.Exists(args[0]))
        {
            io.WriteLine("Usage: plasticroom import <path-to-zip>");
            return 1;
        }

        var zipPath = args[0];
        var inspection = ZipInspector.Inspect(zipPath);

        io.WriteLine($"Found {inspection.ThreeMfEntries.Count} 3MF, {inspection.StlEntries.Count} STL, {inspection.DocEntries.Count} doc file(s).");

        var designerName = Prompt(io, $"Designer [{inspection.GuessedDesigner}]: ", inspection.GuessedDesigner);
        var modelName = Prompt(io, $"Model name [{inspection.GuessedModelName}]: ", inspection.GuessedModelName);

        var defaultDestination = Path.Combine(libraryPaths.RootDirectory, designerName, modelName);
        var destinationInput = Prompt(io, $"Destination [{defaultDestination}]: ", string.Empty);
        var destination = string.IsNullOrWhiteSpace(destinationInput) ? defaultDestination : destinationInput;

        var confirmInput = Prompt(io, "Import? [Y/n]: ", "y");
        if (!confirmInput.Trim().Equals("y", StringComparison.OrdinalIgnoreCase))
        {
            io.WriteLine("Import cancelled.");
            return 1;
        }

        var tempExtractDir = Path.Combine(Path.GetTempPath(), "plasticroom-import-" + Guid.NewGuid());
        Directory.CreateDirectory(tempExtractDir);
        ZipFile.ExtractToDirectory(zipPath, tempExtractDir);

        Directory.CreateDirectory(destination);
        foreach (var sourceFile in Directory.EnumerateFiles(tempExtractDir, "*", SearchOption.AllDirectories))
        {
            var destFile = Path.Combine(destination, Path.GetFileName(sourceFile));
            File.Move(sourceFile, destFile, overwrite: true);
        }
        Directory.Delete(tempExtractDir, recursive: true);

        using var session = sessionFactory.CreateSession();

        var designer = new XPCollection<Designer>(session).Cast<Designer>().FirstOrDefault(d => d.Name == designerName)
            ?? new Designer(session) { Name = designerName };
        designer.Save();

        var model = new Model(session)
        {
            Name = modelName,
            Designer = designer,
            DestinationPath = destination,
        };
        model.Save();

        foreach (var filePath in Directory.EnumerateFiles(destination))
        {
            var extension = Path.GetExtension(filePath).ToLowerInvariant();
            if (extension != ".3mf" && extension != ".stl")
            {
                continue;
            }

            var type = extension == ".3mf" ? ModelFileType.ThreeMf : ModelFileType.Stl;
            var modelFile = new ModelFile(session)
            {
                Name = Path.GetFileName(filePath),
                Type = type,
                SizeBytes = new FileInfo(filePath).Length,
                AddedAt = DateTime.UtcNow,
                StoragePath = filePath,
                Model = model,
            };

            try
            {
                using var stream = File.OpenRead(filePath);
                var metadata = type == ModelFileType.ThreeMf
                    ? ThreeMfMetadataParser.Parse(stream)
                    : StlMetadataParser.Parse(stream);
                modelFile.DimXMm = metadata.DimXMm;
                modelFile.DimYMm = metadata.DimYMm;
                modelFile.DimZMm = metadata.DimZMm;
                modelFile.PlateCount = metadata.PlateCount;
            }
            catch (Exception ex)
            {
                io.WriteLine($"Warning: could not parse metadata for {modelFile.Name}: {ex.Message}");
            }

            modelFile.Save();
        }

        var tagsInput = Prompt(io, "Tags (comma-separated, blank to skip): ", string.Empty);
        if (!string.IsNullOrWhiteSpace(tagsInput))
        {
            foreach (var rawTagName in tagsInput.Split(',', StringSplitOptions.RemoveEmptyEntries))
            {
                var tagName = rawTagName.Trim();
                if (tagName.Length == 0)
                {
                    continue;
                }

                var tag = new XPCollection<Tag>(session).Cast<Tag>().FirstOrDefault(t => t.Name == tagName)
                    ?? new Tag(session) { Name = tagName };
                tag.Save();

                new ModelTag(session) { Model = model, Tag = tag }.Save();
            }
        }

        io.WriteLine($"Imported '{modelName}' by {designerName} into {destination}.");
        return 0;
    }

    private static string Prompt(IConsoleIO io, string message, string defaultValue)
    {
        io.WriteLine(message);
        var input = io.ReadLine();
        return string.IsNullOrWhiteSpace(input) ? defaultValue : input.Trim();
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && dotnet test PlasticRoom.Cli.Tests --filter ImportCommandTests`
Expected: PASS (all 3 tests)

- [ ] **Step 5: Run full CLI test suite to confirm no regressions**

Run: `cd backend && dotnet test PlasticRoom.Cli.Tests`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add backend/PlasticRoom.Cli/ImportCommand.cs backend/PlasticRoom.Cli.Tests/ImportCommandTests.cs
git commit -m "feat(cli): implement import command with confirm/edit and optional tagging"
```

---

## Task 5: `find`, `list designers`, `list models`, `list untagged`

**Files:**
- Modify: `backend/PlasticRoom.Cli/QueryCommands.cs` (replace `Find` and `List` stub bodies; `Show` stays stubbed until Task 6)
- Test: `backend/PlasticRoom.Cli.Tests/QueryCommandsFindListTests.cs`

**Interfaces:**
- Consumes: `Designer`, `Model`, `ModelTag`, `Tag` entities (Task 1).
- Produces: `QueryCommands.Find(string[] args, XpoSessionFactory sessionFactory, IConsoleIO io) : int`, `QueryCommands.List(string[] args, XpoSessionFactory sessionFactory, IConsoleIO io) : int`.

- [ ] **Step 1: Write the failing test**

```csharp
// backend/PlasticRoom.Cli.Tests/QueryCommandsFindListTests.cs
using System;
using System.IO;
using DevExpress.Xpo;
using PlasticRoom.Api.Data;
using PlasticRoom.Api.Entities;
using PlasticRoom.Cli;
using Xunit;

namespace PlasticRoom.Cli.Tests;

public class QueryCommandsFindListTests : IDisposable
{
    private readonly string _tempDir;
    private readonly XpoSessionFactory _sessionFactory;

    public QueryCommandsFindListTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), "plasticroom-query-tests-" + Guid.NewGuid());
        _sessionFactory = new XpoSessionFactory(_tempDir);

        using var session = _sessionFactory.CreateSession();
        var designer = new Designer(session) { Name = "LeHa Designs" };
        designer.Save();

        var taggedModel = new Model(session) { Name = "Bramble", Designer = designer, DestinationPath = "/lib/LeHa/Bramble" };
        taggedModel.Save();
        var tag = new Tag(session) { Name = "3D Printing" };
        tag.Save();
        new ModelTag(session) { Model = taggedModel, Tag = tag }.Save();

        var untaggedModel = new Model(session) { Name = "Filament Rack", Designer = designer, DestinationPath = "/lib/LeHa/FilamentRack" };
        untaggedModel.Save();
    }

    [Fact]
    public void FindMatchesByModelDesignerOrTag()
    {
        var io = new FakeConsoleIO();
        QueryCommands.Find(new[] { "filament" }, _sessionFactory, io);
        Assert.Contains(io.Output, line => line.Contains("Filament Rack"));

        var io2 = new FakeConsoleIO();
        QueryCommands.Find(new[] { "3D Printing" }, _sessionFactory, io2);
        Assert.Contains(io2.Output, line => line.Contains("Bramble"));
    }

    [Fact]
    public void ListDesignersShowsCounts()
    {
        var io = new FakeConsoleIO();
        QueryCommands.List(new[] { "designers" }, _sessionFactory, io);
        Assert.Contains(io.Output, line => line.Contains("LeHa Designs") && line.Contains("2"));
    }

    [Fact]
    public void ListModelsByDesignerFilters()
    {
        var io = new FakeConsoleIO();
        QueryCommands.List(new[] { "models", "--designer", "LeHa Designs" }, _sessionFactory, io);
        Assert.Contains(io.Output, line => line.Contains("Bramble"));
        Assert.Contains(io.Output, line => line.Contains("Filament Rack"));
    }

    [Fact]
    public void ListUntaggedShowsOnlyUntaggedModels()
    {
        var io = new FakeConsoleIO();
        QueryCommands.List(new[] { "untagged" }, _sessionFactory, io);
        Assert.Contains(io.Output, line => line.Contains("Filament Rack"));
        Assert.DoesNotContain(io.Output, line => line.Contains("Bramble"));
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

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && dotnet test PlasticRoom.Cli.Tests --filter QueryCommandsFindListTests`
Expected: FAIL — stub `Find`/`List` always print "not implemented yet".

- [ ] **Step 3: Implement `Find` and `List` in `QueryCommands`**

```csharp
// backend/PlasticRoom.Cli/QueryCommands.cs
using System;
using System.Linq;
using DevExpress.Xpo;
using PlasticRoom.Api.Data;
using PlasticRoom.Api.Entities;

namespace PlasticRoom.Cli;

public static class QueryCommands
{
    public static int Find(string[] args, XpoSessionFactory sessionFactory, IConsoleIO io)
    {
        if (args.Length == 0)
        {
            io.WriteLine("Usage: plasticroom find <term>");
            return 1;
        }

        var term = args[0];
        using var session = sessionFactory.CreateSession();
        var matches = new XPCollection<Model>(session)
            .Where(m =>
                m.Name.Contains(term, StringComparison.OrdinalIgnoreCase) ||
                m.Designer.Name.Contains(term, StringComparison.OrdinalIgnoreCase) ||
                m.ModelTags.Any(mt => mt.Tag.Name.Contains(term, StringComparison.OrdinalIgnoreCase)))
            .ToList();

        if (matches.Count == 0)
        {
            io.WriteLine($"No models found matching '{term}'.");
            return 0;
        }

        foreach (var model in matches)
        {
            PrintModelSummary(model, io);
        }
        return 0;
    }

    public static int List(string[] args, XpoSessionFactory sessionFactory, IConsoleIO io)
    {
        if (args.Length == 0)
        {
            io.WriteLine("Usage: plasticroom list <designers|models|untagged> [--designer <name>] [--tag <name>]");
            return 1;
        }

        using var session = sessionFactory.CreateSession();

        switch (args[0])
        {
            case "designers":
                foreach (var designer in new XPCollection<Designer>(session))
                {
                    io.WriteLine($"{designer.Name} ({designer.Models.Count})");
                }
                return 0;

            case "models":
                var models = new XPCollection<Model>(session).Cast<Model>().AsEnumerable();
                var designerFilter = GetFlagValue(args, "--designer");
                var tagFilter = GetFlagValue(args, "--tag");

                if (designerFilter is not null)
                {
                    models = models.Where(m => m.Designer.Name.Equals(designerFilter, StringComparison.OrdinalIgnoreCase));
                }
                if (tagFilter is not null)
                {
                    models = models.Where(m => m.ModelTags.Any(mt => mt.Tag.Name.Equals(tagFilter, StringComparison.OrdinalIgnoreCase)));
                }

                foreach (var model in models)
                {
                    PrintModelSummary(model, io);
                }
                return 0;

            case "untagged":
                foreach (var model in new XPCollection<Model>(session).Cast<Model>().Where(m => m.ModelTags.Count == 0))
                {
                    PrintModelSummary(model, io);
                }
                return 0;

            default:
                io.WriteLine($"Unknown list target: {args[0]}");
                return 1;
        }
    }

    public static int Show(string[] args, XpoSessionFactory sessionFactory, IConsoleIO io)
    {
        io.WriteLine("show: not implemented yet");
        return 1;
    }

    private static string? GetFlagValue(string[] args, string flag)
    {
        var idx = Array.IndexOf(args, flag);
        return idx >= 0 && idx + 1 < args.Length ? args[idx + 1] : null;
    }

    private static void PrintModelSummary(Model model, IConsoleIO io)
    {
        var tags = string.Join(", ", model.ModelTags.Select(mt => mt.Tag.Name));
        io.WriteLine($"{model.Name} — {model.Designer.Name}" + (tags.Length > 0 ? $" [{tags}]" : ""));
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && dotnet test PlasticRoom.Cli.Tests --filter QueryCommandsFindListTests`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/PlasticRoom.Cli/QueryCommands.cs backend/PlasticRoom.Cli.Tests/QueryCommandsFindListTests.cs
git commit -m "feat(cli): implement find/list designers/list models/list untagged"
```

---

## Task 6: `show <model>`

**Files:**
- Modify: `backend/PlasticRoom.Cli/QueryCommands.cs` (replace `Show` stub body)
- Test: `backend/PlasticRoom.Cli.Tests/QueryCommandsShowTests.cs`

**Interfaces:**
- Produces: `QueryCommands.Show(string[] args, XpoSessionFactory sessionFactory, IConsoleIO io) : int` (final signature — already declared in Task 5).

- [ ] **Step 1: Write the failing test**

```csharp
// backend/PlasticRoom.Cli.Tests/QueryCommandsShowTests.cs
using System;
using System.IO;
using PlasticRoom.Api.Data;
using PlasticRoom.Api.Entities;
using PlasticRoom.Cli;
using Xunit;

namespace PlasticRoom.Cli.Tests;

public class QueryCommandsShowTests : IDisposable
{
    private readonly string _tempDir;
    private readonly XpoSessionFactory _sessionFactory;

    public QueryCommandsShowTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), "plasticroom-show-tests-" + Guid.NewGuid());
        _sessionFactory = new XpoSessionFactory(_tempDir);

        using var session = _sessionFactory.CreateSession();
        var designer = new Designer(session) { Name = "LeHa Designs" };
        designer.Save();

        var model = new Model(session) { Name = "Bramble", Designer = designer, DestinationPath = "/lib/LeHa/Bramble" };
        model.Save();

        var tag = new Tag(session) { Name = "pint holder" };
        tag.Save();
        new ModelTag(session) { Model = model, Tag = tag }.Save();

        new ModelFile(session)
        {
            Name = "bramble.3mf",
            Type = ModelFileType.ThreeMf,
            SizeBytes = 100,
            AddedAt = DateTime.UtcNow,
            StoragePath = "/lib/LeHa/Bramble/bramble.3mf",
            Model = model,
        }.Save();

        new ModelFile(session)
        {
            Name = "instructions.pdf",
            Type = ModelFileType.Stl, // placeholder type; PDFs aren't parsed models, see note below
            SizeBytes = 50,
            AddedAt = DateTime.UtcNow,
            StoragePath = "/lib/LeHa/Bramble/instructions.pdf",
            Model = model,
        }.Save();
    }

    [Fact]
    public void ShowPrintsDesignerTagsFolderAndFiles()
    {
        var io = new FakeConsoleIO();
        var exitCode = QueryCommands.Show(new[] { "Bramble" }, _sessionFactory, io);

        Assert.Equal(0, exitCode);
        Assert.Contains(io.Output, l => l.Contains("LeHa Designs"));
        Assert.Contains(io.Output, l => l.Contains("pint holder"));
        Assert.Contains(io.Output, l => l.Contains("/lib/LeHa/Bramble"));
        Assert.Contains(io.Output, l => l.Contains("bramble.3mf"));
        Assert.Contains(io.Output, l => l.Contains("instructions.pdf"));
    }

    [Fact]
    public void ShowReportsUnknownModel()
    {
        var io = new FakeConsoleIO();
        var exitCode = QueryCommands.Show(new[] { "Nope" }, _sessionFactory, io);

        Assert.Equal(1, exitCode);
        Assert.Contains(io.Output, l => l.Contains("not found", StringComparison.OrdinalIgnoreCase));
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

Note: the PDF/readme is stored as a `ModelFile` row too (any non-3MF/STL file dropped into the destination folder during import is still on disk, but Task 4's import only creates `ModelFile` rows for `.3mf`/`.stl` extensions — the PDF is filed on disk but has no DB row). Revise the test above: since Task 4 does not create a `ModelFile` row for the PDF, this test creates it manually only to verify `show` prints whatever `ModelFile` rows exist for the model — that's fine for testing `Show` in isolation, but note for the implementer that `show` must also list non-`ModelFile` documents living in `model.DestinationPath` (the PDF/readme) directly from disk, not from the DB. Update `Show`'s implementation (Step 3 below) to scan the destination folder for files not already listed as `ModelFile` rows and print those under a "Documents" heading.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && dotnet test PlasticRoom.Cli.Tests --filter QueryCommandsShowTests`
Expected: FAIL — stub `Show` always returns 1 with "not implemented yet".

- [ ] **Step 3: Implement `Show`**

Replace the stub `Show` method in `backend/PlasticRoom.Cli/QueryCommands.cs`:

```csharp
    public static int Show(string[] args, XpoSessionFactory sessionFactory, IConsoleIO io)
    {
        if (args.Length == 0)
        {
            io.WriteLine("Usage: plasticroom show <model-name>");
            return 1;
        }

        using var session = sessionFactory.CreateSession();
        var model = new XPCollection<Model>(session).Cast<Model>()
            .FirstOrDefault(m => m.Name.Equals(args[0], StringComparison.OrdinalIgnoreCase));

        if (model is null)
        {
            io.WriteLine($"Model '{args[0]}' not found.");
            return 1;
        }

        io.WriteLine($"{model.Name} — {model.Designer.Name}");
        var tags = string.Join(", ", model.ModelTags.Select(mt => mt.Tag.Name));
        io.WriteLine(tags.Length > 0 ? $"Tags: {tags}" : "Tags: (none — run 'tag' to add some)");
        io.WriteLine($"Folder: {model.DestinationPath}");

        io.WriteLine("Files:");
        var knownNames = new System.Collections.Generic.HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var file in model.Files)
        {
            io.WriteLine($"  {file.Name} ({file.Type})");
            knownNames.Add(file.Name);
        }

        if (System.IO.Directory.Exists(model.DestinationPath))
        {
            var extras = System.IO.Directory.EnumerateFiles(model.DestinationPath)
                .Select(System.IO.Path.GetFileName)
                .Where(name => name is not null && !knownNames.Contains(name))
                .ToList();

            if (extras.Count > 0)
            {
                io.WriteLine("Documents:");
                foreach (var name in extras)
                {
                    io.WriteLine($"  {name}");
                }
            }
        }

        return 0;
    }
```

Also add `using System.Linq;` if not already present (it is, from Task 5).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && dotnet test PlasticRoom.Cli.Tests --filter QueryCommandsShowTests`
Expected: PASS (both tests)

- [ ] **Step 5: Run the full CLI test suite**

Run: `cd backend && dotnet test PlasticRoom.Cli.Tests`
Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add backend/PlasticRoom.Cli/QueryCommands.cs backend/PlasticRoom.Cli.Tests/QueryCommandsShowTests.cs
git commit -m "feat(cli): implement show command listing files and on-disk documents"
```

---

## Task 7: `tag <model> <tag...>`

**Files:**
- Modify: `backend/PlasticRoom.Cli/TagCommand.cs` (replace stub body)
- Test: `backend/PlasticRoom.Cli.Tests/TagCommandTests.cs`

**Interfaces:**
- Produces: `TagCommand.Run(string[] args, XpoSessionFactory sessionFactory, IConsoleIO io) : int` (signature unchanged from stub).

- [ ] **Step 1: Write the failing test**

```csharp
// backend/PlasticRoom.Cli.Tests/TagCommandTests.cs
using System;
using System.IO;
using System.Linq;
using DevExpress.Xpo;
using PlasticRoom.Api.Data;
using PlasticRoom.Api.Entities;
using PlasticRoom.Cli;
using Xunit;

namespace PlasticRoom.Cli.Tests;

public class TagCommandTests : IDisposable
{
    private readonly string _tempDir;
    private readonly XpoSessionFactory _sessionFactory;

    public TagCommandTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), "plasticroom-tag-cmd-tests-" + Guid.NewGuid());
        _sessionFactory = new XpoSessionFactory(_tempDir);

        using var session = _sessionFactory.CreateSession();
        var designer = new Designer(session) { Name = "LeHa Designs" };
        designer.Save();
        new Model(session) { Name = "Filament Rack", Designer = designer, DestinationPath = "/lib/LeHa/FilamentRack" }.Save();
    }

    [Fact]
    public void TagAddsNewAndReusesExistingTags()
    {
        var io = new FakeConsoleIO();
        var exitCode = TagCommand.Run(new[] { "Filament Rack", "3D Printing", "organizer" }, _sessionFactory, io);

        Assert.Equal(0, exitCode);
        using var session = _sessionFactory.CreateSession();
        var model = new XPCollection<Model>(session).Cast<Model>().Single();
        var names = model.ModelTags.Select(mt => mt.Tag.Name).OrderBy(n => n).ToList();
        Assert.Equal(new[] { "3D Printing", "organizer" }, names);

        // Re-tagging with an overlapping tag name reuses the existing Tag row rather than duplicating it.
        var io2 = new FakeConsoleIO();
        TagCommand.Run(new[] { "Filament Rack", "3D Printing" }, _sessionFactory, io2);
        using var verifySession = _sessionFactory.CreateSession();
        Assert.Single(new XPCollection<Tag>(verifySession).Cast<Tag>().Where(t => t.Name == "3D Printing"));
    }

    [Fact]
    public void TagReportsUnknownModel()
    {
        var io = new FakeConsoleIO();
        var exitCode = TagCommand.Run(new[] { "Nope", "some-tag" }, _sessionFactory, io);

        Assert.Equal(1, exitCode);
        Assert.Contains(io.Output, l => l.Contains("not found", StringComparison.OrdinalIgnoreCase));
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

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && dotnet test PlasticRoom.Cli.Tests --filter TagCommandTests`
Expected: FAIL — stub always returns 1 with "not implemented yet".

- [ ] **Step 3: Implement `TagCommand`**

```csharp
// backend/PlasticRoom.Cli/TagCommand.cs
using System;
using System.Linq;
using DevExpress.Xpo;
using PlasticRoom.Api.Data;
using PlasticRoom.Api.Entities;

namespace PlasticRoom.Cli;

public static class TagCommand
{
    public static int Run(string[] args, XpoSessionFactory sessionFactory, IConsoleIO io)
    {
        if (args.Length < 2)
        {
            io.WriteLine("Usage: plasticroom tag <model-name> <tag...>");
            return 1;
        }

        using var session = sessionFactory.CreateSession();
        var model = new XPCollection<Model>(session).Cast<Model>()
            .FirstOrDefault(m => m.Name.Equals(args[0], StringComparison.OrdinalIgnoreCase));

        if (model is null)
        {
            io.WriteLine($"Model '{args[0]}' not found.");
            return 1;
        }

        var existingTagNames = model.ModelTags.Select(mt => mt.Tag.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);

        foreach (var tagName in args.Skip(1))
        {
            if (existingTagNames.Contains(tagName))
            {
                continue;
            }

            var tag = new XPCollection<Tag>(session).Cast<Tag>().FirstOrDefault(t => t.Name == tagName)
                ?? new Tag(session) { Name = tagName };
            tag.Save();

            new ModelTag(session) { Model = model, Tag = tag }.Save();
        }

        io.WriteLine($"Tagged '{model.Name}' with: {string.Join(", ", args.Skip(1))}");
        return 0;
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && dotnet test PlasticRoom.Cli.Tests --filter TagCommandTests`
Expected: PASS (both tests)

- [ ] **Step 5: Commit**

```bash
git add backend/PlasticRoom.Cli/TagCommand.cs backend/PlasticRoom.Cli.Tests/TagCommandTests.cs
git commit -m "feat(cli): implement tag command for completing skipped-at-import tagging"
```

---

## Task 8: `export <model> [--dest <path>]`

**Files:**
- Modify: `backend/PlasticRoom.Cli/ExportCommand.cs` (replace stub body)
- Test: `backend/PlasticRoom.Cli.Tests/ExportCommandTests.cs`

**Interfaces:**
- Produces: `ExportCommand.Run(string[] args, XpoSessionFactory sessionFactory, IConsoleIO io) : int` (signature unchanged from stub).

- [ ] **Step 1: Write the failing test**

```csharp
// backend/PlasticRoom.Cli.Tests/ExportCommandTests.cs
using System;
using System.IO;
using System.Linq;
using PlasticRoom.Api.Data;
using PlasticRoom.Api.Entities;
using PlasticRoom.Cli;
using Xunit;

namespace PlasticRoom.Cli.Tests;

public class ExportCommandTests : IDisposable
{
    private readonly string _tempDir;
    private readonly XpoSessionFactory _sessionFactory;
    private readonly string _sourceDir;

    public ExportCommandTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), "plasticroom-export-cmd-tests-" + Guid.NewGuid());
        _sourceDir = Path.Combine(_tempDir, "source");
        Directory.CreateDirectory(_sourceDir);
        File.WriteAllText(Path.Combine(_sourceDir, "bramble.3mf"), "3mf-content");
        File.WriteAllText(Path.Combine(_sourceDir, "instructions.pdf"), "pdf-content");

        _sessionFactory = new XpoSessionFactory(Path.Combine(_tempDir, "data"));

        using var session = _sessionFactory.CreateSession();
        var designer = new Designer(session) { Name = "LeHa Designs" };
        designer.Save();
        var model = new Model(session) { Name = "Bramble", Designer = designer, DestinationPath = _sourceDir };
        model.Save();
        new ModelFile(session)
        {
            Name = "bramble.3mf",
            Type = ModelFileType.ThreeMf,
            SizeBytes = 100,
            AddedAt = DateTime.UtcNow,
            StoragePath = Path.Combine(_sourceDir, "bramble.3mf"),
            Model = model,
        }.Save();
    }

    [Fact]
    public void ExportWithoutDestCopiesToTempDir()
    {
        var io = new FakeConsoleIO();
        var exitCode = ExportCommand.Run(new[] { "Bramble" }, _sessionFactory, io);

        Assert.Equal(0, exitCode);
        var reportedLine = io.Output.Single(l => l.StartsWith("Exported to: "));
        var destDir = reportedLine["Exported to: ".Length..];
        Assert.True(File.Exists(Path.Combine(destDir, "bramble.3mf")));
        Assert.True(File.Exists(Path.Combine(destDir, "instructions.pdf")));

        Directory.Delete(destDir, recursive: true);
    }

    [Fact]
    public void ExportWithDestCopiesThere()
    {
        var explicitDest = Path.Combine(_tempDir, "chosen-dest");
        var io = new FakeConsoleIO();
        var exitCode = ExportCommand.Run(new[] { "Bramble", "--dest", explicitDest }, _sessionFactory, io);

        Assert.Equal(0, exitCode);
        Assert.True(File.Exists(Path.Combine(explicitDest, "bramble.3mf")));
        Assert.True(File.Exists(Path.Combine(explicitDest, "instructions.pdf")));
    }

    [Fact]
    public void ExportReportsUnknownModel()
    {
        var io = new FakeConsoleIO();
        var exitCode = ExportCommand.Run(new[] { "Nope" }, _sessionFactory, io);

        Assert.Equal(1, exitCode);
        Assert.Contains(io.Output, l => l.Contains("not found", StringComparison.OrdinalIgnoreCase));
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

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && dotnet test PlasticRoom.Cli.Tests --filter ExportCommandTests`
Expected: FAIL — stub always returns 1 with "not implemented yet".

- [ ] **Step 3: Implement `ExportCommand`**

```csharp
// backend/PlasticRoom.Cli/ExportCommand.cs
using System;
using System.IO;
using System.Linq;
using DevExpress.Xpo;
using PlasticRoom.Api.Data;
using PlasticRoom.Api.Entities;

namespace PlasticRoom.Cli;

public static class ExportCommand
{
    public static int Run(string[] args, XpoSessionFactory sessionFactory, IConsoleIO io)
    {
        if (args.Length == 0)
        {
            io.WriteLine("Usage: plasticroom export <model-name> [--dest <path>]");
            return 1;
        }

        using var session = sessionFactory.CreateSession();
        var model = new XPCollection<Model>(session).Cast<Model>()
            .FirstOrDefault(m => m.Name.Equals(args[0], StringComparison.OrdinalIgnoreCase));

        if (model is null)
        {
            io.WriteLine($"Model '{args[0]}' not found.");
            return 1;
        }

        var destIdx = Array.IndexOf(args, "--dest");
        var destination = destIdx >= 0 && destIdx + 1 < args.Length
            ? args[destIdx + 1]
            : Path.Combine(Path.GetTempPath(), "plasticroom-export-" + Guid.NewGuid());

        Directory.CreateDirectory(destination);

        if (!Directory.Exists(model.DestinationPath))
        {
            io.WriteLine($"Model folder not found on disk: {model.DestinationPath}");
            return 1;
        }

        foreach (var sourceFile in Directory.EnumerateFiles(model.DestinationPath))
        {
            var destFile = Path.Combine(destination, Path.GetFileName(sourceFile));
            File.Copy(sourceFile, destFile, overwrite: true);
        }

        io.WriteLine($"Exported to: {destination}");
        return 0;
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && dotnet test PlasticRoom.Cli.Tests --filter ExportCommandTests`
Expected: PASS (all 3 tests)

- [ ] **Step 5: Run the full CLI + Api test suites**

Run: `cd backend && dotnet test`
Expected: All tests PASS across `PlasticRoom.Api.Tests` and `PlasticRoom.Cli.Tests`.

- [ ] **Step 6: Commit**

```bash
git add backend/PlasticRoom.Cli/ExportCommand.cs backend/PlasticRoom.Cli.Tests/ExportCommandTests.cs
git commit -m "feat(cli): implement export command to gather a model's files into one folder"
```

---

## Manual verification (after Task 8)

1. Build the CLI: `cd backend && dotnet build PlasticRoom.Cli`
2. Set a scratch library root: `$env:LIBRARY_ROOT = "C:\temp\plasticroom-library"` (PowerShell) and `$env:DATA_PATH = "C:\temp\plasticroom-data"`.
3. Create a small test zip (e.g. `SomeDesigner - SomeModel.zip` containing a real `.3mf` or `.stl`) and run:
   `dotnet run --project PlasticRoom.Cli -- import C:\path\to\SomeDesigner - SomeModel.zip`
4. Confirm the prompts, verify the files land under `C:\temp\plasticroom-library\SomeDesigner\SomeModel\`.
5. Run `dotnet run --project PlasticRoom.Cli -- find SomeModel`, `list designers`, `show SomeModel`, `tag SomeModel test-tag`, `export SomeModel`, and confirm each behaves as designed against the spec.
