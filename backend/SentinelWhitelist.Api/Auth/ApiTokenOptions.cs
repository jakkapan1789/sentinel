namespace SentinelWhitelist.Api.Auth;

public sealed class ApiTokenConfig
{
    public string Token { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string[] Scopes { get; set; } = Array.Empty<string>();
}

public static class Scopes
{
    public const string Ingestion = "ingestion";
    public const string Read = "read";
    public const string Admin = "admin";
}
