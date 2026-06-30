using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Dapper;
using SentinelWhitelist.Api.Auth;
using SentinelWhitelist.Api.Data;
using SentinelWhitelist.Api.Models;

namespace SentinelWhitelist.Api.Endpoints;

/// <summary>
/// Whitelist acknowledgement flow. An admin drafts an email for selected entries;
/// the email carries a one-click confirm link. When the network admin applies the
/// change and clicks it, the request is marked acknowledged and its pending entries
/// are promoted to active.
/// </summary>
public static class WhitelistAckEndpoints
{
    private sealed class AckItemRow
    {
        public int? WhitelistId { get; set; }
        public string IpCidr { get; set; } = "";
        public string AppName { get; set; } = "";
        public string Server { get; set; } = "";
        public string Env { get; set; } = "";
        public string BuName { get; set; } = "";
        public string Status { get; set; } = "";
        public string? Owner { get; set; }
    }

    public static void MapWhitelistAckEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/v1/whitelist");

        // Create an acknowledgement request for the selected entries; returns the email HTML + confirm link.
        group.MapPost("/ack-requests", async (
            WhitelistAckCreate body, ClaimsPrincipal user, HttpContext http,
            ISqlConnectionFactory factory, CancellationToken ct) =>
        {
            if (body.EntryIds is null || body.EntryIds.Length == 0)
                return Results.BadRequest(new { error = "Select at least one whitelist entry." });

            var actor = user.Identity?.Name ?? "api";
            var token = "swc_ack_" + Convert.ToHexString(RandomNumberGenerator.GetBytes(24)).ToLowerInvariant();

            using var db = await factory.OpenAsync(ct);

            var entries = (await db.QueryAsync<AckItemRow>(new CommandDefinition(
                """
                SELECT id AS WhitelistId, ip_cidr AS IpCidr, app_name AS AppName, server AS Server,
                       env AS Env, bu_name AS BuName, status AS Status, owner AS Owner
                FROM dbo.ip_whitelist WHERE id IN @ids;
                """, new { ids = body.EntryIds }, cancellationToken: ct))).ToList();

            if (entries.Count == 0)
                return Results.BadRequest(new { error = "No matching whitelist entries." });

            var ackId = await db.ExecuteScalarAsync<int>(new CommandDefinition(
                """
                INSERT dbo.whitelist_ack (token, recipient, subject, intro, created_by)
                OUTPUT INSERTED.id
                VALUES (@token, @recipient, @subject, @intro, @actor);
                """,
                new { token, recipient = body.Recipient, subject = body.Subject, intro = body.Intro, actor },
                cancellationToken: ct));

            foreach (var e in entries)
            {
                await db.ExecuteAsync(new CommandDefinition(
                    """
                    INSERT dbo.whitelist_ack_item (ack_id, whitelist_id, ip_cidr, app_name, server, env, bu_name, status, owner)
                    VALUES (@ackId, @WhitelistId, @IpCidr, @AppName, @Server, @Env, @BuName, @Status, @Owner);
                    """,
                    new { ackId, e.WhitelistId, e.IpCidr, e.AppName, e.Server, e.Env, e.BuName, e.Status, e.Owner },
                    cancellationToken: ct));
            }

            var confirmUrl = ConfirmUrl(http, token);
            var html = BuildEmailHtml(entries, body.Intro, confirmUrl);

            var dto = new WhitelistAckDto(
                ackId, token, "pending", body.Recipient, body.Subject, confirmUrl, html,
                entries.Count, 0, actor, DateTime.UtcNow, null, null);

            return Results.Ok(dto);
        }).RequireAuthorization(Scopes.Admin);

