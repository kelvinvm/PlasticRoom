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
public class TagsController : ControllerBase
{
    private static readonly HashSet<string> ValidColorKeys = new() { "brass", "orange", "green", "red" };

    private readonly XpoSessionFactory _sessionFactory;

    public TagsController(XpoSessionFactory sessionFactory)
    {
        _sessionFactory = sessionFactory;
    }

    [HttpGet]
    public IActionResult GetAll()
    {
        using var session = _sessionFactory.CreateSession();
        var tags = new XPCollection<Tag>(session).Select(ToDto).ToList();
        return Ok(tags);
    }

    [HttpPost]
    public IActionResult Create([FromBody] CreateTagRequest request)
    {
        using var session = _sessionFactory.CreateSession();
        var tag = new Tag(session) { Name = request.Name, ColorKey = request.ColorKey };
        tag.Save();

        return CreatedAtAction(nameof(GetAll), new { }, ToDto(tag));
    }

    [HttpPut("{id}")]
    public IActionResult Update(int id, [FromBody] UpdateTagRequest request)
    {
        using var session = _sessionFactory.CreateSession();
        var tag = session.GetObjectByKey<Tag>(id);
        if (tag is null)
        {
            return NotFound(new { error = $"Tag {id} not found" });
        }

        if (request.ColorKey is not null && !ValidColorKeys.Contains(request.ColorKey))
        {
            return BadRequest(new { error = $"Unknown color key '{request.ColorKey}'" });
        }

        tag.Name = request.Name;
        tag.ColorKey = request.ColorKey;
        tag.Save();

        return Ok(ToDto(tag));
    }

    [HttpDelete("{id}")]
    public IActionResult Delete(int id)
    {
        using var session = _sessionFactory.CreateSession();
        var tag = session.GetObjectByKey<Tag>(id);
        if (tag is null)
        {
            return NotFound(new { error = $"Tag {id} not found" });
        }

        foreach (var fileTag in tag.FileTags.ToList())
        {
            fileTag.Delete();
        }
        tag.Delete();
        session.PurgeDeletedObjects();

        return NoContent();
    }

    private static TagDto ToDto(Tag tag) => new(tag.Oid, tag.Name, tag.ColorKey);
}
