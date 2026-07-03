using System;
using System.Collections.Generic;
using Microsoft.AspNetCore.Http;

namespace PlasticRoom.Api.Dtos;

public record ModelFileDto(
    int Id,
    string Name,
    string Type,
    long SizeBytes,
    DateTime AddedAt,
    double? DimXMm,
    double? DimYMm,
    double? DimZMm,
    int? PlateCount,
    int? EstPrintTimeMin,
    string? Material,
    double? LayerHeightMm,
    string? SourceUrl,
    string? Creator,
    string? Description,
    string? ThumbnailPath,
    IReadOnlyList<int> FolderIds,
    IReadOnlyList<int> TagIds);

public class UploadFileRequest
{
    public IFormFile File { get; set; } = null!;

    public string? SourceUrl { get; set; }

    public string? Creator { get; set; }

    public List<int>? FolderIds { get; set; }

    public List<int>? TagIds { get; set; }
}

public record UpdateFileRequest(
    string? Description,
    string? Material,
    int? EstPrintTimeMin,
    double? LayerHeightMm,
    string? SourceUrl,
    string? Creator);

public record IdListRequest(List<int> Ids);
