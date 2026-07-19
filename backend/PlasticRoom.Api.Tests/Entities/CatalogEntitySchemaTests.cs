using System;
using System.IO;
using System.Linq;
using DevExpress.Xpo;
using PlasticRoom.Api.Data;
using PlasticRoom.Api.Entities;
using Xunit;

namespace PlasticRoom.Api.Tests.Entities;

public class CatalogEntitySchemaTests : IDisposable
{
    private readonly string _tempDir;
    private readonly XpoSessionFactory _factory;

    public CatalogEntitySchemaTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), "plasticroom-catalog-entity-tests-" + Guid.NewGuid());
        _factory = new XpoSessionFactory(_tempDir);
    }

    [Fact]
    public void CanCreateDesignerModelAndAssociateFilesAndTags()
    {
        using (var session = _factory.CreateSession())
        {
            var designer = new Designer(session) { Name = "LeHa Designs" };
            designer.Save();

            var model = new Model(session)
            {
                Name = "Bramble",
                Designer = designer,
                DestinationPath = "/library/LeHa Designs/Bramble",
            };
            model.Save();

            var file = new ModelFile(session)
            {
                Name = "bramble.3mf",
                Type = ModelFileType.ThreeMf,
                SizeBytes = 2048,
                AddedAt = DateTime.UtcNow,
                StoragePath = "/library/LeHa Designs/Bramble/bramble.3mf",
                Model = model,
            };
            file.Save();

            var tag = new Tag(session) { Name = "pint holder" };
            tag.Save();

            var modelTag = new ModelTag(session) { Model = model, Tag = tag };
            modelTag.Save();
        }

        using var verifySession = _factory.CreateSession();

        var designers = new XPCollection<Designer>(verifySession);
        var reloadedDesigner = designers.Single(d => d.Name == "LeHa Designs");
        Assert.Single(reloadedDesigner.Models);

        var reloadedModel = reloadedDesigner.Models.Single();
        Assert.Equal("Bramble", reloadedModel.Name);
        Assert.Single(reloadedModel.Files);
        Assert.Single(reloadedModel.ModelTags);
        Assert.Equal("pint holder", reloadedModel.ModelTags.Single().Tag.Name);
        Assert.Equal(reloadedModel.Oid, reloadedModel.Files.Single().Model!.Oid);
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDir))
        {
            Directory.Delete(_tempDir, recursive: true);
        }
    }
}
