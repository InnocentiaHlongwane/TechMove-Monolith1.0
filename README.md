# TechMove

A contract and service-request management system for a logistics company, built with .NET 8 as three separate tiers that run together in Docker.

| Tier | Project | Role |
|------|---------|------|
| Database | `sql-server-db` container | SQL Server 2022 |
| Service layer | `TechMove.API` | ASP.NET Core Web API. The **only** component that talks to the database. Issues and validates JWTs. |
| Presentation layer | `TechMove.Web` | ASP.NET Core MVC front end. Has **no database access** and calls the API through `HttpClient`. |
| Shared code | `TechMove.Core` | Models, `DbContext`, repository interfaces, contract workflow rules, PDF upload validation, currency service. |
| Tests | `TechMove.Tests` | Unit tests and API integration tests (xUnit). |

Separating the presentation layer from the service layer lets each one be deployed and scaled independently.

## Architecture

```
 Browser ──► glms-frontend-web (MVC, :8081) ──HttpClient + JWT──► glms-backend-api (Web API, :8082) ──► sql-server-db (:1433)
```

All three containers share an internal Docker network (`techmove-network`) and reach each other by service name, for example the front end calls `http://glms-backend-api:8080`.

## Features

- Clients, contracts and service requests with full create / read / update / delete through the API
- Contract filtering by start date, end date and status
- Contract workflow rules (e.g. Draft → Active → OnHold / Expired) enforced by the API
- Signed agreement upload (PDF only) and download
- Service-request costs converted from USD to ZAR using a live exchange rate
- JWT authentication: the MVC app logs in through the API and attaches the token to every API call
- Swagger / OpenAPI documentation with an **Authorize** button for testing protected endpoints

## Technology stack

.NET 8 · ASP.NET Core Web API · ASP.NET Core MVC · Entity Framework Core 8 · SQL Server 2022 · JWT Bearer authentication · Swagger (Swashbuckle) · xUnit and `WebApplicationFactory` · Docker Compose · GitHub Actions

## Project structure

```
TechMoveMonolith/
├── TechMove.API/            Web API: controllers, repositories, DTOs, JWT, Swagger, Dockerfile
├── TechMove.Web/            MVC front end: controllers, views, API client services, Dockerfile
├── TechMove.Core/           Shared models, AppDbContext, interfaces, workflow and validation services
├── TechMove.Tests/          Unit tests + Integration/ (API integration tests)
├── docker-compose.yml       Starts the whole ecosystem
├── .env.example             Template for the required environment variables
├── API_ENDPOINTS_REFERENCE.md   Full endpoint documentation
└── .github/workflows/ci.yml     Build and test pipeline
```

## Running with Docker (recommended)

Prerequisite: Docker Desktop.

1. Copy `.env.example` to `.env` and set a strong `MSSQL_SA_PASSWORD` (8+ characters with upper case, lower case, a digit and a symbol).
2. From the solution folder run:
   ```
   docker compose up --build
   ```
3. Open the app:

| What | URL |
|------|-----|
| MVC front end | http://localhost:8081 |
| Web API Swagger UI | http://localhost:8082/swagger |

The API creates the database and seeds one sample client and contract on first start.

Useful commands:

```
docker compose ps                          # are all three containers up?
docker compose logs glms-backend-api       # API logs (startup / database errors show here)
docker compose down                        # stop
docker compose down -v                     # stop and delete the database and uploaded files
```

| Container | Service | Port (host → container) |
|-----------|---------|-------------------------|
| `sql-server-db` | SQL Server database | 1433 → 1433 |
| `glms-backend-api` | Web API | 8082 → 8080 |
| `glms-frontend-web` | MVC app | 8081 → 8080 |

## Running locally without Docker

Prerequisites: .NET 8 SDK and SQL Server LocalDB (installed with Visual Studio), or any SQL Server instance.

1. Trust the HTTPS development certificate once: `dotnet dev-certs https --trust`
2. Check the connection string in `TechMove.API/appsettings.json` (defaults to LocalDB). To use another server, override it without editing the file:
   ```
   dotnet user-secrets init --project TechMove.API
   dotnet user-secrets set "ConnectionStrings:DefaultConnection" "<your connection string>" --project TechMove.API
   ```
