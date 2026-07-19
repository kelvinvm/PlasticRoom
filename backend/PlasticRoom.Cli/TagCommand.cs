using System;
using System.Linq;
using DevExpress.Xpo;
using PlasticRoom.Api.Data;
using PlasticRoom.Api.Entities;

namespace PlasticRoom.Cli;

public static class TagCommand
{
    public static int Run(string[] args, XpoSessionFactory sessionFactory, IConsoleIO io)
    {
        if (args.Length < 2)
        {
            io.WriteLine("Usage: plasticroom tag <model-name> <tag...>");
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

        var existingTagNames = model.ModelTags.Select(mt => mt.Tag.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);

        foreach (var tagName in args.Skip(1))
        {
            if (existingTagNames.Contains(tagName))
            {
                continue;
            }

            var tag = new XPCollection<Tag>(session).Cast<Tag>().FirstOrDefault(t => t.Name == tagName)
                ?? new Tag(session) { Name = tagName };
            tag.Save();

            new ModelTag(session) { Model = model, Tag = tag }.Save();
        }

        io.WriteLine($"Tagged '{model.Name}' with: {string.Join(", ", args.Skip(1))}");
        return 0;
    }
}
