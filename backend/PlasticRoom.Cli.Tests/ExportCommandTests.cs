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
