using PlasticRoom.Api.Data;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton<XpoSessionFactory>();
builder.Services.AddControllers();
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.AllowAnyOrigin().AllowAnyMethod().AllowAnyHeader();
    });
});

var app = builder.Build();

app.UseCors();
app.MapControllers();

app.Run();
