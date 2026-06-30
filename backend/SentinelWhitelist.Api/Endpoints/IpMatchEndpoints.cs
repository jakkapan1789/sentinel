using Dapper;
using SentinelWhitelist.Api.Auth;
using SentinelWhitelist.Api.Data;
using SentinelWhitelist.Api.Models;

namespace SentinelWhitelist.Api.Endpoints;

/// <summary>
/// IP Match reconciliation: IPs that appear in BOTH application logs (client_ip)
/// and network logs (source_address), with combined usage + whitelist coverage.
/// All reads come from the per-IP rollups (app_ip_daily / network_ip_monthly).
/// </summary>
public static class IpMatchEndpoints
{
    // Network-log driven: one row per network source IP. Flag the ones that also appear in
    // application logs (matched), and HIDE any IP already covered by a whitelist entry.
    // Filters/order/paging are appended per request.
    private const string MatchCte = """
        ;WITH net AS (
            SELECT source_address AS ip, MIN(ip_bin) AS ip_bin,
                   SUM(total_usage) AS net_usage, SUM(request_count) AS net_req, MAX(last_seen) AS net_last
            FROM dbo.network_ip_monthly GROUP BY source_address
        ),
        app AS (
            SELECT client_ip AS ip,
                   SUM(total_usage) AS app_usage, SUM(request_count) AS app_req, MAX(last_seen) AS app_last
            FROM dbo.app_ip_daily GROUP BY client_ip
        ),
        m AS (
            SELECT n.ip,
                   ISNULL(a.app_usage, 0) AS app_usage, ISNULL(a.app_req, 0) AS app_req,
                   n.net_usage, n.net_req,
                   (ISNULL(a.app_usage, 0) + n.net_usage) AS total_usage,
                   CAST(CASE WHEN a.ip IS NOT NULL THEN 1 ELSE 0 END AS BIT) AS matched,
                   CASE WHEN a.app_last IS NOT NULL AND a.app_last > n.net_last THEN a.app_last ELSE n.net_last END AS last_seen,
                   wl.ip_cidr AS whitelist_cidr
            FROM net n
            LEFT JOIN app a ON a.ip = n.ip
            OUTER APPLY (
                SELECT TOP 1 w.ip_cidr FROM dbo.ip_whitelist w
                WHERE w.status IN ('active', 'pending') AND w.ip_start <= n.ip_bin AND w.ip_end >= n.ip_bin
                ORDER BY CASE w.status WHEN 'active' THEN 0 ELSE 1 END, w.ip_end DESC
            ) wl
        )
        """;

    public static void MapIpMatchEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/ip-matches").RequireAuthorization(Scopes.Read);

        group.MapGet("/", async (
            long? minUsage, string? bu, string? country, string? matched, string? search, string? sort,
            int? page, int? pageSize, ISqlConnectionFactory factory, CancellationToken ct) =>
        {
            var pageNum = page is null or < 1 ? 1 : page.Value;
            var size = pageSize is null or < 1 ? 10 : Math.Min(pageSize.Value, 1000);

            var (where, p) = BuildWhere(minUsage, bu, country, matched, search);
            p.Add("@off", (pageNum - 1) * size);
            p.Add("@ps", size);

            using var db = await factory.OpenAsync(ct);
            var total = await db.ExecuteScalarAsync<long>(new CommandDefinition(
                $"{MatchCte} SELECT COUNT_BIG(*) FROM m {where};", p, cancellationToken: ct));

            var rows = (await db.QueryAsync<MatchRow>(new CommandDefinition(
                $"""
                {MatchCte}
                SELECT ip, matched AS Matched, app_usage AS AppUsage, app_req AS AppRequests, net_usage AS NetworkUsage,
                       net_req AS NetworkRequests, total_usage AS TotalUsage, last_seen AS LastSeen
                FROM m {where}
                ORDER BY {ResolveOrderBy(sort)}
                OFFSET @off ROWS FETCH NEXT @ps ROWS ONLY;
                """, p, cancellationToken: ct))).ToList();

            var ips = rows.Select(r => r.Ip).ToArray();
            var (buByIp, appByIp, srvByIp, domBuByIp, domAppByIp, domSrvByIp) = await LoadAppDims(db, ips, ct);
            var countryByIp = await LoadCountries(db, ips, ct);

            var items = rows.Select(r => new IpMatchDto(
                r.Ip, r.Matched, r.AppUsage, r.AppRequests, r.NetworkUsage, r.NetworkRequests, r.TotalUsage,
                buByIp.GetValueOrDefault(r.Ip, Array.Empty<string>()),
                appByIp.GetValueOrDefault(r.Ip, Array.Empty<string>()),
                srvByIp.GetValueOrDefault(r.Ip, Array.Empty<string>()),
                domBuByIp.GetValueOrDefault(r.Ip),
                domAppByIp.GetValueOrDefault(r.Ip),
                domSrvByIp.GetValueOrDefault(r.Ip),
                countryByIp.GetValueOrDefault(r.Ip),
                r.LastSeen)).ToList();

            return Results.Ok(new PagedResult<IpMatchDto> { Items = items, Total = (int)total, Page = pageNum, PageSize = size });
        });

