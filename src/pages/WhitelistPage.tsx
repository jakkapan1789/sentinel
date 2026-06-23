import { Pencil, Plus, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Column, DataTable } from '../components/DataTable';
import { EntityForm, FieldDef } from '../components/EntityForm';
import { Badge, Button, CenterMessage, ConfirmDialog, EmptyState, IconButton, TextInput } from '../components/ui';
import { dataSource } from '../lib/dataSource';
import { formatRelative } from '../lib/format';
import { isValidIpOrCidr } from '../lib/ip';
import { useRefreshVersion } from '../lib/refresh';
import { useAsync } from '../lib/useAsync';
import type { Environment, WhitelistEntry, WhitelistInput, WhitelistStatus } from '../types';

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

export function WhitelistPage() {
  const version = useRefreshVersion();
  const { data, loading, error, reload } = useAsync(() => dataSource.whitelist(), [version]);
  const entries = useMemo(() => data ?? [], [data]);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | WhitelistStatus>('all');
  const [editing, setEditing] = useState<WhitelistEntry | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<WhitelistEntry | null>(null);
  const [busy, setBusy] = useState(false);

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

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 animate-page-in">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">IP Whitelist</h1>
          <p className="mt-0.5 text-xs text-slate-500">
            IP addresses allowed to connect, scoped by web server and application.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" /> Add Entry
        </Button>
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

      <div className="flex flex-col overflow-hidden rounded-xl bg-white ring-1 ring-slate-200/70">
        {loading && !data ? (
          <CenterMessage>Loading whitelist…</CenterMessage>
        ) : error && !data ? (
          <CenterMessage tone="error">Could not load whitelist — {error}</CenterMessage>
        ) : (
          <DataTable
            rows={filtered}
            columns={columns}
            empty={
              <EmptyState
                icon={<ShieldCheck className="h-6 w-6" />}
                title="No whitelist entries"
                description="Add an allowed IP range or adjust the filters above."
                action={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Add Entry</Button>}
              />
            }
          />
        )}
      </div>

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
    </div>
  );
}
