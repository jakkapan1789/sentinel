using Dapper;
using SentinelWhitelist.Api.Auth;
using SentinelWhitelist.Api.Data;
using SentinelWhitelist.Api.Models;

namespace SentinelWhitelist.Api.Endpoints;

public static class NetworkLogEndpoints
{
    public static void MapNetworkLogEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/network-logs").RequireAuthorization(Scopes.Read);

        group.MapGet("/", async (
            string? search, int? page, int? pageSize, ISqlConnectionFactory factory, CancellationToken ct) =>
        {
            var pageNum = page is null or < 1 ? 1 : page.Value;
            var size = pageSize is null or < 1 ? 10 : Math.Min(pageSize.Value, 1000);

            var p = new DynamicParameters();
            p.Add("@search", string.IsNullOrWhiteSpace(search) ? null : $"%{search.Trim()}%");
            p.Add("@off", (pageNum - 1) * size);
            p.Add("@ps", size);

            const string where = """
                WHERE (@search IS NULL OR source_address LIKE @search OR url LIKE @search OR country_name LIKE @search)
                """;

            using var db = await factory.OpenAsync(ct);
            var total = await db.ExecuteScalarAsync<int>(new CommandDefinition(
                $"SELECT COUNT_BIG(*) FROM dbo.network_log {where};", p, cancellationToken: ct));

            var items = (await db.QueryAsync<NetworkLogDto>(new CommandDefinition(
                $"""
                SELECT id, source_address, country_name, url,
                       CONVERT(char(10), period_month, 23) AS period_month, usage_count, created_at
                FROM dbo.network_log
                {where}
                ORDER BY created_at DESC, id DESC
                OFFSET @off ROWS FETCH NEXT @ps ROWS ONLY;
                """, p, cancellationToken: ct))).ToList();

            return Results.Ok(new PagedResult<NetworkLogDto>
            {
                Items = items, Total = total, Page = pageNum, PageSize = size
            });
        });
    }
}