        // List recent ack requests (drives the "Sent for confirmation" panel).
        group.MapGet("/ack-requests", async (
            HttpContext http, ISqlConnectionFactory factory, CancellationToken ct) =>
        {
            using var db = await factory.OpenAsync(ct);
            var rows = await db.QueryAsync(new CommandDefinition(
                """
                SELECT a.id, a.token, a.status, a.recipient, a.subject, a.created_by, a.created_at,
                       a.acknowledged_at, a.acknowledged_note, a.activated_count,
                       (SELECT COUNT(*) FROM dbo.whitelist_ack_item i WHERE i.ack_id = a.id) AS item_count
                FROM dbo.whitelist_ack a
                ORDER BY a.created_at DESC;
                """, cancellationToken: ct));

            var result = rows.Select(r => new WhitelistAckDto(
                (int)r.id, (string)r.token, (string)r.status, (string?)r.recipient, (string?)r.subject,
                ConfirmUrl(http, (string)r.token), "", (int)r.item_count, (int)r.activated_count,
                (string)r.created_by, (DateTime)r.created_at, (DateTime?)r.acknowledged_at, (string?)r.acknowledged_note));

            return Results.Ok(result);
        }).RequireAuthorization(Scopes.Read);

        // ---- Public confirm pages (no auth — the link is the secret) ----

        // Landing page the network admin opens from the email.
        group.MapGet("/ack/{token}", async (string token, ISqlConnectionFactory factory, CancellationToken ct) =>
        {
            using var db = await factory.OpenAsync(ct);
            var ack = await LoadAck(db, token, ct);
            if (ack is null) return Results.Content(Page("Link not found", "<p>This confirmation link is invalid or has expired.</p>"), "text/html");

            var items = await LoadItems(db, (int)ack.id, ct);
            return Results.Content(ConfirmPage(token, ack, items), "text/html");
        }).AllowAnonymous();

