/* =====================================================================
   Sentinel Whitelist Center — Ingestion sources (managed ingest tokens)
   Run after 002. Tokens are stored hashed (SHA-256); the plaintext is
   shown once in the UI at create/rotate time.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO

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
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ing_token' AND object_id = OBJECT_ID('dbo.ingestion_source'))
    CREATE INDEX IX_ing_token ON dbo.ingestion_source (token_hash) WHERE enabled = 1;
GO

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
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ingd_recent' AND object_id = OBJECT_ID('dbo.ingestion_delivery'))
    CREATE INDEX IX_ingd_recent ON dbo.ingestion_delivery (created_at DESC);
GO
PRINT 'Ingestion sources 003 applied.';
GO
