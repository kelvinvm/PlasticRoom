using Microsoft.AspNetCore.Mvc;
using PlasticRoom.Api.Data;

namespace PlasticRoom.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class HealthController : ControllerBase
{
    private readonly XpoSessionFactory _sessionFactory;

    public HealthController(XpoSessionFactory sessionFactory)
    {
        _sessionFactory = sessionFactory;
    }

    [HttpGet]
    public IActionResult Get()
    {
        try
        {
            using var session = _sessionFactory.CreateSession();
            return Ok(new { status = "ok", db = "connected" });
        }
        catch (System.Exception ex)
        {
            return StatusCode(503, new { status = "error", db = "failed", detail = ex.Message });
        }
    }
}