3. Start **both** projects (in Visual Studio use *Configure Startup Projects → Multiple startup projects*, or run each in its own terminal):
   ```
   dotnet run --project TechMove.API   # https://localhost:56373
   dotnet run --project TechMove.Web   # https://localhost:56335
   ```

In development the MVC app reaches the API at `https://localhost:56373` (set in `TechMove.Web/appsettings.Development.json`). If the login page says *"Unable to connect to authentication service"*, the API is not running or its address does not match.

## Logging in

The login page uses demo accounts defined in `TechMove.API/Controllers/AuthController.cs`:

| Username | Password |
|----------|----------|
| `admin` | `admin123` |
| `user` | `user123` |
| `lebo` | `password123` |

These are demo credentials for coursework. Replace them with a real user store and hashed passwords before any real deployment.

To call the API directly: `POST /api/auth/login` with `{ "username": "admin", "password": "admin123" }`, then send the returned token as `Authorization: Bearer <token>`, or paste it into Swagger's **Authorize** dialog.

## API overview

All endpoints except login require a JWT. Full request and response examples are in [`API_ENDPOINTS_REFERENCE.md`](API_ENDPOINTS_REFERENCE.md).

| Resource | Endpoints |
|----------|-----------|
| Auth | `POST /api/auth/login` |
| Contracts | `GET /api/contracts` (filters: `startDate`, `endDate`, `status`), `GET /api/contracts/{id}`, `POST /api/contracts` (multipart form with PDF), `PATCH /api/contracts/{id}/status`, `GET /api/contracts/{id}/download` |
| Clients | `GET`, `GET /{id}`, `POST`, `PUT /{id}`, `DELETE /{id}` on `/api/clients` |
| Service requests | `GET`, `GET /contract/{contractId}`, `GET /{id}`, `POST`, `PUT /{id}`, `DELETE /{id}` on `/api/servicerequests` |

## Configuration

| Setting | Where | Notes |
|---------|-------|-------|
| `MSSQL_SA_PASSWORD` | `.env` | Required by Docker Compose |
| `JWT_SECRET_KEY` | `.env` (optional) | 32+ characters. A development default is used if not set. **Set your own for any real deployment.** |
| `ConnectionStrings__DefaultConnection` | Set by `docker-compose.yml` | Overrides `appsettings.json` in Docker |
| `ApiSettings__BaseUrl` | Set by `docker-compose.yml` | Where the MVC app finds the API |

`.env` is listed in `.gitignore`; never commit it.

## Testing

```
dotnet test
```

- **Unit tests**: PDF upload validation, contract workflow rules and currency rounding.
- **Integration tests** (`TechMove.Tests/Integration`): start the real API in-process with `WebApplicationFactory`, log in to get a JWT, then call the endpoints and assert on the responses. They cover login (success, wrong password), the `401` for requests without a token, `GET /api/contracts` returning `200 OK` with non-null JSON, filtering by status and date, creating contracts (valid PDF and rejected non-PDF), status transitions (valid and invalid), clients, service requests, and the Swagger document. An in-memory database replaces SQL Server, so no external services are needed.

The GitHub Actions workflow in `.github/workflows/ci.yml` runs the build and all tests on every push and pull request, so breaking changes are caught before deployment.

## Troubleshooting

| Problem | What to check |
|---------|---------------|
| *"Unable to connect to authentication service"* on the login page | The API is not running or unreachable. Run `docker compose ps` and `docker compose logs glms-backend-api`, or confirm both projects are started locally. |
| API container keeps restarting | Read its logs. Usually the database is not ready, or `MSSQL_SA_PASSWORD` is too weak for SQL Server. |
| Pages are empty after logging in | The token may have expired. Log out and log in again. |
| Database seems stuck in a bad state | `docker compose down -v` and start again to recreate the database. |

## Known limitations and next steps

