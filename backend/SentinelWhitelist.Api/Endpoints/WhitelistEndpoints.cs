using System.Security.Claims;
using Dapper;
using SentinelWhitelist.Api.Auth;
using SentinelWhitelist.Api.Data;
using SentinelWhitelist.Api.Models;
using SentinelWhitelist.Api.Util;

namespace SentinelWhitelist.Api.Endpoints;

public static class WhitelistEndpoints
{
    private const string SelectColumns =
        "id, ip_cidr, app_name, server, env, bu_name, status, owner, notes, created_by, updated_by, created_at, updated_at";

    public static void MapWhitelistEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/whitelist");

        group.MapGet("/", async (
            string? status, string? search, ISqlConnectionFactory factory, CancellationToken ct) =>
        {
            var p = new DynamicParameters();
            p.Add("@status", string.IsNullOrWhiteSpace(status) || status == "all" ? null : status);
            p.Add("@search", string.IsNullOrWhiteSpace(search) ? null : $"%{search.Trim()}%");

            using var db = await factory.OpenAsync(ct);
            var items = await db.QueryAsync<WhitelistDto>(new CommandDefinition(
                $"""
                SELECT {SelectColumns} FROM dbo.ip_whitelist
                WHERE (@status IS NULL OR status = @status)
                  AND (@search IS NULL OR ip_cidr LIKE @search OR app_name LIKE @search
                       OR server LIKE @search OR bu_name LIKE @search OR owner LIKE @search)
                ORDER BY updated_at DESC;
                """, p, cancellationToken: ct));
            return Results.Ok(items);
        }).RequireAuthorization(Scopes.Read);

        group.MapPost("/", async (
            WhitelistUpsert body, ClaimsPrincipal user, ISqlConnectionFactory factory, CancellationToken ct) =>
        {
            var actor = user.Identity?.Name ?? "api";
            var (start, end) = IpRange.FromCidr(body.IpCidr);
            var p = ToParams(body, actor);
            p.Add("@Start", start);
            p.Add("@End", end);

            using var db = await factory.OpenAsync(ct);
            var id = await db.ExecuteScalarAsync<int>(new CommandDefinition(
                """
                DECLARE @buId INT = (SELECT bu_id FROM dbo.business_unit WHERE bu_name = @BuName);
                IF @buId IS NULL BEGIN INSERT dbo.business_unit (bu_name) VALUES (@BuName); SET @buId = SCOPE_IDENTITY(); END
                INSERT dbo.ip_whitelist
                    (ip_cidr, ip_start, ip_end, app_name, server, env, bu_id, bu_name, status, owner, notes, created_by, updated_by)
                OUTPUT INSERTED.id
                VALUES (@IpCidr, @Start, @End, @AppName, @Server, @Env, @buId, @BuName, @Status, @Owner, @Notes, @Actor, @Actor);
                """, p, cancellationToken: ct));

            var created = await db.QuerySingleAsync<WhitelistDto>(new CommandDefinition(
                $"SELECT {SelectColumns} FROM dbo.ip_whitelist WHERE id = @id;", new { id }, cancellationToken: ct));
            return Results.Created($"/api/v1/whitelist/{id}", created);
        }).RequireAuthorization(Scopes.Admin);

