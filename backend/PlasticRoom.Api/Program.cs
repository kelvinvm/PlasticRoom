using PlasticRoom.Api.Data;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton<XpoSessionFactory>();
// builder.Services.AddSingleton<FileStorage>(); // uncommented in Task 7
builder.Services.AddControllers();
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader();
    });
});

var app = builder.Build();

FolderSeeder.SeedSystemFolders(app.Services.GetRequiredService<XpoSessionFactory>());

app.UseCors();
app.MapControllers();

app.Run();
