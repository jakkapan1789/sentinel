import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  Network,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useMemo } from 'react';
import { Badge, CenterMessage } from '../components/ui';
import { dataSource } from '../lib/dataSource';
import { formatNumber, formatRelative } from '../lib/format';
import { getIpPrefix } from '../lib/ip';
import { useRefreshVersion } from '../lib/refresh';
import { useAsync } from '../lib/useAsync';
import type { ViewKey } from '../types';

export function Dashboard({ onNavigate }: { onNavigate: (key: ViewKey) => void }) {
  const version = useRefreshVersion();
  const { data, loading, error } = useAsync(
    async () => {
      const [dashboard, buSummary, whitelist, networkLogs] = await Promise.all([
        dataSource.dashboard(),
        dataSource.buSummary(),
        dataSource.whitelist(),
        dataSource.networkLogs(),
      ]);
      return { dashboard, buSummary, whitelist, networkLogs };
    },
    [version],
  );

  const view = useMemo(() => {
    if (!data) return null;
    const { dashboard, buSummary, whitelist, networkLogs } = data;

    const allowed = new Set(
      whitelist.filter((e) => e.status === 'active').map((e) => getIpPrefix(e.ipCidr)).filter(Boolean),
    );
    const unmatched = networkLogs.filter((l) => !allowed.has(getIpPrefix(l.sourceAddress)));

    const maxUsage = buSummary[0]?.totalUsage ?? 1;
    const topBus = buSummary.slice(0, 6).map((b) => ({
      ...b,
      pct: Math.round((b.totalUsage / maxUsage) * 100),
      rate: b.transactions ? (b.successCount / b.transactions) * 100 : 0,
    }));

    const recent = [...whitelist].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5);
    const coverage =
      dashboard.whitelistTotal === 0 ? 0 : Math.round((dashboard.whitelistActive / dashboard.whitelistTotal) * 100);

    return { dashboard, unmatched, topBus, recent, coverage };
  }, [data]);

  if (loading && !data) return <CenterMessage>Loading dashboard…</CenterMessage>;
  if (error && !data) return <CenterMessage tone="error">Could not load dashboard — {error}</CenterMessage>;
  if (!view) return null;

  const { dashboard, unmatched, topBus, recent, coverage } = view;

  return (
    <div className="flex flex-col gap-6 page-enter">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-teal-50 via-white to-white p-6 ring-1 ring-slate-200/70 sm:p-7">
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 px-2.5 py-1 text-[11px] font-semibold text-teal-700 ring-1 ring-teal-200/70">
              <ShieldCheck className="h-3 w-3" /> Security posture
            </span>
            <h1 className="mt-3 text-2xl font-semibold tracking-tight text-slate-900 sm:text-3xl">
              Welcome back, Security Admin
            </h1>
            <p className="mt-1.5 max-w-lg text-sm text-slate-500">
              {dashboard.unmatchedSources === 0
                ? 'All network sources currently map to an active whitelist range.'
                : `${dashboard.unmatchedSources} network source${dashboard.unmatchedSources > 1 ? 's are' : ' is'} not covered by an active whitelist range.`}
            </p>
          </div>
          <div className="flex items-center gap-5 rounded-xl bg-white px-5 py-3 ring-1 ring-slate-200/70">
            <div>
              <p className="text-3xl font-semibold tabular-nums text-slate-900">{coverage}%</p>
              <p className="text-[11px] text-slate-400">Active coverage</p>
            </div>
            <div className="h-10 w-px bg-slate-200" />
            <div>
              <p className="text-3xl font-semibold tabular-nums text-slate-900">{dashboard.whitelistTotal}</p>
              <p className="text-[11px] text-slate-400">Entries</p>
            </div>
          </div>
        </div>
      </section>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard icon={ShieldCheck} tone="teal" label="Active Whitelist" value={formatNumber(dashboard.whitelistActive)}
          hint={`${dashboard.whitelistPending} pending · ${dashboard.whitelistDisabled} disabled`} />
        <StatCard icon={Activity} tone="sky" label="Application Usage" value={formatNumber(dashboard.appTotalUsage)}
          hint={`${formatNumber(dashboard.appTransactions)} transactions`} />
        <StatCard icon={CheckCircle2} tone="emerald" label="Success Rate" value={`${dashboard.successRate.toFixed(1)}%`}
          hint={`${formatNumber(dashboard.appError)} errors`} />
        <StatCard icon={AlertTriangle} tone="rose" label="Unmatched Sources" value={formatNumber(dashboard.unmatchedSources)}
          hint="network not whitelisted" />
      </div>

      {/* Top BUs + Application health */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="flex flex-col rounded-2xl bg-white ring-1 ring-slate-200/70 lg:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-teal-50 text-teal-600 ring-1 ring-teal-100">
                <Building2 className="h-4 w-4" />
              </span>
              <h2 className="text-sm font-semibold tracking-tight text-slate-800">Top Business Units by Usage</h2>
            </div>
            <button onClick={() => onNavigate('application-logs')}
              className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:underline">
              View all <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex flex-col gap-3 px-5 py-4">
            {topBus.map((item) => (
              <div key={item.buName} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700">{item.buName}</span>
                  <span className="tabular-nums text-slate-500">
                    {formatNumber(item.totalUsage)}
                    <span className="ml-2 text-[11px] text-slate-400">{item.rate.toFixed(0)}% ok</span>
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-gradient-to-r from-teal-500 to-emerald-500" style={{ width: `${item.pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="flex flex-col rounded-2xl bg-white ring-1 ring-slate-200/70">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="text-sm font-semibold tracking-tight text-slate-800">Application Health</h2>
          </div>
          <div className="flex flex-1 flex-col justify-center gap-4 px-5 py-5">
            <div className="text-center">
              <p className="text-4xl font-semibold tabular-nums tracking-tight text-slate-900">{dashboard.successRate.toFixed(1)}%</p>
              <p className="text-xs text-slate-400">overall success rate</p>
            </div>
            <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="bg-emerald-500" style={{ width: `${dashboard.successRate}%` }} />
              <div className="bg-rose-500" style={{ width: `${100 - dashboard.successRate}%` }} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <HealthStat icon={CheckCircle2} tone="emerald" label="Success" value={formatNumber(dashboard.appSuccess)} />
              <HealthStat icon={XCircle} tone="rose" label="Error" value={formatNumber(dashboard.appError)} />
            </div>
          </div>
        </section>
      </div>

      {/* Unmatched sources + recent changes */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="flex flex-col rounded-2xl bg-white ring-1 ring-slate-200/70">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-amber-50 text-amber-500 ring-1 ring-amber-100">
                <AlertTriangle className="h-4 w-4" />
              </span>
              <h2 className="text-sm font-semibold tracking-tight text-slate-800">Unmatched Network Sources</h2>
            </div>
            <Badge tone={unmatched.length > 0 ? 'amber' : 'emerald'} dot>{unmatched.length} flagged</Badge>
          </div>
          <div className="divide-y divide-slate-100">
            {unmatched.length === 0 ? (
              <p className="px-5 py-10 text-center text-xs text-slate-500">Every network source maps to an active whitelist range. 🎉</p>
            ) : (
              unmatched.slice(0, 5).map((log) => (
                <div key={log.id} className="flex items-center justify-between gap-3 px-5 py-3 transition hover:bg-slate-50/70">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-500 ring-1 ring-rose-100">
                      <Network className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs font-semibold text-slate-800">{log.sourceAddress}</p>
                      <p className="truncate text-[11px] text-slate-500">{log.countryName} · {log.url}</p>
                    </div>
                  </div>
                  <Badge tone="rose">no range</Badge>
                </div>
              ))
            )}
          </div>
          <button onClick={() => onNavigate('network-logs')}
            className="mt-auto flex items-center justify-center gap-1.5 border-t border-slate-100 px-5 py-3 text-xs font-medium text-teal-700 transition hover:bg-teal-50/60">
            Review network logs <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </section>

        <section className="flex flex-col rounded-2xl bg-white ring-1 ring-slate-200/70">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="text-sm font-semibold tracking-tight text-slate-800">Recent Whitelist Changes</h2>
            <button onClick={() => onNavigate('whitelist')}
              className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:underline">
              View all <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="divide-y divide-slate-100">
            {recent.map((entry) => (
              <div key={entry.id} className="flex items-center gap-3 px-5 py-3 transition hover:bg-slate-50/70">
                <span className="font-mono text-xs font-semibold text-slate-800">{entry.ipCidr}</span>
                <span className="hidden truncate text-xs text-slate-500 sm:block">{entry.appName} · {entry.server}</span>
                <span className="ml-auto text-[11px] text-slate-400">{formatRelative(entry.updatedAt)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

const tones: Record<string, string> = {
  teal: 'from-teal-500 to-emerald-500',
  emerald: 'from-emerald-500 to-green-500',
  sky: 'from-sky-500 to-blue-500',
  rose: 'from-rose-500 to-pink-500',
};

function StatCard({ icon: Icon, tone, label, value, hint }: {
  icon: LucideIcon; tone: keyof typeof tones; label: string; value: string; hint: string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl bg-white p-4 ring-1 ring-slate-200/70 transition hover:-translate-y-0.5">
      <div className="flex items-center justify-between">
        <span className={`inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br text-white ${tones[tone]}`}>
          <Icon className="h-5 w-5" />
        </span>
        <span className="text-2xl font-semibold tabular-nums tracking-tight text-slate-900">{value}</span>
      </div>
      <div>
        <p className="text-xs font-semibold text-slate-700">{label}</p>
        <p className="text-[11px] text-slate-400">{hint}</p>
      </div>
    </div>
  );
}

function HealthStat({ icon: Icon, tone, label, value }: {
  icon: LucideIcon; tone: 'emerald' | 'rose'; label: string; value: string;
}) {
  const styles = tone === 'emerald' ? 'bg-emerald-50 text-emerald-600 ring-emerald-100' : 'bg-rose-50 text-rose-600 ring-rose-100';
  return (
    <div className="flex items-center gap-2.5 rounded-xl bg-white p-2.5 ring-1 ring-slate-200/70">
      <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ring-1 ${styles}`}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold tabular-nums text-slate-900">{value}</p>
        <p className="text-[11px] text-slate-400">{label}</p>
      </div>
    </div>
  );
}
