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
GO

/* ---------- Monthly partitioning (created_at) -------------------------- */
IF NOT EXISTS (SELECT 1 FROM sys.partition_functions WHERE name = 'PF_Month')
BEGIN
    DECLARE @start DATE = '2025-01-01', @months INT = 60, @i INT = 0;
    DECLARE @bounds NVARCHAR(MAX) = N'';
    WHILE @i < @months
    BEGIN
        SET @bounds += N'''' + CONVERT(varchar(10), DATEADD(MONTH, @i, @start), 23) + N''',';
        SET @i += 1;
    END
    SET @bounds = LEFT(@bounds, LEN(@bounds) - 1);
    EXEC(N'CREATE PARTITION FUNCTION PF_Month (datetime2(3)) AS RANGE RIGHT FOR VALUES (' + @bounds + N');');
END
GO
IF NOT EXISTS (SELECT 1 FROM sys.partition_schemes WHERE name = 'PS_Month')
    CREATE PARTITION SCHEME PS_Month AS PARTITION PF_Month ALL TO ([PRIMARY]);
GO

/* ---------- Dimension: business_unit ---------------------------------- */
IF OBJECT_ID('dbo.business_unit') IS NULL
CREATE TABLE dbo.business_unit (
    bu_id      INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_business_unit PRIMARY KEY,
    bu_name    NVARCHAR(120) NOT NULL CONSTRAINT UQ_business_unit UNIQUE,
    is_active  BIT NOT NULL CONSTRAINT DF_bu_active DEFAULT(1),
    created_at DATETIME2(3) NOT NULL CONSTRAINT DF_bu_created DEFAULT SYSUTCDATETIME()
);
GO

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
END
GO

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
END
GO

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
END
GO

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
GO
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
GO

/* ---------- Ingestion procs (auto-create BU + idempotent) ------------ */
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
GO

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
GO

/* ---------- Retention: drop monthly partitions fully older than N days ----
   Raw logs are kept ~@days_to_keep (monthly granularity → 60d keeps 60–89d).
   Summaries are the long-term source of truth and are never purged here. ---- */
CREATE OR ALTER PROCEDURE dbo.usp_purge_old_partitions
    @days_to_keep INT = 60
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @cutoff DATETIME2(3) = DATEADD(DAY, -@days_to_keep, CAST(CAST(SYSUTCDATETIME() AS DATE) AS DATETIME2(3)));

    DECLARE @app_parts NVARCHAR(200) =
        (SELECT STRING_AGG(CONVERT(varchar(10), p.partition_number), ',')
         FROM sys.partitions p
         WHERE p.object_id = OBJECT_ID('dbo.app_log_ip') AND p.index_id IN (0,1)
           AND $PARTITION.PF_Month(@cutoff) > p.partition_number);

    IF @app_parts IS NOT NULL
        EXEC(N'TRUNCATE TABLE dbo.app_log_ip WITH (PARTITIONS (' + @app_parts + N'));');

    DECLARE @net_parts NVARCHAR(200) =
        (SELECT STRING_AGG(CONVERT(varchar(10), p.partition_number), ',')
         FROM sys.partitions p
         WHERE p.object_id = OBJECT_ID('dbo.network_log') AND p.index_id IN (0,1)
           AND $PARTITION.PF_Month(@cutoff) > p.partition_number);

    IF @net_parts IS NOT NULL
        EXEC(N'TRUNCATE TABLE dbo.network_log WITH (PARTITIONS (' + @net_parts + N'));');
END
GO
PRINT 'Schema 001 applied.';
GO
