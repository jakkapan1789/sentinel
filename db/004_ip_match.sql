/* =====================================================================
   Sentinel Whitelist Center — IP Match reconciliation rollups.

   Per-IP aggregates so the "IP Match" page can join Application client IPs
   against Network source IPs at scale without scanning the raw fact tables.
   Same watermark-incremental pattern as 002; wired into the Refresh button.

   ip_bin (VARBINARY(16)) is the IPv4 address in the SAME byte layout the
   API's IpRange.FromCidr produces (big-endian a.b.c.d), so whitelist
   coverage is a pure range seek on IX_wl_range (ip_start..ip_end).
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO

/* ---------- Per-IP app usage (daily) -------------------------------- */
IF OBJECT_ID('dbo.app_ip_daily') IS NULL
CREATE TABLE dbo.app_ip_daily (
    summary_date  DATE          NOT NULL,
    client_ip     VARCHAR(45)   NOT NULL,
    ip_bin        VARBINARY(16) NULL,
    bu_name       NVARCHAR(120) NOT NULL,
    server_name   NVARCHAR(128) NOT NULL CONSTRAINT DF_aip_srv DEFAULT(N''),
    app_name      NVARCHAR(200) NOT NULL CONSTRAINT DF_aip_app DEFAULT(N''),
    request_count BIGINT        NOT NULL,
    total_usage   BIGINT        NOT NULL,
    success_count BIGINT        NOT NULL,
    error_count   BIGINT        NOT NULL,
    last_seen     DATETIME2(3)  NOT NULL,
    CONSTRAINT PK_app_ip_daily PRIMARY KEY (summary_date, client_ip, bu_name, server_name, app_name)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_app_ip_daily_ip' AND object_id = OBJECT_ID('dbo.app_ip_daily'))
    CREATE NONCLUSTERED INDEX IX_app_ip_daily_ip ON dbo.app_ip_daily (client_ip)
        INCLUDE (ip_bin, bu_name, total_usage, request_count, last_seen);
GO

/* ---------- Per-IP network usage (monthly) -------------------------- */
IF OBJECT_ID('dbo.network_ip_monthly') IS NULL
CREATE TABLE dbo.network_ip_monthly (
    period_month   DATE          NOT NULL,
    source_address VARCHAR(45)   NOT NULL,
    ip_bin         VARBINARY(16) NULL,
    country_code   CHAR(2)       NOT NULL CONSTRAINT DF_nip_cc DEFAULT('??'),
    country_name   NVARCHAR(100) NULL,
    request_count  BIGINT        NOT NULL,
    total_usage    BIGINT        NOT NULL,
    last_seen      DATETIME2(3)  NOT NULL,
    CONSTRAINT PK_network_ip_monthly PRIMARY KEY (period_month, source_address, country_code)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_net_ip_monthly_ip' AND object_id = OBJECT_ID('dbo.network_ip_monthly'))
    CREATE NONCLUSTERED INDEX IX_net_ip_monthly_ip ON dbo.network_ip_monthly (source_address)
        INCLUDE (ip_bin, country_name, total_usage, request_count, last_seen);
GO

/* ---------- Rollup: app IPs (incremental) --------------------------- */
CREATE OR ALTER PROCEDURE dbo.usp_rollup_app_ips
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @last BIGINT, @newMax BIGINT;

    BEGIN TRAN;
        SELECT @last = last_id FROM dbo.rollup_watermark WITH (UPDLOCK, HOLDLOCK) WHERE rollup_name = 'app_ips';
        IF @last IS NULL
        BEGIN
            INSERT dbo.rollup_watermark (rollup_name, last_id) VALUES ('app_ips', 0);
            SET @last = 0;
        END

        SELECT id, CAST(created_at AS DATE) AS summary_date, client_ip, bu_name,
               ISNULL(server_name, N'') AS server_name, ISNULL(app_name, N'') AS app_name,
               response_status, usage_count, created_at
        INTO #ai
        FROM dbo.app_log_ip
        WHERE id > @last;

        SET @newMax = (SELECT MAX(id) FROM #ai);

        IF @newMax IS NOT NULL
        BEGIN
            ;WITH agg AS (
                SELECT summary_date, client_ip, bu_name, server_name, app_name,
                       COUNT_BIG(*) AS req,
                       SUM(CASE WHEN response_status = 'Success' THEN 1 ELSE 0 END) AS succ,
                       SUM(CASE WHEN response_status = 'Error'   THEN 1 ELSE 0 END) AS err,
                       SUM(usage_count) AS usage_sum, MAX(created_at) AS last_seen
                FROM #ai
                GROUP BY summary_date, client_ip, bu_name, server_name, app_name
            )
            MERGE dbo.app_ip_daily AS t
            USING agg AS s
               ON t.summary_date = s.summary_date AND t.client_ip = s.client_ip AND t.bu_name = s.bu_name
                  AND t.server_name = s.server_name AND t.app_name = s.app_name
            WHEN MATCHED THEN UPDATE SET
                request_count = t.request_count + s.req,
                total_usage   = t.total_usage + s.usage_sum,
                success_count = t.success_count + s.succ,
                error_count   = t.error_count + s.err,
                last_seen     = CASE WHEN s.last_seen > t.last_seen THEN s.last_seen ELSE t.last_seen END
            WHEN NOT MATCHED BY TARGET THEN INSERT
                (summary_date, client_ip, ip_bin, bu_name, server_name, app_name,
                 request_count, total_usage, success_count, error_count, last_seen)
                VALUES (s.summary_date, s.client_ip,
                    CONVERT(VARBINARY(16), CONVERT(BINARY(4),
                        TRY_CAST(PARSENAME(s.client_ip, 4) AS BIGINT) * 16777216
                      + TRY_CAST(PARSENAME(s.client_ip, 3) AS BIGINT) * 65536
                      + TRY_CAST(PARSENAME(s.client_ip, 2) AS BIGINT) * 256
                      + TRY_CAST(PARSENAME(s.client_ip, 1) AS BIGINT))),
                    s.bu_name, s.server_name, s.app_name, s.req, s.usage_sum, s.succ, s.err, s.last_seen);

            UPDATE dbo.rollup_watermark SET last_id = @newMax, updated_at = SYSUTCDATETIME() WHERE rollup_name = 'app_ips';
        END
    COMMIT;
END
GO

/* ---------- Rollup: network IPs (incremental) ----------------------- */
CREATE OR ALTER PROCEDURE dbo.usp_rollup_network_ips
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @last BIGINT, @newMax BIGINT;

    BEGIN TRAN;
        SELECT @last = last_id FROM dbo.rollup_watermark WITH (UPDLOCK, HOLDLOCK) WHERE rollup_name = 'net_ips';
        IF @last IS NULL
        BEGIN
            INSERT dbo.rollup_watermark (rollup_name, last_id) VALUES ('net_ips', 0);
            SET @last = 0;
        END

        SELECT id, period_month, source_address, ISNULL(country_code, '??') AS country_code,
               country_name, usage_count, created_at
        INTO #ni
        FROM dbo.network_log
        WHERE id > @last;

        SET @newMax = (SELECT MAX(id) FROM #ni);

        IF @newMax IS NOT NULL
        BEGIN
            ;WITH agg AS (
                SELECT period_month, source_address, country_code,
                       MAX(country_name) AS country_name,
                       COUNT_BIG(*) AS req, SUM(usage_count) AS usage_sum, MAX(created_at) AS last_seen
                FROM #ni
                GROUP BY period_month, source_address, country_code
            )
            MERGE dbo.network_ip_monthly AS t
            USING agg AS s
               ON t.period_month = s.period_month AND t.source_address = s.source_address AND t.country_code = s.country_code
            WHEN MATCHED THEN UPDATE SET
                request_count = t.request_count + s.req,
                total_usage   = t.total_usage + s.usage_sum,
                country_name  = ISNULL(s.country_name, t.country_name),
                last_seen     = CASE WHEN s.last_seen > t.last_seen THEN s.last_seen ELSE t.last_seen END
            WHEN NOT MATCHED BY TARGET THEN INSERT
                (period_month, source_address, ip_bin, country_code, country_name, request_count, total_usage, last_seen)
                VALUES (s.period_month, s.source_address,
                    CONVERT(VARBINARY(16), CONVERT(BINARY(4),
                        TRY_CAST(PARSENAME(s.source_address, 4) AS BIGINT) * 16777216
                      + TRY_CAST(PARSENAME(s.source_address, 3) AS BIGINT) * 65536
                      + TRY_CAST(PARSENAME(s.source_address, 2) AS BIGINT) * 256
                      + TRY_CAST(PARSENAME(s.source_address, 1) AS BIGINT))),
                    s.country_code, s.country_name, s.req, s.usage_sum, s.last_seen);

            UPDATE dbo.rollup_watermark SET last_id = @newMax, updated_at = SYSUTCDATETIME() WHERE rollup_name = 'net_ips';
        END
    COMMIT;
END
GO

/* ---------- Reset helper (supersedes the 002 version) ---------------
   Truncates all summary tables (incl. the IP-match rollups) and rewinds
   the watermarks, so a full rebuild = reset + run every rollup. */
CREATE OR ALTER PROCEDURE dbo.usp_rollup_reset
AS
BEGIN
    SET NOCOUNT ON;
    TRUNCATE TABLE dbo.app_log_summary_daily;
    TRUNCATE TABLE dbo.app_server_daily;
    TRUNCATE TABLE dbo.app_application_daily;
    TRUNCATE TABLE dbo.network_log_summary_monthly;
    TRUNCATE TABLE dbo.app_ip_daily;
    TRUNCATE TABLE dbo.network_ip_monthly;
    DELETE FROM dbo.rollup_watermark;
END
GO

/* ---------------------------------------------------------------------
   Add these to the refresh set (the API does this automatically):
     EXEC dbo.usp_rollup_app_ips;
     EXEC dbo.usp_rollup_network_ips;
   --------------------------------------------------------------------- */
PRINT 'IP match rollups 004 applied.';
GO
