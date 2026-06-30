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

            var appRows = await db.QueryAsync<(string bu_name, string app_name)>(new CommandDefinition(
                "SELECT bu_name, app_name FROM dbo.app_application_daily GROUP BY bu_name, app_name;",
                cancellationToken: ct));
            var appsByBu = appRows
                .GroupBy(r => r.bu_name)
                .ToDictionary(g => g.Key, g => g.Select(x => x.app_name).OrderBy(s => s).ToArray());

            var lastSeenRows = await db.QueryAsync<(string bu_name, DateTime last_seen)>(new CommandDefinition(
                "SELECT bu_name, MAX(last_seen) AS last_seen FROM dbo.app_server_daily GROUP BY bu_name;",
                cancellationToken: ct));
            var lastSeenByBu = lastSeenRows.ToDictionary(r => r.bu_name, r => (DateTime?)r.last_seen);

            var result = rows.Select(r =>
            {
                var servers = serversByBu.TryGetValue(r.BuName, out var s) ? s : Array.Empty<string>();
                var apps = appsByBu.TryGetValue(r.BuName, out var a) ? a : Array.Empty<string>();
                return new BuSummaryDto(
                    r.BuName, r.TotalUsage, r.Transactions, r.SuccessCount, r.ErrorCount,
                    servers.Length, servers, apps, lastSeenByBu.GetValueOrDefault(r.BuName));
            });

            return Results.Ok(result);
        });

        // Distinct values per filterable column for a BU (drives the detail value-checklist filters).
        // Scoped to a single BU and capped so the lists stay bounded even on the large fact table.
        group.MapGet("/facets", async (string? bu, ISqlConnectionFactory factory, CancellationToken ct) =>
        {
            using var db = await factory.OpenAsync(ct);
            var p = new DynamicParameters();
            p.Add("@bu", bu);

            async Task<string[]> Distinct(string column) =>
                (await db.QueryAsync<string?>(new CommandDefinition(
                    $"""
                    SELECT DISTINCT TOP (500) {column}
                    FROM dbo.app_log_ip
                    WHERE (@bu IS NULL OR bu_name = @bu) AND {column} IS NOT NULL
                    ORDER BY {column};
                    """, p, cancellationToken: ct)))
                .Where(v => v is not null).Select(v => v!).ToArray();

            return Results.Ok(new AppLogFacetsDto(
                await Distinct("client_ip"),
                await Distinct("app_name"),
                await Distinct("function_name"),
                await Distinct("server_name"),
                await Distinct("database_name")));
        });

        // Paged transactions, optionally scoped to a BU (drives the detail table).
        group.MapGet("/", async (
            string? bu, string? search, string? responseStatus, string? app,
            string? clientIp, string? functionName, string? serverName, string? databaseName, string? sort,
            int? page, int? pageSize, ISqlConnectionFactory factory, CancellationToken ct) =>
        {
            var pageNum = page is null or < 1 ? 1 : page.Value;
            var size = pageSize is null or < 1 ? 5 : Math.Min(pageSize.Value, 1000);
            var orderBy = ResolveOrderBy(sort);

            // Column filters arrive as comma-separated multi-selects (e.g. ?app=A,B&responseStatus=Success,Error).
            var statuses = SplitCsv(responseStatus);
            var apps = SplitCsv(app);

            var p = new DynamicParameters();
            p.Add("@bu", bu);
            p.Add("@search", string.IsNullOrWhiteSpace(search) ? null : $"%{search.Trim()}%");
            p.Add("@off", (pageNum - 1) * size);
            p.Add("@ps", size);

            // Build WHERE dynamically: Dapper list-expansion can't coexist with `@p IS NULL OR col IN @p`,
            // so the IN clauses are added only when a filter is active. Values stay parameterized.
            var conditions = new List<string>
            {
                "(@bu IS NULL OR bu_name = @bu)",
                "(@search IS NULL OR client_ip LIKE @search OR function_name LIKE @search OR database_name LIKE @search OR app_name LIKE @search)",
            };
            if (statuses is not null)
            {
                conditions.Add("response_status IN @statuses");
                p.Add("@statuses", statuses);
            }
            if (apps is not null)
            {
                conditions.Add("app_name IN @apps");
                p.Add("@apps", apps);
            }
            // Per-column value-list filters (multi-select checklists, same UX as the other tables).
            var clientIps = SplitCsv(clientIp);
            if (clientIps is not null)
            {
                conditions.Add("client_ip IN @clientIps");
                p.Add("@clientIps", clientIps);
            }
            var functionNames = SplitCsv(functionName);
            if (functionNames is not null)
            {
                conditions.Add("function_name IN @functionNames");
                p.Add("@functionNames", functionNames);
            }
            var serverNames = SplitCsv(serverName);
            if (serverNames is not null)
            {
                conditions.Add("server_name IN @serverNames");
                p.Add("@serverNames", serverNames);
            }
            var databaseNames = SplitCsv(databaseName);
            if (databaseNames is not null)
            {
                conditions.Add("database_name IN @databaseNames");
                p.Add("@databaseNames", databaseNames);
            }
            var where = "WHERE " + string.Join(" AND ", conditions);

            using var db = await factory.OpenAsync(ct);
            var total = await db.ExecuteScalarAsync<int>(new CommandDefinition(
                $"SELECT COUNT_BIG(*) FROM dbo.app_log_ip {where};", p, cancellationToken: ct));

            var items = (await db.QueryAsync<AppLogDto>(new CommandDefinition(
                $"""
                SELECT id, client_ip, bu_name, app_name, function_name, response_status, http_status_code,
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
        ["appName"] = "app_name",
        ["functionName"] = "function_name",
        ["responseStatus"] = "response_status",
        ["serverName"] = "server_name",
        ["databaseName"] = "database_name",
        ["usageCount"] = "usage_count",
        ["durationMs"] = "duration_ms",
        ["createdAt"] = "created_at",
    };

    // Parse a comma-separated multi-select filter into a distinct list, or null when empty.
    private static List<string>? SplitCsv(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        var list = value
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Distinct(StringComparer.Ordinal)
            .ToList();
        return list.Count == 0 ? null : list;
    }

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
