using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Xml.Linq;

namespace PlasticRoom.Api.Parsing;

public static class ThreeMfMetadataParser
{
    private static readonly XNamespace CoreNs = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02";

    public static ModelMetadata Parse(Stream stream)
    {
        using var archive = new ZipArchive(stream, ZipArchiveMode.Read);
        var modelEntry = archive.GetEntry("3D/3dmodel.model")
            ?? throw new InvalidDataException("3D/3dmodel.model not found in 3MF archive");

        using var modelStream = modelEntry.Open();
        var doc = XDocument.Load(modelStream);
        var root = doc.Root ?? throw new InvalidDataException("3MF model file has no root element");

        var minX = double.MaxValue;
        var minY = double.MaxValue;
        var minZ = double.MaxValue;
        var maxX = double.MinValue;
        var maxY = double.MinValue;
        var maxZ = double.MinValue;
        var anyVertex = false;

        foreach (var vertex in root.Descendants(CoreNs + "vertex"))
        {
            anyVertex = true;
            var x = double.Parse(vertex.Attribute("x")!.Value, CultureInfo.InvariantCulture);
            var y = double.Parse(vertex.Attribute("y")!.Value, CultureInfo.InvariantCulture);
            var z = double.Parse(vertex.Attribute("z")!.Value, CultureInfo.InvariantCulture);

            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
            if (z < minZ) minZ = z;
            if (z > maxZ) maxZ = z;
        }

        var plateCount = root.Element(CoreNs + "build")?.Elements(CoreNs + "item").Count() ?? 0;

        if (!anyVertex)
        {
            return new ModelMetadata(null, null, null, plateCount);
        }

        return new ModelMetadata(maxX - minX, maxY - minY, maxZ - minZ, plateCount);
    }
}
