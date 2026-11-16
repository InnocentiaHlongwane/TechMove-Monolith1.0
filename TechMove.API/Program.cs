using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using System.Text;
using TechMove.API.Repositories;
using TechMove.Core.Data;
using TechMove.Core.Services;

var builder = WebApplication.CreateBuilder(args);

// Add services
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new() { Title = "TechMove API", Version = "v1.0" });

    // Lets you test protected endpoints from Swagger: log in via POST /api/auth/login,
    // click "Authorize" and paste the token.
    options.AddSecurityDefinition("Bearer", new Microsoft.OpenApi.Models.OpenApiSecurityScheme
    {
        Name = "Authorization",
        Type = Microsoft.OpenApi.Models.SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT",
        In = Microsoft.OpenApi.Models.ParameterLocation.Header,
        Description = "Paste the JWT returned by POST /api/auth/login"
    });
    options.AddSecurityRequirement(new Microsoft.OpenApi.Models.OpenApiSecurityRequirement
    {
        {
            new Microsoft.OpenApi.Models.OpenApiSecurityScheme
            {
                Reference = new Microsoft.OpenApi.Models.OpenApiReference
                {
                    Type = Microsoft.OpenApi.Models.ReferenceType.SecurityScheme,
                    Id = "Bearer"
                }
            },
            Array.Empty<string>()
        }
    });
});

// Configure JWT Authentication
var jwtSettings = builder.Configuration.GetSection("JwtSettings");
var secretKey = jwtSettings["SecretKey"] ?? throw new InvalidOperationException("JWT SecretKey not configured");
var key = Encoding.UTF8.GetBytes(secretKey);

builder.Services.AddAuthentication(options =>
{
    options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
    options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
})
.AddJwtBearer(options =>
{
    options.TokenValidationParameters = new TokenValidationParameters
    {
        ValidateIssuerSigningKey = true,
        IssuerSigningKey = new SymmetricSecurityKey(key),
        ValidateIssuer = true,
        ValidIssuer = jwtSettings["Issuer"] ?? "TechMove",
        ValidateAudience = true,
        ValidAudience = jwtSettings["Audience"] ?? "TechMoveApp",
        ValidateLifetime = true,
        ClockSkew = TimeSpan.Zero
    };
});

builder.Services.AddAuthorization();

// Configure SQL Server Database
var connectionString = builder.Configuration
.GetConnectionString("DefaultConnection");

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseSqlServer(
        connectionString,
        sqlOptions => sqlOptions.MigrationsAssembly("TechMove.API")
    ));

// Register repositories
builder.Services.AddScoped<IContractRepository, ContractRepository>();
builder.Services.AddScoped<IClientRepository, ClientRepository>();
builder.Services.AddScoped<IServiceRequestRepository, ServiceRequestRepository>();

// Add CORS for development
builder.Services.AddCors(options =>
{
    options.AddPolicy("AllowAll", builder =>
    {
        builder.AllowAnyOrigin()
               .AllowAnyMethod()
               .AllowAnyHeader();
    });
});

// Add HttpClient for services
builder.Services.AddHttpClient<CurrencyService>(client => client.Timeout = TimeSpan.FromSeconds(10));

var app = builder.Build();

// Configure middleware
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI(options =>
    {
        options.SwaggerEndpoint("/swagger/v1/swagger.json", "TechMove API v1");
    });
}

app.UseCors("AllowAll");
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();

// Apply migrations and seed data
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    // The only EF migrations in this solution are old SQLite ones (in TechMove.Web), so SQL Server
    // has none. Migrate() on its own would create an empty database and then fail on db.Clients.Any().
    // Use migrations when this project has them; otherwise create the schema directly.
    if (db.Database.IsRelational() && db.Database.GetMigrations().Any())
        db.Database.Migrate();
    else
        db.Database.EnsureCreated();

    // Seed sample data if database is empty
    if (!db.Clients.Any())
    {
        var client = new TechMove.Core.Models.Client
        {
            Name = "Lebo",
            ContactDetails = "lebo@example.com",
            Region = "South Africa"
        };
        db.Clients.Add(client);
        await db.SaveChangesAsync();

        var contract = new TechMove.Core.Models.Contract
        {
            ClientId = client.Id,
            StartDate = DateTime.UtcNow,
            EndDate = DateTime.UtcNow.AddYears(1),
            Status = TechMove.Core.Models.ContractStatus.Active,
            ServiceLevel = "Premium"
        };
        db.Contracts.Add(contract);
        await db.SaveChangesAsync();
    }
}

app.Run();

public partial class Program { }