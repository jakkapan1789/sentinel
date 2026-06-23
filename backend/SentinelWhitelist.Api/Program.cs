using Dapper;
using Microsoft.AspNetCore.Authentication;
using SentinelWhitelist.Api.Auth;
using SentinelWhitelist.Api.Data;
using SentinelWhitelist.Api.Endpoints;

// Map snake_case columns (client_ip) to PascalCase members (ClientIp).
DefaultTypeMap.MatchNamesWithUnderscores = true;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton<ISqlConnectionFactory, SqlConnectionFactory>();

builder.Services
    .AddAuthentication(TokenAuthenticationHandler.SchemeName)
    .AddScheme<AuthenticationSchemeOptions, TokenAuthenticationHandler>(TokenAuthenticationHandler.SchemeName, _ => { });

builder.Services.AddAuthorizationBuilder()
    .AddPolicy(Scopes.Ingestion, p => p.RequireClaim("scope", Scopes.Ingestion))
    .AddPolicy(Scopes.Read, p => p.RequireClaim("scope", Scopes.Read))
    .AddPolicy(Scopes.Admin, p => p.RequireClaim("scope", Scopes.Admin));

var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? Array.Empty<string>();
builder.Services.AddCors(options => options.AddDefaultPolicy(policy =>
    policy.WithOrigins(allowedOrigins).AllowAnyHeader().AllowAnyMethod()));

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseCors();
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/", () => Results.Ok(new { service = "Sentinel Whitelist Center API", status = "ok" }))
   .AllowAnonymous();

app.MapIngestEndpoints();
app.MapAppLogEndpoints();
app.MapNetworkLogEndpoints();
app.MapWhitelistEndpoints();
app.MapIpMatchEndpoints();
app.MapDashboardEndpoints();
app.MapIngestionSourceEndpoints();

app.Run();
