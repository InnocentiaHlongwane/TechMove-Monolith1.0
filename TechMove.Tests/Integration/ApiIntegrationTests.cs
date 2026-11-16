using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using TechMove.API.Dtos;
using Xunit;

namespace TechMove.Tests.Integration;

/// <summary>
/// Integration tests: each test calls the API over HTTP and asserts on the real response.
/// Protected endpoints need a JWT, so tests log in first through POST /api/auth/login.
/// </summary>
public class ApiIntegrationTests : IClassFixture<TechMoveApiFactory>
{
    private readonly TechMoveApiFactory _factory;

    public ApiIntegrationTests(TechMoveApiFactory factory) => _factory = factory;

    // ---------- helpers ----------

    private async Task<HttpClient> CreateAuthenticatedClientAsync()
    {
        var client = _factory.CreateClient();
        var response = await client.PostAsJsonAsync("/api/auth/login",
            new { username = "admin", password = "admin123" });
        response.EnsureSuccessStatusCode();

        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var token = doc.RootElement.GetProperty("token").GetString();
        Assert.False(string.IsNullOrWhiteSpace(token));

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static async Task<int> GetSeededClientIdAsync(HttpClient client)
    {
        var clients = await client.GetFromJsonAsync<List<ClientDto>>("/api/clients");
        Assert.NotNull(clients);
        Assert.NotEmpty(clients!);
        return clients![0].Id;
    }

    private static MultipartFormDataContent BuildContractForm(
        int clientId, string fileName = "agreement.pdf", string contentType = "application/pdf")
    {
        var form = new MultipartFormDataContent
        {
            { new StringContent(clientId.ToString()), "ClientId" },
            { new StringContent("2026-01-01"), "StartDate" },
            { new StringContent("2026-12-31"), "EndDate" },
            { new StringContent("Standard"), "ServiceLevel" }
        };

        var file = new ByteArrayContent(Encoding.ASCII.GetBytes("%PDF-1.4 integration test"));
        file.Headers.ContentType = new MediaTypeHeaderValue(contentType);
        form.Add(file, "signedAgreement", fileName);
        return form;
    }

    private static async Task<ContractDto> CreateDraftContractAsync(HttpClient client)
    {
        var clientId = await GetSeededClientIdAsync(client);
        var response = await client.PostAsync("/api/contracts", BuildContractForm(clientId));
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);

        var contract = await response.Content.ReadFromJsonAsync<ContractDto>();
        Assert.NotNull(contract);
        return contract!;
    }

    // ---------- authentication ----------

    [Fact]
    public async Task Login_WithValidCredentials_ReturnsToken()
    {
        var response = await _factory.CreateClient().PostAsJsonAsync("/api/auth/login",
            new { username = "admin", password = "admin123" });

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var doc = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.False(string.IsNullOrWhiteSpace(doc.RootElement.GetProperty("token").GetString()));
    }

