/**
 * Single data access layer for the SPA.
 * - Production build: always calls the .NET API — never serves seed data.
 * - Dev (npm run dev): calls the API when configured (VITE_API_BASE_URL + VITE_API_TOKEN);
 *   otherwise falls back to the local seed for offline demos.
 */
import { seedApplicationLogs, seedNetworkLogs, seedWhitelist } from '../data/seed';
import type {
  ApplicationLog,
  AppLogFacets,
  BuSummary,
  DashboardData,
  IpMatch,
  IpMatchFacets,
  IpMatchStats,
  NetworkLog,
  PagedResult,
  IngestionSourceCreate,
  IngestionDelivery,
  IngestionSourcePatch,
  IngestionSecret,
  IngestionSource,
  WhitelistEntry,
  WhitelistInput,
} from '../types';
import { api, apiConfigured, type IpMatchQuery } from './api';
import { getIpPrefix } from './ip';

const NO_BU = '(no BU)';

// Use the real API in production ALWAYS (never show seed data in a prod build).
// In dev, fall back to local seed only when no API is configured — for offline demos.
const useApi = apiConfigured || import.meta.env.PROD;

// --- in-memory mock store (only used when the API is not configured) ---
let mockWhitelist: WhitelistEntry[] = seedWhitelist.map((entry) => ({ ...entry }));
const mockAppLogs: ApplicationLog[] = seedApplicationLogs;
const mockNetworkLogs: NetworkLog[] = seedNetworkLogs;
let nextWhitelistId = mockWhitelist.reduce((max, e) => Math.max(max, e.id), 0) + 1;

function computeBuSummary(logs: ApplicationLog[]): BuSummary[] {
  const groups = new Map<string, ApplicationLog[]>();
  for (const log of logs) {
    const key = log.buName || NO_BU;
    const list = groups.get(key);
    if (list) list.push(log);
    else groups.set(key, [log]);
  }
  return Array.from(groups.entries())
    .map(([buName, items]) => {
      const servers = Array.from(new Set(items.map((i) => i.serverName).filter(Boolean) as string[])).sort();
      const apps = Array.from(new Set(items.map((i) => i.appName).filter(Boolean) as string[])).sort();
      return {
        buName,
        totalUsage: items.reduce((s, i) => s + i.usageCount, 0),
        transactions: items.length,
        successCount: items.filter((i) => i.responseStatus === 'Success').length,
        errorCount: items.filter((i) => i.responseStatus === 'Error').length,
        serverCount: servers.length,
        servers,
        apps,
        lastSeen: items.reduce<string | null>((m, i) => (m && m > i.createdAt ? m : i.createdAt), null),
      };
    })
    .sort((a, b) => b.totalUsage - a.totalUsage);
}

const uniq = (values: string[]) => Array.from(new Set(values.filter(Boolean)));

// Reconcile mock app client IPs against network source IPs (exact match) for offline dev.
function computeIpMatches(): IpMatch[] {
  // Approximate whitelist coverage by /16 prefix (dev only); prefer active over pending.
  const coverFor = (ip: string): { status: 'active' | 'pending' | null; cidr: string | null } => {
    const pfx = getIpPrefix(ip);
    const active = mockWhitelist.find((w) => w.status === 'active' && getIpPrefix(w.ipCidr) === pfx);
    if (active) return { status: 'active', cidr: active.ipCidr };
    const pending = mockWhitelist.find((w) => w.status === 'pending' && getIpPrefix(w.ipCidr) === pfx);
    if (pending) return { status: 'pending', cidr: pending.ipCidr };
    return { status: null, cidr: null };
  };

  type AppAgg = { usage: number; req: number; last: string; dims: Map<string, { bu: string; app: string; srv: string; usage: number }> };
  const appAgg = new Map<string, AppAgg>();
  for (const l of mockAppLogs) {
    const e = appAgg.get(l.clientIp) ?? { usage: 0, req: 0, last: '', dims: new Map() };
    e.usage += l.usageCount;
    e.req += 1;
    if (l.createdAt > e.last) e.last = l.createdAt;
    const key = `${l.buName}|${l.serverName ?? ''}|${l.appName ?? ''}`;
    const d = e.dims.get(key) ?? { bu: l.buName, app: l.appName ?? '', srv: l.serverName ?? '', usage: 0 };
    d.usage += l.usageCount;
    e.dims.set(key, d);
    appAgg.set(l.clientIp, e);
  }

  type NetAgg = { usage: number; req: number; last: string; countries: Map<string, number> };
  const netAgg = new Map<string, NetAgg>();
  for (const n of mockNetworkLogs) {
    const e = netAgg.get(n.sourceAddress) ?? { usage: 0, req: 0, last: '', countries: new Map() };
    e.usage += n.usageCount;
    e.req += 1;
    if (n.createdAt > e.last) e.last = n.createdAt;
    if (n.countryName) e.countries.set(n.countryName, (e.countries.get(n.countryName) ?? 0) + n.usageCount);
    netAgg.set(n.sourceAddress, e);
  }

  const matches: IpMatch[] = [];
  for (const [ip, a] of appAgg) {
    const n = netAgg.get(ip);
    if (!n) continue;
    const dims = Array.from(a.dims.values()).sort((x, y) => y.usage - x.usage);
    const buNames = uniq(dims.map((d) => d.bu));
    const appNames = uniq(dims.map((d) => d.app));
    const servers = uniq(dims.map((d) => d.srv));
    const country = Array.from(n.countries.entries()).sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
    const cover = coverFor(ip);
    matches.push({
      ip,
      appUsage: a.usage,
      appRequests: a.req,
      networkUsage: n.usage,
      networkRequests: n.req,
      totalUsage: a.usage + n.usage,
      buNames,
      appNames,
      servers,
      buName: buNames[0] ?? null,
      appName: appNames[0] ?? null,
      server: servers[0] ?? null,
      country,
      isWhitelisted: cover.status === 'active',
      whitelistStatus: cover.status,
      whitelistCidr: cover.cidr,
      lastSeen: a.last > n.last ? a.last : n.last,
    });
  }
  return matches;
}

