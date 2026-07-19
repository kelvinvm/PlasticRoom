using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;

namespace PlasticRoom.Cli;

public static class ZipInspector
{
    public record InspectionResult(
        string GuessedDesigner,
        string GuessedModelName,
        IReadOnlyList<string> ThreeMfEntries,
        IReadOnlyList<string> StlEntries,
        IReadOnlyList<string> DocEntries);

    private static readonly string[] Separators = { " - ", "_", "-" };

    public static InspectionResult Inspect(string zipPath)
    {
        using var archive = ZipFile.OpenRead(zipPath);
        var fileEntries = archive.Entries.Where(e => !string.IsNullOrEmpty(e.Name)).ToList();

        var threeMf = fileEntries
            .Where(e => e.FullName.EndsWith(".3mf", StringComparison.OrdinalIgnoreCase))
            .Select(e => e.FullName).ToList();
        var stl = fileEntries
            .Where(e => e.FullName.EndsWith(".stl", StringComparison.OrdinalIgnoreCase))
            .Select(e => e.FullName).ToList();
        var docs = fileEntries
            .Where(e =>
                e.FullName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase) ||
                e.FullName.EndsWith(".txt", StringComparison.OrdinalIgnoreCase) ||
                e.Name.Contains("readme", StringComparison.OrdinalIgnoreCase))
            .Select(e => e.FullName).ToList();

        var nameSource = DetermineNameSource(fileEntries, zipPath);
        var (designer, model) = SplitDesignerAndModel(nameSource);

        return new InspectionResult(designer, model, threeMf, stl, docs);
    }

    private static string DetermineNameSource(List<ZipArchiveEntry> fileEntries, string zipPath)
    {
        if (fileEntries.Count > 0 && fileEntries.All(e => e.FullName.Contains('/')))
        {
            var topLevelFolders = fileEntries
                .Select(e => e.FullName.Split('/')[0])
                .Distinct()
                .ToList();

            if (topLevelFolders.Count == 1 && topLevelFolders[0].Length > 0)
            {
                return topLevelFolders[0];
            }
        }

        var fromFilename = Path.GetFileNameWithoutExtension(zipPath);
        return string.IsNullOrWhiteSpace(fromFilename) ? "unknown" : fromFilename;
    }

    private static (string Designer, string Model) SplitDesignerAndModel(string source)
    {
        foreach (var separator in Separators)
        {
            var idx = source.IndexOf(separator, StringComparison.Ordinal);
            if (idx <= 0)
            {
                continue;
            }

            var designer = source[..idx].Trim();
            var model = source[(idx + separator.Length)..].Trim();
            if (designer.Length > 0 && model.Length > 0)
            {
                return (designer, model);
            }
        }

        return ("unknown", source);
    }
}