    [Fact]
    public async Task Login_WithWrongPassword_ReturnsUnauthorized()
    {
        var response = await _factory.CreateClient().PostAsJsonAsync("/api/auth/login",
            new { username = "admin", password = "wrong-password" });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task ProtectedEndpoint_WithoutToken_ReturnsUnauthorized()
    {
        var response = await _factory.CreateClient().GetAsync("/api/contracts");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    // ---------- contracts ----------

    [Fact]
    public async Task GetContracts_ReturnsOkAndNonNullJson()
    {
        var client = await CreateAuthenticatedClientAsync();

        var response = await client.GetAsync("/api/contracts");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var contracts = await response.Content.ReadFromJsonAsync<List<ContractDto>>();
        Assert.NotNull(contracts);
        Assert.NotEmpty(contracts!);
    }

    [Fact]
    public async Task GetContracts_FilterByStatus_ReturnsOnlyThatStatus()
    {
        var client = await CreateAuthenticatedClientAsync();

        var contracts = await client.GetFromJsonAsync<List<ContractDto>>("/api/contracts?status=Active");

        Assert.NotNull(contracts);
        Assert.NotEmpty(contracts!);
        Assert.All(contracts!, c => Assert.Equal("Active", c.Status));
    }

    [Fact]
    public async Task GetContracts_FilterByFutureStartDate_ReturnsEmptyList()
    {
        var client = await CreateAuthenticatedClientAsync();

        var response = await client.GetAsync("/api/contracts?startDate=2999-01-01");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var contracts = await response.Content.ReadFromJsonAsync<List<ContractDto>>();
        Assert.NotNull(contracts);
        Assert.Empty(contracts!);
    }

    [Fact]
    public async Task GetContract_UnknownId_ReturnsNotFound()
    {
        var client = await CreateAuthenticatedClientAsync();

        var response = await client.GetAsync("/api/contracts/999999");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task CreateContract_WithPdf_ReturnsCreatedDraftContract()
    {
        var client = await CreateAuthenticatedClientAsync();

        var contract = await CreateDraftContractAsync(client);

        Assert.True(contract.Id > 0);
        Assert.Equal("Draft", contract.Status);
        Assert.Equal("Standard", contract.ServiceLevel);
    }

    [Fact]
    public async Task CreateContract_WithNonPdfFile_ReturnsBadRequest()
    {
        var client = await CreateAuthenticatedClientAsync();
        var clientId = await GetSeededClientIdAsync(client);

        var response = await client.PostAsync("/api/contracts",
            BuildContractForm(clientId, "notes.txt", "text/plain"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task UpdateContractStatus_ValidTransition_ReturnsUpdatedContract()
    {
        var client = await CreateAuthenticatedClientAsync();
        var contract = await CreateDraftContractAsync(client);

        var request = new HttpRequestMessage(HttpMethod.Patch, $"/api/contracts/{contract.Id}/status")
        {
            Content = JsonContent.Create(new { status = "Active" })
        };
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var updated = await response.Content.ReadFromJsonAsync<ContractDto>();
        Assert.Equal("Active", updated!.Status);
    }

    [Fact]
    public async Task UpdateContractStatus_InvalidTransition_ReturnsBadRequest()
    {
        var client = await CreateAuthenticatedClientAsync();
        var contract = await CreateDraftContractAsync(client);

        // Draft -> Expired is not allowed by the contract workflow.
        var request = new HttpRequestMessage(HttpMethod.Patch, $"/api/contracts/{contract.Id}/status")
        {
            Content = JsonContent.Create(new { status = "Expired" })
        };
        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    // ---------- clients ----------

    [Fact]
    public async Task GetClients_ReturnsOkAndNonNullJson()
    {
        var client = await CreateAuthenticatedClientAsync();

        var response = await client.GetAsync("/api/clients");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var clients = await response.Content.ReadFromJsonAsync<List<ClientDto>>();
        Assert.NotNull(clients);
        Assert.NotEmpty(clients!);
    }

    [Fact]
    public async Task CreateClient_ReturnsCreatedAndClientCanBeFetched()
    {
        var client = await CreateAuthenticatedClientAsync();

        var response = await client.PostAsJsonAsync("/api/clients", new
        {
            name = "Integration Test Client",
            contactDetails = "tests@example.com",
            region = "Gauteng"
        });

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var created = await response.Content.ReadFromJsonAsync<ClientDto>();
        Assert.NotNull(created);

        var fetched = await client.GetFromJsonAsync<ClientDto>($"/api/clients/{created!.Id}");
        Assert.Equal("Integration Test Client", fetched!.Name);
    }

    // ---------- service requests ----------

    [Fact]
    public async Task CreateServiceRequest_ThenListByContract_ReturnsIt()
    {
        var client = await CreateAuthenticatedClientAsync();
        var contracts = await client.GetFromJsonAsync<List<ContractDto>>("/api/contracts");
        var contractId = contracts![0].Id;

        var createResponse = await client.PostAsJsonAsync("/api/servicerequests", new
        {
            contractId,
            description = "Integration test request",
            cost = 1500.50m,
            currency = "ZAR"
        });
        Assert.Equal(HttpStatusCode.Created, createResponse.StatusCode);

        var requests = await client.GetFromJsonAsync<List<ServiceRequestDto>>(
            $"/api/servicerequests/contract/{contractId}");
        Assert.NotNull(requests);
        Assert.Contains(requests!, r => r.Description == "Integration test request");
    }

    // ---------- Swagger ----------

    [Fact]
    public async Task Swagger_DocumentIsAvailable()
    {
        var response = await _factory.CreateClient().GetAsync("/swagger/v1/swagger.json");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var json = await response.Content.ReadAsStringAsync();
        Assert.Contains("/api/contracts", json, StringComparison.OrdinalIgnoreCase);
    }
}
