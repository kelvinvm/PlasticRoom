using System.IO;
using PlasticRoom.Api.Parsing;
using Xunit;

namespace PlasticRoom.Api.Tests.Parsing;

public class StlMetadataParserTests
{
    private static byte[] BuildSingleTriangleStl(
        (float x, float y, float z) v1,
        (float x, float y, float z) v2,
        (float x, float y, float z) v3)
    {
        using var stream = new MemoryStream();
        using (var writer = new BinaryWriter(stream, System.Text.Encoding.ASCII, leaveOpen: true))
        {
            writer.Write(new byte[80]); // header
            writer.Write((uint)1); // triangle count

            // normal vector (unused by the parser)
            writer.Write(0f);
            writer.Write(0f);
            writer.Write(0f);

            foreach (var (x, y, z) in new[] { v1, v2, v3 })
            {
                writer.Write(x);
                writer.Write(y);
                writer.Write(z);
            }

            writer.Write((ushort)0); // attribute byte count
        }

        return stream.ToArray();
    }

    [Fact]
    public void ComputesBoundingBoxFromTriangleVertices()
    {
        var bytes = BuildSingleTriangleStl((0, 0, 0), (10, 5, 0), (0, 5, 2));
        using var stream = new MemoryStream(bytes);

        var metadata = StlMetadataParser.Parse(stream);

        Assert.Equal(10, metadata.DimXMm);
        Assert.Equal(5, metadata.DimYMm);
        Assert.Equal(2, metadata.DimZMm);
        Assert.Null(metadata.PlateCount);
    }

    [Fact]
    public void ReturnsNullDimensionsForZeroTriangles()
    {
        using var stream = new MemoryStream();
        using (var writer = new BinaryWriter(stream, System.Text.Encoding.ASCII, leaveOpen: true))
        {
            writer.Write(new byte[80]);
            writer.Write((uint)0);
        }

        stream.Position = 0;
        var metadata = StlMetadataParser.Parse(stream);

        Assert.Null(metadata.DimXMm);
        Assert.Null(metadata.DimYMm);
        Assert.Null(metadata.DimZMm);
    }
}
