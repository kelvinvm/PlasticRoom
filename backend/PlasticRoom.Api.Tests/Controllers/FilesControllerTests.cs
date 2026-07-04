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

        var result = Assert.IsType<OkObjectResult>(_controller.GetAll(folderId, null));
        var files = Assert.IsAssignableFrom<List<ModelFileDto>>(result.Value);

        Assert.Single(files);
        Assert.Equal(uploadedB.Id, files[0].Id);
    }

    [Fact]
    public async System.Threading.Tasks.Task GetAll_IncludesFilesFromDescendantFolders()
    {
        var parentFile = (ModelFileDto)Assert.IsType<CreatedAtActionResult>(
            (await _controller.Upload(new UploadFileRequest { File = BuildStlFormFile("parent.stl") }))).Value!;
        var childFile = (ModelFileDto)Assert.IsType<CreatedAtActionResult>(
            (await _controller.Upload(new UploadFileRequest { File = BuildStlFormFile("child.stl") }))).Value!;

        int parentFolderId;
        using (var session = _sessionFactory.CreateSession())
        {
            var parent = new PlasticRoom.Api.Entities.Folder(session) { Name = "Parent" };
            parent.Save();
            var child = new PlasticRoom.Api.Entities.Folder(session) { Name = "Child", ParentFolder = parent };
            child.Save();
            var pf = session.GetObjectByKey<PlasticRoom.Api.Entities.ModelFile>(parentFile.Id);
            var cf = session.GetObjectByKey<PlasticRoom.Api.Entities.ModelFile>(childFile.Id);
            new PlasticRoom.Api.Entities.FileFolder(session) { File = pf!, Folder = parent }.Save();
            new PlasticRoom.Api.Entities.FileFolder(session) { File = cf!, Folder = child }.Save();
            parentFolderId = parent.Oid;
        }

        var result = Assert.IsType<OkObjectResult>(_controller.GetAll(parentFolderId, null));
        var files = Assert.IsAssignableFrom<List<ModelFileDto>>(result.Value);

        Assert.Equal(2, files.Count);
        Assert.Contains(files, f => f.Id == parentFile.Id);
        Assert.Contains(files, f => f.Id == childFile.Id);
    }

    [Fact]
    public async System.Threading.Tasks.Task GetAll_DeduplicatesFileInMultipleFoldersOfSubtree()
    {
        var file = (ModelFileDto)Assert.IsType<CreatedAtActionResult>(
            (await _controller.Upload(new UploadFileRequest { File = BuildStlFormFile("shared.stl") }))).Value!;

        int parentFolderId;
        using (var session = _sessionFactory.CreateSession())
        {
            var parent = new PlasticRoom.Api.Entities.Folder(session) { Name = "Parent" };
            parent.Save();
            var child = new PlasticRoom.Api.Entities.Folder(session) { Name = "Child", ParentFolder = parent };
            child.Save();
            var f = session.GetObjectByKey<PlasticRoom.Api.Entities.ModelFile>(file.Id);
            new PlasticRoom.Api.Entities.FileFolder(session) { File = f!, Folder = parent }.Save();
            new PlasticRoom.Api.Entities.FileFolder(session) { File = f!, Folder = child }.Save();
            parentFolderId = parent.Oid;
        }

        var result = Assert.IsType<OkObjectResult>(_controller.GetAll(parentFolderId, null));
        var files = Assert.IsAssignableFrom<List<ModelFileDto>>(result.Value);

        Assert.Single(files);
    }

    [Fact]
    public async System.Threading.Tasks.Task GetAll_FiltersBySearchQueryOnNameAndDescriptionCaseInsensitively()
    {
        var dragon = (ModelFileDto)Assert.IsType<CreatedAtActionResult>(
            (await _controller.Upload(new UploadFileRequest { File = BuildStlFormFile("Dragon.stl") }))).Value!;
        var knight = (ModelFileDto)Assert.IsType<CreatedAtActionResult>(
            (await _controller.Upload(new UploadFileRequest { File = BuildStlFormFile("Knight.stl") }))).Value!;
        _controller.Update(knight.Id, new UpdateFileRequest("A fearsome DRAGON slayer", null, null, null, null, null));

        var result = Assert.IsType<OkObjectResult>(_controller.GetAll(null, "dragon"));
        var files = Assert.IsAssignableFrom<List<ModelFileDto>>(result.Value);

        Assert.Equal(2, files.Count); // Dragon.stl by name, Knight.stl by description
        Assert.Contains(files, f => f.Id == dragon.Id);
        Assert.Contains(files, f => f.Id == knight.Id);
    }

    [Fact]
    public async System.Threading.Tasks.Task GetAll_CombinesFolderScopeAndSearch()
    {
        var inFolder = (ModelFileDto)Assert.IsType<CreatedAtActionResult>(
            (await _controller.Upload(new UploadFileRequest { File = BuildStlFormFile("Dragon.stl") }))).Value!;
        // A second matching-name file NOT in the folder must be excluded by the folder scope.
        await _controller.Upload(new UploadFileRequest { File = BuildStlFormFile("Dragon2.stl") });

        int folderId;
        using (var session = _sessionFactory.CreateSession())
        {
            var folder = new PlasticRoom.Api.Entities.Folder(session) { Name = "Minis" };
            folder.Save();
            var f = session.GetObjectByKey<PlasticRoom.Api.Entities.ModelFile>(inFolder.Id);
            new PlasticRoom.Api.Entities.FileFolder(session) { File = f!, Folder = folder }.Save();
            folderId = folder.Oid;
        }

        var result = Assert.IsType<OkObjectResult>(_controller.GetAll(folderId, "dragon"));
        var files = Assert.IsAssignableFrom<List<ModelFileDto>>(result.Value);

        Assert.Single(files);
        Assert.Equal(inFolder.Id, files[0].Id);
    }

    [Fact]
    public async System.Threading.Tasks.Task Update_SetsEditableFieldsOnly()
    {
        var uploaded = (ModelFileDto)Assert.IsType<CreatedAtActionResult>(
            (await _controller.Upload(new UploadFileRequest { File = BuildStlFormFile("a.stl") }))).Value!;

        var result = _controller.Update(uploaded.Id, new UpdateFileRequest(
            "A nice widget", "PLA", 120, 0.2, "https://example.com/model", "Jane Doe"));

        var dto = Assert.IsType<ModelFileDto>(Assert.IsType<OkObjectResult>(result).Value);
        Assert.Equal("A nice widget", dto.Description);
        Assert.Equal("PLA", dto.Material);
        Assert.Equal(120, dto.EstPrintTimeMin);
        Assert.Equal(0.2, dto.LayerHeightMm);
        Assert.Equal("https://example.com/model", dto.SourceUrl);
        Assert.Equal("Jane Doe", dto.Creator);
        Assert.Equal(10, dto.DimXMm); // unchanged, not editable
    }

    [Fact]
    public async System.Threading.Tasks.Task Update_RejectsMalformedSourceUrl()
    {
        var uploaded = (ModelFileDto)Assert.IsType<CreatedAtActionResult>(
            (await _controller.Upload(new UploadFileRequest { File = BuildStlFormFile("a.stl") }))).Value!;

        var result = _controller.Update(uploaded.Id, new UpdateFileRequest(null, null, null, null, "not a url", null));

        Assert.IsType<BadRequestObjectResult>(result);
    }

    [Fact]
    public async System.Threading.Tasks.Task Delete_RemovesFileRecordAndBlobFromDisk()
    {
        var uploaded = (ModelFileDto)Assert.IsType<CreatedAtActionResult>(
            (await _controller.Upload(new UploadFileRequest { File = BuildStlFormFile("a.stl") }))).Value!;
        var storedFilePath = Directory.GetFiles(_fileStorage.FilesDirectory).Single();

        var result = _controller.Delete(uploaded.Id);

        Assert.IsType<NoContentResult>(result);
        Assert.False(System.IO.File.Exists(storedFilePath));
        Assert.IsType<NotFoundObjectResult>(_controller.GetById(uploaded.Id));
    }

    [Fact]
    public async System.Threading.Tasks.Task UploadThumbnail_WritesPngAndSetsThumbnailPath()
    {
        var uploaded = (ModelFileDto)Assert.IsType<CreatedAtActionResult>(
            (await _controller.Upload(new UploadFileRequest { File = BuildStlFormFile("a.stl") }))).Value!;

        var pngBytes = new byte[] { 0x89, 0x50, 0x4E, 0x47 };
        var pngFile = new FormFile(new MemoryStream(pngBytes), 0, pngBytes.Length, "file", "thumb.png");

        var result = await _controller.UploadThumbnail(uploaded.Id, pngFile);

        var dto = Assert.IsType<ModelFileDto>(Assert.IsType<OkObjectResult>(result).Value);
        Assert.NotNull(dto.ThumbnailPath);
        Assert.True(System.IO.File.Exists(dto.ThumbnailPath));
    }

    [Fact]
    public async System.Threading.Tasks.Task SetFolders_DiffsAddedAndRemovedAssignments()
    {
        var uploaded = (ModelFileDto)Assert.IsType<CreatedAtActionResult>(
            (await _controller.Upload(new UploadFileRequest { File = BuildStlFormFile("a.stl") }))).Value!;

        int folderAId;
        int folderBId;
        using (var session = _sessionFactory.CreateSession())
        {
            var folderA = new PlasticRoom.Api.Entities.Folder(session) { Name = "A" };
            var folderB = new PlasticRoom.Api.Entities.Folder(session) { Name = "B" };
            folderA.Save();
            folderB.Save();
            folderAId = folderA.Oid;
            folderBId = folderB.Oid;
        }

        var firstResult = _controller.SetFolders(uploaded.Id, new IdListRequest(new List<int> { folderAId }));
        var firstDto = Assert.IsType<ModelFileDto>(Assert.IsType<OkObjectResult>(firstResult).Value);
        Assert.Equal(new[] { folderAId }, firstDto.FolderIds);

        var secondResult = _controller.SetFolders(uploaded.Id, new IdListRequest(new List<int> { folderBId }));
        var secondDto = Assert.IsType<ModelFileDto>(Assert.IsType<OkObjectResult>(secondResult).Value);
        Assert.Equal(new[] { folderBId }, secondDto.FolderIds);
    }

    [Fact]
    public async System.Threading.Tasks.Task SetTags_DiffsAddedAndRemovedAssignments()
    {
        var uploaded = (ModelFileDto)Assert.IsType<CreatedAtActionResult>(
            (await _controller.Upload(new UploadFileRequest { File = BuildStlFormFile("a.stl") }))).Value!;

        int tagAId;
        int tagBId;
        using (var session = _sessionFactory.CreateSession())
        {
            var tagA = new PlasticRoom.Api.Entities.Tag(session) { Name = "PLA" };
            var tagB = new PlasticRoom.Api.Entities.Tag(session) { Name = "PETG" };
            tagA.Save();
            tagB.Save();
            tagAId = tagA.Oid;
            tagBId = tagB.Oid;
        }

        _controller.SetTags(uploaded.Id, new IdListRequest(new List<int> { tagAId, tagBId }));
        var result = _controller.SetTags(uploaded.Id, new IdListRequest(new List<int> { tagBId }));

        var dto = Assert.IsType<ModelFileDto>(Assert.IsType<OkObjectResult>(result).Value);
        Assert.Equal(new[] { tagBId }, dto.TagIds);
    }

    [Fact(Timeout = 10000)]
    public async System.Threading.Tasks.Task GetAll_WithFolderCycle_TerminatesAndReturnsFiles()
    {
        var file = (ModelFileDto)Assert.IsType<CreatedAtActionResult>(
            (await _controller.Upload(new UploadFileRequest { File = BuildStlFormFile("cyclic.stl") }))).Value!;

        int folderAId;
        using (var session = _sessionFactory.CreateSession())
        {
            var a = new PlasticRoom.Api.Entities.Folder(session) { Name = "A" };
            var b = new PlasticRoom.Api.Entities.Folder(session) { Name = "B" };
            a.Save();
            b.Save();
            // Create a cycle: A -> B -> A
            a.ParentFolder = b;
            b.ParentFolder = a;
            a.Save();
            b.Save();
            var f = session.GetObjectByKey<PlasticRoom.Api.Entities.ModelFile>(file.Id);
            new PlasticRoom.Api.Entities.FileFolder(session) { File = f!, Folder = a }.Save();
            folderAId = a.Oid;
        }

        var result = Assert.IsType<OkObjectResult>(_controller.GetAll(folderAId, null));
        var files = Assert.IsAssignableFrom<List<ModelFileDto>>(result.Value);

        Assert.Single(files);
        Assert.Equal(file.Id, files[0].Id);
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDataDir))
        {
            Directory.Delete(_tempDataDir, recursive: true);
        }
    }
}
