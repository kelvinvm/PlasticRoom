using System;
using System.IO;
using System.Linq;
using PlasticRoom.Api.Data;
using PlasticRoom.Api.Entities;
using Xunit;

namespace PlasticRoom.Api.Tests.Entities;

public class PlateEntityTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "plasticroom-plate-tests-" + Guid.NewGuid());
    private readonly XpoSessionFactory _factory;

    public PlateEntityTests() => _factory = new XpoSessionFactory(_dir);

    [Fact]
    public void PlateBelongsToFileViaAssociation()
    {
        using (var session = _factory.CreateSession())
        {
            var file = new ModelFile(session) { Name = "a.3mf", Type = ModelFileType.ThreeMf };
            file.Save();
            new Plate(session) { File = file, Index = 1, Name = "Corners", ThumbnailPath = "/t/1.png", BuildItemIndices = "0,2" }.Save();
        }

        using (var session = _factory.CreateSession())
        {
            var file = new DevExpress.Xpo.XPCollection<ModelFile>(session).Single();
            var plate = file.Plates.Single();
            Assert.Equal(1, plate.Index);
            Assert.Equal("Corners", plate.Name);
            Assert.Equal("0,2", plate.BuildItemIndices);
        }
    }

    public void Dispose()
    {
        if (Directory.Exists(_dir)) Directory.Delete(_dir, true);
    }
}
