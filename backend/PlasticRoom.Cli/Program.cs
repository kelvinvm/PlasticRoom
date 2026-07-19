using PlasticRoom.Api.Data;
using PlasticRoom.Cli;

var sessionFactory = new XpoSessionFactory();
var libraryPaths = new LibraryPaths();
var io = new SystemConsoleIO();

return Cli.Dispatch(args, sessionFactory, libraryPaths, io);

namespace PlasticRoom.Cli
{
    public static class Cli
    {
        public static int Dispatch(string[] args, XpoSessionFactory sessionFactory, LibraryPaths libraryPaths, IConsoleIO io)
        {
            if (args.Length == 0)
            {
                PrintUsage(io);
                return 1;
            }

            var rest = args[1..];
            switch (args[0])
            {
                case "import":
                    return ImportCommand.Run(rest, sessionFactory, libraryPaths, io);
                case "find":
                    return QueryCommands.Find(rest, sessionFactory, io);
                case "list":
                    return QueryCommands.List(rest, sessionFactory, io);
                case "show":
                    return QueryCommands.Show(rest, sessionFactory, io);
                case "tag":
                    return TagCommand.Run(rest, sessionFactory, io);
                case "export":
                    return ExportCommand.Run(rest, sessionFactory, io);
                default:
                    io.WriteLine($"Unknown command: {args[0]}");
                    PrintUsage(io);
                    return 1;
            }
        }

        private static void PrintUsage(IConsoleIO io)
        {
            io.WriteLine("Usage: plasticroom <command> [args]");
            io.WriteLine("Commands:");
            io.WriteLine("  import <zip-path>");
            io.WriteLine("  find <term>");
            io.WriteLine("  list designers");
            io.WriteLine("  list models --designer <name> | --tag <name>");
            io.WriteLine("  list untagged");
            io.WriteLine("  show <model-name>");
            io.WriteLine("  tag <model-name> <tag...>");
            io.WriteLine("  export <model-name> [--dest <path>]");
        }
    }
}
