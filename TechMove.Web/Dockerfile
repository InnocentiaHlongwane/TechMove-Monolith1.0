
# Build stage
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src

# Copy project files
COPY ["TechMove.Core/TechMove.Core.csproj", "TechMove.Core/"]
COPY ["TechMove.Web/TechMove.Web.csproj", "TechMove.Web/"]

# Restore dependencies
RUN dotnet restore "TechMove.Web/TechMove.Web.csproj"

# Copy source code
COPY . .

# Build and publish
WORKDIR /src/TechMove.Web
RUN dotnet publish "TechMove.Web.csproj" -c Release -o /app/publish

# Runtime stage
FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS final
WORKDIR /app

COPY --from=build /app/publish .

ENV ASPNETCORE_URLS=http://+:8080
EXPOSE 8080

ENTRYPOINT ["dotnet", "TechMove.Web.dll"]