- Demo users are hardcoded; a real user table with hashed passwords (e.g. ASP.NET Identity) is the next step.
- The schema is created with `EnsureCreated()` because the API has no SQL Server migrations yet. To add them: `dotnet ef migrations add InitialCreate -p TechMove.API -s TechMove.API`. The API then switches to using migrations automatically.
- Uploaded PDFs are stored on a Docker volume; use blob storage for production.

# TechMove MVC Refactoring - API Client & Authentication Implementation

## Overview

This refactoring separates the **Presentation Layer (TechMove.Web MVC)** from the **Service/Data Layer (TechMove.API)** by implementing:

1. **HTTP-based API Clients** - Typed HttpClient services for API communication
2. **JWT Authentication** - Token-based authentication for secure API access
3. **Session-based Token Storage** - Secure handling of JWT tokens on the MVC client

## Architecture Changes

### Before Refactoring
```
TechMove.Web (MVC)
  ├── Direct DbContext Access
  ├── Direct Database Operations
  └── Mixed Presentation & Data Logic
```

### After Refactoring
```
TechMove.Web (MVC)
  ├── Controllers (UI Logic Only)
  ├── API Client Services (HttpClient)
  ├── Authentication Service
  └── Session Token Storage
		 ↓ (HTTPS REST API)
TechMove.API (REST API)
  ├── Controllers (Endpoints)
  ├── Authentication (JWT)
  ├── Repositories (Data Access)
  └── Database (SQLite)
```

## Key Features

### 1. API Client Services

Three typed HTTP clients replace direct database access:

- **`IContractApiClient`** - Manages contracts via `api/contracts` endpoints
- **`IClientApiClient`** - Manages clients via `api/clients` endpoints
- **`IServiceRequestApiClient`** - Manages service requests via `api/servicerequests` endpoints

**Benefits:**
- Centralized HTTP communication logic
- Consistent error handling and logging
- Automatic token injection via `AuthenticatedHttpClientHandler`
- Dependency injection support

### 2. Authentication Flow

#### Login Process
```
User Login Form (MVC)
	↓
LoginController.Login()
	↓
POST /api/auth/login (API)
	↓
JWT Token Generated
	↓
Token Stored in Session
	↓
Redirect to Dashboard
```

#### Protected API Requests
```
MVC Controller Action
	↓
Inject IContractApiClient (or other)
	↓
Service HttpClient sends request
	↓
AuthenticatedHttpClientHandler retrieves token from session
	↓
Adds "Authorization: Bearer {token}" header
	↓
API receives request with token
	↓
[Authorize] validates token
	↓
API returns data (or 401 if invalid token)
```

#### Demo Credentials
```
Username: admin     Password: admin123
Username: user      Password: user123
Username: lebo      Password: password123
```

## Project Structure

### TechMove.Web Changes

**New Files:**
- `Services/IAuthenticationService.cs` - Token management interface
- `Services/AuthenticationService.cs` - Session-based token storage
- `Services/AuthenticatedHttpClientHandler.cs` - Auto-injects JWT to API requests
- `Services/IContractApiClient.cs` - Contract API client interface
- `Services/ContractApiClient.cs` - Contract HTTP client implementation
- `Services/IClientApiClient.cs` - Client API client interface
- `Services/ClientApiClient.cs` - Client HTTP client implementation
- `Services/IServiceRequestApiClient.cs` - Service request API client interface
- `Services/ServiceRequestApiClient.cs` - Service request HTTP client implementation
- `Controllers/LoginController.cs` - Authentication controller
- `Controllers/ContractsController.cs` - Refactored to use API client
- `Controllers/ClientsController.cs` - Refactored to use API client
- `Controllers/ServiceRequestsController.cs` - Refactored to use API client

**Modified Files:**
- `Program.cs` - Added session configuration, authentication services, and API client registration with message handler
- `appsettings.json` - Changed from database connection to API base URL

**Removed Functionality:**
- Direct Entity Framework DbContext usage
- Database seeding in MVC startup

### TechMove.API Changes

**New Files:**
- `Controllers/AuthController.cs` - JWT token generation endpoint

