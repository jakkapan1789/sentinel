import { Activity, GitCompareArrows, Globe, Plus, Search, ShieldCheck, ShieldX } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Column, DataTable } from '../components/DataTable';
import { EntityForm, FieldDef } from '../components/EntityForm';
import {
  Badge,
  Button,
  CenterMessage,
  EmptyState,
  KpiCard,
  Modal,
  SelectMenu,
  Textarea,
  TextInput,
} from '../components/ui';
import { dataSource } from '../lib/dataSource';
import { formatNumber, formatRelative } from '../lib/format';
import { useRefreshVersion } from '../lib/refresh';
import { useAsync } from '../lib/useAsync';
import type { Environment, IpMatch, IpMatchFacets, PagedResult, WhitelistInput, WhitelistStatus } from '../types';

type MatchRow = IpMatch & { id: string };

const USAGE_PRESETS = [0, 50, 100, 500];

const singleFields: FieldDef<WhitelistInput>[] = [
  { name: 'ipCidr', label: 'IP Address / CIDR', required: true },
  { name: 'appName', label: 'Application / Service', required: true },
  { name: 'server', label: 'Web Server', required: true },
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
  { name: 'buName', label: 'Business Unit', required: true },
  { name: 'owner', label: 'Owner', placeholder: 'Responsible person' },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    options: [
      { value: 'pending', label: 'Pending review' },
      { value: 'active', label: 'Active' },
      { value: 'disabled', label: 'Disabled' },
    ],
  },
  { name: 'notes', label: 'Notes', type: 'textarea', colSpan: 2 },
];

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

const prefillFor = (m: IpMatch): WhitelistInput => ({
  ipCidr: `${m.ip}/32`,
  appName: m.appName || 'Unknown',
  server: m.server || 'unknown',
  env: 'production',
  buName: m.buName || '(no BU)',
  status: 'pending',
  owner: null,
  notes: `Matched IP — app usage ${m.appUsage}, network usage ${m.networkUsage}.`,
});

const chips = (values: string[]) => (
  <div className="flex flex-wrap items-center gap-1">
    {values.slice(0, 2).map((v) => (
      <span key={v} className="inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">
        {v}
      </span>
    ))}
    {values.length > 2 && <span className="text-[11px] font-medium text-slate-400">+{values.length - 2}</span>}
    {values.length === 0 && <span className="text-slate-300">—</span>}
  </div>
);

