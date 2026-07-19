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
