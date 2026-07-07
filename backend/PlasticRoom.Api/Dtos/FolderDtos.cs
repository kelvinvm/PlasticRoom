namespace PlasticRoom.Api.Dtos;

public record FolderDto(
    int Id,
    string Name,
    int? ParentId,
    string? Description,
    int? CoverImageFileId,
    int SortOrder,
    bool IsSystem,
    int FileCount);

public record CreateFolderRequest(string Name, int? ParentId, string? Description);

public record UpdateFolderRequest(
    string? Name,
    int? ParentId,
    string? Description,
    int? SortOrder,
    int? CoverImageFileId);
