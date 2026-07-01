/* =====================================================================
   Sentinel Whitelist Center — FULL schema in ONE file, NO "GO".
   All CREATE TABLE / TYPE / PARTITION / INDEX + every stored procedure.

   Runs top-to-bottom as a single batch: procedures are wrapped in
   EXEC(N'...') so each is created in its own batch (the reason GO is
   normally required). Safe to re-run — every object guards with
   IF ... IS NULL or CREATE OR ALTER. Order respects all FKs.

   Requires QUOTED_IDENTIFIER ON + ANSI_NULLS ON (set below) for the
   temporal ip_whitelist table, the columnstore index, and the ingest
   procedures. Do NOT remove the two SET lines.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;



/* ---------- Monthly partition function + scheme ---------- */

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

IF NOT EXISTS (SELECT 1 FROM sys.partition_schemes WHERE name = 'PS_Month')
CREATE PARTITION SCHEME PS_Month AS PARTITION PF_Month ALL TO ([PRIMARY]);


/* ================= TABLES / TYPES / INDEXES ================= */

/* =====================================================================
   Sentinel Whitelist Center — Core schema (SQL Server 2019+/2022)
   Run order: 001_schema.sql -> 002_summary_and_jobs.sql -> 003_seed.sql

   Decisions:
   - business_unit dimension (FK). BU auto-created on ingest.
   - app_log_ip keeps Success/Error AND http_status_code.
   - Extra columns added: server_name, trace_id, usage_count, http_method, endpoint.
   - Fact tables partitioned monthly on created_at (UTC) + nonclustered columnstore
     for analytics. Retention via TRUNCATE ... WITH (PARTITIONS ...).
   - ip_whitelist is a system-versioned (temporal) table for full audit history.
   ===================================================================== */

-- Required for filtered indexes, computed-column indexes, columnstore, temporal.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;

IF NOT EXISTS (SELECT 1 FROM sys.partition_schemes WHERE name = 'PS_Month')
    CREATE PARTITION SCHEME PS_Month AS PARTITION PF_Month ALL TO ([PRIMARY]);

/* ---------- Dimension: business_unit ---------------------------------- */
IF OBJECT_ID('dbo.business_unit') IS NULL
CREATE TABLE dbo.business_unit (
    bu_id      INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_business_unit PRIMARY KEY,
    bu_name    NVARCHAR(120) NOT NULL CONSTRAINT UQ_business_unit UNIQUE,
    is_active  BIT NOT NULL CONSTRAINT DF_bu_active DEFAULT(1),
    created_at DATETIME2(3) NOT NULL CONSTRAINT DF_bu_created DEFAULT SYSUTCDATETIME()
);

/* ---------- Fact: app_log_ip ----------------------------------------- */
IF OBJECT_ID('dbo.app_log_ip') IS NULL
BEGIN
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

    -- Idempotency + query helpers (auto partition-aligned).
    CREATE NONCLUSTERED INDEX IX_app_event   ON dbo.app_log_ip (source_event_id);
    CREATE NONCLUSTERED INDEX IX_app_bu_time  ON dbo.app_log_ip (bu_name, created_at DESC)
        INCLUDE (response_status, function_name, client_ip, duration_ms, usage_count);
    CREATE NONCLUSTERED INDEX IX_app_func     ON dbo.app_log_ip (function_name);

    -- Operational analytics (columnstore) over the rowstore fact.
    CREATE NONCLUSTERED COLUMNSTORE INDEX NCCI_app_log_ip ON dbo.app_log_ip
        (created_at, bu_name, function_name, response_status, http_status_code, duration_ms, usage_count, client_ip);
END;

/* ---------- Fact: network_log ---------------------------------------- */
IF OBJECT_ID('dbo.network_log') IS NULL
BEGIN
    CREATE TABLE dbo.network_log (
        id              BIGINT IDENTITY(1,1) NOT NULL,
        source_event_id UNIQUEIDENTIFIER NOT NULL,
        source_address  VARCHAR(45)   NOT NULL,
        country_code    CHAR(2)       NULL,
        country_name    NVARCHAR(100) NULL,
        url             NVARCHAR(2048) NOT NULL,
        period_month    DATE          NOT NULL,   -- first day of month
        usage_count     BIGINT        NOT NULL CONSTRAINT DF_net_usage DEFAULT(0),
        created_at      DATETIME2(3)  NOT NULL,
        ingested_at     DATETIME2(3)  NOT NULL CONSTRAINT DF_net_ingested DEFAULT SYSUTCDATETIME(),
        CONSTRAINT PK_network_log PRIMARY KEY CLUSTERED (created_at, id) ON PS_Month(created_at)
    ) ON PS_Month(created_at);

    CREATE NONCLUSTERED INDEX IX_net_event   ON dbo.network_log (source_event_id);
    CREATE NONCLUSTERED INDEX IX_net_period  ON dbo.network_log (period_month, source_address)
        INCLUDE (usage_count, country_code, url);
