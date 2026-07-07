using System.Collections.Generic;
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

            if (WouldCreateCycle(folder, parent))
            {
                return BadRequest(new { error = "A folder cannot be moved under itself or its own descendant" });
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

    [HttpPut("order")]
    public IActionResult Order([FromBody] ReorderFoldersRequest request)
    {
        if (request.Items is null || request.Items.Count == 0)
        {
            return BadRequest(new { error = "No folders to reorder" });
        }

        using var session = _sessionFactory.CreateSession();

        // Validate everything before writing anything (atomic all-or-nothing).
        var resolved = new List<(Folder folder, Folder? parent, int sortOrder)>();
        foreach (var item in request.Items)
        {
            var folder = session.GetObjectByKey<Folder>(item.Id);
            if (folder is null)
            {
                return NotFound(new { error = $"Folder {item.Id} not found" });
            }

            if (folder.IsSystem)
            {
                return BadRequest(new { error = $"Folder {item.Id} is a system folder and cannot be reordered" });
            }

            Folder? parent = null;
            if (item.ParentId is int parentId)
            {
                parent = session.GetObjectByKey<Folder>(parentId);
                if (parent is null)
                {
                    return NotFound(new { error = $"Parent folder {parentId} not found" });
                }

                if (WouldCreateCycle(folder, parent))
                {
                    return BadRequest(new { error = $"Folder {item.Id} cannot be moved under itself or its own descendant" });
                }
            }

            resolved.Add((folder, parent, item.SortOrder));
        }

        session.BeginTransaction();
        foreach (var (folder, parent, sortOrder) in resolved)
        {
            folder.ParentFolder = parent;
            folder.SortOrder = sortOrder;
            folder.Save();
        }
        session.CommitTransaction();

        var all = new XPCollection<Folder>(session).Select(ToDto).ToList();
        return Ok(all);
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

    // True if making newParent the parent of folder would create a cycle,
    // i.e. newParent is folder itself or one of folder's descendants.
    private static bool WouldCreateCycle(Folder folder, Folder newParent)
    {
        for (Folder? p = newParent; p is not null; p = p.ParentFolder)
        {
            if (p.Oid == folder.Oid)
            {
                return true;
            }
        }
        return false;
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
