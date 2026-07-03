using System.Linq;
using DevExpress.Xpo;
using PlasticRoom.Api.Entities;

namespace PlasticRoom.Api.Data;

public static class FolderSeeder
{
    public static readonly string[] SystemFolderNames =
    {
        "Favorites",
        "Printed",
        "To Print",
        "Failed Prints",
    };

    public static void SeedSystemFolders(XpoSessionFactory sessionFactory)
    {
        using var session = sessionFactory.CreateSession();

        var existingNames = new XPCollection<Folder>(session)
            .Where(f => f.IsSystem)
            .Select(f => f.Name)
            .ToList();

        foreach (var name in SystemFolderNames)
        {
            if (!existingNames.Contains(name))
            {
                new Folder(session) { Name = name, IsSystem = true }.Save();
            }
        }
    }
}
