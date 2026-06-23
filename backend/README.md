# Sentinel Whitelist Center — Backend (.NET 8)

REST API (minimal API + Dapper + SQL Server) that receives ETL data via the ingestion
endpoints and serves the SPA. Auth is **Bearer token** with scopes (`ingestion`, `read`, `admin`).

## 1. Database
Run the scripts (in order) against your SQL Server database:

```
sqlcmd -S <server> -d SentinelWhitelistCenter -i db/001_schema.sql
sqlcmd -S <server> -d SentinelWhitelistCenter -i db/002_summary.sql
sqlcmd -S <server> -d SentinelWhitelistCenter -i db/003_ingestion_sources.sql
```

Includes: business_unit dim (auto-created on ingest), app_log_ip / network_log
(monthly-partitioned + columnstore), ip_whitelist (temporal/system-versioned for audit),
TVP types, idempotent ingest procs, summary tables + watermark-incremental rollups,
ingestion source/token tables, and a retention proc.

No seed data — start empty for production. Summaries are empty until the first rollup;
refresh on demand via `POST /api/v1/summary/refresh` (the dashboard **Refresh** button)
or schedule the rollup procs externally (cron / Task Scheduler). See the footer of
`db/002_summary.sql` for the exact commands.

## 2. API
```
cd backend/SentinelWhitelist.Api
dotnet restore
# set the connection + tokens:
#   appsettings.json -> ConnectionStrings:Sql, ApiTokens[].Token
dotnet run
```
Swagger at `/swagger` (Development). Health at `/`.

### Endpoints
| Method | Path | Scope | Purpose |
|--------|------|-------|---------|
| POST | /api/v1/ingestion/app-logs | ingestion | batch array (idempotent by `sourceEventId`) |
| POST | /api/v1/ingestion/network-logs | ingestion | batch array |
| GET | /api/v1/app-logs/bu-summary | read | BU summary table |
| GET | /api/v1/app-logs?bu=&search=&responseStatus=&page=&pageSize= | read | transaction detail (paged) |
| GET | /api/v1/network-logs?search=&page=&pageSize= | read | network logs (paged) |
| GET | /api/v1/whitelist?status=&search= | read | whitelist list |
| POST/PUT/DELETE | /api/v1/whitelist[/{id}] | admin | whitelist CRUD (auto-creates BU) |
| GET | /api/v1/dashboard | read | KPI summary |
| GET/POST | /api/v1/ingestion/sources[/{id}] | admin | manage ingestion source tokens |
| GET | /api/v1/ingestion/deliveries | admin | recent ingestion deliveries |

### Ingestion payload (example)
```jsonc
// POST /api/v1/ingestion/app-logs   Authorization: Bearer <ingestion token>
[
  {
    "sourceEventId": "9b1c...-uuid",   // idempotency key (optional; recommended)
    "clientIp": "172.27.10.25",
    "buName": "Retail Banking",          // auto-created if new
    "functionName": "GetCustomerProfile",
    "responseStatus": "Success",         // or "Error"
    "httpStatusCode": 200,
    "databaseName": "customer_core",
    "durationMs": 42,
    "usageCount": 1,
    "serverName": "prod-api-01",
    "httpMethod": "GET",
    "endpoint": "/api/customer/profile",
    "traceId": "abc123",
    "message": null,
    "createdAt": "2026-06-22T03:00:00Z"
  }
]
```

## 3. Frontend integration
1. `cp .env.example .env.local`, set `VITE_API_BASE_URL` and a `read,admin` `VITE_API_TOKEN`.
2. CORS: add the Vite origin to `appsettings.json` → `Cors:AllowedOrigins`.
3. Use `src/lib/api.ts` in the pages (replaces the localStorage `useCollection`). The API
   returns camelCase DTOs; small field-name mapping is needed where the SPA type differs
   (e.g. whitelist `ipCidr → ipAddress`, `appName → application`, `server → webServer`,
   `env → environment`, `buName → bu`, `notes → description`).
