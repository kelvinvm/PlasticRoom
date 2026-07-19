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
        Assert.Single(new XPCollection<Tag>(verifySession).Cast<Tag>(), t => t.Name == "3D Printing");
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
