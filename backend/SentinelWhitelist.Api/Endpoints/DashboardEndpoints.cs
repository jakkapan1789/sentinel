using Dapper;
using SentinelWhitelist.Api.Auth;
using SentinelWhitelist.Api.Data;
using SentinelWhitelist.Api.Models;

namespace SentinelWhitelist.Api.Endpoints;

public static class DashboardEndpoints
{
    public static void MapDashboardEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/v1/dashboard", async (ISqlConnectionFactory factory, CancellationToken ct) =>
        {
            using var db = await factory.OpenAsync(ct);

            var wl = (await db.QueryAsync<(string status, int c)>(new CommandDefinition(
                "SELECT status, COUNT(*) AS c FROM dbo.ip_whitelist GROUP BY status;", cancellationToken: ct)))
                .ToDictionary(x => x.status, x => x.c);

            // Read from the daily rollup (not the raw fact) so it scales to billions of rows.
            var appTotals = await db.QuerySingleAsync<(long transactions, long usage, long success)>(new CommandDefinition(
                """
                SELECT ISNULL(SUM(total_requests), 0) AS transactions,
                       ISNULL(SUM(total_usage), 0)    AS usage,
                       ISNULL(SUM(success_count), 0)  AS success
                FROM dbo.app_log_summary_daily;
                """, cancellationToken: ct));

            var unmatched = await db.ExecuteScalarAsync<int>(new CommandDefinition(
                """
                ;WITH allowed AS (
                    SELECT DISTINCT
                        PARSENAME(LEFT(ip_cidr, CHARINDEX('/', ip_cidr + '/') - 1), 4) + '.' +
                        PARSENAME(LEFT(ip_cidr, CHARINDEX('/', ip_cidr + '/') - 1), 3) AS prefix
                    FROM dbo.ip_whitelist WHERE status = 'active'
                )
                SELECT COUNT_BIG(*) FROM dbo.network_log n
                WHERE NOT EXISTS (
                    SELECT 1 FROM allowed a
                    WHERE a.prefix = PARSENAME(n.source_address, 4) + '.' + PARSENAME(n.source_address, 3)
                );
                """, cancellationToken: ct));

            var active = wl.GetValueOrDefault("active");
            var pending = wl.GetValueOrDefault("pending");
            var disabled = wl.GetValueOrDefault("disabled");
            var error = appTotals.transactions - appTotals.success;
            var rate = appTotals.transactions > 0 ? (double)appTotals.success / appTotals.transactions * 100 : 0;

            return Results.Ok(new DashboardDto(
                active + pending + disabled, active, pending, disabled,
                appTotals.usage, appTotals.transactions, appTotals.success, error,
                Math.Round(rate, 1), unmatched));
        }).RequireAuthorization(Scopes.Read);

        // On-demand summary refresh — runs the incremental rollups (no SQL Agent needed).
        app.MapPost("/api/v1/summary/refresh", async (ISqlConnectionFactory factory, CancellationToken ct) =>
        {
            using var db = await factory.OpenAsync(ct);
            await db.ExecuteAsync(new CommandDefinition(
                "EXEC dbo.usp_rollup_app_daily; EXEC dbo.usp_rollup_app_servers; EXEC dbo.usp_rollup_app_apps; EXEC dbo.usp_rollup_network_monthly; EXEC dbo.usp_rollup_app_ips; EXEC dbo.usp_rollup_network_ips;",
                commandTimeout: 600, cancellationToken: ct));
            return Results.Ok(new { refreshed = true });
        }).RequireAuthorization(Scopes.Admin);
    }
}
