using System.Security.Cryptography;
using System.Text;

namespace SentinelWhitelist.Api.Util;

public static class Tokens
{
    /// <summary>Generate an opaque ingest token, e.g. swc_etl_ab12…</summary>
    public static string Generate() => "swc_etl_" + Convert.ToHexString(RandomNumberGenerator.GetBytes(20)).ToLowerInvariant();

    public static string Sha256Hex(string input) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(input))).ToLowerInvariant();

    /// <summary>Last 4 chars, used for masked display (••••1234).</summary>
    public static string Prefix(string token) => token.Length <= 4 ? token : token[^4..];
}
