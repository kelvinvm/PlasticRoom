using System;
using System.IO;
using System.Linq;
using PlasticRoom.Api.Data;
using PlasticRoom.Api.Entities;
using Xunit;

namespace PlasticRoom.Api.Tests.Data;

public class SampleDataSeederTests : IDisposable
{
    private readonly string _tempDataDir;
    private readonly XpoSessionFactory _sessionFactory;
    private readonly FileStorage _fileStorage;

    public SampleDataSeederTests()
    {
        _tempDataDir = Path.Combine(Path.GetTempPath(), "plasticroom-sampleseeder-tests-" + Guid.NewGuid());
        _sessionFactory = new XpoSessionFactory(_tempDataDir);
        _fileStorage = new FileStorage(_tempDataDir);
    }

    [Fact]
    public void Seed_CreatesFoldersTagsAndParsedFilesOnDisk()
    {
        SampleDataSeeder.Seed(_sessionFactory, _fileStorage);

        using var session = _sessionFactory.CreateSession();
        Assert.True(new DevExpress.Xpo.XPCollection<Folder>(session).Any());
        Assert.True(new DevExpress.Xpo.XPCollection<Tag>(session).Any());

        var files = new DevExpress.Xpo.XPCollection<ModelFile>(session).ToList();
        Assert.NotEmpty(files);
        Assert.All(files, f => Assert.True(File.Exists(f.StoragePath)));
        Assert.Contains(files, f => f.DimXMm is > 0); // metadata parsed
        Assert.Contains(files, f => f.FileFolders.Any()); // assigned to a folder
    }

    [Fact]
    public void Seed_IsIdempotent()
    {
        SampleDataSeeder.Seed(_sessionFactory, _fileStorage);
        int folderCount;
        using (var session = _sessionFactory.CreateSession())
        {
            folderCount = new DevExpress.Xpo.XPCollection<Folder>(session).Count();
        }

        SampleDataSeeder.Seed(_sessionFactory, _fileStorage);

        using var session2 = _sessionFactory.CreateSession();
        Assert.Equal(folderCount, new DevExpress.Xpo.XPCollection<Folder>(session2).Count());
    }

    [Fact]
    public void IsEnabled_ReflectsEnvironmentVariable()
    {
        var original = Environment.GetEnvironmentVariable("SEED_SAMPLE_DATA");
        try
        {
            Environment.SetEnvironmentVariable("SEED_SAMPLE_DATA", "true");
            Assert.True(SampleDataSeeder.IsEnabled());
            Environment.SetEnvironmentVariable("SEED_SAMPLE_DATA", null);
            Assert.False(SampleDataSeeder.IsEnabled());
        }
        finally
        {
            Environment.SetEnvironmentVariable("SEED_SAMPLE_DATA", original);
        }
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDataDir))
        {
            Directory.Delete(_tempDataDir, recursive: true);
        }
    }
}
