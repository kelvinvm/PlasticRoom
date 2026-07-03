using System;
using System.Collections.Generic;
using System.IO;
using Microsoft.AspNetCore.Mvc;
using PlasticRoom.Api.Controllers;
using PlasticRoom.Api.Data;
using PlasticRoom.Api.Dtos;
using Xunit;

namespace PlasticRoom.Api.Tests.Controllers;

public class TagsControllerTests : IDisposable
{
    private readonly string _tempDir;
    private readonly TagsController _controller;

    public TagsControllerTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), "plasticroom-tags-controller-tests-" + Guid.NewGuid());
        _controller = new TagsController(new XpoSessionFactory(_tempDir));
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

    public void Dispose()
    {
        if (Directory.Exists(_tempDir))
        {
            Directory.Delete(_tempDir, recursive: true);
        }
    }
}
