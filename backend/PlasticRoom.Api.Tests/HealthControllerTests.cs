using System;
using System.IO;
using Microsoft.AspNetCore.Mvc;
using PlasticRoom.Api.Controllers;
using PlasticRoom.Api.Data;
using Xunit;

namespace PlasticRoom.Api.Tests;

public class HealthControllerTests : IDisposable
{
    private readonly string _tempDir;

    public HealthControllerTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), "plasticroom-health-tests-" + Guid.NewGuid());
    }

    [Fact]
    public void Get_ReturnsOkWithConnectedStatus_WhenDatabaseIsReachable()
    {
        var factory = new XpoSessionFactory(_tempDir);
        var controller = new HealthController(factory);

        var result = Assert.IsType<OkObjectResult>(controller.Get());

        Assert.Equal(200, result.StatusCode);
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDir))
        {
            Directory.Delete(_tempDir, recursive: true);
        }
    }
}
