using System.Collections.Generic;

namespace PlasticRoom.Api.Parsing;

public record PlateInfo(int Index, string Name, string? ThumbnailEntryName, IReadOnlyList<int> BuildItemIndices);
