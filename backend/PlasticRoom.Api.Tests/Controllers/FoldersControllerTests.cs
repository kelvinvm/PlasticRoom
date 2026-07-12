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

        Assert.Contains(folders, f => f.Id == created.Id && f.Name == "Miniatures");
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

    [Fact]
    public void GetAll_ReportsDirectFileCount_NotDescendantInclusive()
    {
        var parent = (FolderDto)Assert.IsType<CreatedAtActionResult>(
            _controller.Create(new CreateFolderRequest("Parent", null, null))).Value!;
        var child = (FolderDto)Assert.IsType<CreatedAtActionResult>(
            _controller.Create(new CreateFolderRequest("Child", parent.Id, null))).Value!;

        using (var session = _factory.CreateSession())
        {
            var parentFolder = session.GetObjectByKey<Folder>(parent.Id)!;
            var childFolder = session.GetObjectByKey<Folder>(child.Id)!;
            // One file assigned directly to the parent, one to the child.
            foreach (var (name, folder) in new[] { ("p.stl", parentFolder), ("c.stl", childFolder) })
            {
                var file = new ModelFile(session)
                {
                    Name = name, Type = ModelFileType.Stl, SizeBytes = 1,
                    AddedAt = DateTime.UtcNow, StoragePath = "/data/files/" + name,
                };
                file.Save();
                new FileFolder(session) { File = file, Folder = folder }.Save();
            }
        }

        var folders = Assert.IsAssignableFrom<System.Collections.Generic.List<FolderDto>>(
            Assert.IsType<OkObjectResult>(_controller.GetAll()).Value);

        Assert.Equal(1, folders.Single(f => f.Id == parent.Id).FileCount);
        Assert.Equal(1, folders.Single(f => f.Id == child.Id).FileCount);
    }

    [Fact]
    public void Update_RejectsReparentingIntoOwnDescendant()
    {
        var parent = (FolderDto)Assert.IsType<CreatedAtActionResult>(
            _controller.Create(new CreateFolderRequest("Parent", null, null))).Value!;
        var child = (FolderDto)Assert.IsType<CreatedAtActionResult>(
            _controller.Create(new CreateFolderRequest("Child", parent.Id, null))).Value!;

        // Try to move Parent under its own Child -> cycle.
        var result = _controller.Update(parent.Id, new UpdateFolderRequest(null, child.Id, null, null, null));

        var badRequest = Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal(400, badRequest.StatusCode);
    }

    [Fact]
    public void Update_AllowsLegalReparent()
    {
        var a = (FolderDto)Assert.IsType<CreatedAtActionResult>(
            _controller.Create(new CreateFolderRequest("A", null, null))).Value!;
        var b = (FolderDto)Assert.IsType<CreatedAtActionResult>(
            _controller.Create(new CreateFolderRequest("B", null, null))).Value!;

        var result = _controller.Update(a.Id, new UpdateFolderRequest(null, b.Id, null, null, null));
        var updated = Assert.IsType<FolderDto>(Assert.IsType<OkObjectResult>(result).Value);

        Assert.Equal(b.Id, updated.ParentId);
    }

    [Fact]
    public void Order_ReordersAndReparents_Atomically()
    {
        var a = (FolderDto)Assert.IsType<CreatedAtActionResult>(
            _controller.Create(new CreateFolderRequest("A", null, null))).Value!;
        var b = (FolderDto)Assert.IsType<CreatedAtActionResult>(
            _controller.Create(new CreateFolderRequest("B", null, null))).Value!;

        // Put B before A at root, and nest A under B.
        var result = _controller.Order(new ReorderFoldersRequest(new()
        {
            new FolderOrderItem(b.Id, null, 0),
            new FolderOrderItem(a.Id, b.Id, 0),
        }));

        var folders = Assert.IsAssignableFrom<System.Collections.Generic.List<FolderDto>>(
            Assert.IsType<OkObjectResult>(result).Value);
        var updatedA = folders.Single(f => f.Id == a.Id);
        Assert.Equal(b.Id, updatedA.ParentId);
        Assert.Equal(0, updatedA.SortOrder);
        Assert.Equal(0, folders.Single(f => f.Id == b.Id).SortOrder);
    }

    [Fact]
    public void Order_UnknownFolder_Returns404()
    {
        var result = _controller.Order(new ReorderFoldersRequest(new()
        {
            new FolderOrderItem(999999, null, 0),
        }));
        Assert.IsType<NotFoundObjectResult>(result);
    }

    [Fact]
    public void Order_Cycle_Returns400_AndWritesNothing()
    {
        var parent = (FolderDto)Assert.IsType<CreatedAtActionResult>(
            _controller.Create(new CreateFolderRequest("Parent", null, null))).Value!;
        var child = (FolderDto)Assert.IsType<CreatedAtActionResult>(
            _controller.Create(new CreateFolderRequest("Child", parent.Id, null))).Value!;

        var result = _controller.Order(new ReorderFoldersRequest(new()
        {
            new FolderOrderItem(parent.Id, child.Id, 0),
        }));

        Assert.IsType<BadRequestObjectResult>(result);
        using var verify = _factory.CreateSession();
        Assert.Null(verify.GetObjectByKey<Folder>(parent.Id)!.ParentFolder);
    }

    [Fact]
    public void Order_RejectsMutualReparentCycle_AndWritesNothing()
    {
        var x = (FolderDto)Assert.IsType<CreatedAtActionResult>(
            _controller.Create(new CreateFolderRequest("X", null, null))).Value!;
        var y = (FolderDto)Assert.IsType<CreatedAtActionResult>(
            _controller.Create(new CreateFolderRequest("Y", null, null))).Value!;

        // X under Y and Y under X in one batch -> would form a 2-node cycle.
        var result = _controller.Order(new ReorderFoldersRequest(new()
        {
            new FolderOrderItem(x.Id, y.Id, 0),
            new FolderOrderItem(y.Id, x.Id, 0),
        }));

        Assert.IsType<BadRequestObjectResult>(result);
        using var verify = _factory.CreateSession();
        Assert.Null(verify.GetObjectByKey<Folder>(x.Id)!.ParentFolder);
        Assert.Null(verify.GetObjectByKey<Folder>(y.Id)!.ParentFolder);
    }

    [Fact]
    public void Order_EmptyItems_Returns400()
    {
        Assert.IsType<BadRequestObjectResult>(
            _controller.Order(new ReorderFoldersRequest(new())));
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDir))
        {
            Directory.Delete(_tempDir, recursive: true);
        }
    }
}
