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
        io.WriteLine("show: not implemented yet");
        return 1;
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