export function IpMatchPage() {
  const version = useRefreshVersion();

  const [minUsage, setMinUsage] = useState(0);
  const [matchFilter, setMatchFilter] = useState<'all' | 'matched' | 'unmatched'>('all');
  const [colFilters, setColFilters] = useState<Record<string, string[]>>({});
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'totalUsage', direction: 'desc' });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [selected, setSelected] = useState<Map<string, IpMatch>>(new Map());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [single, setSingle] = useState<IpMatch | null>(null);
  const [busy, setBusy] = useState(false);

  const csv = (key: string) => (colFilters[key]?.length ? colFilters[key].join(',') : undefined);
  const ctx = {
    minUsage,
    bu: csv('bu'),
    country: csv('country'),
    matched: matchFilter === 'all' ? undefined : matchFilter,
    search: search.trim() || undefined,
  };

  const facets = useAsync(
    () => dataSource.ipMatchFacets(),
    [version],
  );

  const stats = useAsync(
    () => dataSource.ipMatchStats(ctx),
    [version, minUsage, ctx.bu, ctx.country, ctx.matched, ctx.search],
  );

  const matches = useAsync(
    () =>
      dataSource.ipMatches({ ...ctx, sort: `${sort.key}:${sort.direction}`, page, pageSize }) as Promise<PagedResult<IpMatch>>,
    [version, minUsage, ctx.bu, ctx.country, ctx.matched, ctx.search, sort.key, sort.direction, page, pageSize],
  );

  const rows = useMemo<MatchRow[]>(() => (matches.data?.items ?? []).map((m) => ({ ...m, id: m.ip })), [matches.data]);
  const total = matches.data?.total ?? 0;
  const s = stats.data;

  const reloadAll = () => {
    matches.reload();
    stats.reload();
  };

  const allOnPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.ip));
  const toggle = (m: IpMatch) =>
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(m.ip)) next.delete(m.ip);
      else next.set(m.ip, m);
      return next;
    });
  const togglePage = (checked: boolean) =>
    setSelected((prev) => {
      const next = new Map(prev);
      for (const r of rows) {
        if (checked) next.set(r.ip, r);
        else next.delete(r.ip);
      }
      return next;
    });

  const onSortChange = (key: string) => {
    setSort((prev) => (prev.key === key ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'desc' }));
    setPage(1);
  };

  const columns: Column<MatchRow>[] = [
    {
      key: 'ip',
      header: 'IP Address',
      sortValue: (r) => r.ip,
      render: (r) => (
        <div>
          <span className="font-mono text-xs font-semibold text-slate-900">{r.ip}</span>
          <span className="mt-0.5 block">
            {r.matched ? (
              <Badge tone="emerald" dot>matched app log</Badge>
            ) : (
              <Badge tone="slate" dot>no app match</Badge>
            )}
          </span>
        </div>
      ),
    },
    {
      key: 'bu',
      header: 'Business Unit',
      filterable: true,
      render: (r) => chips(r.buNames),
    },
    {
      key: 'appNames',
      header: 'Application',
      hideBelow: 'lg',
      render: (r) => chips(r.appNames),
    },
    {
      key: 'country',
      header: 'Country',
      hideBelow: 'lg',
      filterable: true,
      render: (r) => (
        <span className="inline-flex items-center gap-1.5 text-slate-600">
          <Globe className="h-3.5 w-3.5 text-slate-400" />
          {r.country || '—'}
        </span>
      ),
    },
    {
      key: 'appUsage',
      header: 'App Usage',
      align: 'right',
      hideBelow: 'md',
      sortValue: (r) => r.appUsage,
      render: (r) => <span className="tabular-nums text-slate-600">{formatNumber(r.appUsage)}</span>,
    },
    {
      key: 'networkUsage',
      header: 'Net Usage',
      align: 'right',
      hideBelow: 'md',
      sortValue: (r) => r.networkUsage,
      render: (r) => <span className="tabular-nums text-slate-600">{formatNumber(r.networkUsage)}</span>,
    },
    {
      key: 'totalUsage',
      header: 'Total',
      align: 'right',
      sortValue: (r) => r.totalUsage,
      render: (r) => <span className="font-semibold tabular-nums text-slate-900">{formatNumber(r.totalUsage)}</span>,
    },
    {
      key: 'lastSeen',
      header: 'Last Seen',
      align: 'right',
      hideBelow: 'xl',
      sortValue: (r) => r.lastSeen,
      render: (r) => <span className="text-[11px] text-slate-500">{formatRelative(r.lastSeen)}</span>,
    },
    {
      key: 'action',
      header: '',
      align: 'right',
      render: (r) => (
        <button
          onClick={() => setSingle(r)}
          className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-teal-200 bg-teal-50 px-2.5 py-1 text-[11px] font-semibold text-teal-700 transition hover:bg-teal-100"
        >
          <Plus className="h-3 w-3" /> Whitelist
        </button>
      ),
    },
  ];

  const activeFilterCount = (colFilters.bu?.length ?? 0) + (colFilters.country?.length ?? 0) + (matchFilter !== 'all' ? 1 : 0);

  const runBulk = async (shared: { env: Environment; status: WhitelistStatus; owner: string; notes: string }) => {
    setBusy(true);
    try {
      const entries: WhitelistInput[] = Array.from(selected.values()).map((m) => ({
        ...prefillFor(m),
        env: shared.env,
        status: shared.status,
        owner: shared.owner.trim() || null,
        notes: shared.notes.trim() || prefillFor(m).notes,
      }));
      await dataSource.bulkAddWhitelist(entries);
      setSelected(new Map());
      setBulkOpen(false);
      reloadAll();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 animate-page-in">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-900">
          <GitCompareArrows className="h-5 w-5 text-teal-600" />
          IP Match
        </h1>
        <p className="mt-0.5 text-xs text-slate-500">
          Network source IPs, flagged where they match application traffic. Already-whitelisted IPs are hidden — pick the ones you trust and add them.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard icon={GitCompareArrows} tone="sky" label="Network IPs" value={formatNumber(s?.total ?? 0)} sub="not yet whitelisted" />
        <KpiCard icon={ShieldCheck} tone="emerald" label="Matched" value={formatNumber(s?.matched ?? 0)} sub="also in app logs" />
        <KpiCard icon={ShieldX} tone="amber" label="Unmatched" value={formatNumber(s?.unmatched ?? 0)} sub="no app traffic" />
        <KpiCard icon={Activity} tone="teal" label="Combined Usage" value={formatNumber(s?.combinedUsage ?? 0)} sub="app + network" />
      </div>

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <TextInput
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search IP…"
            className="pl-9"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-slate-500">Min usage</span>
          <div className="flex items-center gap-1 rounded-xl bg-slate-100/80 p-1 ring-1 ring-slate-200/70">
            {USAGE_PRESETS.map((value) => (
              <button
                key={value}
                onClick={() => {
                  setMinUsage(value);
                  setPage(1);
                }}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                  minUsage === value ? 'bg-white text-slate-900 ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800'
                }`}
              >
                {value === 0 ? 'All' : `≥${value}`}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1 rounded-xl bg-slate-100/80 p-1 ring-1 ring-slate-200/70">
          {(['all', 'matched', 'unmatched'] as const).map((value) => (
            <button
              key={value}
              onClick={() => {
                setMatchFilter(value);
                setPage(1);
              }}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium capitalize transition ${
                matchFilter === value ? 'bg-white text-slate-900 ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {value}
            </button>
          ))}
        </div>

        {activeFilterCount > 0 && (
          <button
            onClick={() => {
              setColFilters({});
              setMatchFilter('all');
              setPage(1);
            }}
            className="text-xs font-medium text-teal-700 hover:underline"
          >
            Clear filters
          </button>
        )}
        <span className="text-xs text-slate-400 lg:ml-auto">{formatNumber(total)} IPs</span>
      </div>

      {selected.size > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-teal-200 bg-teal-50/70 px-4 py-2.5">
          <span className="text-xs font-medium text-teal-800">{selected.size} selected</span>
          <div className="flex items-center gap-2">
            <button onClick={() => setSelected(new Map())} className="text-xs font-medium text-slate-500 hover:text-slate-800">
              Clear
            </button>
            <Button onClick={() => setBulkOpen(true)}>
              <Plus className="h-4 w-4" /> Add {selected.size} to whitelist
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200/70">
        {matches.loading && !matches.data ? (
          <CenterMessage>Loading matches…</CenterMessage>
        ) : matches.error && !matches.data ? (
          <CenterMessage tone="error">Could not load — {matches.error}</CenterMessage>
        ) : (
          <DataTable
            rows={rows}
            columns={columns}
            selection={{
              isSelected: (r) => selected.has(r.ip),
              onToggle: toggle,
              allOnPageSelected,
              onToggleAll: togglePage,
            }}
            server={{
              total,
              page,
              pageSize,
              sortKey: sort.key,
              sortDirection: sort.direction,
              onPageChange: setPage,
              onPageSizeChange: (size) => {
                setPageSize(size);
                setPage(1);
              },
              onSortChange,
              filters: {
                options: { bu: facets.data?.bu ?? [], country: facets.data?.country ?? [] },
                selected: colFilters,
                onChange: (key, values) => {
                  setColFilters((prev) => ({ ...prev, [key]: values }));
                  setPage(1);
                },
              },
            }}
            empty={
              <EmptyState
                icon={<GitCompareArrows className="h-6 w-6" />}
                title="No matching IPs"
                description="No IP appears in both application and network logs for these filters."
              />
            }
          />
        )}
      </div>

      {single && (
        <EntityForm<WhitelistInput>
          title="Add to whitelist"
          description={`${single.ip} — review and confirm`}
          fields={singleFields}
          initial={{ ...prefillFor(single), owner: '', notes: prefillFor(single).notes ?? '' } as unknown as Record<string, string>}
          submitLabel={busy ? 'Saving…' : 'Add to whitelist'}
          onCancel={() => setSingle(null)}
          onSubmit={async (values) => {
            setBusy(true);
            try {
              await dataSource.createWhitelist(toInput(values));
              setSingle(null);
              reloadAll();
            } finally {
              setBusy(false);
            }
          }}
        />
      )}

      {bulkOpen && <BulkModal count={selected.size} busy={busy} onCancel={() => setBulkOpen(false)} onConfirm={runBulk} />}
    </div>
  );
}

function BulkModal({
  count,
  busy,
  onCancel,
  onConfirm,
}: {
  count: number;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (shared: { env: Environment; status: WhitelistStatus; owner: string; notes: string }) => void;
}) {
  const [env, setEnv] = useState<Environment>('production');
  const [status, setStatus] = useState<WhitelistStatus>('pending');
  const [owner, setOwner] = useState('');
  const [notes, setNotes] = useState('');

  return (
    <Modal
      title={`Add ${count} IP${count > 1 ? 's' : ''} to whitelist`}
      description="Each IP is added as a /32 host. Application, server and BU come from the dominant app-log values per IP."
      onClose={onCancel}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => onConfirm({ env, status, owner, notes })} disabled={busy}>
            {busy ? 'Saving…' : `Add ${count}`}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Environment</span>
          <SelectMenu
            value={env}
            onChange={(v) => setEnv(v as Environment)}
            options={[
              { value: 'production', label: 'Production' },
              { value: 'staging', label: 'Staging' },
              { value: 'development', label: 'Development' },
            ]}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-600">Status</span>
          <SelectMenu
            value={status}
            onChange={(v) => setStatus(v as WhitelistStatus)}
            options={[
              { value: 'pending', label: 'Pending review' },
              { value: 'active', label: 'Active' },
              { value: 'disabled', label: 'Disabled' },
            ]}
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-slate-600">Owner</span>
          <TextInput value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Responsible person" />
        </label>
        <label className="block sm:col-span-2">
          <span className="mb-1 block text-xs font-medium text-slate-600">Notes</span>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional — applied to all entries" />
        </label>
      </div>
    </Modal>
  );
}
