using System.IO;
using System.IO.Compression;
using PlasticRoom.Api.Parsing;
using Xunit;

namespace PlasticRoom.Api.Tests.Parsing;

public class ThreeMfMetadataParserTests
{
    private const string ModelXml = """
        <?xml version="1.0" encoding="UTF-8"?>
        <model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
          <resources>
            <object id="1" type="model">
              <mesh>
                <vertices>
                  <vertex x="0" y="0" z="0" />
                  <vertex x="12.5" y="0" z="0" />
                  <vertex x="0" y="8" z="0" />
                  <vertex x="0" y="0" z="3.25" />
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

    private static byte[] BuildThreeMfArchive(string modelXml)
    {
        using var stream = new MemoryStream();
        using (var archive = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
        {
            var entry = archive.CreateEntry("3D/3dmodel.model");
            using var entryStream = entry.Open();
            using var writer = new StreamWriter(entryStream);
            writer.Write(modelXml);
        }

        return stream.ToArray();
    }

    [Fact]
    public void ComputesBoundingBoxAndPlateCountFromModelXml()
    {
        var bytes = BuildThreeMfArchive(ModelXml);
        using var stream = new MemoryStream(bytes);

        var metadata = ThreeMfMetadataParser.Parse(stream);

        Assert.Equal(12.5, metadata.DimXMm);
        Assert.Equal(8, metadata.DimYMm);
        Assert.Equal(3.25, metadata.DimZMm);
        Assert.Equal(1, metadata.PlateCount);
    }

    [Fact]
    public void ThrowsWhenModelEntryIsMissing()
    {
        using var stream = new MemoryStream();
        using (var archive = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
        {
            archive.CreateEntry("Metadata/unrelated.txt");
        }

        stream.Position = 0;

        Assert.Throws<InvalidDataException>(() => ThreeMfMetadataParser.Parse(stream));
    }
}
