using System.IO;

namespace PlasticRoom.Api.Parsing;

public static class StlMetadataParser
{
    public static ModelMetadata Parse(Stream stream)
    {
        using var reader = new BinaryReader(stream, System.Text.Encoding.ASCII, leaveOpen: true);
        reader.ReadBytes(80); // header, unused
        var triangleCount = reader.ReadUInt32();

        if (triangleCount == 0)
        {
            return new ModelMetadata(null, null, null, null);
        }

        var minX = double.MaxValue;
        var minY = double.MaxValue;
        var minZ = double.MaxValue;
        var maxX = double.MinValue;
        var maxY = double.MinValue;
        var maxZ = double.MinValue;

        for (var i = 0; i < triangleCount; i++)
        {
            reader.ReadBytes(12); // normal vector, unused

            for (var v = 0; v < 3; v++)
            {
                var x = reader.ReadSingle();
                var y = reader.ReadSingle();
                var z = reader.ReadSingle();

                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
                if (z < minZ) minZ = z;
                if (z > maxZ) maxZ = z;
            }

            reader.ReadUInt16(); // attribute byte count, unused
        }

        return new ModelMetadata(maxX - minX, maxY - minY, maxZ - minZ, null);
    }
}