**Modified Files:**
- `Program.cs` - Added JWT authentication configuration, bearer scheme setup
- `Controllers/ContractsController.cs` - Added `[Authorize]` attribute
- `Controllers/ClientsController.cs` - Added `[Authorize]` attribute
- `Controllers/ServiceRequestsController.cs` - Added `[Authorize]` attribute
- `appsettings.json` - Added JWT configuration section

**New Packages:**
- `Microsoft.AspNetCore.Authentication.JwtBearer` (v8.0.0)
- `System.IdentityModel.Tokens.Jwt` (v7.0.3)

## Configuration

### MVC Configuration (appsettings.json)
```json
{
  "ApiSettings": {
	"BaseUrl": "https://localhost:56373"
  },
  "Logging": { ... }
}
```

### API Configuration (appsettings.json)
```json
{
  "JwtSettings": {
	"SecretKey": "your-secret-key-change-this-in-production-to-at-least-32-characters",
	"Issuer": "TechMove",
	"Audience": "TechMoveApp",
	"ExpirationMinutes": 60
  },
  "ConnectionStrings": {
	"DefaultConnection": "Data Source=techmove.db"
  }
}
```

## Running the Application

### Step 1: Start the API
```powershell
cd TechMove.API
dotnet run
# API runs at https://localhost:56373
# Swagger at https://localhost:56373/swagger
```

### Step 2: Start the MVC Web App
```powershell
cd ../TechMove.Web
dotnet run
# Web runs at https://localhost:port (typically 7xxx range)
```

### Step 3: Login
1. Navigate to the web application
2. Click "Login" or go to `/login`
3. Use demo credentials above
4. After login, token is stored in session
5. Navigate to Contracts, Clients, or Service Requests

## API Endpoints

### Authentication
- `POST /api/auth/login` - Get JWT token (Authorization: None required)

### Contracts (Authorization: Bearer token required)
- `GET /api/contracts` - List contracts with optional filters
- `GET /api/contracts/{id}` - Get specific contract
- `POST /api/contracts` - Create new contract
- `PATCH /api/contracts/{id}/status` - Update contract status
- `GET /api/contracts/{id}/download` - Download contract PDF

### Clients (Authorization: Bearer token required)
- `GET /api/clients` - List all clients
- `GET /api/clients/{id}` - Get specific client
- `POST /api/clients` - Create new client
- `PUT /api/clients/{id}` - Update client
- `DELETE /api/clients/{id}` - Delete client

### Service Requests (Authorization: Bearer token required)
- `GET /api/servicerequests` - List all service requests
- `GET /api/servicerequests/contract/{contractId}` - List by contract
- `GET /api/servicerequests/{id}` - Get specific request
- `POST /api/servicerequests` - Create new request
- `PUT /api/servicerequests/{id}` - Update request
- `DELETE /api/servicerequests/{id}` - Delete request

## Error Handling

### MVC Side
- **API Connection Issues** - Friendly error messages displayed to users
- **Authentication Failures** - Redirect to login page
- **Network Timeouts** - 30-second timeout with retry capability

### API Side
- **Invalid Token** - Returns `401 Unauthorized`
- **Expired Token** - Returns `401 Unauthorized`
- **Database Errors** - Returns `500 Internal Server Error` with logging

## Security Considerations

### Current Implementation (Development)
- Session-based token storage (HTTP-only recommended in production)
- Simple demo authentication (replace with real user database)
- CORS allows all origins (restrict in production)
- Demo JWT secret key (use strong key and environment variables)

### Production Recommendations
1. **Use secure, HTTP-only cookies** instead of session for token storage
2. **Implement proper user database** with password hashing (bcrypt/Argon2)
3. **Restrict CORS** to specific domains
4. **Use environment variables** for JWT secrets
5. **Add HTTPS enforcement** (already enabled)
6. **Implement token refresh** mechanism
7. **Add rate limiting** to auth endpoint
8. **Use strong secret keys** (32+ characters with mixed case, numbers, symbols)

## Testing

### Test Login
```powershell
$body = @{username="admin"; password="admin123"} | ConvertTo-Json
Invoke-RestMethod -Uri "https://localhost:56373/api/auth/login" -Method Post -Body $body -ContentType "application/json"
```