        group.MapGet("/stats", async (
            long? minUsage, string? bu, string? country, string? search,
            ISqlConnectionFactory factory, CancellationToken ct) =>
        {
            // Context filters (excl. the matched toggle) so matched/unmatched counts stay meaningful.
            var (where, p) = BuildWhere(minUsage, bu, country, null, search);

            using var db = await factory.OpenAsync(ct);
            var s = await db.QuerySingleAsync<IpMatchStatsDto>(new CommandDefinition(
                $"""
                {MatchCte}
                SELECT COUNT_BIG(*) AS Total,
                       SUM(CAST(CASE WHEN matched = 1 THEN 1 ELSE 0 END AS BIGINT)) AS Matched,
                       SUM(CAST(CASE WHEN matched = 0 THEN 1 ELSE 0 END AS BIGINT)) AS Unmatched,
                       ISNULL(SUM(total_usage), 0) AS CombinedUsage
                FROM m {where};
                """, p, cancellationToken: ct));
            return Results.Ok(s);
        });

        group.MapGet("/facets", async (ISqlConnectionFactory factory, CancellationToken ct) =>
        {
            using var db = await factory.OpenAsync(ct);
            var bu = (await db.QueryAsync<string>(new CommandDefinition(
                "SELECT DISTINCT TOP (500) bu_name FROM dbo.app_ip_daily ORDER BY bu_name;", cancellationToken: ct))).ToArray();
            var country = (await db.QueryAsync<string>(new CommandDefinition(
                "SELECT DISTINCT TOP (500) country_name FROM dbo.network_ip_monthly WHERE country_name IS NOT NULL ORDER BY country_name;",
                cancellationToken: ct))).ToArray();
            return Results.Ok(new IpMatchFacetsDto(bu, country));
        });
    }

    private static (string where, DynamicParameters p) BuildWhere(
        long? minUsage, string? bu, string? country, string? matched, string? search)
    {
        var p = new DynamicParameters();
        // Whitelisted IPs are never shown — they already have a decision.
        var conditions = new List<string> { "whitelist_cidr IS NULL" };

        if (minUsage is > 0)
        {
            conditions.Add("total_usage >= @minUsage");
            p.Add("@minUsage", minUsage.Value);
        }
        if (!string.IsNullOrWhiteSpace(search))
        {
            conditions.Add("ip LIKE @search");
            p.Add("@search", $"%{search.Trim()}%");
        }
        if (matched == "matched") conditions.Add("matched = 1");
        else if (matched == "unmatched") conditions.Add("matched = 0");

        var bus = SplitCsv(bu);
        if (bus is not null)
        {
            conditions.Add("EXISTS (SELECT 1 FROM dbo.app_ip_daily d WHERE d.client_ip = m.ip AND d.bu_name IN @bus)");
            p.Add("@bus", bus);
        }
        var countries = SplitCsv(country);
        if (countries is not null)
        {
            conditions.Add("EXISTS (SELECT 1 FROM dbo.network_ip_monthly d WHERE d.source_address = m.ip AND d.country_name IN @countries)");
            p.Add("@countries", countries);
        }

        var where = conditions.Count == 0 ? "" : "WHERE " + string.Join(" AND ", conditions);
        return (where, p);
    }

    // Distinct BU / app / server lists + dominant (highest-usage) value per IP, from app_ip_daily.
    private static async Task<(
        Dictionary<string, string[]> bu, Dictionary<string, string[]> app, Dictionary<string, string[]> srv,
        Dictionary<string, string?> domBu, Dictionary<string, string?> domApp, Dictionary<string, string?> domSrv)>
        LoadAppDims(System.Data.IDbConnection db, string[] ips, CancellationToken ct)
    {
        var bu = new Dictionary<string, string[]>();
        var app = new Dictionary<string, string[]>();
        var srv = new Dictionary<string, string[]>();
        var domBu = new Dictionary<string, string?>();
        var domApp = new Dictionary<string, string?>();
        var domSrv = new Dictionary<string, string?>();
        if (ips.Length == 0) return (bu, app, srv, domBu, domApp, domSrv);

        var rows = await db.QueryAsync<(string client_ip, string bu_name, string server_name, string app_name, long usage)>(
            new CommandDefinition(
                """
                SELECT client_ip, bu_name, server_name, app_name, SUM(total_usage) AS usage
                FROM dbo.app_ip_daily WHERE client_ip IN @ips
                GROUP BY client_ip, bu_name, server_name, app_name;
                """, new { ips }, cancellationToken: ct));

        foreach (var g in rows.GroupBy(r => r.client_ip))
        {
            var ordered = g.OrderByDescending(r => r.usage).ToList();
            bu[g.Key] = ordered.Select(r => r.bu_name).Where(v => !string.IsNullOrEmpty(v)).Distinct().ToArray();
            app[g.Key] = ordered.Select(r => r.app_name).Where(v => !string.IsNullOrEmpty(v)).Distinct().ToArray();
            srv[g.Key] = ordered.Select(r => r.server_name).Where(v => !string.IsNullOrEmpty(v)).Distinct().ToArray();
            domBu[g.Key] = bu[g.Key].FirstOrDefault();
            domApp[g.Key] = app[g.Key].FirstOrDefault();
            domSrv[g.Key] = srv[g.Key].FirstOrDefault();
        }
        return (bu, app, srv, domBu, domApp, domSrv);
    }

    private static async Task<Dictionary<string, string?>> LoadCountries(
        System.Data.IDbConnection db, string[] ips, CancellationToken ct)
    {
        var map = new Dictionary<string, string?>();
        if (ips.Length == 0) return map;
        var rows = await db.QueryAsync<(string source_address, string country_name, long usage)>(new CommandDefinition(
            """
            SELECT source_address, country_name, SUM(total_usage) AS usage
            FROM dbo.network_ip_monthly WHERE source_address IN @ips AND country_name IS NOT NULL
            GROUP BY source_address, country_name;
            """, new { ips }, cancellationToken: ct));
        foreach (var g in rows.GroupBy(r => r.source_address))
            map[g.Key] = g.OrderByDescending(r => r.usage).First().country_name;
        return map;
    }

    private static readonly Dictionary<string, string> SortColumns = new(StringComparer.OrdinalIgnoreCase)
    {
        ["ip"] = "ip",
        ["totalUsage"] = "total_usage",
        ["appUsage"] = "app_usage",
        ["networkUsage"] = "net_usage",
        ["lastSeen"] = "last_seen",
        ["matched"] = "matched",
    };

    private static string ResolveOrderBy(string? sort)
    {
        if (!string.IsNullOrWhiteSpace(sort))
        {
            var parts = sort.Split(':');
            if (parts.Length == 2 && SortColumns.TryGetValue(parts[0], out var col))
            {
                var dir = parts[1].Equals("asc", StringComparison.OrdinalIgnoreCase) ? "ASC" : "DESC";
                return $"{col} {dir}, ip ASC";
            }
        }
        return "total_usage DESC, ip ASC";
    }

    private static List<string>? SplitCsv(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var list = value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Distinct(StringComparer.Ordinal).ToList();
        return list.Count == 0 ? null : list;
    }

    private sealed class MatchRow
    {
        public string Ip { get; set; } = "";
        public bool Matched { get; set; }
        public long AppUsage { get; set; }
        public long AppRequests { get; set; }
        public long NetworkUsage { get; set; }
        public long NetworkRequests { get; set; }
        public long TotalUsage { get; set; }
        public DateTime LastSeen { get; set; }
    }
}
