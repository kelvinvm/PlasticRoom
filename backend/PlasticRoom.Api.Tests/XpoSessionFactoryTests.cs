using System;
using System.IO;
using DevExpress.Xpo;
using PlasticRoom.Api.Data;
using Xunit;

namespace PlasticRoom.Api.Tests;

public class XpoSessionFactoryTests : IDisposable
{
    private readonly string _tempDir;

    public XpoSessionFactoryTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), "plasticroom-xpo-tests-" + Guid.NewGuid());
    }

    [Fact]
    public void CreatesDataDirectoryIfMissing()
    {
        Assert.False(Directory.Exists(_tempDir));

        var factory = new XpoSessionFactory(_tempDir);

        Assert.True(Directory.Exists(_tempDir));
    }

    [Fact]
    public void DatabasePathPointsAtPlasticRoomDbInsideDataPath()
    {
        var factory = new XpoSessionFactory(_tempDir);

        Assert.Equal(Path.Combine(_tempDir, "plasticroom.db"), factory.DatabasePath);
    }

    [Fact]
    public void CreateSessionOpensWithoutError()
    {
        var factory = new XpoSessionFactory(_tempDir);

        using var session = factory.CreateSession();

        Assert.NotNull(session);
        Assert.True(File.Exists(factory.DatabasePath));
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDir))
        {
            Directory.Delete(_tempDir, recursive: true);
        }
    }
}