### Test Protected Endpoint
```powershell
$token = "eyJhbGciOiJIUzI1NiIs..." # Replace with token from login
$headers = @{Authorization = "Bearer $token"}
Invoke-RestMethod -Uri "https://localhost:56373/api/contracts" -Headers $headers
```

## Troubleshooting

### "Cannot connect to API"
- Ensure API is running on port 56373
- Check `ApiSettings:BaseUrl` in MVC appsettings.json
- Verify HTTPS certificate trust

### "401 Unauthorized"
- Token may have expired (60-minute default lifespan)
- Log out and log in again
- Check JWT secret key matches between MVC and API

### "CORS error"
- API CORS is set to allow all origins in development
- Check browser console for specific CORS error
- API is configured to run on same HTTPS scheme

### Session token not persisting
- Ensure `UseSession()` middleware is added after `UseRouting()`
- Session requires distributed memory cache or other backing store
- Default uses in-memory cache (not suitable for multi-server production)

## Next Steps for Production

1. Replace demo authentication with real user database
2. Implement token refresh mechanism
3. Add audit logging for all API operations
4. Implement proper error tracking (Application Insights, Sentry, etc.)
5. Add API rate limiting and throttling
6. Implement database migrations strategy
7. Add integration and load tests
8. Configure environment-specific settings
9. Set up CI/CD pipeline
10. Implement API versioning strategy

## Dependencies

**TechMove.Web:**
- Microsoft.AspNetCore.* (framework)
- System.Net.Http (HTTP client)
- System.Text.Json (JSON serialization)

**TechMove.API:**
- Microsoft.AspNetCore.Authentication.JwtBearer (v8.0.0)
- System.IdentityModel.Tokens.Jwt (v7.0.3)
- Microsoft.EntityFrameworkCore (v8.0.11)

## References

