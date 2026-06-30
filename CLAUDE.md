# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Sentinel Whitelist Center** — an enterprise app to manage an IP whitelist (IPs allowed to connect, scoped by web server + application), store/inspect Application IP logs and Network IP logs, and reconcile the two. A monorepo with three parts:

- **Frontend** (repo root): React 19 + Vite + TypeScript + Tailwind v4.
- **Backend** (`backend/SentinelWhitelist.Api`): .NET 8 minimal API + Dapper + SQL Server.
- **Database** (`db/*.sql`): hand-applied SQL Server migrations.

There is no login yet (demo mode); the UI uses a single static bearer token.

## Commands

Frontend (run from repo root):
- `npm run dev` — Vite dev server on `:5173`.
- `npm run build` — `tsc -b && vite build`. **This is the typecheck**; there is no separate lint or test script. Run it after frontend changes.
- `npm run preview` — serve the production build.

Backend (run from `backend/SentinelWhitelist.Api`):
- `dotnet build` — compiles; the project is `net8.0` with `<RollForward>LatestMajor</RollForward>` so it builds on newer SDKs.
- `dotnet run` — serves the API on `http://localhost:5080` (Swagger at `/swagger` in Development).

There are **no automated tests** in this repo. Verify changes by building both sides and exercising the API with `curl` / the running UI.

### Database

SQL Server runs in a Docker container named **`flowable_poc`**, database **`SentinelWhitelistCenter`** (connection string under `ConnectionStrings:Sql` in `backend/.../appsettings.json`). Apply migrations **in numeric order** (`001` → `004`):

```bash
docker exec -i flowable_poc /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -P Passw0rd -C -d SentinelWhitelistCenter < db/00X_*.sql
```

- Every `.sql` file (and any manual DDL/DML you run) **must have `SET QUOTED_IDENTIFIER ON; SET ANSI_NULLS ON;`** — required because of filtered indexes, the columnstore indexes, and the temporal `ip_whitelist` table. A bare `DELETE FROM dbo.ip_whitelist` via `sqlcmd` fails without it (the API's `Microsoft.Data.SqlClient` sets it automatically).
- After ingesting/changing raw data, rebuild summaries with `usp_rollup_reset` then re-run every `usp_rollup_*` proc (see below), or hit the Refresh button / `POST /api/v1/summary/refresh`.

## Architecture

### Frontend data flow

- **`src/lib/dataSource.ts` is the single data-access layer.** All pages call `dataSource.*`, never `api.*` directly. Its core switch: `const useApi = apiConfigured || import.meta.env.PROD`. **Production builds always call the real API and never serve mock data.** In dev, when `.env.local` (`VITE_API_BASE_URL` + `VITE_API_TOKEN`, see `.env.example`) is absent, it falls back to the in-memory seed in `src/data/seed.ts` for offline demos. When adding a data method, implement both the `api` path and a mock path.
- **`src/lib/api.ts`** is the typed HTTP client; **`src/types.ts`** mirrors the backend DTOs in camelCase (one type flows end-to-end: SQL `snake_case` → C# record `PascalCase` → TS `camelCase`).
- **Routing is hash-based** in `src/App.tsx` (`#/dashboard`, `#/application-logs/<BU>`, etc.) so refresh persists state. Adding a page means touching: `types.ts` (`ViewKey` + interfaces), `api.ts`, `dataSource.ts` (+ mock), `App.tsx` (route + `VIEWS`), and `Layout.tsx` (nav item).
- **Global refresh** (`src/lib/refresh.tsx`): the topbar Refresh button calls `dataSource.refreshSummary()` then `bump()`. Pages subscribe via `useRefreshVersion()` and include `version` in their `useAsync` deps. Guard against flicker with `loading && !data` (keep showing prior data while re-fetching).
- **`src/lib/useAsync.ts`** runs a loader on dep change with a `reload()`; it cancels stale results.

### `DataTable` (`src/components/DataTable.tsx`)

One generic table used everywhere, in two modes:
- **Client mode** — pass `rows`; it sorts/pages/filters in-memory. Column value-checklist filters come from the rows.
- **Server mode** — pass `server={{ total, page, pageSize, sort*, on*, filters }}`; `rows` is just the current page. Because distinct values can't be derived from one page, **server-mode column filters require the parent to supply `filters.options`** (usually from a `/facets` endpoint) and apply selections by re-querying. Filters are multi-select → the parent joins values CSV and the API expands them with `IN`.
- Optional `selection` prop adds a checkbox column (parent owns the selection set; use a `Map` to keep selections across pages).

### Backend (minimal API + Dapper)

- `Program.cs` sets `DefaultTypeMap.MatchNamesWithUnderscores = true`, so SQL `snake_case` maps to DTO `PascalCase` automatically. Endpoints are grouped one file per area in `Endpoints/` and registered in `Program.cs`.
- **Auth** (`Auth/TokenAuthenticationHandler.cs`): bearer tokens validated first against config `ApiTokens` (the UI token), then against DB `ingestion_source` rows (SHA-256 hashed). Scopes are `ingestion` / `read` / `admin` (`Auth/ApiTokenOptions.cs`); endpoints declare `.RequireAuthorization(Scopes.X)`.
- **SQL-injection safety**: list/sort params are whitelisted (see `ResolveOrderBy` + `SortColumns` dicts) and all values are parameterized. Build `WHERE` dynamically when using Dapper list expansion (`col IN @list`) — the `@p IS NULL OR col IN @p` pattern does **not** work with list params, so only append the `IN` clause when the list is non-empty.

### Scale model — read from rollups, not raw

The fact tables `app_log_ip` and `network_log` are monthly-partitioned with nonclustered columnstore and a **60-day raw retention** (`usp_purge_old_partitions`); they are designed for ~400M+ rows. **Read endpoints aggregate from rollup tables, never scan the raw fact**, except the BU-detail list and `/facets` (which are scoped to one BU). Rollups are **watermark-incremental**: each `usp_rollup_*` proc reads only `id > last_id` from `dbo.rollup_watermark`, MERGEs the delta into its summary table, and advances the watermark — all in one transaction. There is **no SQL Agent**; refresh is on-demand.

- Rollup tables/procs live in `db/002_summary.sql` (app daily/servers/apps, network monthly) and `db/004_ip_match.sql` (per-IP `app_ip_daily` + `network_ip_monthly`).
- `POST /api/v1/summary/refresh` (admin) runs the full `EXEC` set — **when you add a rollup proc, add its `EXEC` both there (`DashboardEndpoints.cs`) and in `usp_rollup_reset`.**
- Full rebuild = `EXEC usp_rollup_reset;` then run every `usp_rollup_*` proc.

### IP whitelist matching

`ip_whitelist` is a system-versioned (temporal) table with `ip_start`/`ip_end` `VARBINARY(16)` range columns + a filtered index `IX_wl_range` for fast CIDR-containment checks. `Util/IpRange.FromCidr` produces those bytes (big-endian `a.b.c.d`). The IP Match feature (`IpMatchEndpoints.cs`, `db/004`) precomputes `ip_bin` in the rollups in the **same byte layout**, so coverage is a pure range seek: `w.ip_start <= ip_bin AND w.ip_end >= ip_bin`. Coverage has three states — `active` = whitelisted, `pending` = added but not enforced, none = not whitelisted.
