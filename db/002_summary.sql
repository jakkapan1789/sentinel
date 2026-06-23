/* =====================================================================
   Sentinel Whitelist Center — Summary (rollup) tables + watermark-incremental
   rollups. No SQL Agent: refresh on demand via POST /api/v1/summary/refresh
   (the dashboard "Refresh" button) or an external scheduler (see footer).

   Rollups are INCREMENTAL: each proc processes only rows newer than its
   watermark (app_log_ip.id / network_log.id), adds the deltas into the
   summary, then advances the watermark — all in one transaction.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO

/* ---------- Summary: app usage daily (per BU + function) ------------- */
IF OBJECT_ID('dbo.app_log_summary_daily') IS NULL
CREATE TABLE dbo.app_log_summary_daily (
    summary_date      DATE          NOT NULL,
    bu_name           NVARCHAR(120) NOT NULL,
    function_name     NVARCHAR(200) NOT NULL,
    total_requests    BIGINT NOT NULL,
    success_count     BIGINT NOT NULL,
    error_count       BIGINT NOT NULL,
    total_usage       BIGINT NOT NULL,
    total_duration_ms BIGINT NOT NULL,
    avg_duration_ms   AS (CASE WHEN total_requests > 0 THEN total_duration_ms / total_requests END),
    distinct_clients  INT    NOT NULL,   -- not maintained incrementally (use raw within retention)
    refreshed_at      DATETIME2(3) NOT NULL CONSTRAINT DF_appsum_ref DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_app_log_summary_daily PRIMARY KEY (summary_date, bu_name, function_name)
);
GO

/* ---------- Summary: network usage monthly --------------------------- */
IF OBJECT_ID('dbo.network_log_summary_monthly') IS NULL
CREATE TABLE dbo.network_log_summary_monthly (
    period_month   DATE          NOT NULL,
    country_code   CHAR(2)       NOT NULL CONSTRAINT DF_netsum_cc DEFAULT('??'),
    whitelisted    BIT           NOT NULL,
    total_usage    BIGINT NOT NULL,
    request_count  BIGINT NOT NULL,
    refreshed_at   DATETIME2(3)  NOT NULL CONSTRAINT DF_netsum_ref DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_network_log_summary_monthly PRIMARY KEY (period_month, country_code, whitelisted)
);
GO

/* ---------- Summary: server dimension per BU (drives BU summary page) - */
IF OBJECT_ID('dbo.app_server_daily') IS NULL
CREATE TABLE dbo.app_server_daily (
    summary_date   DATE          NOT NULL,
    bu_name        NVARCHAR(120) NOT NULL,
    server_name    NVARCHAR(128) NOT NULL,
    request_count  BIGINT NOT NULL,
    total_usage    BIGINT NOT NULL,
    last_seen      DATETIME2(3) NOT NULL,
    CONSTRAINT PK_app_server_daily PRIMARY KEY (summary_date, bu_name, server_name)
);
GO

