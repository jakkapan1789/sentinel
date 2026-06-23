using System.Data;
using Microsoft.Data.SqlClient;

namespace SentinelWhitelist.Api.Data;

public interface ISqlConnectionFactory
{
    Task<IDbConnection> OpenAsync(CancellationToken ct = default);
}

public sealed class SqlConnectionFactory : ISqlConnectionFactory
{
    private readonly string _connectionString;

    public SqlConnectionFactory(IConfiguration configuration)
    {
        _connectionString = configuration.GetConnectionString("Sql")
            ?? throw new InvalidOperationException("Missing connection string 'Sql'.");
    }

    public async Task<IDbConnection> OpenAsync(CancellationToken ct = default)
    {
        var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync(ct);
        return connection;
    }
}
