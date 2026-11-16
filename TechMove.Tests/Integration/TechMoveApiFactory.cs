using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using TechMove.Core.Data;

namespace TechMove.Tests.Integration;

/// <summary>
/// Starts the real TechMove API in-process (real controllers, JWT auth, Swagger) and swaps
/// SQL Server for an isolated in-memory database, so the tests need no external services.
/// The API's own startup code seeds one client ("Lebo") and one Active contract.
/// </summary>
public class TechMoveApiFactory : WebApplicationFactory<Program>
{
    private readonly string _dbName = $"techmove_test_{Guid.NewGuid()}";

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Development");

        builder.ConfigureTestServices(services =>
        {
            var descriptor = services.SingleOrDefault(d =>
                d.ServiceType == typeof(DbContextOptions<AppDbContext>));
            if (descriptor != null)
                services.Remove(descriptor);

            services.AddDbContext<AppDbContext>(options =>
                options.UseInMemoryDatabase(_dbName));
        });
    }
}
