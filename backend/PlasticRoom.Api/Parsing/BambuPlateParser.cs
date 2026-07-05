using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Xml.Linq;

namespace PlasticRoom.Api.Parsing;

// Parses Bambu Studio's Metadata/model_settings.config to recover real print
// plates. Returns [] for any 3MF without that file or without <plate> nodes.
public static class BambuPlateParser
{
    private static readonly XNamespace CoreNs = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02";

    public static IReadOnlyList<PlateInfo> Parse(Stream stream)
    {
        using var archive = new ZipArchive(stream, ZipArchiveMode.Read);
        var settingsEntry = archive.GetEntry("Metadata/model_settings.config");
        if (settingsEntry is null)
        {
            return Array.Empty<PlateInfo>();
        }

        // Ordered objectids of the root <build><item> elements → their position is the build-item index.
        var buildOrder = new List<string>();
        var modelEntry = archive.GetEntry("3D/3dmodel.model");
        if (modelEntry is not null)
        {
            using var modelStream = modelEntry.Open();
            var model = XDocument.Load(modelStream);
            var build = model.Root?.Element(CoreNs + "build");
            if (build is not null)
            {
                foreach (var item in build.Elements(CoreNs + "item"))
                {
                    buildOrder.Add(item.Attribute("objectid")?.Value ?? string.Empty);
                }
            }
        }

        using var settingsStream = settingsEntry.Open();
        var settings = XDocument.Load(settingsStream);

        var result = new List<PlateInfo>();
        foreach (var plateNode in settings.Root?.Elements("plate") ?? Enumerable.Empty<XElement>())
        {
            var index = 0;
            var name = string.Empty;
            string? thumbnail = null;

            foreach (var md in plateNode.Elements("metadata"))
            {
                var key = md.Attribute("key")?.Value;
                var value = md.Attribute("value")?.Value;
                if (key == "plater_id" && int.TryParse(value, out var pid)) index = pid;
                else if (key == "plater_name") name = value ?? string.Empty;
                else if (key == "thumbnail_file") thumbnail = value;
            }

            var objectIds = plateNode.Elements("model_instance")
                .Select(mi => mi.Elements("metadata")
                    .FirstOrDefault(m => m.Attribute("key")?.Value == "object_id")?.Attribute("value")?.Value)
                .Where(v => !string.IsNullOrEmpty(v))
                .ToHashSet();

            var indices = new List<int>();
            for (var i = 0; i < buildOrder.Count; i++)
            {
                if (objectIds.Contains(buildOrder[i])) indices.Add(i);
            }

            result.Add(new PlateInfo(index, name, thumbnail, indices));
        }

        return result;
    }
}
