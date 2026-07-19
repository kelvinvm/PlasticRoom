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
