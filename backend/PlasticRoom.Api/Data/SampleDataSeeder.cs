using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using DevExpress.Xpo;
using PlasticRoom.Api.Entities;
using PlasticRoom.Api.Parsing;

namespace PlasticRoom.Api.Data;

public static class SampleDataSeeder
{
    public static bool IsEnabled() =>
        string.Equals(
            Environment.GetEnvironmentVariable("SEED_SAMPLE_DATA"),
            "true",
            StringComparison.OrdinalIgnoreCase);

    public static void Seed(XpoSessionFactory sessionFactory, FileStorage fileStorage)
    {
        using var session = sessionFactory.CreateSession();

        // Idempotency: bail if any folder already exists.
        if (new XPCollection<Folder>(session).Any())
        {
            return;
        }

        var miniatures = new Folder(session) { Name = "Miniatures" };
        miniatures.Save();
        var dnd = new Folder(session) { Name = "DnD Campaign", ParentFolder = miniatures };
        dnd.Save();
        var household = new Folder(session) { Name = "Household" };
        household.Save();
        var terrain = new Folder(session) { Name = "Terrain" };
        terrain.Save();

        var tagResin = new Tag(session) { Name = "Resin", ColorKey = "brass" };
        var tagPla = new Tag(session) { Name = "PLA", ColorKey = "green" };
        var tagWip = new Tag(session) { Name = "WIP", ColorKey = "orange" };
        tagResin.Save();
        tagPla.Save();
        tagWip.Save();

        CreateSampleFile(session, fileStorage, "Articulated_Dragon.stl", ModelFileType.Stl,
            "Print-in-place dragon, 8 segments",
            new[] { miniatures, dnd }, new[] { tagPla });
        CreateSampleFile(session, fileStorage, "Goblin_King_Mini.stl", ModelFileType.Stl,
            "32mm scale, single piece",
            new[] { dnd }, new[] { tagResin, tagWip });
        CreateSampleFile(session, fileStorage, "Chess_Knight_Set.3mf", ModelFileType.ThreeMf,
            "4 plates, resin optimized",
            new[] { household }, new[] { tagResin });
        CreateSampleFile(session, fileStorage, "Terrain_Ruins.3mf", ModelFileType.ThreeMf,
            "Modular 6x6in base",
            new[] { terrain }, new[] { tagPla });
    }

    private static void CreateSampleFile(
        Session session,
        FileStorage fileStorage,
        string name,
        ModelFileType type,
        string description,
        Folder?[] folders,
        Tag[] tags)
    {
        var extension = type == ModelFileType.ThreeMf ? ".3mf" : ".stl";
        var bytes = type == ModelFileType.ThreeMf ? BuildSampleThreeMf() : BuildSampleStl();

        var storedFileName = $"{Guid.NewGuid()}{extension}";
        var storagePath = Path.Combine(fileStorage.FilesDirectory, storedFileName);
        File.WriteAllBytes(storagePath, bytes);

        using var readStream = File.OpenRead(storagePath);
        var metadata = type == ModelFileType.ThreeMf
            ? ThreeMfMetadataParser.Parse(readStream)
            : StlMetadataParser.Parse(readStream);

        var file = new ModelFile(session)
        {
            Name = name,
            Type = type,
            SizeBytes = bytes.Length,
            AddedAt = DateTime.UtcNow,
            DimXMm = metadata.DimXMm,
            DimYMm = metadata.DimYMm,
            DimZMm = metadata.DimZMm,
            PlateCount = metadata.PlateCount,
            Description = description,
            StoragePath = storagePath,
        };
        file.Save();

        foreach (var folder in folders.Where(f => f is not null))
        {
            new FileFolder(session) { File = file, Folder = folder! }.Save();
        }

        foreach (var tag in tags)
        {
            new FileTag(session) { File = file, Tag = tag }.Save();
        }
    }

    private static byte[] BuildSampleStl()
    {
        using var stream = new MemoryStream();
        using (var writer = new BinaryWriter(stream, Encoding.ASCII, leaveOpen: true))
        {
            writer.Write(new byte[80]);      // header
            writer.Write((uint)1);            // triangle count
            writer.Write(0f); writer.Write(0f); writer.Write(0f); // normal
            writer.Write(0f); writer.Write(0f); writer.Write(0f); // v1
            writer.Write(42f); writer.Write(0f); writer.Write(0f); // v2
            writer.Write(0f); writer.Write(28f); writer.Write(15f); // v3
            writer.Write((ushort)0);          // attribute byte count
        }

        return stream.ToArray();
    }

    private static byte[] BuildSampleThreeMf()
    {
        const string modelXml = """
            <?xml version="1.0" encoding="UTF-8"?>
            <model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
              <resources>
                <object id="1" type="model">
                  <mesh>
                    <vertices>
                      <vertex x="0" y="0" z="0" />
                      <vertex x="60" y="0" z="0" />
                      <vertex x="0" y="60" z="0" />
                      <vertex x="0" y="0" z="40" />
                    </vertices>
                    <triangles>
                      <triangle v1="0" v2="1" v3="2" />
                      <triangle v1="0" v2="1" v3="3" />
                    </triangles>
                  </mesh>
                </object>
              </resources>
              <build>
                <item objectid="1" />
              </build>
            </model>
            """;

        using var stream = new MemoryStream();
        using (var archive = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
        {
            var entry = archive.CreateEntry("3D/3dmodel.model");
            using var entryStream = entry.Open();
            using var streamWriter = new StreamWriter(entryStream);
            streamWriter.Write(modelXml);
        }

        return stream.ToArray();
    }
}
