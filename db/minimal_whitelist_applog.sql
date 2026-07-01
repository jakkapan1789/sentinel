/* =====================================================================
   MINIMAL setup — ONLY what is required for two features to work:
       1) IP WHITELIST   (add / edit / delete entries)
       2) APP LOG INGEST (POST /api/v1/ingestion/app-logs) + viewing it

   HOW TO RUN
   - Run every numbered block below, in order, ONE BLOCK AT A TIME.
   - Run them all in the SAME session/tab, top to bottom, so the SET
     options from block [0] stay in effect. This matters: the temporal
     table, the columnstore index and the ingest proc all REQUIRE
     QUOTED_IDENTIFIER ON / ANSI_NULLS ON at create time.
   - No GO separators and no partition WHILE-loop are used here, so a
     client that trips over GO/BEGIN can still run each block as-is.
   - Every block is idempotent (IF ... IS NULL / CREATE OR ALTER): safe
     to re-run.
   ===================================================================== */


/* [0] Session options — RUN THIS FIRST, keep the same tab open. */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;


/* ---------------------------------------------------------------------
   SHARED — needed by BOTH whitelist and app-log ingest
   ------------------------------------------------------------------- */

/* [1] Monthly partition function (static bounds 2025-01 .. 2029-12).
       app_log_ip is partitioned monthly on created_at. */
IF NOT EXISTS (SELECT 1 FROM sys.partition_functions WHERE name = 'PF_Month')
CREATE PARTITION FUNCTION PF_Month (datetime2(3)) AS RANGE RIGHT FOR VALUES (
 '2025-01-01','2025-02-01','2025-03-01','2025-04-01','2025-05-01','2025-06-01',
 '2025-07-01','2025-08-01','2025-09-01','2025-10-01','2025-11-01','2025-12-01',
 '2026-01-01','2026-02-01','2026-03-01','2026-04-01','2026-05-01','2026-06-01',
 '2026-07-01','2026-08-01','2026-09-01','2026-10-01','2026-11-01','2026-12-01',
 '2027-01-01','2027-02-01','2027-03-01','2027-04-01','2027-05-01','2027-06-01',
 '2027-07-01','2027-08-01','2027-09-01','2027-10-01','2027-11-01','2027-12-01',
 '2028-01-01','2028-02-01','2028-03-01','2028-04-01','2028-05-01','2028-06-01',
 '2028-07-01','2028-08-01','2028-09-01','2028-10-01','2028-11-01','2028-12-01',
 '2029-01-01','2029-02-01','2029-03-01','2029-04-01','2029-05-01','2029-06-01',
 '2029-07-01','2029-08-01','2029-09-01','2029-10-01','2029-11-01','2029-12-01'
);

/* [2] Partition scheme. */
IF NOT EXISTS (SELECT 1 FROM sys.partition_schemes WHERE name = 'PS_Month')
CREATE PARTITION SCHEME PS_Month AS PARTITION PF_Month ALL TO ([PRIMARY]);

/* [3] business_unit dimension (auto-created on ingest; FK target). */
IF OBJECT_ID('dbo.business_unit') IS NULL
CREATE TABLE dbo.business_unit (
    bu_id      INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_business_unit PRIMARY KEY,
    bu_name    NVARCHAR(120) NOT NULL CONSTRAINT UQ_business_unit UNIQUE,
    is_active  BIT NOT NULL CONSTRAINT DF_bu_active DEFAULT(1),
    created_at DATETIME2(3) NOT NULL CONSTRAINT DF_bu_created DEFAULT SYSUTCDATETIME()
);


/* ---------------------------------------------------------------------
   FEATURE 1 — IP WHITELIST
   ------------------------------------------------------------------- */

/* [4] ip_whitelist — system-versioned (temporal) table + its indexes.
       Creates dbo.ip_whitelist_history automatically. */
