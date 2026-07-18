namespace PlasticRoom.Api.Dtos;

public record TagDto(int Id, string Name, string? ColorKey);

public record CreateTagRequest(string Name, string? ColorKey);

public record UpdateTagRequest(string Name, string? ColorKey);