        group.MapPut("/{id:int}", async (
            int id, WhitelistUpsert body, ClaimsPrincipal user, ISqlConnectionFactory factory, CancellationToken ct) =>
        {
            var actor = user.Identity?.Name ?? "api";
            var (start, end) = IpRange.FromCidr(body.IpCidr);
            var p = ToParams(body, actor);
            p.Add("@Id", id);
            p.Add("@Start", start);
            p.Add("@End", end);

            using var db = await factory.OpenAsync(ct);
            var affected = await db.ExecuteAsync(new CommandDefinition(
                """
                DECLARE @buId INT = (SELECT bu_id FROM dbo.business_unit WHERE bu_name = @BuName);
                IF @buId IS NULL BEGIN INSERT dbo.business_unit (bu_name) VALUES (@BuName); SET @buId = SCOPE_IDENTITY(); END
                UPDATE dbo.ip_whitelist
                SET ip_cidr = @IpCidr, ip_start = @Start, ip_end = @End, app_name = @AppName, server = @Server,
                    env = @Env, bu_id = @buId, bu_name = @BuName, status = @Status, owner = @Owner, notes = @Notes,
                    updated_by = @Actor, updated_at = SYSUTCDATETIME()
                WHERE id = @Id;
                """, p, cancellationToken: ct));

            if (affected == 0) return Results.NotFound();
            var updated = await db.QuerySingleAsync<WhitelistDto>(new CommandDefinition(
                $"SELECT {SelectColumns} FROM dbo.ip_whitelist WHERE id = @id;", new { id }, cancellationToken: ct));
            return Results.Ok(updated);
        }).RequireAuthorization(Scopes.Admin);

        // Bulk add — used by the IP Match page to whitelist several matched IPs at once.
        // Skips entries that violate the unique (ip_cidr, app, server, env) constraint.
        group.MapPost("/bulk", async (
            WhitelistUpsert[] body, ClaimsPrincipal user, ISqlConnectionFactory factory, CancellationToken ct) =>
        {
            var actor = user.Identity?.Name ?? "api";
            using var db = await factory.OpenAsync(ct);
            int created = 0, skipped = 0;

            foreach (var entry in body)
            {
                var (start, end) = IpRange.FromCidr(entry.IpCidr);
                var p = ToParams(entry, actor);
                p.Add("@Start", start);
                p.Add("@End", end);
                try
                {
                    await db.ExecuteAsync(new CommandDefinition(
                        """
                        DECLARE @buId INT = (SELECT bu_id FROM dbo.business_unit WHERE bu_name = @BuName);
                        IF @buId IS NULL BEGIN INSERT dbo.business_unit (bu_name) VALUES (@BuName); SET @buId = SCOPE_IDENTITY(); END
                        INSERT dbo.ip_whitelist
                            (ip_cidr, ip_start, ip_end, app_name, server, env, bu_id, bu_name, status, owner, notes, created_by, updated_by)
                        VALUES (@IpCidr, @Start, @End, @AppName, @Server, @Env, @buId, @BuName, @Status, @Owner, @Notes, @Actor, @Actor);
                        """, p, cancellationToken: ct));
                    created++;
                }
                catch (Microsoft.Data.SqlClient.SqlException ex) when (ex.Number is 2601 or 2627)
                {
                    skipped++; // duplicate entry — already whitelisted for this app/server/env
                }
            }

            return Results.Ok(new WhitelistBulkResult(created, skipped));
        }).RequireAuthorization(Scopes.Admin);

        group.MapDelete("/{id:int}", async (int id, ISqlConnectionFactory factory, CancellationToken ct) =>
        {
            using var db = await factory.OpenAsync(ct);
            var affected = await db.ExecuteAsync(new CommandDefinition(
                "DELETE FROM dbo.ip_whitelist WHERE id = @id;", new { id }, cancellationToken: ct));
            return affected == 0 ? Results.NotFound() : Results.NoContent();
        }).RequireAuthorization(Scopes.Admin);
    }

    private static DynamicParameters ToParams(WhitelistUpsert b, string actor)
    {
        var p = new DynamicParameters();
        p.Add("@IpCidr", b.IpCidr);
        p.Add("@AppName", b.AppName);
        p.Add("@Server", b.Server);
        p.Add("@Env", b.Env);
        p.Add("@BuName", b.BuName);
        p.Add("@Status", b.Status);
        p.Add("@Owner", b.Owner);
        p.Add("@Notes", b.Notes);
        p.Add("@Actor", actor);
        return p;
    }
}
