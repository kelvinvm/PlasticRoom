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
        Assert.Single(model.Files);
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
        var model = new XPCollection<Model>(session).Cast<Model>().Single();
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