END;

/* ---------- ip_whitelist (system-versioned / temporal) --------------- */
IF OBJECT_ID('dbo.ip_whitelist') IS NULL
BEGIN
    CREATE TABLE dbo.ip_whitelist (
        id          INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ip_whitelist PRIMARY KEY,
        ip_cidr     VARCHAR(49)   NOT NULL,
        ip_start    VARBINARY(16) NULL,         -- range for fast subnet matching
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
        -- temporal period columns
        valid_from  DATETIME2(3) GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,
        valid_to    DATETIME2(3) GENERATED ALWAYS AS ROW END   HIDDEN NOT NULL,
        PERIOD FOR SYSTEM_TIME (valid_from, valid_to),
        CONSTRAINT CK_wl_env    CHECK (env IN ('production','staging','development')),
        CONSTRAINT CK_wl_status CHECK (status IN ('active','pending','disabled')),
        CONSTRAINT UQ_wl_entry  UNIQUE (ip_cidr, app_name, server, env)
    ) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = dbo.ip_whitelist_history));

    CREATE NONCLUSTERED INDEX IX_wl_status_bu ON dbo.ip_whitelist (status, bu_name);
    CREATE NONCLUSTERED INDEX IX_wl_range     ON dbo.ip_whitelist (ip_start, ip_end) WHERE status = 'active';
END;

/* ---------- Table types (TVP) for batch ingestion -------------------- */
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

IF TYPE_ID('dbo.NetworkLogTvp') IS NULL
CREATE TYPE dbo.NetworkLogTvp AS TABLE (
    source_event_id UNIQUEIDENTIFIER NOT NULL,
    source_address  VARCHAR(45)   NOT NULL,
    country_code    CHAR(2)       NULL,
    country_name    NVARCHAR(100) NULL,
    url             NVARCHAR(2048) NOT NULL,
    period_month    DATE          NOT NULL,
    usage_count     BIGINT        NULL,
    created_at      DATETIME2(3)  NOT NULL
);

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

/* ---------- Incremental rollup control + supporting indexes ---------- */
IF OBJECT_ID('dbo.rollup_watermark') IS NULL
CREATE TABLE dbo.rollup_watermark (
    rollup_name VARCHAR(50)  NOT NULL CONSTRAINT PK_rollup_watermark PRIMARY KEY,
    last_id     BIGINT       NOT NULL CONSTRAINT DF_rwm_last DEFAULT(0),
    updated_at  DATETIME2(3) NOT NULL CONSTRAINT DF_rwm_upd  DEFAULT SYSUTCDATETIME()
);

-- Range index on the identity so "id > @last" is a fast seek (segment-friendly).
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_app_id' AND object_id = OBJECT_ID('dbo.app_log_ip'))
    CREATE NONCLUSTERED INDEX IX_app_id ON dbo.app_log_ip (id);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_net_id' AND object_id = OBJECT_ID('dbo.network_log'))
    CREATE NONCLUSTERED INDEX IX_net_id ON dbo.network_log (id);

/* ---------- Summary: application dimension per BU (filter source) ----- */
IF OBJECT_ID('dbo.app_application_daily') IS NULL
CREATE TABLE dbo.app_application_daily (
    summary_date  DATE          NOT NULL,
    bu_name       NVARCHAR(120) NOT NULL,
    app_name      NVARCHAR(200) NOT NULL,
    request_count BIGINT NOT NULL,
    total_usage   BIGINT NOT NULL,
    CONSTRAINT PK_app_application_daily PRIMARY KEY (summary_date, bu_name, app_name)
);

