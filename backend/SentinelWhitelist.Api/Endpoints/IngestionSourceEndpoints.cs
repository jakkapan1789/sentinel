using System.Security.Claims;
using Dapper;
using SentinelWhitelist.Api.Auth;
using SentinelWhitelist.Api.Data;
using SentinelWhitelist.Api.Models;
using SentinelWhitelist.Api.Util;

namespace SentinelWhitelist.Api.Endpoints;

public static class IngestionSourceEndpoints
{
    private const string Cols =
        "id, name, token_prefix, token, scope, enabled, allowed_cidr, last_used_at, total_received, total_inserted, created_by, created_at";

    public static void MapIngestionSourceEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/ingestion/sources").RequireAuthorization(Scopes.Admin);

        group.MapGet("/", async (ISqlConnectionFactory factory, CancellationToken ct) =>
        {
            using var db = await factory.OpenAsync(ct);
            var items = await db.QueryAsync<IngestionSourceDto>(new CommandDefinition(
                $"SELECT {Cols} FROM dbo.ingestion_source ORDER BY created_at DESC;", cancellationToken: ct));
            return Results.Ok(items);
        });

        group.MapPost("/", async (IngestionSourceCreate body, ClaimsPrincipal user, ISqlConnectionFactory factory, CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(body.Name)) return Results.BadRequest(new { error = "Name is required." });
            var token = Tokens.Generate();
            var p = new
            {
                name = body.Name.Trim(),
                hash = Tokens.Sha256Hex(token),
                prefix = Tokens.Prefix(token),
                token,
                cidr = string.IsNullOrWhiteSpace(body.AllowedCidr) ? null : body.AllowedCidr.Trim(),
                actor = user.Identity?.Name ?? "api",
            };

            using var db = await factory.OpenAsync(ct);
            var id = await db.ExecuteScalarAsync<int>(new CommandDefinition(
                """
                INSERT dbo.ingestion_source (name, token_hash, token_prefix, token, scope, allowed_cidr, created_by)
                OUTPUT INSERTED.id
                VALUES (@name, @hash, @prefix, @token, 'ingestion', @cidr, @actor);
                """, p, cancellationToken: ct));

            var source = await db.QuerySingleAsync<IngestionSourceDto>(new CommandDefinition(
                $"SELECT {Cols} FROM dbo.ingestion_source WHERE id = @id;", new { id }, cancellationToken: ct));
            return Results.Created($"/api/v1/ingestion/sources/{id}", new IngestionSecretDto(source, token));
        });

        group.MapPost("/{id:int}/rotate", async (int id, ISqlConnectionFactory factory, CancellationToken ct) =>
        {
            var token = Tokens.Generate();
            using var db = await factory.OpenAsync(ct);
            var affected = await db.ExecuteAsync(new CommandDefinition(
                "UPDATE dbo.ingestion_source SET token_hash = @hash, token_prefix = @prefix, token = @token WHERE id = @id;",
                new { id, hash = Tokens.Sha256Hex(token), prefix = Tokens.Prefix(token), token }, cancellationToken: ct));
            if (affected == 0) return Results.NotFound();
            var source = await db.QuerySingleAsync<IngestionSourceDto>(new CommandDefinition(
                $"SELECT {Cols} FROM dbo.ingestion_source WHERE id = @id;", new { id }, cancellationToken: ct));
            return Results.Ok(new IngestionSecretDto(source, token));
        });

        group.MapPatch("/{id:int}", async (int id, IngestionSourcePatch body, ISqlConnectionFactory factory, CancellationToken ct) =>
        {
            using var db = await factory.OpenAsync(ct);
            var affected = await db.ExecuteAsync(new CommandDefinition(
                """
                UPDATE dbo.ingestion_source
                SET enabled      = COALESCE(@enabled, enabled),
                    allowed_cidr = CASE WHEN @setCidr = 1 THEN @cidr ELSE allowed_cidr END
                WHERE id = @id;
                """,
                new
                {
                    id,
                    enabled = body.Enabled,
                    setCidr = body.AllowedCidr is null ? 0 : 1,
                    cidr = string.IsNullOrWhiteSpace(body.AllowedCidr) ? null : body.AllowedCidr.Trim(),
                }, cancellationToken: ct));
            if (affected == 0) return Results.NotFound();
            var source = await db.QuerySingleAsync<IngestionSourceDto>(new CommandDefinition(
                $"SELECT {Cols} FROM dbo.ingestion_source WHERE id = @id;", new { id }, cancellationToken: ct));
            return Results.Ok(source);
        });

        group.MapDelete("/{id:int}", async (int id, ISqlConnectionFactory factory, CancellationToken ct) =>
        {
            using var db = await factory.OpenAsync(ct);
            // Detach delivery history (keep the log) before removing the source to satisfy the FK.
            var affected = await db.ExecuteAsync(new CommandDefinition(
                """
                UPDATE dbo.ingestion_delivery SET source_id = NULL WHERE source_id = @id;
                DELETE FROM dbo.ingestion_source WHERE id = @id;
                """, new { id }, cancellationToken: ct));
            return affected == 0 ? Results.NotFound() : Results.NoContent();
        });

        // Recent deliveries (admin) — separate path under /api/v1/ingestion.
        app.MapGet("/api/v1/ingestion/deliveries", async (int? take, ISqlConnectionFactory factory, CancellationToken ct) =>
        {
            var top = take is null or < 1 or > 200 ? 20 : take.Value;
            using var db = await factory.OpenAsync(ct);
            var items = await db.QueryAsync<IngestionDeliveryDto>(new CommandDefinition(
                """
                SELECT TOP (@top) d.id, d.source_id, COALESCE(d.source_name, s.name) AS source_name, d.kind,
                       d.received, d.inserted, d.status, d.message, d.created_at
                FROM dbo.ingestion_delivery d
                LEFT JOIN dbo.ingestion_source s ON s.id = d.source_id
                ORDER BY d.created_at DESC;
                """, new { top }, cancellationToken: ct));
            return Results.Ok(items);
        }).RequireAuthorization(Scopes.Admin);
    }
}
