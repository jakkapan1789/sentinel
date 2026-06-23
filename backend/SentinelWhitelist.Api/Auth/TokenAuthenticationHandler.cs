using System.Security.Claims;
using System.Text.Encodings.Web;
using Dapper;
using Microsoft.AspNetCore.Authentication;
using Microsoft.Extensions.Options;
using SentinelWhitelist.Api.Data;
using SentinelWhitelist.Api.Util;

namespace SentinelWhitelist.Api.Auth;

/// <summary>
/// Validates "Authorization: Bearer &lt;token&gt;" against:
///   1) static tokens in appsettings (UI read/admin), then
///   2) hashed ingestion tokens in dbo.ingestion_source (managed via the UI).
/// </summary>
public sealed class TokenAuthenticationHandler : AuthenticationHandler<AuthenticationSchemeOptions>
{
    public const string SchemeName = "Bearer";
    public const string SourceIdClaim = "ingestion_source_id";

    private readonly IReadOnlyList<ApiTokenConfig> _tokens;
    private readonly ISqlConnectionFactory _factory;

    public TokenAuthenticationHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder,
        IConfiguration configuration,
        ISqlConnectionFactory factory)
        : base(options, logger, encoder)
    {
        _tokens = configuration.GetSection("ApiTokens").Get<List<ApiTokenConfig>>() ?? new();
        _factory = factory;
    }

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Headers.TryGetValue("Authorization", out var header))
            return AuthenticateResult.NoResult();

        var value = header.ToString();
        if (string.IsNullOrWhiteSpace(value) || !value.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            return AuthenticateResult.NoResult();

        var token = value["Bearer ".Length..].Trim();

        // 1) Static config tokens (UI).
        var cfg = _tokens.FirstOrDefault(t => !string.IsNullOrEmpty(t.Token) && FixedEquals(t.Token, token));
        if (cfg is not null)
            return Success(cfg.Name, cfg.Scopes, null);

        // 2) Managed ingestion source tokens (DB, hashed).
        try
        {
            using var db = await _factory.OpenAsync();
            var source = await db.QuerySingleOrDefaultAsync<IngestionAuthRow>(
                "SELECT id, name, scope, allowed_cidr FROM dbo.ingestion_source WHERE token_hash = @hash AND enabled = 1;",
                new { hash = Tokens.Sha256Hex(token) });

            if (source is null)
                return AuthenticateResult.Fail("Invalid token.");

            if (!string.IsNullOrEmpty(source.allowed_cidr) &&
                !IpRange.IsInCidr(Context.Connection.RemoteIpAddress, source.allowed_cidr))
                return AuthenticateResult.Fail("Source IP not allowed.");

            return Success(source.name, new[] { source.scope }, source.id);
        }
        catch
        {
            return AuthenticateResult.Fail("Token validation failed.");
        }
    }

    private AuthenticateResult Success(string name, IEnumerable<string> scopes, int? sourceId)
    {
        var claims = new List<Claim> { new(ClaimTypes.Name, name) };
        claims.AddRange(scopes.Select(s => new Claim("scope", s)));
        if (sourceId is not null) claims.Add(new Claim(SourceIdClaim, sourceId.Value.ToString()));
        var identity = new ClaimsIdentity(claims, SchemeName);
        return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), SchemeName));
    }

    private static bool FixedEquals(string a, string b) =>
        System.Security.Cryptography.CryptographicOperations.FixedTimeEquals(
            System.Text.Encoding.UTF8.GetBytes(a), System.Text.Encoding.UTF8.GetBytes(b));

    private sealed class IngestionAuthRow
    {
        public int id { get; set; }
        public string name { get; set; } = "";
        public string scope { get; set; } = "ingest";
        public string? allowed_cidr { get; set; }
    }
}