IF OBJECT_ID('dbo.ip_whitelist') IS NULL
CREATE TABLE dbo.ip_whitelist (
    id          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ip_whitelist PRIMARY KEY,
    ip_cidr     VARCHAR(49)   NOT NULL,
    ip_start    VARBINARY(16) NULL,
    ip_end      VARBINARY(16) NULL,
    app_name    NVARCHAR(200) NOT NULL,
    server      NVARCHAR(128) NOT NULL,
    env         VARCHAR(20)   NOT NULL,
    bu_id       INT           NULL CONSTRAINT FK_wl_bu REFERENCES dbo.business_unit(bu_id),
    bu_name     NVARCHAR(120) NOT NULL,
    status      VARCHAR(16)   NOT NULL,
    owner       NVARCHAR(128) NULL,
    notes       NVARCHAR(1000) NULL,
    created_by  NVARCHAR(128) NOT NULL,
    updated_by  NVARCHAR(128) NOT NULL,
    created_at  DATETIME2(3)  NOT NULL CONSTRAINT DF_wl_created DEFAULT SYSUTCDATETIME(),
    updated_at  DATETIME2(3)  NOT NULL CONSTRAINT DF_wl_updated DEFAULT SYSUTCDATETIME(),
    valid_from  DATETIME2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
    valid_to    DATETIME2(3) GENERATED ALWAYS AS ROW END   HIDDEN NOT NULL,
    PERIOD FOR SYSTEM_TIME (valid_from, valid_to),
    CONSTRAINT CK_wl_env    CHECK (env IN ('production','staging','development')),
    CONSTRAINT CK_wl_status CHECK (status IN ('active','pending','disabled')),
    CONSTRAINT UQ_wl_entry  UNIQUE (ip_cidr, app_name, server, env)
) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = dbo.ip_whitelist_history));

/* [5] Whitelist indexes (status/bu lookup + fast active-range seek). */
IF OBJECT_ID('dbo.ip_whitelist') IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_wl_status_bu' AND object_id = OBJECT_ID('dbo.ip_whitelist'))
CREATE NONCLUSTERED INDEX IX_wl_status_bu ON dbo.ip_whitelist (status, bu_name);

IF OBJECT_ID('dbo.ip_whitelist') IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_wl_range' AND object_id = OBJECT_ID('dbo.ip_whitelist'))
CREATE NONCLUSTERED INDEX IX_wl_range ON dbo.ip_whitelist (ip_start, ip_end) WHERE status = 'active';


/* ---------------------------------------------------------------------
   FEATURE 2 — APP LOG INGEST
   ------------------------------------------------------------------- */

/* [6] app_log_ip fact table (partitioned monthly on created_at). */
IF OBJECT_ID('dbo.app_log_ip') IS NULL
CREATE TABLE dbo.app_log_ip (
    id               BIGINT IDENTITY(1,1) NOT NULL,
    source_event_id  UNIQUEIDENTIFIER NOT NULL,
    client_ip        VARCHAR(45)   NOT NULL,
    bu_id            INT           NULL,
    bu_name          NVARCHAR(120) NOT NULL,
    app_name         NVARCHAR(200) NULL,
    function_name    NVARCHAR(200) NOT NULL,
    response_status  VARCHAR(16)   NOT NULL,
    http_status_code SMALLINT      NULL,
    database_name    NVARCHAR(128) NULL,
    duration_ms      INT           NULL,
    usage_count      BIGINT        NOT NULL CONSTRAINT DF_app_usage DEFAULT(0),
    server_name      NVARCHAR(128) NULL,
    http_method      VARCHAR(10)   NULL,
    endpoint         NVARCHAR(2048) NULL,
    trace_id         VARCHAR(64)   NULL,
    message          NVARCHAR(2000) NULL,
    created_at       DATETIME2(3)  NOT NULL,
    ingested_at      DATETIME2(3)  NOT NULL CONSTRAINT DF_app_ingested DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_app_log_ip PRIMARY KEY CLUSTERED (created_at, id) ON PS_Month(created_at),
    CONSTRAINT FK_app_log_bu FOREIGN KEY (bu_id) REFERENCES dbo.business_unit(bu_id),
    CONSTRAINT CK_app_resp CHECK (response_status IN ('Success','Error'))
) ON PS_Month(created_at);

