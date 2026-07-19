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
    private readonly string _destinationDir;

    public QueryCommandsShowTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), "plasticroom-show-tests-" + Guid.NewGuid());
        _destinationDir = Path.Combine(_tempDir, "library", "LeHa Designs", "Bramble");
        Directory.CreateDirectory(_destinationDir);
        File.WriteAllText(Path.Combine(_destinationDir, "bramble.3mf"), "3mf-content");
        File.WriteAllText(Path.Combine(_destinationDir, "instructions.pdf"), "pdf-content");

        _sessionFactory = new XpoSessionFactory(Path.Combine(_tempDir, "data"));

        using var session = _sessionFactory.CreateSession();
        var designer = new Designer(session) { Name = "LeHa Designs" };
        designer.Save();

        var model = new Model(session) { Name = "Bramble", Designer = designer, DestinationPath = _destinationDir };
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
            StoragePath = Path.Combine(_destinationDir, "bramble.3mf"),
            Model = model,
        }.Save();
    }

    [Fact]
    public void ShowPrintsDesignerTagsFolderFilesAndDocuments()
    {
        var io = new FakeConsoleIO();
        var exitCode = QueryCommands.Show(new[] { "Bramble" }, _sessionFactory, io);

        Assert.Equal(0, exitCode);
        Assert.Contains(io.Output, l => l.Contains("LeHa Designs"));
        Assert.Contains(io.Output, l => l.Contains("pint holder"));
        Assert.Contains(io.Output, l => l.Contains(_destinationDir));
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
