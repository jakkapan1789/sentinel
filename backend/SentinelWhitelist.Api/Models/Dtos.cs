namespace SentinelWhitelist.Api.Models;

public sealed class PagedResult<T>
{
    public required IReadOnlyList<T> Items { get; init; }
    public required int Total { get; init; }
    public required int Page { get; init; }
    public required int PageSize { get; init; }
}

/* ---------------- Ingestion payloads (from ETL webhook) -------------- */

public sealed record AppLogIngest(
    Guid? SourceEventId,
    string ClientIp,
    string BuName,
    string? AppName,
    string FunctionName,
    string ResponseStatus,      // "Success" | "Error"
    short? HttpStatusCode,
    string? DatabaseName,
    int? DurationMs,
    long? UsageCount,
    string? ServerName,
    string? HttpMethod,
    string? Endpoint,
    string? TraceId,
    string? Message,
    DateTime CreatedAt);

public sealed record NetworkLogIngest(
    Guid? SourceEventId,
    string SourceAddress,
    string? CountryCode,
    string? CountryName,
    string Url,
    DateOnly PeriodMonth,
    long? UsageCount,
    DateTime CreatedAt);

public sealed record IngestResult(int Received, int Inserted, int Duplicated);

/* ---------------- Read models (consumed by the SPA) ------------------ */

public sealed record AppLogDto(
    long Id,
    string ClientIp,
    string BuName,
    string? AppName,
    string FunctionName,
    string ResponseStatus,
    short? HttpStatusCode,
    string? DatabaseName,
    int? DurationMs,
    long UsageCount,
    string? ServerName,
    string? Message,
    DateTime CreatedAt);

public sealed record BuSummaryDto(
    string BuName,
    long TotalUsage,
    long Transactions,
    long SuccessCount,
    long ErrorCount,
    int ServerCount,
    string[] Servers,
    string[] Apps,
    DateTime? LastSeen);

// Distinct values per filterable column, scoped to a BU (drives the detail value-checklist filters).
public sealed record AppLogFacetsDto(
    string[] ClientIp,
    string[] AppName,
    string[] FunctionName,
    string[] ServerName,
    string[] DatabaseName);

public sealed record NetworkLogDto(
    long Id,
    string SourceAddress,
    string? CountryName,
    string Url,
    string PeriodMonth,   // 'yyyy-MM-dd'
    long UsageCount,
    DateTime CreatedAt);

public sealed record WhitelistDto(
    int Id,
    string IpCidr,
    string AppName,
    string Server,
    string Env,
    string BuName,
    string Status,
    string? Owner,
    string? Notes,
    string CreatedBy,
    string UpdatedBy,
    DateTime CreatedAt,
    DateTime UpdatedAt);

public sealed record WhitelistUpsert(
    string IpCidr,
    string AppName,
    string Server,
    string Env,
    string BuName,
    string Status,
    string? Owner,
    string? Notes);

public sealed record WhitelistBulkResult(int Created, int Skipped);

// ---- Whitelist acknowledgement (confirm) flow ----
public sealed record WhitelistAckCreate(
    int[] EntryIds,
    string? Recipient,
    string? Subject,
    string? Intro);

public sealed record WhitelistAckDto(
    int Id,
    string Token,
    string Status,
    string? Recipient,
    string? Subject,
    string ConfirmUrl,
    string Html,                 // server-rendered email body (table + confirm button)
    int ItemCount,
    int ActivatedCount,
    string CreatedBy,
    DateTime CreatedAt,
    DateTime? AcknowledgedAt,
    string? AcknowledgedNote);

// A network source IP (whitelisted ones are excluded). Matched = it also appears in app logs.
public sealed record IpMatchDto(
    string Ip,
    bool Matched,
    long AppUsage,
    long AppRequests,
    long NetworkUsage,
    long NetworkRequests,
    long TotalUsage,
    string[] BuNames,
    string[] AppNames,
    string[] Servers,
    string? BuName,       // dominant (highest-usage) values → whitelist prefill
    string? AppName,
    string? Server,
    string? Country,
    DateTime LastSeen);

public sealed record IpMatchFacetsDto(string[] Bu, string[] Country);

public sealed record IpMatchStatsDto(long Total, long Matched, long Unmatched, long CombinedUsage);

public sealed record IngestionSourceDto(
    int Id,
    string Name,
    string TokenPrefix,
    string? Token,
    string Scope,
    bool Enabled,
    string? AllowedCidr,
    DateTime? LastUsedAt,
    long TotalReceived,
    long TotalInserted,
    string CreatedBy,
    DateTime CreatedAt);

public sealed record IngestionSourceCreate(string Name, string? AllowedCidr);

public sealed record IngestionSourcePatch(bool? Enabled, string? AllowedCidr);

/// <summary>Returned once on create/rotate — contains the plaintext token.</summary>
public sealed record IngestionSecretDto(IngestionSourceDto Source, string Token);

public sealed record IngestionDeliveryDto(
    long Id,
    int? SourceId,
    string? SourceName,
    string Kind,
    int Received,
    int Inserted,
    string Status,
    string? Message,
    DateTime CreatedAt);

public sealed record DashboardDto(
    int WhitelistTotal,
    int WhitelistActive,
    int WhitelistPending,
    int WhitelistDisabled,
    long AppTotalUsage,
    long AppTransactions,
    long AppSuccess,
    long AppError,
    double SuccessRate,
    int UnmatchedSources);
