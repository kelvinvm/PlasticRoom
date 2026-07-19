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