function filterIpMatches(rows: IpMatch[], params: IpMatchQuery): IpMatch[] {
  let out = rows;
  if (params.minUsage) out = out.filter((m) => m.totalUsage >= params.minUsage!);
  if (params.whitelisted === 'covered') out = out.filter((m) => m.whitelistStatus != null);
  else if (params.whitelisted === 'uncovered') out = out.filter((m) => m.whitelistStatus == null);
  const bus = params.bu ? params.bu.split(',') : null;
  if (bus) out = out.filter((m) => m.buNames.some((b) => bus.includes(b)));
  const countries = params.country ? params.country.split(',') : null;
  if (countries) out = out.filter((m) => m.country != null && countries.includes(m.country));
  const term = (params.search ?? '').trim().toLowerCase();
  if (term) out = out.filter((m) => m.ip.toLowerCase().includes(term));
  return out;
}

function computeDashboard(): DashboardData {
  const active = mockWhitelist.filter((e) => e.status === 'active').length;
  const pending = mockWhitelist.filter((e) => e.status === 'pending').length;
  const disabled = mockWhitelist.filter((e) => e.status === 'disabled').length;
  const allowed = new Set(
    mockWhitelist.filter((e) => e.status === 'active').map((e) => getIpPrefix(e.ipCidr)).filter(Boolean),
  );
  const transactions = mockAppLogs.length;
  const success = mockAppLogs.filter((l) => l.responseStatus === 'Success').length;
  return {
    whitelistTotal: mockWhitelist.length,
    whitelistActive: active,
    whitelistPending: pending,
    whitelistDisabled: disabled,
    appTotalUsage: mockAppLogs.reduce((s, l) => s + l.usageCount, 0),
    appTransactions: transactions,
    appSuccess: success,
    appError: transactions - success,
    successRate: transactions ? Math.round((success / transactions) * 1000) / 10 : 0,
    unmatchedSources: mockNetworkLogs.filter((l) => !allowed.has(getIpPrefix(l.sourceAddress))).length,
  };
}

