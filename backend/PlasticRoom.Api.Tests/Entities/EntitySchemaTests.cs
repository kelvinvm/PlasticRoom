using System;
using System.IO;
using PlasticRoom.Api.Data;
using PlasticRoom.Api.Entities;
using Xunit;

namespace PlasticRoom.Api.Tests.Entities;

public class EntitySchemaTests : IDisposable
{
    private readonly string _tempDir;
    private readonly XpoSessionFactory _factory;

    public EntitySchemaTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), "plasticroom-entity-tests-" + Guid.NewGuid());
        _factory = new XpoSessionFactory(_tempDir);
    }

    [Fact]
    public void CanCreateAndAssociateAllEntities()
    {
        using (var session = _factory.CreateSession())
        {
            var parent = new Folder(session) { Name = "Parent" };
            var child = new Folder(session) { Name = "Child", ParentFolder = parent };
            parent.Save();
            child.Save();

            var file = new ModelFile(session)
            {
                Name = "widget.stl",
                Type = ModelFileType.Stl,
                SizeBytes = 1024,
                AddedAt = DateTime.UtcNow,
                StoragePath = "/data/files/widget.stl",
            };
            file.Save();

            var fileFolder = new FileFolder(session) { File = file, Folder = child };
            fileFolder.Save();

            var tag = new Tag(session) { Name = "PLA" };
            tag.Save();

            var fileTag = new FileTag(session) { File = file, Tag = tag };
            fileTag.Save();
        }

        using var verifySession = _factory.CreateSession();

        var allFolders = new DevExpress.Xpo.XPCollection<Folder>(verifySession);
        var childFolder = System.Linq.Enumerable.Single(allFolders, f => f.Name == "Child");
        var parentFolder = System.Linq.Enumerable.Single(allFolders, f => f.Name == "Parent");

        Assert.Equal(parentFolder.Oid, childFolder.ParentFolder!.Oid);
        Assert.Single(childFolder.FileFolders);
        Assert.Single(parentFolder.Children);

        var reloadedFile = System.Linq.Enumerable.Single(new DevExpress.Xpo.XPCollection<ModelFile>(verifySession));
        Assert.Single(reloadedFile.FileFolders);
        Assert.Single(reloadedFile.FileTags);
    }

    public void Dispose()
    {
        if (Directory.Exists(_tempDir))
        {
            Directory.Delete(_tempDir, recursive: true);
        }
    }
}
