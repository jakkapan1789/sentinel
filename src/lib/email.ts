import type { WhitelistEntry, WhitelistStatus } from '../types';

const STATUS_HEX: Record<WhitelistStatus, string> = { active: '#047857', pending: '#b45309', disabled: '#be123c' };

const esc = (v: string) =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Email-client-safe HTML (inline styles only) with a details table + optional confirm button. */
export function buildWhitelistEmailHtml(entries: WhitelistEntry[], intro: string, confirmUrl?: string): string {
  const th = 'padding:8px 10px;text-align:left;font-weight:600;border-bottom:1px solid #0f766e;';
  const td = 'padding:7px 10px;border-bottom:1px solid #e2e8f0;vertical-align:top;';
  const rows = entries
    .map((e, i) => {
      const bg = i % 2 ? '#f8fafc' : '#ffffff';
      return `<tr style="background:${bg};">
<td style="${td}color:#64748b;">${i + 1}</td>
<td style="${td}font-family:'Courier New',monospace;font-weight:600;color:#0f172a;">${esc(e.ipCidr)}</td>
<td style="${td}">${esc(e.appName)}</td>
<td style="${td}font-family:'Courier New',monospace;color:#475569;">${esc(e.server)}</td>
<td style="${td}text-transform:capitalize;">${esc(e.env)}</td>
<td style="${td}">${esc(e.buName)}</td>
<td style="${td}font-weight:600;text-transform:capitalize;color:${STATUS_HEX[e.status]};">${esc(e.status)}</td>
<td style="${td}color:#475569;">${esc(e.owner || '—')}</td>
</tr>`;
    })
    .join('');

  const confirmBlock = confirmUrl
    ? `<div style="margin:20px 0 6px;">
<a href="${esc(confirmUrl)}" style="display:inline-block;background:#0f766e;color:#ffffff;text-decoration:none;font-weight:600;padding:11px 20px;border-radius:8px;">✓ Confirm completion</a>
</div>
<p style="margin:6px 0 0;color:#94a3b8;font-size:11px;">Network admin: click the button above once the firewall change is applied. Pending entries will then be activated.</p>`
    : '';

  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;font-size:13px;line-height:1.5;">
${intro.trim() ? `<p style="margin:0 0 14px;">${esc(intro.trim()).replace(/\n/g, '<br>')}</p>` : ''}
<table style="border-collapse:collapse;width:100%;border:1px solid #e2e8f0;">
<thead><tr style="background:#0f766e;color:#ffffff;">
<th style="${th}">#</th><th style="${th}">IP / CIDR</th><th style="${th}">Application</th><th style="${th}">Web Server</th>
<th style="${th}">Env</th><th style="${th}">Business Unit</th><th style="${th}">Status</th><th style="${th}">Owner</th>
</tr></thead>
<tbody>${rows}</tbody>
</table>${confirmBlock}
<p style="margin:14px 0 0;color:#94a3b8;font-size:11px;">Sentinel Whitelist Center · ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}</p>
</div>`;
}

/** Truncate to a max width with an ellipsis, so columns stay aligned. */
const clip = (v: string, max: number) => (v.length <= max ? v : v.slice(0, max - 1) + '…');

/**
 * A monospace box-drawing table for the plain-text body (mailto only carries text).
 * Renders as an aligned table in any mail client that uses a fixed-width font.
 */
function asciiTable(entries: WhitelistEntry[]): string {
  const headers = ['#', 'IP / CIDR', 'Application', 'Web Server', 'Env', 'Business Unit', 'Status', 'Owner'];
  const caps = [4, 18, 22, 16, 11, 16, 8, 14];
  const rows = entries.map((e, i) => [
    String(i + 1),
    clip(e.ipCidr, caps[1]),
    clip(e.appName, caps[2]),
    clip(e.server, caps[3]),
    clip(e.env, caps[4]),
    clip(e.buName, caps[5]),
    clip(e.status, caps[6]),
    clip(e.owner || '-', caps[7]),
  ]);

  // Column width = widest of header / cell values in that column.
  const widths = headers.map((h, c) => Math.max(h.length, ...rows.map((r) => r[c].length)));
  const line = (l: string, m: string, r: string) => l + widths.map((w) => '─'.repeat(w + 2)).join(m) + r;
  const row = (cells: string[]) => '│ ' + cells.map((c, i) => c.padEnd(widths[i])).join(' │ ') + ' │';

  return [line('┌', '┬', '┐'), row(headers), line('├', '┼', '┤'), ...rows.map(row), line('└', '┴', '┘')].join('\n');
}

export function buildWhitelistEmailText(entries: WhitelistEntry[], intro: string, confirmUrl?: string): string {
  const title = `IP Whitelist — ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`;
  const confirm = confirmUrl
    ? `\n\n----------------------------------------\n✓ CONFIRM WHEN DONE:\n${confirmUrl}\n(Clicking this confirms the firewall change and activates any pending entries.)`
    : '';
  return `${intro.trim() ? intro.trim() + '\n\n' : ''}${title}\n\n${asciiTable(entries)}${confirm}\n\n— Sentinel Whitelist Center`;
}
