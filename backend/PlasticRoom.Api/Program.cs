using PlasticRoom.Api.Data;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton<XpoSessionFactory>();
builder.Services.AddSingleton<FileStorage>();
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

if (SampleDataSeeder.IsEnabled())
{
    SampleDataSeeder.Seed(
        app.Services.GetRequiredService<XpoSessionFactory>(),
        app.Services.GetRequiredService<FileStorage>());
}

app.UseCors();
app.MapControllers();

app.Run();
