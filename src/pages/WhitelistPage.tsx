import { Check, CheckCircle2, Clock3, Copy, Mail, Pencil, Plus, Search, ShieldCheck, ShieldX, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Column, DataTable } from '../components/DataTable';
import { EntityForm, FieldDef } from '../components/EntityForm';
import { Badge, Button, CenterMessage, ConfirmDialog, EmptyState, IconButton, KpiCard, Modal, Textarea, TextInput } from '../components/ui';
import { dataSource } from '../lib/dataSource';
import { buildWhitelistEmailHtml, buildWhitelistEmailText } from '../lib/email';
import { formatNumber, formatRelative } from '../lib/format';
import { isValidIpOrCidr } from '../lib/ip';
import { useRefreshVersion } from '../lib/refresh';
import { useAsync } from '../lib/useAsync';
import type { Environment, WhitelistAck, WhitelistEntry, WhitelistInput, WhitelistStatus } from '../types';

const statusTone: Record<WhitelistStatus, 'emerald' | 'amber' | 'rose'> = {
  active: 'emerald',
  pending: 'amber',
  disabled: 'rose',
};

const envTone: Record<Environment, 'sky' | 'violet' | 'slate'> = {
  production: 'sky',
  staging: 'violet',
  development: 'slate',
};

const formFields: FieldDef<WhitelistInput>[] = [
  {
    name: 'ipCidr',
    label: 'IP Address / CIDR',
    required: true,
    placeholder: '172.27.10.0/24',
    hint: 'Single IPv4 or CIDR range',
    validate: (value) => (isValidIpOrCidr(value) ? '' : 'Enter a valid IPv4 address or CIDR.'),
  },
  { name: 'appName', label: 'Application / Service', required: true, placeholder: 'Customer Profile Service' },
  { name: 'server', label: 'Web Server', required: true, placeholder: 'prod-api-gw-01' },
  {
    name: 'env',
    label: 'Environment',
    type: 'select',
    options: [
      { value: 'production', label: 'Production' },
      { value: 'staging', label: 'Staging' },
      { value: 'development', label: 'Development' },
    ],
  },
  { name: 'buName', label: 'Business Unit', required: true, placeholder: 'Retail Banking' },
  { name: 'owner', label: 'Owner', placeholder: 'Responsible person' },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    options: [
      { value: 'active', label: 'Active' },
      { value: 'pending', label: 'Pending review' },
      { value: 'disabled', label: 'Disabled' },
    ],
  },
  { name: 'notes', label: 'Notes', type: 'textarea', colSpan: 2, placeholder: 'Purpose / notes' },
];

const emptyDraft: Record<string, string> = {
  ipCidr: '', appName: '', server: '', env: 'production', buName: '', owner: '', status: 'active', notes: '',
};

const toInput = (v: Record<string, string>): WhitelistInput => ({
  ipCidr: v.ipCidr.trim(),
  appName: v.appName.trim(),
  server: v.server.trim(),
  env: v.env as Environment,
  buName: v.buName.trim(),
  status: v.status as WhitelistStatus,
  owner: v.owner.trim() || null,
  notes: v.notes.trim() || null,
});

