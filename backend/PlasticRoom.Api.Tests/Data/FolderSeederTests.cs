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
