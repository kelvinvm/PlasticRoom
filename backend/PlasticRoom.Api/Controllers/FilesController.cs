using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using DevExpress.Xpo;
using Microsoft.AspNetCore.Mvc;
using PlasticRoom.Api.Data;
using PlasticRoom.Api.Dtos;
using PlasticRoom.Api.Entities;
using PlasticRoom.Api.Parsing;

namespace PlasticRoom.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class FilesController : ControllerBase
{
    private readonly XpoSessionFactory _sessionFactory;
    private readonly FileStorage _fileStorage;

    public FilesController(XpoSessionFactory sessionFactory, FileStorage fileStorage)
    {
        _sessionFactory = sessionFactory;
        _fileStorage = fileStorage;
    }

    [HttpGet]
    public IActionResult GetAll([FromQuery] int? folderId)
    {
        using var session = _sessionFactory.CreateSession();

        List<ModelFile> files;
        if (folderId is int fid)
        {
            var folder = session.GetObjectByKey<Folder>(fid);
            if (folder is null)
            {
                return NotFound(new { error = $"Folder {fid} not found" });
            }

            files = folder.FileFolders.Select(ff => ff.File).ToList();
        }
        else
        {
            files = new XPCollection<ModelFile>(session).ToList();
        }

        return Ok(files.Select(ToDto).ToList());
    }

    [HttpGet("{id}")]
    public IActionResult GetById(int id)
    {
        using var session = _sessionFactory.CreateSession();
        var file = session.GetObjectByKey<ModelFile>(id);
        if (file is null)
        {
            return NotFound(new { error = $"File {id} not found" });
        }

        return Ok(ToDto(file));
    }

    [HttpPost]
    public async Task<IActionResult> Upload([FromForm] UploadFileRequest request)
    {
        if (request.File is null || request.File.Length == 0)
        {
            return BadRequest(new { error = "A file is required" });
        }

        var extension = Path.GetExtension(request.File.FileName).ToLowerInvariant();
        ModelFileType type;
        if (extension == ".3mf")
        {
            type = ModelFileType.ThreeMf;
        }
        else if (extension == ".stl")
        {
            type = ModelFileType.Stl;
        }
        else
        {
            return BadRequest(new { error = "Only .3mf and .stl files are supported" });
        }

        if (!TryValidateSourceUrl(request.SourceUrl, out var sourceUrlError))
        {
            return BadRequest(new { error = sourceUrlError });
        }

        var storedFileName = $"{Guid.NewGuid()}{extension}";
        var storagePath = Path.Combine(_fileStorage.FilesDirectory, storedFileName);

        using (var destination = System.IO.File.Create(storagePath))
        {
            await request.File.CopyToAsync(destination);
        }

        ModelMetadata metadata;
        try
        {
            using var readStream = System.IO.File.OpenRead(storagePath);
            metadata = type == ModelFileType.ThreeMf
                ? ThreeMfMetadataParser.Parse(readStream)
                : StlMetadataParser.Parse(readStream);
        }
        catch (InvalidDataException ex)
        {
            System.IO.File.Delete(storagePath);
            return BadRequest(new { error = ex.Message });
        }

        using var session = _sessionFactory.CreateSession();

        var modelFile = new ModelFile(session)
        {
            Name = request.File.FileName,
            Type = type,
            SizeBytes = request.File.Length,
            AddedAt = DateTime.UtcNow,
            DimXMm = metadata.DimXMm,
            DimYMm = metadata.DimYMm,
            DimZMm = metadata.DimZMm,
            PlateCount = metadata.PlateCount,
            SourceUrl = request.SourceUrl,
            Creator = request.Creator,
            StoragePath = storagePath,
        };
        modelFile.Save();

        if (request.FolderIds is { Count: > 0 })
        {
            foreach (var folderId in request.FolderIds)
            {
                var folder = session.GetObjectByKey<Folder>(folderId);
                if (folder is null)
                {
                    System.IO.File.Delete(storagePath);
                    return NotFound(new { error = $"Folder {folderId} not found" });
                }

                new FileFolder(session) { File = modelFile, Folder = folder }.Save();
            }
        }

        if (request.TagIds is { Count: > 0 })
        {
            foreach (var tagId in request.TagIds)
            {
                var tag = session.GetObjectByKey<Tag>(tagId);
                if (tag is null)
                {
                    System.IO.File.Delete(storagePath);
                    return NotFound(new { error = $"Tag {tagId} not found" });
                }

                new FileTag(session) { File = modelFile, Tag = tag }.Save();
            }
        }

        return CreatedAtAction(nameof(GetById), new { id = modelFile.Oid }, ToDto(modelFile));
    }

    private static bool TryValidateSourceUrl(string? sourceUrl, out string? error)
    {
        error = null;
        if (string.IsNullOrEmpty(sourceUrl))
        {
            return true;
        }

        if (!Uri.TryCreate(sourceUrl, UriKind.Absolute, out _))
        {
            error = "sourceUrl must be a well-formed absolute URL";
            return false;
        }

        return true;
    }

    private static ModelFileDto ToDto(ModelFile file) => new(
        file.Oid,
        file.Name,
        file.Type.ToString(),
        file.SizeBytes,
        file.AddedAt,
        file.DimXMm,
        file.DimYMm,
        file.DimZMm,
        file.PlateCount,
        file.EstPrintTimeMin,
        file.Material,
        file.LayerHeightMm,
        file.SourceUrl,
        file.Creator,
        file.Description,
        file.ThumbnailPath,
        file.FileFolders.Select(ff => ff.Folder.Oid).ToList(),
        file.FileTags.Select(ft => ft.Tag.Oid).ToList());
}
