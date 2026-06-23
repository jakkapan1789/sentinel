using System.Data;
using System.Security.Claims;
using Dapper;
using SentinelWhitelist.Api.Auth;
using SentinelWhitelist.Api.Data;
using SentinelWhitelist.Api.Models;

namespace SentinelWhitelist.Api.Endpoints;

public static class IngestEndpoints
{
    public static void MapIngestEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/ingestion").RequireAuthorization(Scopes.Ingestion);

        group.MapPost("/app-logs", async (AppLogIngest[] batch, ClaimsPrincipal user, ISqlConnectionFactory factory, CancellationToken ct) =>
        {
            using var db = await factory.OpenAsync(ct);
            var result = batch.Length == 0
                ? new IngestResult(0, 0, 0)
                : await RunIngest(db, "dbo.usp_ingest_app_logs", BuildAppLogTable(batch), "dbo.AppLogTvp", ct);
            await RecordDelivery(db, user, "app-logs", result, ct);
            return Results.Ok(result);
        });

        group.MapPost("/network-logs", async (NetworkLogIngest[] batch, ClaimsPrincipal user, ISqlConnectionFactory factory, CancellationToken ct) =>
        {
            using var db = await factory.OpenAsync(ct);
            var result = batch.Length == 0
                ? new IngestResult(0, 0, 0)
                : await RunIngest(db, "dbo.usp_ingest_network_logs", BuildNetworkLogTable(batch), "dbo.NetworkLogTvp", ct);
            await RecordDelivery(db, user, "network-logs", result, ct);
            return Results.Ok(result);
        });
    }

    private static int? SourceId(ClaimsPrincipal user) =>
        int.TryParse(user.FindFirst(TokenAuthenticationHandler.SourceIdClaim)?.Value, out var id) ? id : null;

    private static async Task<IngestResult> RunIngest(IDbConnection db, string proc, DataTable table, string tvpType, CancellationToken ct)
    {
        var p = new DynamicParameters();
        p.Add("@rows", table.AsTableValuedParameter(tvpType));
        var r = await db.QuerySingleAsync<(int inserted_count, int received_count)>(
            new CommandDefinition(proc, p, commandType: CommandType.StoredProcedure, cancellationToken: ct));
        return new IngestResult(r.received_count, r.inserted_count, r.received_count - r.inserted_count);
    }

    private static async Task RecordDelivery(IDbConnection db, ClaimsPrincipal user, string kind, IngestResult r, CancellationToken ct)
    {
        var sourceId = SourceId(user);
        var sourceName = user.Identity?.Name;
        try
        {
            await db.ExecuteAsync(new CommandDefinition(
                """
                INSERT dbo.ingestion_delivery (source_id, source_name, kind, received, inserted, status)
                VALUES (@sourceId, @sourceName, @kind, @received, @inserted, 'ok');
                IF @sourceId IS NOT NULL
                    UPDATE dbo.ingestion_source
                    SET total_received = total_received + @received,
                        total_inserted = total_inserted + @inserted,
                        last_used_at   = SYSUTCDATETIME()
                    WHERE id = @sourceId;
                """,
                new { sourceId, sourceName, kind, received = r.Received, inserted = r.Inserted }, cancellationToken: ct));
        }
        catch
        {
            // Telemetry must never fail an otherwise-successful ingest.
        }
    }

    private static DataTable BuildAppLogTable(IEnumerable<AppLogIngest> rows)
    {
        var t = new DataTable();
        t.Columns.Add("source_event_id", typeof(Guid));
        t.Columns.Add("client_ip", typeof(string));
        t.Columns.Add("bu_name", typeof(string));
        t.Columns.Add("function_name", typeof(string));
        t.Columns.Add("response_status", typeof(string));
        t.Columns.Add("http_status_code", typeof(short));
        t.Columns.Add("database_name", typeof(string));
        t.Columns.Add("duration_ms", typeof(int));
        t.Columns.Add("usage_count", typeof(long));
        t.Columns.Add("server_name", typeof(string));
        t.Columns.Add("http_method", typeof(string));
        t.Columns.Add("endpoint", typeof(string));
        t.Columns.Add("trace_id", typeof(string));
        t.Columns.Add("message", typeof(string));
        t.Columns.Add("created_at", typeof(DateTime));

        foreach (var r in rows)
        {
            var status = string.Equals(r.ResponseStatus, "Success", StringComparison.OrdinalIgnoreCase) ? "Success" : "Error";
            t.Rows.Add(
                r.SourceEventId ?? Guid.NewGuid(), r.ClientIp, r.BuName, r.FunctionName, status,
                (object?)r.HttpStatusCode ?? DBNull.Value, (object?)r.DatabaseName ?? DBNull.Value,
                (object?)r.DurationMs ?? DBNull.Value, (object?)r.UsageCount ?? DBNull.Value,
                (object?)r.ServerName ?? DBNull.Value, (object?)r.HttpMethod ?? DBNull.Value,
                (object?)r.Endpoint ?? DBNull.Value, (object?)r.TraceId ?? DBNull.Value,
                (object?)r.Message ?? DBNull.Value, r.CreatedAt);
        }
        return t;
    }

    private static DataTable BuildNetworkLogTable(IEnumerable<NetworkLogIngest> rows)
    {
        var t = new DataTable();
        t.Columns.Add("source_event_id", typeof(Guid));
        t.Columns.Add("source_address", typeof(string));
        t.Columns.Add("country_code", typeof(string));
        t.Columns.Add("country_name", typeof(string));
        t.Columns.Add("url", typeof(string));
        t.Columns.Add("period_month", typeof(DateTime));
        t.Columns.Add("usage_count", typeof(long));
        t.Columns.Add("created_at", typeof(DateTime));

        foreach (var r in rows)
        {
            t.Rows.Add(
                r.SourceEventId ?? Guid.NewGuid(), r.SourceAddress,
                (object?)r.CountryCode ?? DBNull.Value, (object?)r.CountryName ?? DBNull.Value,
                r.Url, r.PeriodMonth.ToDateTime(TimeOnly.MinValue), (object?)r.UsageCount ?? DBNull.Value, r.CreatedAt);
        }
        return t;
    }
}