        // One-click confirm (posted by the button on the landing page).
        group.MapPost("/ack/{token}/confirm", async (
            string token, HttpContext http, ISqlConnectionFactory factory, CancellationToken ct) =>
        {
            var note = http.Request.HasFormContentType ? http.Request.Form["note"].ToString() : null;
            using var db = await factory.OpenAsync(ct);
            var ack = await LoadAck(db, token, ct);
            if (ack is null) return Results.Content(Page("Link not found", "<p>This confirmation link is invalid or has expired.</p>"), "text/html");

            if ((string)ack.status != "acknowledged")
            {
                // Promote the snapshot's still-pending entries to active.
                var activated = await db.ExecuteAsync(new CommandDefinition(
                    """
                    UPDATE w SET w.status = 'active', w.updated_by = 'ack-confirm', w.updated_at = SYSUTCDATETIME()
                    FROM dbo.ip_whitelist w
                    JOIN dbo.whitelist_ack_item i ON i.whitelist_id = w.id
                    WHERE i.ack_id = @ackId AND w.status = 'pending';
                    """, new { ackId = (int)ack.id }, cancellationToken: ct));

                await db.ExecuteAsync(new CommandDefinition(
                    """
                    UPDATE dbo.whitelist_ack
                    SET status = 'acknowledged', acknowledged_at = SYSUTCDATETIME(),
                        acknowledged_note = @note, activated_count = @activated
                    WHERE id = @ackId;
                    """, new { ackId = (int)ack.id, note = string.IsNullOrWhiteSpace(note) ? null : note.Trim(), activated },
                    cancellationToken: ct));

                ack = await LoadAck(db, token, ct);
            }

            var items = await LoadItems(db, (int)ack!.id, ct);
            return Results.Content(ConfirmedPage(ack, items), "text/html");
        }).AllowAnonymous();
    }

    private static async Task<dynamic?> LoadAck(System.Data.IDbConnection db, string token, CancellationToken ct) =>
        await db.QueryFirstOrDefaultAsync(new CommandDefinition(
            "SELECT id, token, status, subject, created_by, created_at, acknowledged_at, acknowledged_note, activated_count FROM dbo.whitelist_ack WHERE token = @token;",
            new { token }, cancellationToken: ct));

    private static async Task<List<AckItemRow>> LoadItems(System.Data.IDbConnection db, int ackId, CancellationToken ct) =>
        (await db.QueryAsync<AckItemRow>(new CommandDefinition(
            """
            SELECT whitelist_id AS WhitelistId, ip_cidr AS IpCidr, app_name AS AppName, server AS Server,
                   env AS Env, bu_name AS BuName, status AS Status, owner AS Owner
            FROM dbo.whitelist_ack_item WHERE ack_id = @ackId ORDER BY id;
            """, new { ackId }, cancellationToken: ct))).ToList();

    private static string ConfirmUrl(HttpContext http, string token) =>
        $"{http.Request.Scheme}://{http.Request.Host}{http.Request.PathBase}/api/v1/whitelist/ack/{token}";

    private static string E(string? v) => WebUtility.HtmlEncode(v ?? "");

    private static string StatusHex(string s) => s switch
    {
        "active" => "#047857",
        "pending" => "#b45309",
        "disabled" => "#be123c",
        _ => "#475569",
    };

    // ---- Email body (inline styles only — email clients strip <style>) ----
    private static string BuildEmailHtml(IReadOnlyList<AckItemRow> entries, string? intro, string confirmUrl)
    {
        const string th = "padding:8px 10px;text-align:left;font-weight:600;border-bottom:1px solid #0f766e;";
        const string td = "padding:7px 10px;border-bottom:1px solid #e2e8f0;vertical-align:top;";
        var sb = new StringBuilder();
        var i = 0;
        foreach (var e in entries)
        {
            var bg = i % 2 == 1 ? "#f8fafc" : "#ffffff";
            sb.Append($"<tr style=\"background:{bg};\">")
              .Append($"<td style=\"{td}color:#64748b;\">{++i}</td>")
              .Append($"<td style=\"{td}font-family:'Courier New',monospace;font-weight:600;color:#0f172a;\">{E(e.IpCidr)}</td>")
              .Append($"<td style=\"{td}\">{E(e.AppName)}</td>")
              .Append($"<td style=\"{td}font-family:'Courier New',monospace;color:#475569;\">{E(e.Server)}</td>")
              .Append($"<td style=\"{td}text-transform:capitalize;\">{E(e.Env)}</td>")
              .Append($"<td style=\"{td}\">{E(e.BuName)}</td>")
              .Append($"<td style=\"{td}font-weight:600;text-transform:capitalize;color:{StatusHex(e.Status)};\">{E(e.Status)}</td>")
              .Append($"<td style=\"{td}color:#475569;\">{E(string.IsNullOrEmpty(e.Owner) ? "—" : e.Owner)}</td>")
              .Append("</tr>");
        }

        var introHtml = string.IsNullOrWhiteSpace(intro) ? "" :
            $"<p style=\"margin:0 0 14px;\">{E(intro).Replace("\n", "<br>")}</p>";

        return $@"<div style=""font-family:Arial,Helvetica,sans-serif;color:#0f172a;font-size:13px;line-height:1.5;"">
{introHtml}
<table style=""border-collapse:collapse;width:100%;border:1px solid #e2e8f0;"">
<thead><tr style=""background:#0f766e;color:#ffffff;"">
<th style=""{th}"">#</th><th style=""{th}"">IP / CIDR</th><th style=""{th}"">Application</th><th style=""{th}"">Web Server</th>
<th style=""{th}"">Env</th><th style=""{th}"">Business Unit</th><th style=""{th}"">Status</th><th style=""{th}"">Owner</th>
</tr></thead>
<tbody>{sb}</tbody>
</table>
<div style=""margin:20px 0 6px;"">
<a href=""{confirmUrl}"" style=""display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;font-weight:600;padding:11px 20px;border-radius:8px;"">✓ Confirm completion</a>
</div>
<p style=""margin:6px 0 0;color:#94a3b8;font-size:11px;"">Network admin: click the button above once the firewall change is applied. Pending entries will then be activated.</p>
<p style=""margin:4px 0 0;color:#94a3b8;font-size:11px;"">Sentinel Whitelist Center · {entries.Count} entr{(entries.Count == 1 ? "y" : "ies")}</p>
</div>";
    }

    // ---- Standalone HTML pages served to the network admin's browser ----
    private static string Page(string title, string bodyHtml) => $@"<!doctype html><html><head><meta charset=""utf-8"">
