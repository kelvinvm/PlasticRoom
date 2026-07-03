using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using PlasticRoom.Api.Controllers;
using PlasticRoom.Api.Data;
using PlasticRoom.Api.Dtos;
using Xunit;

namespace PlasticRoom.Api.Tests.Controllers;

public class FilesControllerTests : IDisposable
{
    private readonly string _tempDataDir;
    private readonly XpoSessionFactory _sessionFactory;
    private readonly FileStorage _fileStorage;
    private readonly FilesController _controller;

    public FilesControllerTests()
    {
        _tempDataDir = Path.Combine(Path.GetTempPath(), "plasticroom-files-controller-tests-" + Guid.NewGuid());
        _sessionFactory = new XpoSessionFactory(_tempDataDir);
        _fileStorage = new FileStorage(_tempDataDir);
        _controller = new FilesController(_sessionFactory, _fileStorage);
    }

    private static IFormFile BuildStlFormFile(string fileName)
    {
        using var stream = new MemoryStream();
        using (var writer = new BinaryWriter(stream, Encoding.ASCII, leaveOpen: true))
        {
            writer.Write(new byte[80]);
            writer.Write((uint)1);
            writer.Write(0f); writer.Write(0f); writer.Write(0f); // normal
            writer.Write(0f); writer.Write(0f); writer.Write(0f);
            writer.Write(10f); writer.Write(0f); writer.Write(0f);
            writer.Write(0f); writer.Write(5f); writer.Write(0f);
            writer.Write((ushort)0);
        }

        var bytes = stream.ToArray();
        return new FormFile(new MemoryStream(bytes), 0, bytes.Length, "file", fileName);
    }

    [Fact]
    public async System.Threading.Tasks.Task Upload_ParsesStlAndCreatesFileRecord()
    {
        var request = new UploadFileRequest { File = BuildStlFormFile("widget.stl") };

        var result = await _controller.Upload(request);

        var dto = Assert.IsType<ModelFileDto>(Assert.IsType<CreatedAtActionResult>(result).Value);
        Assert.Equal("widget.stl", dto.Name);
        Assert.Equal("Stl", dto.Type);
        Assert.Equal(10, dto.DimXMm);
        Assert.Equal(5, dto.DimYMm);
        Assert.Single(Directory.GetFiles(_fileStorage.FilesDirectory));
    }

    [Fact]
    public async System.Threading.Tasks.Task Upload_RejectsUnsupportedExtension()
    {
        var bytes = new byte[] { 1, 2, 3 };
        var formFile = new FormFile(new MemoryStream(bytes), 0, bytes.Length, "file", "model.obj");
        var request = new UploadFileRequest { File = formFile };

        var result = await _controller.Upload(request);

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async System.Threading.Tasks.Task Upload_RejectsMalformedSourceUrl()
    {
        var request = new UploadFileRequest { File = BuildStlFormFile("widget.stl"), SourceUrl = "not a url" };

        var result = await _controller.Upload(request);

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async System.Threading.Tasks.Task GetAll_FiltersByFolderId()
    {
        await _controller.Upload(new UploadFileRequest { File = BuildStlFormFile("a.stl") });
        var uploadedB = (ModelFileDto)Assert.IsType<CreatedAtActionResult>(
            (await _controller.Upload(new UploadFileRequest { File = BuildStlFormFile("b.stl") }))).Value!;

        int folderId;
        using (var session = _sessionFactory.CreateSession())
        {
            var folder = new PlasticRoom.Api.Entities.Folder(session) { Name = "Bucket" };
            folder.Save();
            var file = session.GetObjectByKey<PlasticRoom.Api.Entities.ModelFile>(uploadedB.Id);
            new PlasticRoom.Api.Entities.FileFolder(session) { File = file!, Folder = folder }.Save();
            folderId = folder.Oid;
        }

        var result = Assert.IsType<OkObjectResult>(_controller.GetAll(folderId));
        var files = Assert.IsAssignableFrom<List<ModelFileDto>>(result.Value);

        Assert.Single(files);
        Assert.Equal(uploadedB.Id, files[0].Id);
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDataDir))
        {
            Directory.Delete(_tempDataDir, recursive: true);
        }
    }
}