/* ---------- Incremental rollup control + supporting indexes ---------- */
IF OBJECT_ID('dbo.rollup_watermark') IS NULL
CREATE TABLE dbo.rollup_watermark (
    rollup_name VARCHAR(50)  NOT NULL CONSTRAINT PK_rollup_watermark PRIMARY KEY,
    last_id     BIGINT       NOT NULL CONSTRAINT DF_rwm_last DEFAULT(0),
    updated_at  DATETIME2(3) NOT NULL CONSTRAINT DF_rwm_upd  DEFAULT SYSUTCDATETIME()
);
GO
-- Range index on the identity so "id > @last" is a fast seek (segment-friendly).
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_app_id' AND object_id = OBJECT_ID('dbo.app_log_ip'))
    CREATE NONCLUSTERED INDEX IX_app_id ON dbo.app_log_ip (id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_net_id' AND object_id = OBJECT_ID('dbo.network_log'))
    CREATE NONCLUSTERED INDEX IX_net_id ON dbo.network_log (id);
GO

/* ---------- Rollup: app daily (incremental) -------------------------- */
CREATE OR ALTER PROCEDURE dbo.usp_rollup_app_daily
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @last BIGINT, @newMax BIGINT;

    BEGIN TRAN;
        SELECT @last = last_id FROM dbo.rollup_watermark WITH (UPDLOCK, HOLDLOCK) WHERE rollup_name = 'app_daily';
        IF @last IS NULL
        BEGIN
            INSERT dbo.rollup_watermark (rollup_name, last_id) VALUES ('app_daily', 0);
            SET @last = 0;
        END

        SELECT id,
               CAST(created_at AS DATE) AS summary_date, bu_name, function_name, response_status,
               usage_count, CAST(ISNULL(duration_ms, 0) AS BIGINT) AS duration_ms
        INTO #app
        FROM dbo.app_log_ip
        WHERE id > @last;

        SET @newMax = (SELECT MAX(id) FROM #app);

        IF @newMax IS NOT NULL
        BEGIN
            ;WITH agg AS (
                SELECT summary_date, bu_name, function_name,
                       COUNT_BIG(*) AS req,
                       SUM(CASE WHEN response_status = 'Success' THEN 1 ELSE 0 END) AS succ,
                       SUM(CASE WHEN response_status = 'Error'   THEN 1 ELSE 0 END) AS err,
                       SUM(usage_count)  AS usage_sum,
                       SUM(duration_ms)  AS dur_sum
                FROM #app
                GROUP BY summary_date, bu_name, function_name
            )
            MERGE dbo.app_log_summary_daily AS t
            USING agg AS s
               ON t.summary_date = s.summary_date AND t.bu_name = s.bu_name AND t.function_name = s.function_name
            WHEN MATCHED THEN UPDATE SET
                total_requests    = t.total_requests + s.req,
                success_count     = t.success_count + s.succ,
                error_count       = t.error_count + s.err,
                total_usage       = t.total_usage + s.usage_sum,
                total_duration_ms = t.total_duration_ms + s.dur_sum,
                refreshed_at      = SYSUTCDATETIME()
            WHEN NOT MATCHED BY TARGET THEN INSERT
                (summary_date, bu_name, function_name, total_requests, success_count, error_count,
                 total_usage, total_duration_ms, distinct_clients)
                VALUES (s.summary_date, s.bu_name, s.function_name, s.req, s.succ, s.err, s.usage_sum, s.dur_sum, 0);

            UPDATE dbo.rollup_watermark SET last_id = @newMax, updated_at = SYSUTCDATETIME() WHERE rollup_name = 'app_daily';
        END
    COMMIT;
END
GO

/* ---------- Rollup: app servers (incremental) ------------------------ */
CREATE OR ALTER PROCEDURE dbo.usp_rollup_app_servers
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @last BIGINT, @newMax BIGINT;

    BEGIN TRAN;
        SELECT @last = last_id FROM dbo.rollup_watermark WITH (UPDLOCK, HOLDLOCK) WHERE rollup_name = 'app_servers';
        IF @last IS NULL
        BEGIN
            INSERT dbo.rollup_watermark (rollup_name, last_id) VALUES ('app_servers', 0);
            SET @last = 0;
        END

        SELECT id, CAST(created_at AS DATE) AS summary_date, bu_name, server_name, usage_count, created_at
        INTO #srv
        FROM dbo.app_log_ip
        WHERE id > @last;

        SET @newMax = (SELECT MAX(id) FROM #srv);

        IF @newMax IS NOT NULL
        BEGIN
            ;WITH agg AS (
                SELECT summary_date, bu_name, server_name,
                       COUNT_BIG(*) AS req, SUM(usage_count) AS usage_sum, MAX(created_at) AS last_seen
                FROM #srv
                WHERE server_name IS NOT NULL
                GROUP BY summary_date, bu_name, server_name
            )
            MERGE dbo.app_server_daily AS t
            USING agg AS s
               ON t.summary_date = s.summary_date AND t.bu_name = s.bu_name AND t.server_name = s.server_name
            WHEN MATCHED THEN UPDATE SET
                request_count = t.request_count + s.req,
                total_usage   = t.total_usage + s.usage_sum,
                last_seen     = CASE WHEN s.last_seen > t.last_seen THEN s.last_seen ELSE t.last_seen END
            WHEN NOT MATCHED BY TARGET THEN INSERT
                (summary_date, bu_name, server_name, request_count, total_usage, last_seen)
                VALUES (s.summary_date, s.bu_name, s.server_name, s.req, s.usage_sum, s.last_seen);

            UPDATE dbo.rollup_watermark SET last_id = @newMax, updated_at = SYSUTCDATETIME() WHERE rollup_name = 'app_servers';
        END
    COMMIT;
END
GO

/* ---------- Rollup: network monthly (incremental) -------------------- */
CREATE OR ALTER PROCEDURE dbo.usp_rollup_network_monthly
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @last BIGINT, @newMax BIGINT;

    BEGIN TRAN;
        SELECT @last = last_id FROM dbo.rollup_watermark WITH (UPDLOCK, HOLDLOCK) WHERE rollup_name = 'network_monthly';
        IF @last IS NULL
        BEGIN
            INSERT dbo.rollup_watermark (rollup_name, last_id) VALUES ('network_monthly', 0);
            SET @last = 0;
        END

        SELECT id, period_month, ISNULL(country_code, '??') AS country_code, source_address, usage_count
        INTO #net
        FROM dbo.network_log
        WHERE id > @last;

        SET @newMax = (SELECT MAX(id) FROM #net);

        IF @newMax IS NOT NULL
        BEGIN
            ;WITH allowed AS (
                SELECT DISTINCT
                    PARSENAME(LEFT(ip_cidr, CHARINDEX('/', ip_cidr + '/') - 1), 4) + '.' +
                    PARSENAME(LEFT(ip_cidr, CHARINDEX('/', ip_cidr + '/') - 1), 3) AS prefix
                FROM dbo.ip_whitelist WHERE status = 'active'
            ),
            n AS (
                SELECT period_month, country_code,
                       CAST(CASE WHEN EXISTS (
                           SELECT 1 FROM allowed w
                           WHERE w.prefix = PARSENAME(source_address, 4) + '.' + PARSENAME(source_address, 3)
                       ) THEN 1 ELSE 0 END AS BIT) AS whitelisted,
                       usage_count
                FROM #net
            ),
            agg AS (
                SELECT period_month, country_code, whitelisted,
                       SUM(usage_count) AS usage_sum, COUNT_BIG(*) AS req
                FROM n GROUP BY period_month, country_code, whitelisted
            )
            MERGE dbo.network_log_summary_monthly AS t
            USING agg AS s
               ON t.period_month = s.period_month AND t.country_code = s.country_code AND t.whitelisted = s.whitelisted
            WHEN MATCHED THEN UPDATE SET
                total_usage   = t.total_usage + s.usage_sum,
                request_count = t.request_count + s.req,
                refreshed_at  = SYSUTCDATETIME()
            WHEN NOT MATCHED BY TARGET THEN INSERT
                (period_month, country_code, whitelisted, total_usage, request_count)
                VALUES (s.period_month, s.country_code, s.whitelisted, s.usage_sum, s.req);

            UPDATE dbo.rollup_watermark SET last_id = @newMax, updated_at = SYSUTCDATETIME() WHERE rollup_name = 'network_monthly';
        END
    COMMIT;
END
GO

/* ---------- Reset helper (truncate summaries + rewind watermarks) ----
   Use once when switching to incremental, then run the rollups to rebuild. */
CREATE OR ALTER PROCEDURE dbo.usp_rollup_reset
AS
BEGIN
    SET NOCOUNT ON;
    TRUNCATE TABLE dbo.app_log_summary_daily;
    TRUNCATE TABLE dbo.app_server_daily;
    TRUNCATE TABLE dbo.network_log_summary_monthly;
    DELETE FROM dbo.rollup_watermark;
END
GO

/* ---------------------------------------------------------------------
   Scheduling: NO SQL Agent required.
   - Summaries refresh on demand via the API:  POST /api/v1/summary/refresh
     (the "Refresh summary" button in the dashboard calls it).
   - For automatic refresh, point any external scheduler at it, e.g.:
       * Windows Task Scheduler / cron running:
           sqlcmd -S <srv> -d SentinelWhitelistCenter -Q "EXEC dbo.usp_rollup_app_daily; EXEC dbo.usp_rollup_app_servers; EXEC dbo.usp_rollup_network_monthly;"
       * or curl POST .../api/v1/summary/refresh with a read/admin token.
   - Retention (run daily from the same scheduler):
           EXEC dbo.usp_purge_old_partitions @days_to_keep = 60;
   --------------------------------------------------------------------- */
PRINT 'Summary + incremental rollups 002 applied.';
GO
