using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using PlasticRoom.Api.Parsing;
using Xunit;

namespace PlasticRoom.Api.Tests.Parsing;

public class BambuPlateParserTests
{
    // Root model: three build items in order objectid 1, 2, 3 → indices 0, 1, 2.
    private const string ModelXml = """
        <?xml version="1.0" encoding="UTF-8"?>
        <model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
          <resources><object id="1" type="model"><components><component objectid="10"/></components></object></resources>
          <build>
            <item objectid="1" />
            <item objectid="2" />
            <item objectid="3" />
          </build>
        </model>
        """;

    // Plate 1 "Corners" holds objects 1 & 3; plate 2 "Base" holds object 2.
    private const string SettingsXml = """
        <?xml version="1.0" encoding="UTF-8"?>
        <config>
          <plate>
            <metadata key="plater_id" value="1"/>
            <metadata key="plater_name" value="Corners"/>
            <metadata key="thumbnail_file" value="Metadata/plate_1.png"/>
            <model_instance><metadata key="object_id" value="1"/></model_instance>
            <model_instance><metadata key="object_id" value="3"/></model_instance>
          </plate>
          <plate>
            <metadata key="plater_id" value="2"/>
            <metadata key="plater_name" value="Base"/>
            <metadata key="thumbnail_file" value="Metadata/plate_2.png"/>
            <model_instance><metadata key="object_id" value="2"/></model_instance>
          </plate>
        </config>
        """;

    private static byte[] BuildArchive(string? settingsXml)
    {
        using var stream = new MemoryStream();
        using (var archive = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
        {
            WriteEntry(archive, "3D/3dmodel.model", ModelXml);
            if (settingsXml != null) WriteEntry(archive, "Metadata/model_settings.config", settingsXml);
        }
        return stream.ToArray();
    }

    private static void WriteEntry(ZipArchive archive, string name, string content)
    {
        using var s = archive.CreateEntry(name).Open();
        using var w = new StreamWriter(s, new UTF8Encoding(false));
        w.Write(content);
    }

    [Fact]
    public void ParsesPlatesAndResolvesBuildItemIndices()
    {
        using var stream = new MemoryStream(BuildArchive(SettingsXml));

        var plates = BambuPlateParser.Parse(stream);

        Assert.Equal(2, plates.Count);
        Assert.Equal(1, plates[0].Index);
        Assert.Equal("Corners", plates[0].Name);
        Assert.Equal("Metadata/plate_1.png", plates[0].ThumbnailEntryName);
        Assert.Equal(new[] { 0, 2 }, plates[0].BuildItemIndices);   // objectids 1 & 3 → positions 0 & 2
        Assert.Equal(new[] { 1 }, plates[1].BuildItemIndices);       // objectid 2 → position 1
    }

    [Fact]
    public void ReturnsEmptyWhenNoSettingsConfig()
    {
        using var stream = new MemoryStream(BuildArchive(settingsXml: null));
        Assert.Empty(BambuPlateParser.Parse(stream));
    }
}
