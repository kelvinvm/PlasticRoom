using System;
using System.IO;
using System.Linq;
using Microsoft.AspNetCore.Mvc;
using PlasticRoom.Api.Controllers;
using PlasticRoom.Api.Data;
using PlasticRoom.Api.Dtos;
using PlasticRoom.Api.Entities;
using Xunit;

namespace PlasticRoom.Api.Tests.Controllers;

public class FoldersControllerTests : IDisposable
{
    private readonly string _tempDir;
    private readonly XpoSessionFactory _factory;
    private readonly FoldersController _controller;

    public FoldersControllerTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), "plasticroom-folders-controller-tests-" + Guid.NewGuid());
        _factory = new XpoSessionFactory(_tempDir);
        _controller = new FoldersController(_factory);
    }

    [Fact]
    public void Create_ThenGetAll_ReturnsTheNewFolder()
    {
        var createResult = _controller.Create(new CreateFolderRequest("Miniatures", null, "Small stuff"));
        var created = Assert.IsType<FolderDto>(Assert.IsType<CreatedAtActionResult>(createResult).Value);

        var getAllResult = Assert.IsType<OkObjectResult>(_controller.GetAll());
        var folders = Assert.IsAssignableFrom<System.Collections.Generic.List<FolderDto>>(getAllResult.Value);

        Assert.Contains(folders, f => f.Id == created.Id && f.Name == "Miniatures" && !f.IsSystem);
    }

    [Fact]
    public void Update_RenamesNonSystemFolder()
    {
        var created = (FolderDto)Assert.IsType<CreatedAtActionResult>(
            _controller.Create(new CreateFolderRequest("Old Name", null, null))).Value!;

        var updateResult = _controller.Update(created.Id, new UpdateFolderRequest("New Name", null, null, null, null));
        var updated = Assert.IsType<FolderDto>(Assert.IsType<OkObjectResult>(updateResult).Value);

        Assert.Equal("New Name", updated.Name);
    }

    [Fact]
    public void Update_RejectsRenameOfSystemFolder()
    {
        FolderSeeder.SeedSystemFolders(_factory);
        using var session = _factory.CreateSession();
        var systemFolder = new DevExpress.Xpo.XPCollection<Folder>(session).First(f => f.IsSystem);

        var result = _controller.Update(systemFolder.Oid, new UpdateFolderRequest("Renamed", null, null, null, null));

        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal(400, badRequest.StatusCode);
    }

    [Fact]
    public void Delete_RejectsSystemFolder()
    {
        FolderSeeder.SeedSystemFolders(_factory);
        using var session = _factory.CreateSession();
        var systemFolder = new DevExpress.Xpo.XPCollection<Folder>(session).First(f => f.IsSystem);

        var result = _controller.Delete(systemFolder.Oid);

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public void Delete_CascadesToChildFoldersAndFileFolderRows()
    {
        var parent = (FolderDto)Assert.IsType<CreatedAtActionResult>(
            _controller.Create(new CreateFolderRequest("Parent", null, null))).Value!;
        var child = (FolderDto)Assert.IsType<CreatedAtActionResult>(
            _controller.Create(new CreateFolderRequest("Child", parent.Id, null))).Value!;

        using (var session = _factory.CreateSession())
        {
            var file = new ModelFile(session)
            {
                Name = "a.stl",
                Type = ModelFileType.Stl,
                SizeBytes = 1,
                AddedAt = DateTime.UtcNow,
                StoragePath = "/data/files/a.stl",
            };
            file.Save();
            var childFolder = session.GetObjectByKey<Folder>(child.Id);
            new FileFolder(session) { File = file, Folder = childFolder! }.Save();
        }

        var deleteResult = _controller.Delete(parent.Id);
        Assert.IsType<NoContentResult>(deleteResult);

        using var verifySession = _factory.CreateSession();
        Assert.Null(verifySession.GetObjectByKey<Folder>(parent.Id));
        Assert.Null(verifySession.GetObjectByKey<Folder>(child.Id));
        Assert.Empty(new DevExpress.Xpo.XPCollection<FileFolder>(verifySession));
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDir))
        {
            Directory.Delete(_tempDir, recursive: true);
        }
    }
}
