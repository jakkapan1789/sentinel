import { Activity, ArrowRight, Building2, CheckCircle2, Database, Layers, Search, ServerCog, X, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Column, DataTable } from '../components/DataTable';
import { Badge, CenterMessage, EmptyState, KpiCard, TextInput } from '../components/ui';
import { dataSource } from '../lib/dataSource';
import { formatDateTime, formatNumber, formatRelative } from '../lib/format';
import { useRefreshVersion } from '../lib/refresh';
import { useAsync } from '../lib/useAsync';
import type { ApplicationLog, AppLogFacets, BuSummary, PagedResult, ResponseStatus } from '../types';

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

  // Detail (server-side) paging state. Column filters are multi-select.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  // Per-column value-list filters, keyed by column key (multi-select, like the BU & Network tables).
  const [colFilters, setColFilters] = useState<Record<string, string[]>>({});
  const [sort, setSort] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'createdAt', direction: 'desc' });

  // Reset detail controls whenever we switch BU (or back to summary).
  useEffect(() => {
    setSearch('');
    setPage(1);
    setColFilters({});
    setSort({ key: 'createdAt', direction: 'desc' });
  }, [selectedBu]);

  const summary = useAsync(() => dataSource.buSummary(), [version]);

  // Distinct values per column for the open BU → option lists for the value-checklist filters.
  const facets = useAsync(
    () =>
      selectedBu
        ? dataSource.appLogFacets(selectedBu)
        : Promise.resolve<AppLogFacets>({ clientIp: [], appName: [], functionName: [], databaseName: [] }),
    [selectedBu, version],
  );

  const csv = (key: string) => (colFilters[key]?.length ? colFilters[key].join(',') : undefined);

  const detail = useAsync(
    () =>
      selectedBu
        ? dataSource.appLogsPage({
            bu: selectedBu,
            search: search.trim() || undefined,
            responseStatus: csv('responseStatus'),
            app: csv('appName'),
            clientIp: csv('clientIp'),
            functionName: csv('functionName'),
            databaseName: csv('databaseName'),
            sort: `${sort.key}:${sort.direction}`,
            page,
            pageSize,
          })
        : Promise.resolve<PagedResult<ApplicationLog>>({ items: [], total: 0, page: 1, pageSize }),
    [selectedBu, search, colFilters, sort.key, sort.direction, page, pageSize, version],
  );

  const summaryRows = useMemo<SummaryRow[]>(() => {
    const term = search.trim().toLowerCase();
    const rows = (summary.data ?? []).map((s) => ({ ...s, id: s.buName }));
    return term ? rows.filter((r) => r.buName.toLowerCase().includes(term)) : rows;
  }, [summary.data, search]);

  const summaryStats = useMemo(() => {
    const rows = summary.data ?? [];
    const txns = rows.reduce((s, r) => s + r.transactions, 0);
    const success = rows.reduce((s, r) => s + r.successCount, 0);
    return {
      usage: rows.reduce((s, r) => s + r.totalUsage, 0),
      txns,
      rate: txns ? (success / txns) * 100 : 0,
      bus: rows.length,
    };
  }, [summary.data]);

  const buStat = (summary.data ?? []).find((s) => s.buName === selectedBu);
  const activeFilters = Object.values(colFilters).reduce((n, v) => n + v.length, 0);
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
      filterable: true,
      sortValue: (row) => row.clientIp,
      render: (row) => <span className="font-mono text-xs font-semibold text-slate-900">{row.clientIp}</span>,
    },
    {
      key: 'appName',
      header: 'Application',
      filterable: true,
      sortValue: (row) => row.appName ?? '',
      render: (row) => <span className="font-medium text-slate-700">{row.appName || '—'}</span>,
    },
    {
      key: 'functionName',
      header: 'Function',
      filterable: true,
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
      filterable: true,
      sortValue: (row) => row.responseStatus,
      render: (row) => <Badge tone={statusTone(row.responseStatus)} dot>{row.responseStatus}</Badge>,
    },
    {
      key: 'databaseName',
      header: 'Database',
      hideBelow: 'md',
      filterable: true,
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
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <KpiCard icon={Activity} tone="teal" label="Total Usage" value={formatNumber(summaryStats.usage)} sub="across all BUs" />
          <KpiCard icon={Layers} tone="sky" label="Transactions" value={formatNumber(summaryStats.txns)} sub="total requests" />
          <KpiCard icon={CheckCircle2} tone="emerald" label="Success Rate" value={`${summaryStats.rate.toFixed(1)}%`} sub="all business units" />
          <KpiCard icon={Building2} tone="violet" label="Business Units" value={formatNumber(summaryStats.bus)} sub="active units" />
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
        {activeFilters > 0 && (
          <button
            onClick={() => {
              setColFilters({});
              setPage(1);
            }}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-teal-50 px-3 py-1.5 text-xs font-medium text-teal-700 ring-1 ring-teal-100 transition hover:bg-teal-100"
          >
            <X className="h-3.5 w-3.5" />
            Clear {activeFilters} filter{activeFilters > 1 ? 's' : ''}
          </button>
        )}
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
              filters: {
                options: {
                  clientIp: facets.data?.clientIp ?? [],
                  appName: facets.data?.appName ?? [],
                  functionName: facets.data?.functionName ?? [],
                  responseStatus: ['Success', 'Error'],
                  databaseName: facets.data?.databaseName ?? [],
                },
                selected: colFilters,
                onChange: (key, values) => {
                  setColFilters((prev) => ({ ...prev, [key]: values }));
                  setPage(1);
                },
              },
            }}
            empty={<EmptyState icon={<ServerCog className="h-6 w-6" />} title="No transactions" description="No application logs match this business unit and search." />}
          />
        )}
      </div>
    </div>
  );
}

