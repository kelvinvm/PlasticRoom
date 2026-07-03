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

    private static TagDto ToDto(Tag tag) => new(tag.Oid, tag.Name, tag.ColorKey);
}
