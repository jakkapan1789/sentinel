/* =====================================================================
   Sentinel Whitelist Center — Whitelist acknowledgement (confirm) flow.

   An admin selects whitelist entries and creates an "ack request". The
   generated email carries a one-click confirm link. When the network admin
   has applied the firewall change, they open the link and confirm — which
   marks the request acknowledged and promotes its 'pending' entries to
   'active'. Entry details are SNAPSHOTTED so the confirm page is stable
   even if the underlying whitelist row later changes or is deleted.
   ===================================================================== */
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO

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
GO

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
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_wacki_ack' AND object_id = OBJECT_ID('dbo.whitelist_ack_item'))
    CREATE NONCLUSTERED INDEX IX_wacki_ack ON dbo.whitelist_ack_item (ack_id);
GO

PRINT 'Whitelist acknowledgement 005 applied.';
GO
