using System;
using System.IO;

namespace PlasticRoom.Api.Data;

public class FileStorage
{
    public string FilesDirectory { get; }

    public string ThumbsDirectory { get; }

    public FileStorage(string? dataPath = null)
    {
        var resolvedDataPath = dataPath
            ?? Environment.GetEnvironmentVariable("DATA_PATH")
            ?? "/data";

        FilesDirectory = Path.Combine(resolvedDataPath, "files");
        ThumbsDirectory = Path.Combine(resolvedDataPath, "thumbs");

        Directory.CreateDirectory(FilesDirectory);
        Directory.CreateDirectory(ThumbsDirectory);
    }
}
