import { Activity, Globe, Network, Search, ShieldCheck, ShieldX } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Column, DataTable } from '../components/DataTable';
import { Badge, CenterMessage, EmptyState, KpiCard, TextInput } from '../components/ui';
import { dataSource } from '../lib/dataSource';
import { formatNumber, formatRelative } from '../lib/format';
import { getIpPrefix } from '../lib/ip';
import { useRefreshVersion } from '../lib/refresh';
import { useAsync } from '../lib/useAsync';
import type { NetworkLog } from '../types';

export function NetworkLogsPage() {
  const [search, setSearch] = useState('');

  const version = useRefreshVersion();
  const { data, loading, error } = useAsync(async () => {
    const [logs, whitelist] = await Promise.all([dataSource.networkLogs(), dataSource.whitelist()]);
    return { logs, whitelist };
  }, [version]);

  const allowedPrefixes = useMemo(() => {
    const set = new Set<string>();
    for (const entry of data?.whitelist ?? []) {
      if (entry.status === 'active') {
        const prefix = getIpPrefix(entry.ipCidr);
        if (prefix) set.add(prefix);
      }
    }
    return set;
  }, [data]);

  const filtered = useMemo(() => {
    const logs = data?.logs ?? [];
    const term = search.trim().toLowerCase();
    if (!term) return logs;
    return logs.filter((l) => [l.sourceAddress, l.countryName ?? '', l.url].join(' ').toLowerCase().includes(term));
  }, [data, search]);

  const stats = useMemo(() => {
    const logs = data?.logs ?? [];
    const whitelisted = logs.filter((l) => allowedPrefixes.has(getIpPrefix(l.sourceAddress))).length;
    return {
      count: logs.length,
      usage: logs.reduce((s, l) => s + l.usageCount, 0),
      whitelisted,
      notWhitelisted: logs.length - whitelisted,
    };
  }, [data, allowedPrefixes]);

  const columns: Column<NetworkLog>[] = [
    {
      key: 'sourceAddress',
      header: 'Source IP',
      filterable: true,
      filterValue: (row) => row.sourceAddress,
      sortValue: (row) => row.sourceAddress,
      render: (row) => {
        const allowed = allowedPrefixes.has(getIpPrefix(row.sourceAddress));
        return (
          <div>
            <span className="font-mono text-xs font-semibold text-slate-900">{row.sourceAddress}</span>
            <span className="mt-0.5 block">
              <Badge tone={allowed ? 'emerald' : 'rose'} className="capitalize">
                {allowed ? 'whitelisted' : 'not whitelisted'}
              </Badge>
            </span>
          </div>
        );
      },
    },
    {
      key: 'countryName',
      header: 'Country',
      hideBelow: 'md',
      filterable: true,
      filterValue: (row) => row.countryName ?? '',
      sortValue: (row) => row.countryName ?? '',
      render: (row) => (
        <span className="inline-flex items-center gap-1.5 text-slate-600">
          <Globe className="h-3.5 w-3.5 text-slate-400" />
          {row.countryName || '—'}
        </span>
      ),
    },
    {
      key: 'url',
      header: 'URL',
      filterable: true,
      sortValue: (row) => row.url,
      render: (row) => <span className="font-mono text-[11px] text-slate-600">{row.url}</span>,
    },
    {
      key: 'periodMonth',
      header: 'Month',
      hideBelow: 'lg',
      filterable: true,
      filterValue: (row) => row.periodMonth.slice(0, 7),
      sortValue: (row) => row.periodMonth,
      render: (row) => <span className="text-slate-600">{row.periodMonth.slice(0, 7)}</span>,
    },
    {
      key: 'usageCount',
      header: 'Usage',
      align: 'right',
      hideBelow: 'sm',
      sortValue: (row) => row.usageCount,
      render: (row) => <span className="font-medium tabular-nums text-slate-700">{formatNumber(row.usageCount)}</span>,
    },
    {
      key: 'createdAt',
      header: 'Last Seen',
      align: 'right',
      hideBelow: 'xl',
      sortValue: (row) => row.createdAt,
      render: (row) => <span className="text-[11px] text-slate-500">{formatRelative(row.createdAt)}</span>,
    },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 animate-page-in">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">Network IP Logs</h1>
        <p className="mt-0.5 text-xs text-slate-500">Edge / source traffic, flagged against active whitelist ranges.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <KpiCard icon={Network} tone="sky" label="Total Logs" value={formatNumber(stats.count)} sub="source records" />
        <KpiCard icon={Activity} tone="teal" label="Total Usage" value={formatNumber(stats.usage)} sub="hits" />
        <KpiCard icon={ShieldCheck} tone="emerald" label="Whitelisted" value={formatNumber(stats.whitelisted)} sub="matched active range" />
        <KpiCard icon={ShieldX} tone="rose" label="Not Whitelisted" value={formatNumber(stats.notWhitelisted)} sub="no active range" />
      </div>

      <div className="flex items-center gap-2">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <TextInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search IP, country, URL…" className="pl-9" />
        </div>
        <span className="text-xs text-slate-400 sm:ml-auto">{filtered.length} logs</span>
      </div>

      <div className="flex flex-col overflow-hidden rounded-xl bg-white ring-1 ring-slate-200/70">
        {loading && !data ? (
          <CenterMessage>Loading network logs…</CenterMessage>
        ) : error && !data ? (
          <CenterMessage tone="error">Could not load — {error}</CenterMessage>
        ) : (
          <DataTable
            rows={filtered}
            columns={columns}
            empty={<EmptyState icon={<Network className="h-6 w-6" />} title="No network logs" description="No network traffic ingested yet." />}
          />
        )}
      </div>
    </div>
  );
}