- [ASP.NET Core Authentication](https://docs.microsoft.com/en-us/aspnet/core/security/authentication)
- [JWT Bearer Authentication](https://docs.microsoft.com/en-us/dotnet/api/microsoft.aspnetcore.authentication.jwtbearer)
- [HttpClient Best Practices](https://docs.microsoft.com/en-us/dotnet/architecture/microservices/implement-resilient-applications/use-httpclientfactory-to-implement-resilient-http-requests)
- [ASP.NET Core Security](https://docs.microsoft.com/en-us/aspnet/core/security)

# TechMove API - Endpoint Reference

## 🔐 Authentication

Every endpoint except `POST /api/auth/login` requires a JWT in the `Authorization: Bearer <token>` header.

| Method | Endpoint | Description | Body |
|--------|----------|-------------|------|
| **POST** | `/api/auth/login` | Log in and receive a JWT | `{ "username": "...", "password": "..." }` |

Response (200 OK): `{ "token": "<jwt>", "message": "Login successful" }` - invalid credentials return `401 Unauthorized`.
In Swagger, call the login endpoint, click **Authorize** and paste the token.

## 🔍 Contracts API

### Base URL: `/api/contracts`

| Method | Endpoint | Description | Parameters | Auth |
|--------|----------|-------------|-----------|------|
| **GET** | `/` | List all contracts | `startDate?`, `endDate?`, `status?` | JWT |
| **GET** | `/{id}` | Get contract details | `id` (path) | JWT |
| **POST** | `/` | Create new contract | Form data: clientId, startDate, endDate, serviceLevel, signedAgreement (file) | JWT |
| **PATCH** | `/{id}/status` | Update status | `id` (path), Body: `{ status: string }` | JWT |
| **GET** | `/{id}/download` | Download PDF agreement | `id` (path) | JWT |

### Request/Response Examples

#### GET /api/contracts
```
Request:
GET /api/contracts?startDate=2024-01-01&endDate=2025-01-01&status=Active

Response (200 OK):
[
  {
	"id": 1,
	"clientId": 1,
	"clientName": "Lebo",
	"startDate": "2024-01-15T00:00:00Z",
	"endDate": "2025-01-15T00:00:00Z",
	"status": "Active",
	"serviceLevel": "Premium",
	"signedAgreementPath": "uploads/contracts/abc123.pdf"
  }
]
```

#### POST /api/contracts
```
Request:
POST /api/contracts
Content-Type: multipart/form-data

Form Fields:
- clientId: 1
- startDate: 2024-02-01
- endDate: 2025-02-01
- serviceLevel: Standard
- signedAgreement: [PDF file]

Response (201 Created):
{
  "id": 2,
  "clientId": 1,
  "clientName": "Lebo",
  "startDate": "2024-02-01T00:00:00Z",
  "endDate": "2025-02-01T00:00:00Z",
  "status": "Draft",
  "serviceLevel": "Standard",
  "signedAgreementPath": "uploads/contracts/xyz789.pdf"
}
```

#### PATCH /api/contracts/{id}/status
```
Request:
PATCH /api/contracts/1/status
Content-Type: application/json

{
  "status": "Active"
}

Response (200 OK):
{
  "id": 1,
  "clientId": 1,
  "clientName": "Lebo",
  "startDate": "2024-01-15T00:00:00Z",
  "endDate": "2025-01-15T00:00:00Z",
  "status": "Active",
  "serviceLevel": "Premium",
  "signedAgreementPath": "uploads/contracts/abc123.pdf"
}
```

---

## 👥 Clients API

### Base URL: `/api/clients`

| Method | Endpoint | Description | Parameters |
|--------|----------|-------------|-----------|
| **GET** | `/` | List all clients | - |
| **GET** | `/{id}` | Get client details | `id` (path) |
| **POST** | `/` | Create new client | Body: `{ name, contactDetails, region }` |
| **PUT** | `/{id}` | Update client | `id` (path), Body: `{ name, contactDetails, region }` |
| **DELETE** | `/{id}` | Delete client | `id` (path) |

### Request/Response Examples

#### GET /api/clients
```
Response (200 OK):
[
  {
	"id": 1,
	"name": "Lebo",
	"contactDetails": "lebo@example.com",
	"region": "South Africa"
  },
  {
	"id": 2,
	"name": "John Doe",
	"contactDetails": "john@example.com",
	"region": "Gauteng"
  }
]
```

#### POST /api/clients
```
Request:
POST /api/clients
Content-Type: application/json

{
  "name": "New Client",
  "contactDetails": "contact@newclient.com",
  "region": "Western Cape"
}

Response (201 Created):
{
  "id": 3,
  "name": "New Client",
  "contactDetails": "contact@newclient.com",
  "region": "Western Cape"
}
```

---

## 📋 Service Requests API

### Base URL: `/api/servicerequests`

| Method | Endpoint | Description | Parameters |
|--------|----------|-------------|-----------|
| **GET** | `/` | List all requests | - |
| **GET** | `/contract/{contractId}` | Get requests by contract | `contractId` (path) |
| **GET** | `/{id}` | Get request details | `id` (path) |
| **POST** | `/` | Create new request | Body: `{ contractId, description, cost, currency? }` |
| **PUT** | `/{id}` | Update request | `id` (path), Body: `{ description, cost, currency? }` |
| **DELETE** | `/{id}` | Delete request | `id` (path) |

### Request/Response Examples

#### GET /api/servicerequests
```
Response (200 OK):
[
  {
	"id": 1,
	"contractId": 1,
	"description": "Website maintenance",
	"cost": 5000.00,
	"currency": "ZAR",
	"createdAt": "2024-01-20T10:30:00Z"
  }
]
```

#### POST /api/servicerequests
```
Request:
POST /api/servicerequests
Content-Type: application/json

{
  "contractId": 1,
  "description": "Database optimization",
  "cost": 8500.00,
  "currency": "ZAR"
}

Response (201 Created):
{
  "id": 2,
  "contractId": 1,
  "description": "Database optimization",
  "cost": 8500.00,
  "currency": "ZAR",
  "createdAt": "2024-01-25T14:15:00Z"
}
```

#### GET /api/servicerequests/contract/1
```
Response (200 OK):
[
  {
	"id": 1,
	"contractId": 1,
	"description": "Website maintenance",
	"cost": 5000.00,
	"currency": "ZAR",
	"createdAt": "2024-01-20T10:30:00Z"
  },
  {
	"id": 2,
	"contractId": 1,
	"description": "Database optimization",
	"cost": 8500.00,
	"currency": "ZAR",
	"createdAt": "2024-01-25T14:15:00Z"
  }
]
```

---

## 🔄 Contract Status Transitions

Valid status transitions:
- **Draft** → Active, Expired, OnHold
- **Active** → Expired, OnHold
- **Expired** → (terminal state)
- **OnHold** → Active

Example: You can move a contract from Draft to Active, but not from Expired back to Active.

---

## 🎛️ Query Parameters

### Contracts Filtering
```
GET /api/contracts?startDate=2024-01-01&endDate=2024-12-31&status=Active

Parameters:
- startDate: ISO 8601 date (optional)
  Example: 2024-01-01, 2024-01-01T00:00:00Z

- endDate: ISO 8601 date (optional)
  Example: 2024-12-31, 2024-12-31T23:59:59Z

- status: Contract status (optional)
  Values: Draft, Active, Expired, OnHold
```

---

## ❌ Error Responses

### 400 Bad Request
```json
{
  "type": "https://tools.ietf.org/html/rfc7231#section-6.5.1",
  "title": "One or more validation errors occurred.",
  "status": 400,
  "errors": {
	"fieldName": ["Error message here"]
  }
}
```

### 404 Not Found
```json
{
  "type": "https://tools.ietf.org/html/rfc7231#section-6.5.4",
  "title": "Not Found",
  "status": 404
}
```

### 500 Internal Server Error
```json
{
  "type": "https://tools.ietf.org/html/rfc7231#section-6.6.1",
  "title": "An error occurred while processing your request.",
  "status": 500,
  "traceId": "00-abc123-def456-00"
}
```

---

## 📤 File Upload (Contracts)

### Upload Signed Agreement PDF

```
POST /api/contracts
Content-Type: multipart/form-data

Form-data:
- clientId: 1 (integer)
- startDate: 2024-02-01 (date, YYYY-MM-DD)
- endDate: 2025-02-01 (date, YYYY-MM-DD)
- serviceLevel: Premium (string)
- signedAgreement: [binary PDF file content] (file)

Validations:
- PDF only (checked by filename and content-type)
- Required: cannot be empty
- File size: reasonable limits enforced
- Client must exist
- endDate >= startDate
```

### Download Signed Agreement

```
GET /api/contracts/1/download

Response: PDF file (application/pdf)
Header: Content-Disposition: attachment; filename="Contract-1-Agreement.pdf"
```

---

## 🗂️ Data Models

### Contract
```json
{
  "id": 1,
  "clientId": 1,
  "clientName": "Client Name",
  "startDate": "2024-01-15T00:00:00Z",
  "endDate": "2025-01-15T00:00:00Z",
  "status": "Active",
  "serviceLevel": "Premium",
  "signedAgreementPath": "uploads/contracts/filename.pdf"
}
```

### Client
```json
{
  "id": 1,
  "name": "Client Name",
  "contactDetails": "contact@example.com",
  "region": "South Africa"
}
```

### ServiceRequest
```json
{
  "id": 1,
  "contractId": 1,
  "description": "Service description",
  "cost": 5000.00,
  "currency": "ZAR",
  "createdAt": "2024-01-20T10:30:00Z"
}
```

---

## 🧪 Testing with Swagger

1. Navigate to `https://localhost:56373/swagger/ui`
2. Click on any endpoint to expand it
3. Click **"Try it out"**
4. Fill in the parameters
5. Click **"Execute"**
6. View the response

---

## 📊 HTTP Status Codes

| Code | Meaning | When Used |
|------|---------|-----------|
| 200 | OK | Successful GET or PUT request |
| 201 | Created | Successful POST request |
| 204 | No Content | Successful DELETE request |
| 400 | Bad Request | Invalid input or validation failure |
| 404 | Not Found | Resource doesn't exist |
| 500 | Server Error | Internal server error |

---

**API Version**: v1.0
**Base URL**: `https://localhost:56373/api`
**Documentation**: Available at `/swagger/ui`
**OpenAPI Spec**: Available at `/swagger/v1/swagger.json`