IF OBJECT_ID('dbo.ingestion_source') IS NULL
CREATE TABLE dbo.ingestion_source (
    id             INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ingestion_source PRIMARY KEY,
    name           NVARCHAR(120) NOT NULL CONSTRAINT UQ_ingestion_source UNIQUE,
    token_hash     CHAR(64)      NOT NULL,           -- SHA-256 hex (used for auth lookup)
    token_prefix   VARCHAR(12)   NOT NULL,           -- last chars, for display
    token          VARCHAR(80)   NULL,               -- plaintext token (copyable in the UI)
    scope          VARCHAR(20)   NOT NULL CONSTRAINT DF_ing_scope DEFAULT('ingestion'),
    enabled        BIT           NOT NULL CONSTRAINT DF_ing_enabled DEFAULT(1),
    allowed_cidr   VARCHAR(49)   NULL,               -- optional source IP restriction
    last_used_at   DATETIME2(3)  NULL,
    total_received BIGINT        NOT NULL CONSTRAINT DF_ing_recv DEFAULT(0),
    total_inserted BIGINT        NOT NULL CONSTRAINT DF_ing_ins  DEFAULT(0),
    created_by     NVARCHAR(128) NOT NULL,
    created_at     DATETIME2(3)  NOT NULL CONSTRAINT DF_ing_created DEFAULT SYSUTCDATETIME()
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ing_token' AND object_id = OBJECT_ID('dbo.ingestion_source'))
    CREATE INDEX IX_ing_token ON dbo.ingestion_source (token_hash) WHERE enabled = 1;

IF OBJECT_ID('dbo.ingestion_delivery') IS NULL
CREATE TABLE dbo.ingestion_delivery (
    id          BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT PK_ingestion_delivery PRIMARY KEY,
    source_id   INT           NULL CONSTRAINT FK_ingd_source REFERENCES dbo.ingestion_source(id) ON DELETE SET NULL,
    source_name NVARCHAR(120) NULL,                 -- denormalized; survives source deletion
    kind        VARCHAR(20)   NOT NULL,              -- 'app-logs' | 'network-logs'
    received    INT           NOT NULL,
    inserted    INT           NOT NULL,
    status      VARCHAR(20)   NOT NULL,              -- 'ok' | 'error'
    message     NVARCHAR(400) NULL,
    created_at  DATETIME2(3)  NOT NULL CONSTRAINT DF_ingd_created DEFAULT SYSUTCDATETIME()
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ingd_recent' AND object_id = OBJECT_ID('dbo.ingestion_delivery'))
    CREATE INDEX IX_ingd_recent ON dbo.ingestion_delivery (created_at DESC);

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

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_app_ip_daily_ip' AND object_id = OBJECT_ID('dbo.app_ip_daily'))
    CREATE NONCLUSTERED INDEX IX_app_ip_daily_ip ON dbo.app_ip_daily (client_ip)
        INCLUDE (ip_bin, bu_name, total_usage, request_count, last_seen);

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

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_net_ip_monthly_ip' AND object_id = OBJECT_ID('dbo.network_ip_monthly'))
    CREATE NONCLUSTERED INDEX IX_net_ip_monthly_ip ON dbo.network_ip_monthly (source_address)
        INCLUDE (ip_bin, country_name, total_usage, request_count, last_seen);

IF OBJECT_ID('dbo.whitelist_ack') IS NULL
CREATE TABLE dbo.whitelist_ack (
    id                INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_whitelist_ack PRIMARY KEY,
    token             VARCHAR(64)   NOT NULL CONSTRAINT UQ_wack_token UNIQUE,
    status            VARCHAR(16)   NOT NULL CONSTRAINT DF_wack_status DEFAULT('pending'),  -- pending | acknowledged
    recipient         NVARCHAR(256) NULL,
    subject           NVARCHAR(300) NULL,
    intro             NVARCHAR(2000) NULL,
    created_by        NVARCHAR(128) NOT NULL,
    created_at        DATETIME2(3)  NOT NULL CONSTRAINT DF_wack_created DEFAULT SYSUTCDATETIME(),
    acknowledged_at   DATETIME2(3)  NULL,
    acknowledged_by   NVARCHAR(128) NULL,
    acknowledged_note NVARCHAR(1000) NULL,
    activated_count   INT           NOT NULL CONSTRAINT DF_wack_actcnt DEFAULT(0),
    CONSTRAINT CK_wack_status CHECK (status IN ('pending', 'acknowledged'))
);

IF OBJECT_ID('dbo.whitelist_ack_item') IS NULL
CREATE TABLE dbo.whitelist_ack_item (
    id           INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_whitelist_ack_item PRIMARY KEY,
    ack_id       INT           NOT NULL CONSTRAINT FK_wacki_ack REFERENCES dbo.whitelist_ack(id) ON DELETE CASCADE,
    whitelist_id INT           NULL,            -- nullable: entry may be deleted later
    ip_cidr      VARCHAR(49)   NOT NULL,
    app_name     NVARCHAR(200) NOT NULL,
    server       NVARCHAR(128) NOT NULL,
    env          VARCHAR(20)   NOT NULL,
    bu_name      NVARCHAR(120) NOT NULL,
    status       VARCHAR(16)   NOT NULL,        -- snapshot of status at request time
    owner        NVARCHAR(128) NULL
);

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_wacki_ack' AND object_id = OBJECT_ID('dbo.whitelist_ack_item'))
    CREATE NONCLUSTERED INDEX IX_wacki_ack ON dbo.whitelist_ack_item (ack_id);


/* ================= STORED PROCEDURES ========================

   Each proc is created via EXEC(N'...') so it is its own batch. */

EXEC(N'
CREATE OR ALTER PROCEDURE dbo.usp_ingest_app_logs
    @rows dbo.AppLogTvp READONLY
AS
BEGIN
    SET NOCOUNT ON;

    -- 1) Auto-create any unseen business unit.
    MERGE dbo.business_unit AS t
    USING (SELECT DISTINCT bu_name FROM @rows) AS s
        ON t.bu_name = s.bu_name
    WHEN NOT MATCHED THEN INSERT (bu_name) VALUES (s.bu_name);

    -- 2) Insert only new events (idempotent by source_event_id).
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
END
');

EXEC(N'
CREATE OR ALTER PROCEDURE dbo.usp_ingest_network_logs
    @rows dbo.NetworkLogTvp READONLY
AS
BEGIN
    SET NOCOUNT ON;
    INSERT dbo.network_log
        (source_event_id, source_address, country_code, country_name, url, period_month, usage_count, created_at)
    SELECT r.source_event_id, r.source_address, r.country_code, r.country_name, r.url, r.period_month,
           ISNULL(r.usage_count,0), r.created_at
    FROM @rows r
    WHERE NOT EXISTS (SELECT 1 FROM dbo.network_log n WHERE n.source_event_id = r.source_event_id);

    SELECT @@ROWCOUNT AS inserted_count, (SELECT COUNT(*) FROM @rows) AS received_count;
END
');

EXEC(N'
CREATE OR ALTER PROCEDURE dbo.usp_purge_old_partitions
    @days_to_keep INT = 60
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @cutoff DATETIME2(3) = DATEADD(DAY, -@days_to_keep, CAST(CAST(SYSUTCDATETIME() AS DATE) AS DATETIME2(3)));

    DECLARE @app_parts NVARCHAR(200) =
        (SELECT STRING_AGG(CONVERT(varchar(10), p.partition_number), '','')
         FROM sys.partitions p
         WHERE p.object_id = OBJECT_ID(''dbo.app_log_ip'') AND p.index_id IN (0,1)
           AND $PARTITION.PF_Month(@cutoff) > p.partition_number);

    IF @app_parts IS NOT NULL
        EXEC(N''TRUNCATE TABLE dbo.app_log_ip WITH (PARTITIONS ('' + @app_parts + N''));'');

    DECLARE @net_parts NVARCHAR(200) =
        (SELECT STRING_AGG(CONVERT(varchar(10), p.partition_number), '','')
         FROM sys.partitions p
         WHERE p.object_id = OBJECT_ID(''dbo.network_log'') AND p.index_id IN (0,1)
           AND $PARTITION.PF_Month(@cutoff) > p.partition_number);

    IF @net_parts IS NOT NULL
        EXEC(N''TRUNCATE TABLE dbo.network_log WITH (PARTITIONS ('' + @net_parts + N''));'');
END
');

EXEC(N'
CREATE OR ALTER PROCEDURE dbo.usp_rollup_app_daily
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @last BIGINT, @newMax BIGINT;

    BEGIN TRAN;
        SELECT @last = last_id FROM dbo.rollup_watermark WITH (UPDLOCK, HOLDLOCK) WHERE rollup_name = ''app_daily'';
        IF @last IS NULL
        BEGIN
            INSERT dbo.rollup_watermark (rollup_name, last_id) VALUES (''app_daily'', 0);
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
                       SUM(CASE WHEN response_status = ''Success'' THEN 1 ELSE 0 END) AS succ,
                       SUM(CASE WHEN response_status = ''Error''   THEN 1 ELSE 0 END) AS err,
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

            UPDATE dbo.rollup_watermark SET last_id = @newMax, updated_at = SYSUTCDATETIME() WHERE rollup_name = ''app_daily'';
        END
    COMMIT;
END
');

EXEC(N'
CREATE OR ALTER PROCEDURE dbo.usp_rollup_app_servers
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @last BIGINT, @newMax BIGINT;

    BEGIN TRAN;
        SELECT @last = last_id FROM dbo.rollup_watermark WITH (UPDLOCK, HOLDLOCK) WHERE rollup_name = ''app_servers'';
        IF @last IS NULL
        BEGIN
            INSERT dbo.rollup_watermark (rollup_name, last_id) VALUES (''app_servers'', 0);
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

            UPDATE dbo.rollup_watermark SET last_id = @newMax, updated_at = SYSUTCDATETIME() WHERE rollup_name = ''app_servers'';
        END
    COMMIT;
END
');

EXEC(N'
CREATE OR ALTER PROCEDURE dbo.usp_rollup_app_apps
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @last BIGINT, @newMax BIGINT;

    BEGIN TRAN;
        SELECT @last = last_id FROM dbo.rollup_watermark WITH (UPDLOCK, HOLDLOCK) WHERE rollup_name = ''app_apps'';
        IF @last IS NULL
        BEGIN
            INSERT dbo.rollup_watermark (rollup_name, last_id) VALUES (''app_apps'', 0);
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

            UPDATE dbo.rollup_watermark SET last_id = @newMax, updated_at = SYSUTCDATETIME() WHERE rollup_name = ''app_apps'';
        END
    COMMIT;
END
');

EXEC(N'
CREATE OR ALTER PROCEDURE dbo.usp_rollup_network_monthly
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @last BIGINT, @newMax BIGINT;

    BEGIN TRAN;
        SELECT @last = last_id FROM dbo.rollup_watermark WITH (UPDLOCK, HOLDLOCK) WHERE rollup_name = ''network_monthly'';
        IF @last IS NULL
        BEGIN
            INSERT dbo.rollup_watermark (rollup_name, last_id) VALUES (''network_monthly'', 0);
            SET @last = 0;
        END

        SELECT id, period_month, ISNULL(country_code, ''??'') AS country_code, source_address, usage_count
        INTO #net
        FROM dbo.network_log
        WHERE id > @last;

        SET @newMax = (SELECT MAX(id) FROM #net);

        IF @newMax IS NOT NULL
        BEGIN
            ;WITH allowed AS (
                SELECT DISTINCT
                    PARSENAME(LEFT(ip_cidr, CHARINDEX(''/'', ip_cidr + ''/'') - 1), 4) + ''.'' +
                    PARSENAME(LEFT(ip_cidr, CHARINDEX(''/'', ip_cidr + ''/'') - 1), 3) AS prefix
                FROM dbo.ip_whitelist WHERE status = ''active''
            ),
            n AS (
                SELECT period_month, country_code,
                       CAST(CASE WHEN EXISTS (
                           SELECT 1 FROM allowed w
                           WHERE w.prefix = PARSENAME(source_address, 4) + ''.'' + PARSENAME(source_address, 3)
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

            UPDATE dbo.rollup_watermark SET last_id = @newMax, updated_at = SYSUTCDATETIME() WHERE rollup_name = ''network_monthly'';
        END
    COMMIT;
END
');

EXEC(N'
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
');

EXEC(N'
CREATE OR ALTER PROCEDURE dbo.usp_rollup_app_ips
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @last BIGINT, @newMax BIGINT;

    BEGIN TRAN;
        SELECT @last = last_id FROM dbo.rollup_watermark WITH (UPDLOCK, HOLDLOCK) WHERE rollup_name = ''app_ips'';
        IF @last IS NULL
        BEGIN
            INSERT dbo.rollup_watermark (rollup_name, last_id) VALUES (''app_ips'', 0);
            SET @last = 0;
        END

        SELECT id, CAST(created_at AS DATE) AS summary_date, client_ip, bu_name,
               ISNULL(server_name, N'''') AS server_name, ISNULL(app_name, N'''') AS app_name,
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
                       SUM(CASE WHEN response_status = ''Success'' THEN 1 ELSE 0 END) AS succ,
                       SUM(CASE WHEN response_status = ''Error''   THEN 1 ELSE 0 END) AS err,
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

            UPDATE dbo.rollup_watermark SET last_id = @newMax, updated_at = SYSUTCDATETIME() WHERE rollup_name = ''app_ips'';
        END
    COMMIT;
END
');

EXEC(N'
CREATE OR ALTER PROCEDURE dbo.usp_rollup_network_ips
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @last BIGINT, @newMax BIGINT;

    BEGIN TRAN;
        SELECT @last = last_id FROM dbo.rollup_watermark WITH (UPDLOCK, HOLDLOCK) WHERE rollup_name = ''net_ips'';
        IF @last IS NULL
        BEGIN
            INSERT dbo.rollup_watermark (rollup_name, last_id) VALUES (''net_ips'', 0);
            SET @last = 0;
        END

        SELECT id, period_month, source_address, ISNULL(country_code, ''??'') AS country_code,
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

            UPDATE dbo.rollup_watermark SET last_id = @newMax, updated_at = SYSUTCDATETIME() WHERE rollup_name = ''net_ips'';
        END
    COMMIT;
END
');
