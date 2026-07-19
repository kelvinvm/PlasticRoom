using System;
using System.IO;
using System.IO.Compression;
using System.Linq;
using DevExpress.Xpo;
using PlasticRoom.Api.Data;
using PlasticRoom.Api.Entities;
using PlasticRoom.Api.Parsing;

namespace PlasticRoom.Cli;

public static class ImportCommand
{
    public static int Run(string[] args, XpoSessionFactory sessionFactory, LibraryPaths libraryPaths, IConsoleIO io)
    {
        if (args.Length == 0 || !File.Exists(args[0]))
        {
            io.WriteLine("Usage: plasticroom import <path-to-zip>");
            return 1;
        }

        var zipPath = args[0];
        var inspection = ZipInspector.Inspect(zipPath);

        io.WriteLine($"Found {inspection.ThreeMfEntries.Count} 3MF, {inspection.StlEntries.Count} STL, {inspection.DocEntries.Count} doc file(s).");

        var designerName = Prompt(io, $"Designer [{inspection.GuessedDesigner}]: ", inspection.GuessedDesigner);
        var modelName = Prompt(io, $"Model name [{inspection.GuessedModelName}]: ", inspection.GuessedModelName);

        var defaultDestination = Path.Combine(libraryPaths.RootDirectory, designerName, modelName);
        var destinationInput = Prompt(io, $"Destination [{defaultDestination}]: ", string.Empty);
        var destination = string.IsNullOrWhiteSpace(destinationInput) ? defaultDestination : destinationInput;

        var confirmInput = Prompt(io, "Import? [Y/n]: ", "y");
        if (!confirmInput.Trim().Equals("y", StringComparison.OrdinalIgnoreCase))
        {
            io.WriteLine("Import cancelled.");
            return 1;
        }

        var tempExtractDir = Path.Combine(Path.GetTempPath(), "plasticroom-import-" + Guid.NewGuid());
        Directory.CreateDirectory(tempExtractDir);
        ZipFile.ExtractToDirectory(zipPath, tempExtractDir);

        Directory.CreateDirectory(destination);
        foreach (var sourceFile in Directory.EnumerateFiles(tempExtractDir, "*", SearchOption.AllDirectories))
        {
            var destFile = Path.Combine(destination, Path.GetFileName(sourceFile));
            File.Move(sourceFile, destFile, overwrite: true);
        }
        Directory.Delete(tempExtractDir, recursive: true);

        using var session = sessionFactory.CreateSession();

        var designer = new XPCollection<Designer>(session).Cast<Designer>().FirstOrDefault(d => d.Name == designerName)
            ?? new Designer(session) { Name = designerName };
        designer.Save();

        var model = new Model(session)
        {
            Name = modelName,
            Designer = designer,
            DestinationPath = destination,
        };
        model.Save();

        foreach (var filePath in Directory.EnumerateFiles(destination))
        {
            var extension = Path.GetExtension(filePath).ToLowerInvariant();
            if (extension != ".3mf" && extension != ".stl")
            {
                continue;
            }

            var type = extension == ".3mf" ? ModelFileType.ThreeMf : ModelFileType.Stl;
            var modelFile = new ModelFile(session)
            {
                Name = Path.GetFileName(filePath),
                Type = type,
                SizeBytes = new FileInfo(filePath).Length,
                AddedAt = DateTime.UtcNow,
                StoragePath = filePath,
                Model = model,
            };

            try
            {
                using var stream = File.OpenRead(filePath);
                var metadata = type == ModelFileType.ThreeMf
                    ? ThreeMfMetadataParser.Parse(stream)
                    : StlMetadataParser.Parse(stream);
                modelFile.DimXMm = metadata.DimXMm;
                modelFile.DimYMm = metadata.DimYMm;
                modelFile.DimZMm = metadata.DimZMm;
                modelFile.PlateCount = metadata.PlateCount;
            }
            catch (Exception ex)
            {
                io.WriteLine($"Warning: could not parse metadata for {modelFile.Name}: {ex.Message}");
            }

            modelFile.Save();
        }

        var tagsInput = Prompt(io, "Tags (comma-separated, blank to skip): ", string.Empty);
        if (!string.IsNullOrWhiteSpace(tagsInput))
        {
            foreach (var rawTagName in tagsInput.Split(',', StringSplitOptions.RemoveEmptyEntries))
            {
                var tagName = rawTagName.Trim();
                if (tagName.Length == 0)
                {
                    continue;
                }

                var tag = new XPCollection<Tag>(session).Cast<Tag>().FirstOrDefault(t => t.Name == tagName)
                    ?? new Tag(session) { Name = tagName };
                tag.Save();

                new ModelTag(session) { Model = model, Tag = tag }.Save();
            }
        }

        io.WriteLine($"Imported '{modelName}' by {designerName} into {destination}.");
        return 0;
    }

    private static string Prompt(IConsoleIO io, string message, string defaultValue)
    {
        io.WriteLine(message);
        var input = io.ReadLine();
        return string.IsNullOrWhiteSpace(input) ? defaultValue : input.Trim();
    }
}
