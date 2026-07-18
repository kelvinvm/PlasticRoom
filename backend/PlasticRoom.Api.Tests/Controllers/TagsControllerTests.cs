using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Microsoft.AspNetCore.Mvc;
using PlasticRoom.Api.Controllers;
using PlasticRoom.Api.Data;
using PlasticRoom.Api.Dtos;
using PlasticRoom.Api.Entities;
using Xunit;

namespace PlasticRoom.Api.Tests.Controllers;

public class TagsControllerTests : IDisposable
{
    private readonly string _tempDir;
    private readonly XpoSessionFactory _factory;
    private readonly TagsController _controller;

    public TagsControllerTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), "plasticroom-tags-controller-tests-" + Guid.NewGuid());
        _factory = new XpoSessionFactory(_tempDir);
        _controller = new TagsController(_factory);
    }

    [Fact]
    public void Create_ThenGetAll_ReturnsTheNewTag()
    {
        var createResult = _controller.Create(new CreateTagRequest("PLA", "#dbb55a"));
        var created = Assert.IsType<TagDto>(Assert.IsType<CreatedAtActionResult>(createResult).Value);

        var getAllResult = Assert.IsType<OkObjectResult>(_controller.GetAll());
        var tags = Assert.IsAssignableFrom<List<TagDto>>(getAllResult.Value);

        Assert.Contains(tags, t => t.Id == created.Id && t.Name == "PLA" && t.ColorKey == "#dbb55a");
    }

    [Fact]
    public void Update_RenamesAndRecolorsTheTag()
    {
        var created = (TagDto)Assert.IsType<CreatedAtActionResult>(
            _controller.Create(new CreateTagRequest("Old Name", "brass"))).Value!;

        var updateResult = _controller.Update(created.Id, new UpdateTagRequest("New Name", "green"));
        var updated = Assert.IsType<TagDto>(Assert.IsType<OkObjectResult>(updateResult).Value);

        Assert.Equal("New Name", updated.Name);
        Assert.Equal("green", updated.ColorKey);
    }

    [Fact]
    public void Update_UnknownId_ReturnsNotFound()
    {
        var result = _controller.Update(999, new UpdateTagRequest("Whatever", "brass"));
        Assert.IsType<NotFoundObjectResult>(result);
    }

    [Fact]
    public void Update_InvalidColorKey_ReturnsBadRequest()
    {
        var created = (TagDto)Assert.IsType<CreatedAtActionResult>(
            _controller.Create(new CreateTagRequest("PLA", "brass"))).Value!;

        var result = _controller.Update(created.Id, new UpdateTagRequest("PLA", "not-a-real-color"));
        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public void Delete_RemovesTagAndItsFileTagRows()
    {
        var created = (TagDto)Assert.IsType<CreatedAtActionResult>(
            _controller.Create(new CreateTagRequest("PLA", "brass"))).Value!;

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
            var tag = session.GetObjectByKey<Tag>(created.Id);
            new FileTag(session) { File = file, Tag = tag! }.Save();
        }

        var deleteResult = _controller.Delete(created.Id);
        Assert.IsType<NoContentResult>(deleteResult);

        using var verify = _factory.CreateSession();
        Assert.Null(verify.GetObjectByKey<Tag>(created.Id));
        Assert.Empty(new DevExpress.Xpo.XPCollection<FileTag>(verify));
    }

    [Fact]
    public void Delete_UnknownId_ReturnsNotFound()
    {
        var result = _controller.Delete(999);
        Assert.IsType<NotFoundObjectResult>(result);
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDir))
        {
            Directory.Delete(_tempDir, recursive: true);
        }
    }
}