/* [7] app_log_ip indexes (idempotency + BU/time query + rollup seek). */
IF OBJECT_ID('dbo.app_log_ip') IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_app_event' AND object_id = OBJECT_ID('dbo.app_log_ip'))
CREATE NONCLUSTERED INDEX IX_app_event ON dbo.app_log_ip (source_event_id);

IF OBJECT_ID('dbo.app_log_ip') IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_app_bu_time' AND object_id = OBJECT_ID('dbo.app_log_ip'))
CREATE NONCLUSTERED INDEX IX_app_bu_time ON dbo.app_log_ip (bu_name, created_at DESC)
    INCLUDE (response_status, function_name, client_ip, duration_ms, usage_count);

IF OBJECT_ID('dbo.app_log_ip') IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_app_func' AND object_id = OBJECT_ID('dbo.app_log_ip'))
CREATE NONCLUSTERED INDEX IX_app_func ON dbo.app_log_ip (function_name);

IF OBJECT_ID('dbo.app_log_ip') IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'NCCI_app_log_ip' AND object_id = OBJECT_ID('dbo.app_log_ip'))
CREATE NONCLUSTERED COLUMNSTORE INDEX NCCI_app_log_ip ON dbo.app_log_ip
    (created_at, bu_name, function_name, response_status, http_status_code, duration_ms, usage_count, client_ip);

IF OBJECT_ID('dbo.app_log_ip') IS NOT NULL
AND NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_app_id' AND object_id = OBJECT_ID('dbo.app_log_ip'))
CREATE NONCLUSTERED INDEX IX_app_id ON dbo.app_log_ip (id);

/* [8] Table type (TVP) the ingest endpoint passes rows through. */
IF TYPE_ID('dbo.AppLogTvp') IS NULL
CREATE TYPE dbo.AppLogTvp AS TABLE (
    source_event_id  UNIQUEIDENTIFIER NOT NULL,
    client_ip        VARCHAR(45)   NOT NULL,
    bu_name          NVARCHAR(120) NOT NULL,
    app_name         NVARCHAR(200) NULL,
    function_name    NVARCHAR(200) NOT NULL,
    response_status  VARCHAR(16)   NOT NULL,
    http_status_code SMALLINT      NULL,
    database_name    NVARCHAR(128) NULL,
    duration_ms      INT           NULL,
    usage_count      BIGINT        NULL,
    server_name      NVARCHAR(128) NULL,
    http_method      VARCHAR(10)   NULL,
    endpoint         NVARCHAR(2048) NULL,
    trace_id         VARCHAR(64)   NULL,
    message          NVARCHAR(2000) NULL,
    created_at       DATETIME2(3)  NOT NULL
);

/* [9] Ingest proc — auto-creates BU + inserts new events (idempotent).
       RUN THIS WHOLE BLOCK as one statement. */
CREATE OR ALTER PROCEDURE dbo.usp_ingest_app_logs
    @rows dbo.AppLogTvp READONLY
AS
BEGIN
    SET NOCOUNT ON;

    MERGE dbo.business_unit AS t
    USING (SELECT DISTINCT bu_name FROM @rows) AS s
        ON t.bu_name = s.bu_name
    WHEN NOT MATCHED THEN INSERT (bu_name) VALUES (s.bu_name);

    INSERT dbo.app_log_ip
        (source_event_id, client_ip, bu_id, bu_name, app_name, function_name, response_status,
         http_status_code, database_name, duration_ms, usage_count, server_name,
         http_method, endpoint, trace_id, message, created_at)
    SELECT r.source_event_id, r.client_ip, b.bu_id, r.bu_name, r.app_name, r.function_name, r.response_status,
           r.http_status_code, r.database_name, r.duration_ms, ISNULL(r.usage_count,0), r.server_name,
           r.http_method, r.endpoint, r.trace_id, r.message, r.created_at
    FROM @rows r
    JOIN dbo.business_unit b ON b.bu_name = r.bu_name
    WHERE NOT EXISTS (SELECT 1 FROM dbo.app_log_ip a WHERE a.source_event_id = r.source_event_id);

    SELECT @@ROWCOUNT AS inserted_count, (SELECT COUNT(*) FROM @rows) AS received_count;
END;