export const dataSource = {
  whitelist: (): Promise<WhitelistEntry[]> =>
    useApi ? api.whitelist() : Promise.resolve(mockWhitelist.map((e) => ({ ...e }))),

  buSummary: (): Promise<BuSummary[]> =>
    useApi ? api.buSummary() : Promise.resolve(computeBuSummary(mockAppLogs)),

  appLogFacets: (bu: string): Promise<AppLogFacets> => {
    if (useApi) return api.appLogFacets(bu);
    const rows = mockAppLogs.filter((l) => (l.buName || NO_BU) === bu);
    const distinct = (values: (string | null)[]) =>
      Array.from(new Set(values.filter((v): v is string => !!v))).sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true }),
      );
    return Promise.resolve({
      clientIp: distinct(rows.map((l) => l.clientIp)),
      appName: distinct(rows.map((l) => l.appName)),
      functionName: distinct(rows.map((l) => l.functionName)),
      databaseName: distinct(rows.map((l) => l.databaseName)),
    });
  },

  appLogsPage: async (params: {
    bu: string;
    search?: string;
    responseStatus?: string;
    app?: string;
    clientIp?: string;
    functionName?: string;
    databaseName?: string;
    sort?: string;
    page: number;
    pageSize: number;
  }): Promise<PagedResult<ApplicationLog>> => {
    if (useApi) return api.appLogs(params);

    let rows = mockAppLogs.filter((l) => (l.buName || NO_BU) === params.bu);
    // responseStatus / app may be comma-separated multi-selects (column filters).
    const statuses = params.responseStatus ? params.responseStatus.split(',') : null;
    if (statuses) rows = rows.filter((l) => statuses.includes(l.responseStatus));
    const apps = params.app ? params.app.split(',') : null;
    if (apps) rows = rows.filter((l) => l.appName != null && apps.includes(l.appName));
    // Per-column value-list filters (exact match, comma-separated multi-select).
    const inList = (value: string | null, csv?: string) =>
      !csv || (value != null && csv.split(',').includes(value));
    rows = rows.filter(
      (l) =>
        inList(l.clientIp, params.clientIp) &&
        inList(l.functionName, params.functionName) &&
        inList(l.databaseName, params.databaseName),
    );
    const term = (params.search ?? '').trim().toLowerCase();
    if (term) {
      rows = rows.filter((l) =>
        [l.clientIp, l.appName ?? '', l.functionName, l.databaseName ?? ''].join(' ').toLowerCase().includes(term),
      );
    }
    const accessors: Record<string, (l: ApplicationLog) => string | number> = {
      clientIp: (l) => l.clientIp,
      appName: (l) => l.appName ?? '',
      functionName: (l) => l.functionName,
      responseStatus: (l) => l.responseStatus,
      databaseName: (l) => l.databaseName ?? '',
      usageCount: (l) => l.usageCount,
      createdAt: (l) => l.createdAt,
    };
    const [sortKey, sortDir] = (params.sort ?? 'createdAt:desc').split(':');
    const acc = accessors[sortKey] ?? accessors.createdAt;
    rows = [...rows].sort((a, b) => {
      const x = acc(a);
      const y = acc(b);
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
      return sortDir === 'asc' ? c : -c;
    });
    const total = rows.length;
    const start = (params.page - 1) * params.pageSize;
    return { items: rows.slice(start, start + params.pageSize), total, page: params.page, pageSize: params.pageSize };
  },

  // ---- IP match reconciliation ----
  ipMatches: (params: IpMatchQuery): Promise<PagedResult<IpMatch>> => {
    if (useApi) return api.ipMatches(params);
    const all = filterIpMatches(computeIpMatches(), params);
    const [sortKey, dir] = (params.sort ?? 'totalUsage:desc').split(':');
    const accessor: Record<string, (m: IpMatch) => string | number> = {
      ip: (m) => m.ip,
      totalUsage: (m) => m.totalUsage,
      appUsage: (m) => m.appUsage,
      networkUsage: (m) => m.networkUsage,
      lastSeen: (m) => m.lastSeen,
      whitelisted: (m) => (m.isWhitelisted ? 1 : 0),
    };
    const acc = accessor[sortKey] ?? accessor.totalUsage;
    const sorted = [...all].sort((a, b) => {
      const x = acc(a);
      const y = acc(b);
      const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true });
      return dir === 'asc' ? c : -c;
    });
    const page = params.page ?? 1;
    const pageSize = params.pageSize ?? 10;
    const start = (page - 1) * pageSize;
    return Promise.resolve({ items: sorted.slice(start, start + pageSize), total: sorted.length, page, pageSize });
  },

  ipMatchStats: (params: Omit<IpMatchQuery, 'sort' | 'page' | 'pageSize'>): Promise<IpMatchStats> => {
    if (useApi) return api.ipMatchStats(params);
    const ctx = filterIpMatches(computeIpMatches(), { ...params, minUsage: undefined });
    return Promise.resolve({
      matched: ctx.length,
      aboveThreshold: params.minUsage ? ctx.filter((m) => m.totalUsage >= params.minUsage!).length : ctx.length,
      notWhitelisted: ctx.filter((m) => m.whitelistStatus == null).length,
      combinedUsage: ctx.reduce((s, m) => s + m.totalUsage, 0),
    });
  },

  ipMatchFacets: (): Promise<IpMatchFacets> => {
    if (useApi) return api.ipMatchFacets();
    const matches = computeIpMatches();
    return Promise.resolve({
      bu: uniq(matches.flatMap((m) => m.buNames)).sort(),
      country: uniq(matches.map((m) => m.country ?? '')).sort(),
    });
  },

  bulkAddWhitelist: async (entries: WhitelistInput[]): Promise<{ created: number; skipped: number }> => {
    if (useApi) return api.bulkAddWhitelist(entries);
    const now = new Date().toISOString();
    let created = 0;
    let skipped = 0;
    for (const input of entries) {
      const dup = mockWhitelist.some(
        (e) => e.ipCidr === input.ipCidr && e.appName === input.appName && e.server === input.server && e.env === input.env,
      );
      if (dup) {
        skipped += 1;
        continue;
      }
      mockWhitelist = [
        { id: nextWhitelistId++, ...input, createdBy: 'you', updatedBy: 'you', createdAt: now, updatedAt: now },
        ...mockWhitelist,
      ];
      created += 1;
    }
    return { created, skipped };
  },

  networkLogs: async (): Promise<NetworkLog[]> =>
    useApi ? (await api.networkLogs({ pageSize: 1000 })).items : mockNetworkLogs.map((l) => ({ ...l })),

  dashboard: (): Promise<DashboardData> =>
    useApi ? api.dashboard() : Promise.resolve(computeDashboard()),

  // Run the incremental rollups on demand. No-op in mock mode (summary is computed live).
  refreshSummary: (): Promise<void> => (useApi ? api.refreshSummary() : Promise.resolve()),

  createWhitelist: async (input: WhitelistInput): Promise<void> => {
    if (useApi) {
      await api.createWhitelist(input);
      return;
    }
    const now = new Date().toISOString();
    mockWhitelist = [
      { id: nextWhitelistId++, ...input, createdBy: 'you', updatedBy: 'you', createdAt: now, updatedAt: now },
      ...mockWhitelist,
    ];
  },

  updateWhitelist: async (id: number, input: WhitelistInput): Promise<void> => {
    if (useApi) {
      await api.updateWhitelist(id, input);
      return;
    }
    const now = new Date().toISOString();
    mockWhitelist = mockWhitelist.map((e) => (e.id === id ? { ...e, ...input, updatedBy: 'you', updatedAt: now } : e));
  },

  deleteWhitelist: async (id: number): Promise<void> => {
    if (useApi) {
      await api.deleteWhitelist(id);
      return;
    }
    mockWhitelist = mockWhitelist.filter((e) => e.id !== id);
  },

  // ---- ingestion sources ----
  ingestionSources: (): Promise<IngestionSource[]> =>
    useApi ? api.ingestionSources() : Promise.resolve(mockIngestionSources.map((w) => ({ ...w }))),

  ingestionDeliveries: (): Promise<IngestionDelivery[]> =>
    useApi ? api.ingestionDeliveries() : Promise.resolve([]),

  createIngestionSource: async (input: IngestionSourceCreate): Promise<IngestionSecret> => {
    if (useApi) return api.createIngestionSource(input);
    const token = mockToken();
    const source: IngestionSource = {
      id: nextIngestionId++,
      name: input.name,
      tokenPrefix: token.slice(-4),
      token,
      scope: 'ingestion',
      enabled: true,
      allowedCidr: input.allowedCidr,
      lastUsedAt: null,
      totalReceived: 0,
      totalInserted: 0,
      createdBy: 'you',
      createdAt: new Date().toISOString(),
    };
    mockIngestionSources = [source, ...mockIngestionSources];
    return { source, token };
  },

  rotateIngestionSource: async (id: number): Promise<IngestionSecret> => {
    if (useApi) return api.rotateIngestionSource(id);
    const token = mockToken();
    mockIngestionSources = mockIngestionSources.map((w) => (w.id === id ? { ...w, tokenPrefix: token.slice(-4), token } : w));
    return { source: mockIngestionSources.find((w) => w.id === id)!, token };
  },

  patchIngestionSource: async (id: number, patch: IngestionSourcePatch): Promise<void> => {
    if (useApi) {
      await api.patchIngestionSource(id, patch);
      return;
    }
    mockIngestionSources = mockIngestionSources.map((w) =>
      w.id === id
        ? {
            ...w,
            enabled: patch.enabled ?? w.enabled,
            allowedCidr: patch.allowedCidr !== undefined ? patch.allowedCidr : w.allowedCidr,
          }
        : w,
    );
  },

  deleteIngestionSource: async (id: number): Promise<void> => {
    if (useApi) {
      await api.deleteIngestionSource(id);
      return;
    }
    mockIngestionSources = mockIngestionSources.filter((w) => w.id !== id);
  },
};

let mockIngestionSources: IngestionSource[] = [];
let nextIngestionId = 1;
function mockToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return 'swc_etl_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export { apiConfigured };