function EmailDraftModal({
  entries,
  onClose,
  onCreated,
}: {
  entries: WhitelistEntry[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState(`IP Whitelist Request — ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`);
  const [intro, setIntro] = useState('Hi team,\n\nPlease apply the following IP whitelist entries:');
  const [ack, setAck] = useState<WhitelistAck | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  // Live preview; once created, the real confirm link is embedded in the button.
  const html = useMemo(() => buildWhitelistEmailHtml(entries, intro, ack?.confirmUrl), [entries, intro, ack]);
  const text = useMemo(() => buildWhitelistEmailText(entries, intro, ack?.confirmUrl), [entries, intro, ack]);

  const copyEmail = async () => {
    try {
      if (navigator.clipboard && 'write' in navigator.clipboard && typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([text], { type: 'text/plain' }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(text);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      } catch {
        /* clipboard unavailable */
      }
    }
  };

  // Create the ack request once (gives us the confirm link); reuse it afterwards.
  const ensureAck = async (): Promise<WhitelistAck> => {
    if (ack) return ack;
    const created = await dataSource.createWhitelistAck({
      entryIds: entries.map((e) => e.id),
      recipient: to.trim() || null,
      subject: subject.trim() || null,
      intro: intro.trim() || null,
    });
    setAck(created);
    onCreated();
    return created;
  };

  // Persist the request (creates the confirm link), then copy the email in one step.
  const createAndCopy = async () => {
    setBusy(true);
    try {
      const created = await ensureAck();
      // copy with the embedded confirm link (best-effort — never let a clipboard error break the flow)
      const withLinkHtml = buildWhitelistEmailHtml(entries, intro, created.confirmUrl);
      const withLinkText = buildWhitelistEmailText(entries, intro, created.confirmUrl);
      try {
        if (typeof ClipboardItem !== 'undefined') {
          await navigator.clipboard.write([
            new ClipboardItem({
              'text/html': new Blob([withLinkHtml], { type: 'text/html' }),
              'text/plain': new Blob([withLinkText], { type: 'text/plain' }),
            }),
          ]);
        } else {
          await navigator.clipboard.writeText(withLinkText);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      } catch {
        try {
          await navigator.clipboard.writeText(withLinkText);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        } catch {
          /* clipboard unavailable (e.g. not focused) — request is still created */
        }
      }
    } finally {
      setBusy(false);
    }
  };

  // Open the default mail app with the aligned table + confirm link in the (plain-text) body.
  const openMail = async () => {
    setBusy(true);
    try {
      const created = await ensureAck();
      const body = buildWhitelistEmailText(entries, intro, created.confirmUrl);
      window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Draft whitelist email"
      description={`${entries.length} selected · the email includes a one-click confirm link for the network admin`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button variant="ghost" onClick={openMail} disabled={busy}>
            <Mail className="h-4 w-4" /> Open in mail app
          </Button>
          {ack ? (
            <Button onClick={copyEmail}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied' : 'Copy email'}
            </Button>
          ) : (
            <Button onClick={createAndCopy} disabled={busy}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {busy ? 'Creating…' : 'Create & copy'}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">To</span>
            <TextInput value={to} onChange={(e) => setTo(e.target.value)} placeholder="firewall-team@bank.co.th" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Subject</span>
            <TextInput value={subject} onChange={(e) => setSubject(e.target.value)} />
          </label>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Intro message</span>
          <Textarea value={intro} onChange={(e) => setIntro(e.target.value)} rows={3} />
        </label>

        {ack && (
          <div className="rounded-xl border border-teal-200 bg-teal-50/60 p-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-teal-800">
              <CheckCircle2 className="h-4 w-4" /> Request created · confirm link
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              <code className="min-w-0 flex-1 truncate rounded-md bg-white px-2 py-1.5 font-mono text-[11px] text-slate-600 ring-1 ring-slate-200">
                {ack.confirmUrl}
              </code>
              <button
                onClick={async () => {
                  await navigator.clipboard.writeText(ack.confirmUrl);
                  setLinkCopied(true);
                  setTimeout(() => setLinkCopied(false), 1500);
                }}
                className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-600 transition hover:bg-slate-50"
              >
                {linkCopied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
                {linkCopied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="mt-1.5 text-[11px] text-teal-700">
              When the network admin opens this link and confirms, any pending entries are activated automatically.
            </p>
          </div>
        )}

        <div>
          <span className="mb-1 block text-xs font-medium text-slate-600">Preview</span>
          <div className="max-h-72 overflow-auto rounded-xl border border-slate-200 bg-white p-3" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>
    </Modal>
  );
}

export function WhitelistPage() {
  const version = useRefreshVersion();
  const { data, loading, error, reload } = useAsync(() => dataSource.whitelist(), [version]);
  const acks = useAsync(() => dataSource.whitelistAcks(), [version]);
  const entries = useMemo(() => data ?? [], [data]);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | WhitelistStatus>('all');
  const [editing, setEditing] = useState<WhitelistEntry | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<WhitelistEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Map<number, WhitelistEntry>>(new Map());
  const [emailing, setEmailing] = useState(false);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return entries.filter((entry) => {
      const statusOk = statusFilter === 'all' || entry.status === statusFilter;
      const textOk =
        term.length === 0 ||
        [entry.ipCidr, entry.appName, entry.server, entry.buName, entry.owner ?? '', entry.notes ?? '']
          .join(' ')
          .toLowerCase()
          .includes(term);
      return statusOk && textOk;
    });
  }, [entries, search, statusFilter]);

  const stats = useMemo(
    () => ({
      total: entries.length,
      active: entries.filter((e) => e.status === 'active').length,
      pending: entries.filter((e) => e.status === 'pending').length,
      disabled: entries.filter((e) => e.status === 'disabled').length,
    }),
    [entries],
  );

  const columns: Column<WhitelistEntry>[] = [
    {
      key: 'ipCidr',
      header: 'IP / CIDR',
      filterable: true,
      filterValue: (row) => row.ipCidr,
      sortValue: (row) => row.ipCidr,
      render: (row) => (
        <div>
          <span className="font-mono text-xs font-semibold text-slate-900">{row.ipCidr}</span>
          <span className="mt-0.5 block text-[11px] text-slate-400">WL-{row.id}</span>
        </div>
      ),
    },
    {
      key: 'appName',
      header: 'Application',
      filterable: true,
      sortValue: (row) => row.appName,
      render: (row) => (
        <div>
          <span className="font-medium text-slate-800">{row.appName}</span>
          <span className="mt-0.5 block text-[11px] text-slate-400">{row.buName}</span>
        </div>
      ),
    },
    {
      key: 'server',
      header: 'Web Server',
      hideBelow: 'md',
      filterable: true,
      sortValue: (row) => row.server,
      render: (row) => <span className="font-mono text-[11px] text-slate-600">{row.server}</span>,
    },
    {
      key: 'env',
      header: 'Env',
      hideBelow: 'lg',
      filterable: true,
      sortValue: (row) => row.env,
      render: (row) => <Badge tone={envTone[row.env]} className="capitalize">{row.env}</Badge>,
    },
    {
      key: 'status',
      header: 'Status',
      filterable: true,
      sortValue: (row) => row.status,
      render: (row) => <Badge tone={statusTone[row.status]} className="capitalize">{row.status}</Badge>,
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      hideBelow: 'xl',
      sortValue: (row) => row.updatedAt,
      render: (row) => <span className="text-[11px] text-slate-500">{formatRelative(row.updatedAt)}</span>,
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (row) => (
        <div className="flex justify-end gap-1">
          <IconButton label="Edit" onClick={() => setEditing(row)}>
            <Pencil className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton label="Delete" danger onClick={() => setDeleting(row)}>
            <Trash2 className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      ),
    },
  ];

  const runMutation = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      reload();
    } finally {
      setBusy(false);
    }
  };

  // First-run state: nothing in the whitelist at all (not just hidden by a filter).
  const isEmpty = !loading && !error && entries.length === 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 animate-page-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">IP Whitelist</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            IP addresses allowed to connect, scoped by web server and application.
          </p>
        </div>
        {!isEmpty && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Add Entry
          </Button>
        )}
      </div>

      {isEmpty ? (
        <WhitelistEmptyState onAdd={() => setCreating(true)} />
      ) : (
      <>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard icon={ShieldCheck} tone="teal" label="Total Entries" value={formatNumber(stats.total)} sub="all environments" />
        <KpiCard icon={CheckCircle2} tone="emerald" label="Active" value={formatNumber(stats.active)} sub="currently enforced" />
        <KpiCard icon={Clock3} tone="amber" label="Pending" value={formatNumber(stats.pending)} sub="awaiting review" />
        <KpiCard icon={ShieldX} tone="rose" label="Disabled" value={formatNumber(stats.disabled)} sub="blocked / archived" />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <TextInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search IP, app, server, BU…" className="pl-9" />
        </div>
        <div className="flex flex-wrap items-center gap-1 rounded-xl bg-slate-100/80 p-1 ring-1 ring-slate-200/70">
          {(['all', 'active', 'pending', 'disabled'] as const).map((value) => (
            <button
              key={value}
              onClick={() => setStatusFilter(value)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition ${
                statusFilter === value ? 'bg-white text-slate-900 ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {value}
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-400 sm:ml-auto">{filtered.length} entries</span>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-teal-200 bg-teal-50/70 px-4 py-2.5">
          <span className="text-xs font-medium text-teal-800">{selected.size} selected</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setSelected(new Map())} className="text-xs font-medium text-slate-500 hover:text-slate-800">
              Clear
            </button>
            <Button onClick={() => setEmailing(true)} className="h-8 px-3 text-xs">
              <Mail className="h-3.5 w-3.5" /> Draft email
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col overflow-hidden rounded-xl bg-white ring-1 ring-slate-200/70">
        {loading && !data ? (
          <CenterMessage>Loading whitelist…</CenterMessage>
        ) : error && !data ? (
          <CenterMessage tone="error">Could not load whitelist — {error}</CenterMessage>
        ) : (
          <DataTable
            rows={filtered}
            columns={columns}
            selection={{
              isSelected: (row) => selected.has(row.id),
              onToggle: (row) =>
                setSelected((prev) => {
                  const next = new Map(prev);
                  if (next.has(row.id)) next.delete(row.id);
                  else next.set(row.id, row);
                  return next;
                }),
              allOnPageSelected: filtered.length > 0 && filtered.every((r) => selected.has(r.id)),
              onToggleAll: (checked) =>
                setSelected((prev) => {
                  const next = new Map(prev);
                  for (const r of filtered) {
                    if (checked) next.set(r.id, r);
                    else next.delete(r.id);
                  }
                  return next;
                }),
            }}
            empty={
              <EmptyState
                icon={<ShieldCheck className="h-6 w-6" />}
                title="No matching entries"
                description="No whitelist entries match the current search or filters."
                action={
                  <Button variant="secondary" onClick={() => { setSearch(''); setStatusFilter('all'); }}>
                    Clear filters
                  </Button>
                }
              />
            }
          />
        )}
      </div>
      </>
      )}

      {(acks.data?.length ?? 0) > 0 && (
        <section className="flex flex-col overflow-hidden rounded-xl bg-white ring-1 ring-slate-200/70">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold tracking-tight text-slate-800">Sent for confirmation</h2>
            <p className="mt-0.5 text-[11px] text-slate-500">Acknowledgement requests emailed to the network team.</p>
          </div>
          <div className="divide-y divide-slate-100">
            {(acks.data ?? []).slice(0, 8).map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-xs">
                <Badge tone={a.status === 'acknowledged' ? 'emerald' : 'amber'} dot>
                  {a.status === 'acknowledged' ? 'confirmed' : 'awaiting'}
                </Badge>
                <span className="font-medium text-slate-700">{a.itemCount} entr{a.itemCount === 1 ? 'y' : 'ies'}</span>
                {a.recipient && <span className="text-slate-400">→ {a.recipient}</span>}
                {a.status === 'acknowledged' ? (
                  <span className="text-emerald-600">
                    activated {a.activatedCount}
                    {a.acknowledgedAt ? ` · ${formatRelative(a.acknowledgedAt)}` : ''}
                    {a.acknowledgedNote ? ` · “${a.acknowledgedNote}”` : ''}
                  </span>
                ) : (
                  <a href={a.confirmUrl} target="_blank" rel="noreferrer" className="font-medium text-teal-700 hover:underline">
                    confirm link
                  </a>
                )}
                <span className="ml-auto text-[11px] text-slate-400">{formatRelative(a.createdAt)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {creating && (
        <EntityForm<WhitelistInput>
          title="Add Whitelist Entry"
          description="Allow a new IP / CIDR to connect to a service."
          fields={formFields}
          initial={emptyDraft}
          submitLabel={busy ? 'Saving…' : 'Add Entry'}
          onCancel={() => setCreating(false)}
          onSubmit={(values) => runMutation(() => dataSource.createWhitelist(toInput(values))).then(() => setCreating(false))}
        />
      )}

      {editing && (
        <EntityForm<WhitelistInput>
          title="Edit Whitelist Entry"
          description={`WL-${editing.id}`}
          fields={formFields}
          initial={{
            ipCidr: editing.ipCidr,
            appName: editing.appName,
            server: editing.server,
            env: editing.env,
            buName: editing.buName,
            owner: editing.owner ?? '',
            status: editing.status,
            notes: editing.notes ?? '',
          }}
          submitLabel={busy ? 'Saving…' : 'Save Changes'}
          onCancel={() => setEditing(null)}
          onSubmit={(values) => runMutation(() => dataSource.updateWhitelist(editing.id, toInput(values))).then(() => setEditing(null))}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete whitelist entry?"
          message={`${deleting.ipCidr} (${deleting.appName}) will be removed. This cannot be undone.`}
          onCancel={() => setDeleting(null)}
          onConfirm={() => runMutation(() => dataSource.deleteWhitelist(deleting.id)).then(() => setDeleting(null))}
        />
      )}

      {emailing && selected.size > 0 && (
        <EmailDraftModal
          entries={Array.from(selected.values())}
          onClose={() => setEmailing(false)}
          onCreated={() => acks.reload()}
        />
      )}
    </div>
  );
}

function WhitelistEmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-gradient-to-b from-white to-slate-50/60 px-6 py-12">
      <div className="flex max-w-md flex-col items-center text-center">
        <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-50 text-teal-600 ring-1 ring-teal-100">
          <ShieldCheck className="h-7 w-7" />
        </span>
        <h2 className="mt-4 text-base font-semibold text-slate-900">Your whitelist is empty</h2>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
          No IP addresses are allowed yet. Add an allowed IP or CIDR range — scoped by web server and
          application — and it will appear here ready to be reviewed and enforced.
        </p>
        <div className="mt-5">
          <Button onClick={onAdd}>
            <Plus className="h-4 w-4" /> Add your first entry
          </Button>
        </div>
        <ul className="mt-6 grid w-full gap-2 text-left text-[11px] text-slate-500">
          <li className="flex items-start gap-2 rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200/70">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
            Add a single IPv4 address or a CIDR range (e.g. <code className="font-mono">172.27.10.0/24</code>).
          </li>
          <li className="flex items-start gap-2 rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200/70">
            <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
            Mark entries as <span className="font-medium">pending</span> and email the network team a one-click confirm link.
          </li>
        </ul>
      </div>
    </div>
  );
}