<meta name=""viewport"" content=""width=device-width,initial-scale=1"">
<title>{E(title)} · Sentinel Whitelist Center</title></head>
<body style=""margin:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;"">
<div style=""max-width:760px;margin:40px auto;padding:0 16px;"">
<div style=""background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;"">
<div style=""background:#0f766e;color:#fff;padding:18px 24px;font-weight:700;font-size:16px;"">🛡 Sentinel Whitelist Center</div>
<div style=""padding:24px;"">{bodyHtml}</div>
</div></div></body></html>";

    private static string ItemsTable(IReadOnlyList<AckItemRow> items)
    {
        const string th = "padding:8px 10px;text-align:left;font-weight:600;border-bottom:1px solid #0f766e;";
        const string td = "padding:7px 10px;border-bottom:1px solid #e2e8f0;";
        var sb = new StringBuilder();
        var i = 0;
        foreach (var e in items)
        {
            var bg = i % 2 == 1 ? "#f8fafc" : "#ffffff";
            sb.Append($"<tr style=\"background:{bg};\">")
              .Append($"<td style=\"{td}color:#64748b;\">{++i}</td>")
              .Append($"<td style=\"{td}font-family:monospace;font-weight:600;\">{E(e.IpCidr)}</td>")
              .Append($"<td style=\"{td}\">{E(e.AppName)}</td>")
              .Append($"<td style=\"{td}font-family:monospace;color:#475569;\">{E(e.Server)}</td>")
              .Append($"<td style=\"{td}\">{E(e.BuName)}</td>")
              .Append($"<td style=\"{td}font-weight:600;text-transform:capitalize;color:{StatusHex(e.Status)};\">{E(e.Status)}</td>")
              .Append("</tr>");
        }
        return $@"<table style=""border-collapse:collapse;width:100%;font-size:13px;border:1px solid #e2e8f0;"">
<thead><tr style=""background:#0f766e;color:#fff;""><th style=""{th}"">#</th><th style=""{th}"">IP / CIDR</th><th style=""{th}"">Application</th><th style=""{th}"">Web Server</th><th style=""{th}"">Business Unit</th><th style=""{th}"">Status</th></tr></thead>
<tbody>{sb}</tbody></table>";
    }

    private static string ConfirmPage(string token, dynamic ack, IReadOnlyList<AckItemRow> items)
    {
        if ((string)ack.status == "acknowledged") return ConfirmedPage(ack, items);
        var body = $@"<p style=""margin:0 0 6px;font-size:15px;font-weight:600;"">Confirm firewall change</p>
<p style=""margin:0 0 18px;color:#475569;font-size:13px;"">Please review the {items.Count} whitelist entr{(items.Count == 1 ? "y" : "ies")} below. Confirm once the change has been applied — any <b>pending</b> entries will be activated.</p>
{ItemsTable(items)}
<form method=""post"" action=""/api/v1/whitelist/ack/{E(token)}/confirm"" style=""margin-top:20px;"">
<input type=""text"" name=""note"" placeholder=""Optional note (e.g. ticket #, applied by)"" style=""width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:13px;margin-bottom:12px;"">
<button type=""submit"" style=""background:#0f766e;color:#fff;border:none;font-weight:600;font-size:14px;padding:12px 22px;border-radius:8px;cursor:pointer;"">✓ Confirm completion</button>
</form>";
        return Page("Confirm whitelist", body);
    }

    private static string ConfirmedPage(dynamic ack, IReadOnlyList<AckItemRow> items)
    {
        var when = ack.acknowledged_at is DateTime dt ? dt.ToString("u") : "";
        var note = (string?)ack.acknowledged_note;
        var activated = (int)ack.activated_count;
        var body = $@"<div style=""text-align:center;padding:8px 0 18px;"">
<div style=""display:inline-flex;width:56px;height:56px;border-radius:50%;background:#dcfce7;color:#16a34a;align-items:center;justify-content:center;font-size:28px;"">✓</div>
<p style=""margin:14px 0 4px;font-size:17px;font-weight:700;color:#166534;"">Confirmed — thank you</p>
<p style=""margin:0;color:#475569;font-size:13px;"">This request was acknowledged{(string.IsNullOrEmpty(when) ? "" : $" at {E(when)} UTC")}.{(activated > 0 ? $" {activated} entr{(activated == 1 ? "y was" : "ies were")} activated." : "")}</p>
{(string.IsNullOrWhiteSpace(note) ? "" : $"<p style=\"margin:8px 0 0;color:#64748b;font-size:12px;\">Note: {E(note)}</p>")}
</div>
{ItemsTable(items)}";
        return Page("Confirmed", body);
    }
}
