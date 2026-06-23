using Dapper;
using SentinelWhitelist.Api.Auth;
using SentinelWhitelist.Api.Data;
using SentinelWhitelist.Api.Models;

namespace SentinelWhitelist.Api.Endpoints;

public static class AppLogEndpoints
{
    public static void MapAppLogEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/app-logs").RequireAuthorization(Scopes.Read);

        // Summary per business unit (drives the first table).
        group.MapGet("/bu-summary", async (ISqlConnectionFactory factory, CancellationToken ct) =>
        {
            using var db = await factory.OpenAsync(ct);

            // All numbers come from the rollups (app_log_summary_daily + app_server_daily), never the raw fact.
            var rows = (await db.QueryAsync<BuSummaryRow>(new CommandDefinition(
                """
                SELECT bu_name,
                       SUM(total_usage)    AS total_usage,
                       SUM(total_requests) AS transactions,
                       SUM(success_count)  AS success_count,
                       SUM(error_count)    AS error_count
                FROM dbo.app_log_summary_daily
                GROUP BY bu_name
                ORDER BY SUM(total_usage) DESC;
                """, cancellationToken: ct))).ToList();

            var serverRows = await db.QueryAsync<(string bu_name, string server_name)>(new CommandDefinition(
                "SELECT bu_name, server_name FROM dbo.app_server_daily GROUP BY bu_name, server_name;",
                cancellationToken: ct));
            var serversByBu = serverRows
                .GroupBy(r => r.bu_name)
                .ToDictionary(g => g.Key, g => g.Select(x => x.server_name).OrderBy(s => s).ToArray());

            var lastSeenRows = await db.QueryAsync<(string bu_name, DateTime last_seen)>(new CommandDefinition(
                "SELECT bu_name, MAX(last_seen) AS last_seen FROM dbo.app_server_daily GROUP BY bu_name;",
                cancellationToken: ct));
            var lastSeenByBu = lastSeenRows.ToDictionary(r => r.bu_name, r => (DateTime?)r.last_seen);

            var result = rows.Select(r =>
            {
                var servers = serversByBu.TryGetValue(r.BuName, out var s) ? s : Array.Empty<string>();
                return new BuSummaryDto(
                    r.BuName, r.TotalUsage, r.Transactions, r.SuccessCount, r.ErrorCount,
                    servers.Length, servers, lastSeenByBu.GetValueOrDefault(r.BuName));
            });

            return Results.Ok(result);
        });

        // Paged transactions, optionally scoped to a BU (drives the detail table).
        group.MapGet("/", async (
            string? bu, string? search, string? responseStatus, string? sort,
            int? page, int? pageSize, ISqlConnectionFactory factory, CancellationToken ct) =>
        {
            var pageNum = page is null or < 1 ? 1 : page.Value;
            var size = pageSize is null or < 1 ? 10 : Math.Min(pageSize.Value, 1000);
            var orderBy = ResolveOrderBy(sort);

            var p = new DynamicParameters();
            p.Add("@bu", bu);
            p.Add("@search", string.IsNullOrWhiteSpace(search) ? null : $"%{search.Trim()}%");
            p.Add("@status", string.IsNullOrWhiteSpace(responseStatus) ? null : responseStatus);
            p.Add("@off", (pageNum - 1) * size);
            p.Add("@ps", size);

            const string where = """
                WHERE (@bu IS NULL OR bu_name = @bu)
                  AND (@status IS NULL OR response_status = @status)
                  AND (@search IS NULL OR client_ip LIKE @search OR function_name LIKE @search OR database_name LIKE @search)
                """;

            using var db = await factory.OpenAsync(ct);
            var total = await db.ExecuteScalarAsync<int>(new CommandDefinition(
                $"SELECT COUNT_BIG(*) FROM dbo.app_log_ip {where};", p, cancellationToken: ct));

            var items = (await db.QueryAsync<AppLogDto>(new CommandDefinition(
                $"""
                SELECT id, client_ip, bu_name, function_name, response_status, http_status_code,
                       database_name, duration_ms, usage_count, server_name, message, created_at
                FROM dbo.app_log_ip
                {where}
                ORDER BY {orderBy}
                OFFSET @off ROWS FETCH NEXT @ps ROWS ONLY;
                """, p, cancellationToken: ct))).ToList();

            return Results.Ok(new PagedResult<AppLogDto>
            {
                Items = items, Total = total, Page = pageNum, PageSize = size
            });
        });
    }

    // Whitelisted sort columns → safe ORDER BY (avoids SQL injection on the sort param).
    private static readonly Dictionary<string, string> SortColumns = new(StringComparer.OrdinalIgnoreCase)
    {
        ["clientIp"] = "client_ip",
        ["functionName"] = "function_name",
        ["responseStatus"] = "response_status",
        ["databaseName"] = "database_name",
        ["usageCount"] = "usage_count",
        ["createdAt"] = "created_at",
    };

    private static string ResolveOrderBy(string? sort)
    {
        if (!string.IsNullOrWhiteSpace(sort))
        {
            var parts = sort.Split(':');
            if (parts.Length == 2 && SortColumns.TryGetValue(parts[0], out var col))
            {
                var dir = parts[1].Equals("asc", StringComparison.OrdinalIgnoreCase) ? "ASC" : "DESC";
                return $"{col} {dir}, id DESC";
            }
        }
        return "created_at DESC, id DESC";
    }

    private sealed class BuSummaryRow
    {
        public string BuName { get; set; } = "";
        public long TotalUsage { get; set; }
        public long Transactions { get; set; }
        public long SuccessCount { get; set; }
        public long ErrorCount { get; set; }
        public int ServerCount { get; set; }
        public DateTime? LastSeen { get; set; }
    }
}