/* ---------------------------------------------------------------------
   VIEW PATH — required so ingested app logs actually SHOW in the UI.
   Read endpoints (dashboard, BU summary) read these rollups, never the
   raw fact. After ingesting, run block [13] to refresh them.
   ------------------------------------------------------------------- */

/* [10] Rollup summary tables + watermark control table. */
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
    distinct_clients  INT    NOT NULL,
    refreshed_at      DATETIME2(3) NOT NULL CONSTRAINT DF_appsum_ref DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_app_log_summary_daily PRIMARY KEY (summary_date, bu_name, function_name)
);

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

IF OBJECT_ID('dbo.app_application_daily') IS NULL
CREATE TABLE dbo.app_application_daily (
    summary_date  DATE          NOT NULL,
    bu_name       NVARCHAR(120) NOT NULL,
    app_name      NVARCHAR(200) NOT NULL,
    request_count BIGINT NOT NULL,
    total_usage   BIGINT NOT NULL,
    CONSTRAINT PK_app_application_daily PRIMARY KEY (summary_date, bu_name, app_name)
);

IF OBJECT_ID('dbo.rollup_watermark') IS NULL
CREATE TABLE dbo.rollup_watermark (
    rollup_name VARCHAR(50)  NOT NULL CONSTRAINT PK_rollup_watermark PRIMARY KEY,
    last_id     BIGINT       NOT NULL CONSTRAINT DF_rwm_last DEFAULT(0),
    updated_at  DATETIME2(3) NOT NULL CONSTRAINT DF_rwm_upd  DEFAULT SYSUTCDATETIME()
);

/* [11] Rollup: app usage per BU + function (incremental).
        RUN THIS WHOLE BLOCK as one statement. */
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
END;

/* [12a] Rollup: server dimension per BU. RUN THIS WHOLE BLOCK as one. */
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
END;

/* [12b] Rollup: application dimension per BU. RUN THIS WHOLE BLOCK as one. */
CREATE OR ALTER PROCEDURE dbo.usp_rollup_app_apps
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @last BIGINT, @newMax BIGINT;

    BEGIN TRAN;
        SELECT @last = last_id FROM dbo.rollup_watermark WITH (UPDLOCK, HOLDLOCK) WHERE rollup_name = 'app_apps';
        IF @last IS NULL
        BEGIN
            INSERT dbo.rollup_watermark (rollup_name, last_id) VALUES ('app_apps', 0);
            SET @last = 0;
        END

        SELECT id, CAST(created_at AS DATE) AS summary_date, bu_name, app_name, usage_count
        INTO #apps
        FROM dbo.app_log_ip
        WHERE id > @last;

        SET @newMax = (SELECT MAX(id) FROM #apps);

        IF @newMax IS NOT NULL
        BEGIN
            ;WITH agg AS (
                SELECT summary_date, bu_name, app_name, COUNT_BIG(*) AS req, SUM(usage_count) AS usage_sum
                FROM #apps
                WHERE app_name IS NOT NULL
                GROUP BY summary_date, bu_name, app_name
            )
            MERGE dbo.app_application_daily AS t
            USING agg AS s
               ON t.summary_date = s.summary_date AND t.bu_name = s.bu_name AND t.app_name = s.app_name
            WHEN MATCHED THEN UPDATE SET
                request_count = t.request_count + s.req, total_usage = t.total_usage + s.usage_sum
            WHEN NOT MATCHED BY TARGET THEN INSERT
                (summary_date, bu_name, app_name, request_count, total_usage)
                VALUES (s.summary_date, s.bu_name, s.app_name, s.req, s.usage_sum);

            UPDATE dbo.rollup_watermark SET last_id = @newMax, updated_at = SYSUTCDATETIME() WHERE rollup_name = 'app_apps';
        END
    COMMIT;
END;


/* [13] AFTER EACH INGEST — run these three EXECs to make the new logs
        appear in the UI (dashboard / BU summary / app-log detail).
        This is the equivalent of pressing "Refresh" in the app.
        Keep this block SEPARATE from proc [12b] above. */
EXEC dbo.usp_rollup_app_daily;
EXEC dbo.usp_rollup_app_servers;
EXEC dbo.usp_rollup_app_apps;
