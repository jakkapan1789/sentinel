import { Activity, ArrowRight, Building2, CheckCircle2, Database, Search, ServerCog, XCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Column, DataTable } from '../components/DataTable';
import { Badge, CenterMessage, EmptyState, TextInput } from '../components/ui';
import { dataSource } from '../lib/dataSource';
import { formatDateTime, formatNumber, formatRelative } from '../lib/format';
import { useRefreshVersion } from '../lib/refresh';
import { useAsync } from '../lib/useAsync';
import type { ApplicationLog, BuSummary, PagedResult, ResponseStatus } from '../types';

type SummaryRow = BuSummary & { id: string };

const statusTone = (status: ResponseStatus): 'emerald' | 'rose' => (status === 'Success' ? 'emerald' : 'rose');

export function ApplicationLogsPage({
  selectedBu,
  onSelectBu,
}: {
  selectedBu: string | null;
  onSelectBu: (bu: string | null) => void;
}) {
  const version = useRefreshVersion();
  const [search, setSearch] = useState('');

  // Detail (server-side) paging state.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [status, setStatus] = useState<'all' | ResponseStatus>('all');
  const [sort, setSort] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'createdAt', direction: 'desc' });

  // Reset detail controls whenever we switch BU (or back to summary).
  useEffect(() => {
    setSearch('');
    setPage(1);
    setStatus('all');
    setSort({ key: 'createdAt', direction: 'desc' });
  }, [selectedBu]);

  const summary = useAsync(() => dataSource.buSummary(), [version]);

  const detail = useAsync(
    () =>
      selectedBu
        ? dataSource.appLogsPage({
            bu: selectedBu,
            search: search.trim() || undefined,
            responseStatus: status === 'all' ? undefined : status,
            sort: `${sort.key}:${sort.direction}`,
            page,
            pageSize,
          })
        : Promise.resolve<PagedResult<ApplicationLog>>({ items: [], total: 0, page: 1, pageSize }),
    [selectedBu, search, status, sort.key, sort.direction, page, pageSize, version],
  );

  const summaryRows = useMemo<SummaryRow[]>(() => {
    const term = search.trim().toLowerCase();
    const rows = (summary.data ?? []).map((s) => ({ ...s, id: s.buName }));
    return term ? rows.filter((r) => r.buName.toLowerCase().includes(term)) : rows;
  }, [summary.data, search]);

  const buStat = (summary.data ?? []).find((s) => s.buName === selectedBu);
  const successRate = buStat && buStat.transactions ? (buStat.successCount / buStat.transactions) * 100 : 0;
  const errorRate = buStat && buStat.transactions ? (buStat.errorCount / buStat.transactions) * 100 : 0;

  const summaryColumns: Column<SummaryRow>[] = [
    {
      key: 'buName',
      header: 'Business Unit',
      filterable: true,
      filterValue: (row) => row.buName,
      sortValue: (row) => row.buName,
      render: (row) => (
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-600 ring-1 ring-teal-100">
            <Building2 className="h-4 w-4" />
          </span>
          <span className="font-semibold text-slate-800">{row.buName}</span>
        </div>
      ),
    },
    {
      key: 'servers',
      header: 'Servers',
      filterable: true,
      filterValues: (row) => row.servers,
      sortValue: (row) => row.servers.join(', '),
      render: (row) => (
        <div className="flex flex-wrap items-center gap-1">
          {row.servers.slice(0, 3).map((server) => (
            <span key={server} className="inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
              {server}
            </span>
          ))}
          {row.servers.length > 3 && <span className="text-[11px] font-medium text-slate-400">+{row.servers.length - 3}</span>}
        </div>
      ),
    },
    {
      key: 'totalUsage',
      header: 'Usage',
      align: 'right',
      sortValue: (row) => row.totalUsage,
      render: (row) => <span className="font-semibold tabular-nums text-slate-900">{formatNumber(row.totalUsage)}</span>,
    },
    {
      key: 'lastSeen',
      header: 'Last Seen',
      align: 'right',
      hideBelow: 'lg',
      sortValue: (row) => row.lastSeen ?? '',
      render: (row) => <span className="text-[11px] text-slate-500">{row.lastSeen ? formatRelative(row.lastSeen) : '—'}</span>,
    },
    { key: 'go', header: '', align: 'right', render: () => <ArrowRight className="ml-auto h-4 w-4 text-slate-300" /> },
  ];

  const detailColumns: Column<ApplicationLog>[] = [
    {
      key: 'clientIp',
      header: 'Client IP',
      sortValue: (row) => row.clientIp,
      render: (row) => <span className="font-mono text-xs font-semibold text-slate-900">{row.clientIp}</span>,
    },
    {
      key: 'functionName',
      header: 'Function',
      sortValue: (row) => row.functionName,
      render: (row) => (
        <div>
          <span className="font-medium text-slate-800">{row.functionName}</span>
          {row.httpStatusCode != null && (
            <span className="mt-0.5 block text-[11px] text-slate-400">HTTP {row.httpStatusCode}</span>
          )}
        </div>
      ),
    },
    {
      key: 'responseStatus',
      header: 'Response Status',
      sortValue: (row) => row.responseStatus,
      render: (row) => <Badge tone={statusTone(row.responseStatus)} dot>{row.responseStatus}</Badge>,
    },
    {
      key: 'databaseName',
      header: 'Database',
      hideBelow: 'md',
      sortValue: (row) => row.databaseName ?? '',
      render: (row) => (
        <span className="inline-flex items-center gap-1.5 text-slate-600">
          <Database className="h-3.5 w-3.5 text-slate-400" />
          <span className="truncate">{row.databaseName || '—'}</span>
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: 'Created At',
      hideBelow: 'lg',
      sortValue: (row) => row.createdAt,
      render: (row) => <span className="whitespace-nowrap text-[11px] text-slate-500">{formatDateTime(row.createdAt)}</span>,
    },
  ];

  // -------- Summary view (client-side, small) --------
  if (selectedBu === null) {
    return (
      <div key="summary" className="flex h-full min-h-0 flex-col gap-4 animate-page-in">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Application IP Logs</h1>
          <p className="mt-0.5 text-xs text-slate-500">Usage summarized by business unit. Open a unit to inspect each transaction.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <TextInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search business unit…" className="pl-9" />
          </div>
          <span className="text-xs text-slate-400 sm:ml-auto">{summaryRows.length} business units</span>
        </div>
        <div className="flex flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200/70">
          {summary.loading && !summary.data ? (
            <CenterMessage>Loading summary…</CenterMessage>
          ) : summary.error && !summary.data ? (
            <CenterMessage tone="error">Could not load — {summary.error}</CenterMessage>
          ) : (
            <DataTable
              rows={summaryRows}
              columns={summaryColumns}
              onRowClick={(row) => onSelectBu(row.buName)}
              empty={<EmptyState icon={<Building2 className="h-6 w-6" />} title="No business units" description="No application logs ingested yet." />}
            />
          )}
        </div>
      </div>
    );
  }

  // -------- Detail view (server-side paging) --------
  const rows = detail.data?.items ?? [];
  const total = detail.data?.total ?? 0;

  return (
    <div key={selectedBu} className="flex h-full min-h-0 flex-col gap-4 animate-page-in">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-900">
          <Building2 className="h-5 w-5 text-teal-600" />
          {selectedBu}
        </h1>
        <p className="mt-0.5 text-xs text-slate-500">Detailed application transactions for this business unit.</p>
      </div>

      {buStat && (
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <KpiCard icon={Activity} tone="teal" label="Total Usage" value={formatNumber(buStat.totalUsage)} sub={`${formatNumber(buStat.transactions)} transactions`} />
          <KpiCard icon={CheckCircle2} tone="emerald" label="Success" value={formatNumber(buStat.successCount)} sub={`${successRate.toFixed(1)}% success rate`} />
          <KpiCard icon={XCircle} tone="rose" label="Error" value={formatNumber(buStat.errorCount)} sub={`${errorRate.toFixed(1)}% error rate`} />
          <KpiCard icon={ServerCog} tone="sky" label="Servers" value={formatNumber(buStat.serverCount)} sub="distinct servers" />
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <TextInput
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search client IP, function, database…"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1 rounded-xl bg-slate-100/80 p-1 ring-1 ring-slate-200/70">
          {(['all', 'Success', 'Error'] as const).map((value) => (
            <button
              key={value}
              onClick={() => {
                setStatus(value);
                setPage(1);
              }}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                status === value ? 'bg-white text-slate-900 ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {value === 'all' ? 'All' : value}
            </button>
          ))}
        </div>
        <span className="text-xs text-slate-400 sm:ml-auto">{formatNumber(total)} transactions</span>
      </div>

      <div className="flex flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200/70">
        {detail.loading && !detail.data ? (
          <CenterMessage>Loading transactions…</CenterMessage>
        ) : detail.error && !detail.data ? (
          <CenterMessage tone="error">Could not load — {detail.error}</CenterMessage>
        ) : (
          <DataTable
            rows={rows}
            columns={detailColumns}
            server={{
              total,
              page,
              pageSize,
              sortKey: sort.key,
              sortDirection: sort.direction,
              onPageChange: setPage,
              onPageSizeChange: (s) => {
                setPageSize(s);
                setPage(1);
              },
              onSortChange: (key) => {
                setSort((prev) => (prev.key === key ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' } : { key, direction: 'asc' }));
                setPage(1);
              },
            }}
            empty={<EmptyState icon={<ServerCog className="h-6 w-6" />} title="No transactions" description="No application logs match this business unit and search." />}
          />
        )}
      </div>
    </div>
  );
}

const kpiTiles: Record<string, string> = {
  teal: 'from-teal-500 to-emerald-500',
  emerald: 'from-emerald-500 to-green-500',
  rose: 'from-rose-500 to-pink-500',
  sky: 'from-sky-500 to-blue-500',
};

function KpiCard({ icon: Icon, tone, label, value, sub }: {
  icon: LucideIcon; tone: keyof typeof kpiTiles; label: string; value: string; sub: string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl bg-white p-4 ring-1 ring-slate-200/70">
      <div className="flex items-center justify-between">
        <span className={`inline-flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br text-white ${kpiTiles[tone]}`}>
          <Icon className="h-4.5 w-4.5" />
        </span>
        <span className="text-2xl font-semibold tabular-nums tracking-tight text-slate-900">{value}</span>
      </div>
      <div>
        <p className="text-xs font-semibold text-slate-700">{label}</p>
        <p className="text-[11px] text-slate-400">{sub}</p>
      </div>
    </div>
  );
}
