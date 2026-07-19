using System;
using System.Linq;
using DevExpress.Xpo;
using PlasticRoom.Api.Data;
using PlasticRoom.Api.Entities;

namespace PlasticRoom.Cli;

public static class QueryCommands
{
    public static int Find(string[] args, XpoSessionFactory sessionFactory, IConsoleIO io)
    {
        if (args.Length == 0)
        {
            io.WriteLine("Usage: plasticroom find <term>");
            return 1;
        }

        var term = args[0];
        using var session = sessionFactory.CreateSession();
        var matches = new XPCollection<Model>(session).Cast<Model>()
            .Where(m =>
                m.Name.Contains(term, StringComparison.OrdinalIgnoreCase) ||
                m.Designer.Name.Contains(term, StringComparison.OrdinalIgnoreCase) ||
                m.ModelTags.Any(mt => mt.Tag.Name.Contains(term, StringComparison.OrdinalIgnoreCase)))
            .ToList();

        if (matches.Count == 0)
        {
            io.WriteLine($"No models found matching '{term}'.");
            return 0;
        }

        foreach (var model in matches)
        {
            PrintModelSummary(model, io);
        }
        return 0;
    }

    public static int List(string[] args, XpoSessionFactory sessionFactory, IConsoleIO io)
    {
        if (args.Length == 0)
        {
            io.WriteLine("Usage: plasticroom list <designers|models|untagged> [--designer <name>] [--tag <name>]");
            return 1;
        }

        using var session = sessionFactory.CreateSession();

        switch (args[0])
        {
            case "designers":
                foreach (var designer in new XPCollection<Designer>(session))
                {
                    io.WriteLine($"{designer.Name} ({designer.Models.Count})");
                }
                return 0;

            case "models":
                var models = new XPCollection<Model>(session).Cast<Model>().AsEnumerable();
                var designerFilter = GetFlagValue(args, "--designer");
                var tagFilter = GetFlagValue(args, "--tag");

                if (designerFilter is not null)
                {
                    models = models.Where(m => m.Designer.Name.Equals(designerFilter, StringComparison.OrdinalIgnoreCase));
                }
                if (tagFilter is not null)
                {
                    models = models.Where(m => m.ModelTags.Any(mt => mt.Tag.Name.Equals(tagFilter, StringComparison.OrdinalIgnoreCase)));
                }

                foreach (var model in models)
                {
                    PrintModelSummary(model, io);
                }
                return 0;

            case "untagged":
                foreach (var model in new XPCollection<Model>(session).Cast<Model>().Where(m => m.ModelTags.Count == 0))
                {
                    PrintModelSummary(model, io);
                }
                return 0;

            default:
                io.WriteLine($"Unknown list target: {args[0]}");
                return 1;
        }
    }

    public static int Show(string[] args, XpoSessionFactory sessionFactory, IConsoleIO io)
    {
        if (args.Length == 0)
        {
            io.WriteLine("Usage: plasticroom show <model-name>");
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

        io.WriteLine($"{model.Name} — {model.Designer.Name}");
        var tags = string.Join(", ", model.ModelTags.Select(mt => mt.Tag.Name));
        io.WriteLine(tags.Length > 0 ? $"Tags: {tags}" : "Tags: (none — run 'tag' to add some)");
        io.WriteLine($"Folder: {model.DestinationPath}");

        io.WriteLine("Files:");
        var knownNames = new System.Collections.Generic.HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var file in model.Files)
        {
            io.WriteLine($"  {file.Name} ({file.Type})");
            knownNames.Add(file.Name);
        }

        if (System.IO.Directory.Exists(model.DestinationPath))
        {
            var extras = System.IO.Directory.EnumerateFiles(model.DestinationPath)
                .Select(System.IO.Path.GetFileName)
                .Where(name => name is not null && !knownNames.Contains(name))
                .ToList();

            if (extras.Count > 0)
            {
                io.WriteLine("Documents:");
                foreach (var name in extras)
                {
                    io.WriteLine($"  {name}");
                }
            }
        }

        return 0;
    }

    private static string? GetFlagValue(string[] args, string flag)
    {
        var idx = Array.IndexOf(args, flag);
        return idx >= 0 && idx + 1 < args.Length ? args[idx + 1] : null;
    }

    private static void PrintModelSummary(Model model, IConsoleIO io)
    {
        var tags = string.Join(", ", model.ModelTags.Select(mt => mt.Tag.Name));
        io.WriteLine($"{model.Name} — {model.Designer.Name}" + (tags.Length > 0 ? $" [{tags}]" : ""));
    }
}
