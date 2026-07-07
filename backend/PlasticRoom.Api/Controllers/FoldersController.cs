using System.Linq;
using DevExpress.Xpo;
using Microsoft.AspNetCore.Mvc;
using PlasticRoom.Api.Data;
using PlasticRoom.Api.Dtos;
using PlasticRoom.Api.Entities;

namespace PlasticRoom.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class FoldersController : ControllerBase
{
    private readonly XpoSessionFactory _sessionFactory;

    public FoldersController(XpoSessionFactory sessionFactory)
    {
        _sessionFactory = sessionFactory;
    }

    [HttpGet]
    public IActionResult GetAll()
    {
        using var session = _sessionFactory.CreateSession();
        var folders = new XPCollection<Folder>(session).Select(ToDto).ToList();
        return Ok(folders);
    }

    [HttpPost]
    public IActionResult Create([FromBody] CreateFolderRequest request)
    {
        using var session = _sessionFactory.CreateSession();

        Folder? parent = null;
        if (request.ParentId is int parentId)
        {
            parent = session.GetObjectByKey<Folder>(parentId);
            if (parent is null)
            {
                return NotFound(new { error = $"Parent folder {parentId} not found" });
            }
        }

        var folder = new Folder(session)
        {
            Name = request.Name,
            ParentFolder = parent,
            Description = request.Description,
            IsSystem = false,
        };
        folder.Save();

        return CreatedAtAction(nameof(GetAll), new { }, ToDto(folder));
    }

    [HttpPut("{id}")]
    public IActionResult Update(int id, [FromBody] UpdateFolderRequest request)
    {
        using var session = _sessionFactory.CreateSession();
        var folder = session.GetObjectByKey<Folder>(id);
        if (folder is null)
        {
            return NotFound(new { error = $"Folder {id} not found" });
        }

        if (folder.IsSystem && (request.Name is not null || request.ParentId is not null))
        {
            return BadRequest(new { error = "System folders cannot be renamed or reparented" });
        }

        if (request.Name is not null)
        {
            folder.Name = request.Name;
        }

        if (request.ParentId is int parentId)
        {
            var parent = session.GetObjectByKey<Folder>(parentId);
            if (parent is null)
            {
                return NotFound(new { error = $"Parent folder {parentId} not found" });
            }

            folder.ParentFolder = parent;
        }

        if (request.Description is not null)
        {
            folder.Description = request.Description;
        }

        if (request.SortOrder is int sortOrder)
        {
            folder.SortOrder = sortOrder;
        }

        if (request.CoverImageFileId is int coverId)
        {
            var cover = session.GetObjectByKey<ModelFile>(coverId);
            if (cover is null)
            {
                return NotFound(new { error = $"File {coverId} not found" });
            }

            folder.CoverImageFile = cover;
        }

        folder.Save();
        return Ok(ToDto(folder));
    }

    [HttpDelete("{id}")]
    public IActionResult Delete(int id)
    {
        using var session = _sessionFactory.CreateSession();
        var folder = session.GetObjectByKey<Folder>(id);
        if (folder is null)
        {
            return NotFound(new { error = $"Folder {id} not found" });
        }

        if (folder.IsSystem)
        {
            return BadRequest(new { error = "System folders cannot be deleted" });
        }

        DeleteFolderRecursive(folder);
        session.PurgeDeletedObjects();
        return NoContent();
    }

    private static void DeleteFolderRecursive(Folder folder)
    {
        foreach (var child in folder.Children.ToList())
        {
            DeleteFolderRecursive(child);
        }

        foreach (var fileFolder in folder.FileFolders.ToList())
        {
            fileFolder.Delete();
        }

        folder.Delete();
    }

    private static FolderDto ToDto(Folder folder) => new(
        folder.Oid,
        folder.Name,
        folder.ParentFolder?.Oid,
        folder.Description,
        folder.CoverImageFile?.Oid,
        folder.SortOrder,
        folder.IsSystem,
        folder.FileFolders.Count);
}
