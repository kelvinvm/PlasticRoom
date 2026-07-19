using System;
using System.IO;

namespace PlasticRoom.Cli;

public class LibraryPaths
{
    public string RootDirectory { get; }

    public LibraryPaths(string? root = null)
    {
        RootDirectory = root
            ?? Environment.GetEnvironmentVariable("LIBRARY_ROOT")
            ?? throw new InvalidOperationException(
                "LIBRARY_ROOT must be set (or pass a root path) so the CLI knows where to file imported models.");

        Directory.CreateDirectory(RootDirectory);
    }
}
