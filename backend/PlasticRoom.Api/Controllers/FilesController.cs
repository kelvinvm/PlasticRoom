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
    public IActionResult GetAll([FromQuery] int? folderId, [FromQuery] string? q)
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

            files = CollectSelfAndDescendants(folder)
                .SelectMany(f => f.FileFolders.Select(ff => ff.File))
                .DistinctBy(f => f.Oid)
                .ToList();
        }
        else
        {
            files = new XPCollection<ModelFile>(session).ToList();
        }

        var trimmed = q?.Trim();
        if (!string.IsNullOrEmpty(trimmed))
        {
            files = files
                .Where(f =>
                    f.Name.Contains(trimmed, StringComparison.OrdinalIgnoreCase) ||
                    (f.Description is not null &&
                     f.Description.Contains(trimmed, StringComparison.OrdinalIgnoreCase)))
                .ToList();
        }

        return Ok(files.Select(ToDto).ToList());
    }

    private static List<Folder> CollectSelfAndDescendants(Folder root)
    {
        var result = new List<Folder>();
        var seen = new HashSet<int>();
        var stack = new Stack<Folder>();
        stack.Push(root);
        while (stack.Count > 0)
        {
            var current = stack.Pop();
            if (!seen.Add(current.Oid))
            {
                continue;
            }
            result.Add(current);
            foreach (var child in current.Children)
            {
                stack.Push(child);
            }
        }
        return result;
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

    [HttpGet("{id}/content")]
    public IActionResult GetContent(int id)
    {
        using var session = _sessionFactory.CreateSession();
        var file = session.GetObjectByKey<ModelFile>(id);
        if (file is null)
        {
            return NotFound(new { error = $"File {id} not found" });
        }

        if (string.IsNullOrEmpty(file.StoragePath) || !System.IO.File.Exists(file.StoragePath))
        {
            return NotFound(new { error = $"File {id} content is missing on disk" });
        }

        var contentType = file.Type == ModelFileType.ThreeMf ? "model/3mf" : "model/stl";
        return PhysicalFile(file.StoragePath, contentType, file.Name, enableRangeProcessing: true);
    }

    [HttpGet("{id}/thumbnail")]
    public IActionResult GetThumbnail(int id)
    {
        using var session = _sessionFactory.CreateSession();
        var file = session.GetObjectByKey<ModelFile>(id);
        if (file is null)
        {
            return NotFound(new { error = $"File {id} not found" });
        }

        if (string.IsNullOrEmpty(file.ThumbnailPath) || !System.IO.File.Exists(file.ThumbnailPath))
        {
            return NotFound(new { error = $"File {id} has no thumbnail" });
        }

        return PhysicalFile(file.ThumbnailPath, "image/png");
    }

    [HttpGet("{id}/plates/{index}/thumbnail")]
    public IActionResult GetPlateThumbnail(int id, int index)
    {
        using var session = _sessionFactory.CreateSession();
        var file = session.GetObjectByKey<ModelFile>(id);
        if (file is null)
        {
            return NotFound(new { error = $"File {id} not found" });
        }

        var plate = file.Plates.FirstOrDefault(p => p.Index == index);
        if (plate is null || string.IsNullOrEmpty(plate.ThumbnailPath) || !System.IO.File.Exists(plate.ThumbnailPath))
        {
            return NotFound(new { error = $"Plate {index} thumbnail for file {id} not found" });
        }

        return PhysicalFile(plate.ThumbnailPath, "image/png");
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

        var plateInfos = ParseBambuPlates(storagePath);
        if (plateInfos.Count > 0)
        {
            modelFile.PlateCount = plateInfos.Count;
            modelFile.Save();

            using var plateZip = System.IO.Compression.ZipFile.OpenRead(storagePath);
            foreach (var info in plateInfos)
            {
                string? thumbPath = null;
                if (!string.IsNullOrEmpty(info.ThumbnailEntryName))
                {
                    var entry = plateZip.GetEntry(info.ThumbnailEntryName);
                    if (entry is not null)
                    {
                        thumbPath = Path.Combine(_fileStorage.ThumbsDirectory, $"{modelFile.Oid}_plate_{info.Index}.png");
                        using var entryStream = entry.Open();
                        using var dest = System.IO.File.Create(thumbPath);
                        entryStream.CopyTo(dest);
                    }
                }

                new Plate(session)
                {
                    File = modelFile,
                    Index = info.Index,
                    Name = info.Name,
                    ThumbnailPath = thumbPath,
                    BuildItemIndices = string.Join(",", info.BuildItemIndices),
                }.Save();
            }
        }

        return CreatedAtAction(nameof(GetById), new { id = modelFile.Oid }, ToDto(modelFile));
    }

    [HttpPut("{id}")]
    public IActionResult Update(int id, [FromBody] UpdateFileRequest request)
    {
        using var session = _sessionFactory.CreateSession();
        var file = session.GetObjectByKey<ModelFile>(id);
        if (file is null)
        {
            return NotFound(new { error = $"File {id} not found" });
        }

        if (!TryValidateSourceUrl(request.SourceUrl, out var sourceUrlError))
        {
            return BadRequest(new { error = sourceUrlError });
        }

        if (request.Description is not null)
        {
            file.Description = request.Description;
        }

        if (request.Material is not null)
        {
            file.Material = request.Material;
        }

        if (request.EstPrintTimeMin is int est)
        {
            file.EstPrintTimeMin = est;
        }

        if (request.LayerHeightMm is double lh)
        {
            file.LayerHeightMm = lh;
        }

        if (request.SourceUrl is not null)
        {
            file.SourceUrl = request.SourceUrl;
        }

        if (request.Creator is not null)
        {
            file.Creator = request.Creator;
        }

        file.Save();
        return Ok(ToDto(file));
    }

    [HttpDelete("{id}")]
    public IActionResult Delete(int id)
    {
        using var session = _sessionFactory.CreateSession();
        var file = session.GetObjectByKey<ModelFile>(id);
        if (file is null)
        {
            return NotFound(new { error = $"File {id} not found" });
        }

        foreach (var fileFolder in file.FileFolders.ToList())
        {
            fileFolder.Delete();
        }

        foreach (var fileTag in file.FileTags.ToList())
        {
            fileTag.Delete();
        }

        var storagePath = file.StoragePath;
        var thumbnailPath = file.ThumbnailPath;

        file.Delete();
        session.PurgeDeletedObjects();

        if (System.IO.File.Exists(storagePath))
        {
            System.IO.File.Delete(storagePath);
        }

        if (thumbnailPath is not null && System.IO.File.Exists(thumbnailPath))
        {
            System.IO.File.Delete(thumbnailPath);
        }

        return NoContent();
    }

    [HttpPost("{id}/thumbnail")]
    public async Task<IActionResult> UploadThumbnail(int id, IFormFile file)
    {
        if (file is null || file.Length == 0)
        {
            return BadRequest(new { error = "A thumbnail file is required" });
        }

        using var session = _sessionFactory.CreateSession();
        var modelFile = session.GetObjectByKey<ModelFile>(id);
        if (modelFile is null)
        {
            return NotFound(new { error = $"File {id} not found" });
        }

        var thumbnailPath = Path.Combine(_fileStorage.ThumbsDirectory, $"{id}.png");
        using (var destination = System.IO.File.Create(thumbnailPath))
        {
            await file.CopyToAsync(destination);
        }

        modelFile.ThumbnailPath = thumbnailPath;
        modelFile.Save();

        return Ok(ToDto(modelFile));
    }

    [HttpPut("{id}/folders")]
    public IActionResult SetFolders(int id, [FromBody] IdListRequest request)
    {
        using var session = _sessionFactory.CreateSession();
        var file = session.GetObjectByKey<ModelFile>(id);
        if (file is null)
        {
            return NotFound(new { error = $"File {id} not found" });
        }

        var desiredIds = request.Ids.ToHashSet();
        var current = file.FileFolders.ToList();
        var currentIds = current.Select(ff => ff.Folder.Oid).ToHashSet();

        foreach (var fileFolder in current.Where(ff => !desiredIds.Contains(ff.Folder.Oid)))
        {
            fileFolder.Delete();
        }

        session.PurgeDeletedObjects();

        foreach (var folderId in desiredIds.Where(fid => !currentIds.Contains(fid)))
        {
            var folder = session.GetObjectByKey<Folder>(folderId);
            if (folder is null)
            {
                return NotFound(new { error = $"Folder {folderId} not found" });
            }

            new FileFolder(session) { File = file, Folder = folder }.Save();
        }

        return Ok(ToDto(file));
    }

    [HttpPut("{id}/tags")]
    public IActionResult SetTags(int id, [FromBody] IdListRequest request)
    {
        using var session = _sessionFactory.CreateSession();
        var file = session.GetObjectByKey<ModelFile>(id);
        if (file is null)
        {
            return NotFound(new { error = $"File {id} not found" });
        }

        var desiredIds = request.Ids.ToHashSet();
        var current = file.FileTags.ToList();
        var currentIds = current.Select(ft => ft.Tag.Oid).ToHashSet();

        foreach (var fileTag in current.Where(ft => !desiredIds.Contains(ft.Tag.Oid)))
        {
            fileTag.Delete();
        }

        session.PurgeDeletedObjects();

        foreach (var tagId in desiredIds.Where(tid => !currentIds.Contains(tid)))
        {
            var tag = session.GetObjectByKey<Tag>(tagId);
            if (tag is null)
            {
                return NotFound(new { error = $"Tag {tagId} not found" });
            }

            new FileTag(session) { File = file, Tag = tag }.Save();
        }

        return Ok(ToDto(file));
    }

    private static IReadOnlyList<PlateInfo> ParseBambuPlates(string storagePath)
    {
        try
        {
            using var stream = System.IO.File.OpenRead(storagePath);
            return BambuPlateParser.Parse(stream);
        }
        catch
        {
            return System.Array.Empty<PlateInfo>();
        }
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
        file.FileTags.Select(ft => ft.Tag.Oid).ToList(),
        file.Plates.OrderBy(p => p.Index).Select(p => new PlateDto(
            p.Index,
            p.Name,
            ParseIndices(p.BuildItemIndices))).ToList());

    private static IReadOnlyList<int> ParseIndices(string csv) =>
        string.IsNullOrEmpty(csv)
            ? System.Array.Empty<int>()
            : csv.Split(',').Select(int.Parse).ToList();
}
