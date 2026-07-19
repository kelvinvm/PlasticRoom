using System;
using System.IO;
using System.Linq;
using DevExpress.Xpo;
using PlasticRoom.Api.Data;
using PlasticRoom.Api.Entities;

namespace PlasticRoom.Cli;

public static class ExportCommand
{
    public static int Run(string[] args, XpoSessionFactory sessionFactory, IConsoleIO io)
    {
        if (args.Length == 0)
        {
            io.WriteLine("Usage: plasticroom export <model-name> [--dest <path>]");
            return 1;
        }

        using var session = sessionFactory.CreateSession();
        var model = new XPCollection<Model>(session).Cast<Model>()
            .FirstOrDefault(m => m.Name.Equals(args[0], StringComparison.OrdinalIgnoreCase));

        if (model is null)
        {
            io.WriteLine($"Model '{args[0]}' not found.");
            return 1;
        }

        var destIdx = Array.IndexOf(args, "--dest");
        var destination = destIdx >= 0 && destIdx + 1 < args.Length
            ? args[destIdx + 1]
            : Path.Combine(Path.GetTempPath(), "plasticroom-export-" + Guid.NewGuid());

        Directory.CreateDirectory(destination);

        if (!Directory.Exists(model.DestinationPath))
        {
            io.WriteLine($"Model folder not found on disk: {model.DestinationPath}");
            return 1;
        }

        foreach (var sourceFile in Directory.EnumerateFiles(model.DestinationPath))
        {
            var destFile = Path.Combine(destination, Path.GetFileName(sourceFile));
            File.Copy(sourceFile, destFile, overwrite: true);
        }

        io.WriteLine($"Exported to: {destination}");
        return 0;
    }
}
