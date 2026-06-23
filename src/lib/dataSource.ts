/**
 * Single data access layer for the SPA.
 * - When the API is configured (VITE_API_BASE_URL + VITE_API_TOKEN) every call hits the .NET API.
 * - Otherwise it serves/ mutates the local seed in memory so the UI still runs offline.
 */
import { seedApplicationLogs, seedNetworkLogs, seedWhitelist } from '../data/seed';
import type {
  ApplicationLog,
  BuSummary,
  DashboardData,
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
import { api, apiConfigured } from './api';
import { getIpPrefix } from './ip';

const NO_BU = '(no BU)';

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
      return {
        buName,
        totalUsage: items.reduce((s, i) => s + i.usageCount, 0),
        transactions: items.length,
        successCount: items.filter((i) => i.responseStatus === 'Success').length,
        errorCount: items.filter((i) => i.responseStatus === 'Error').length,
        serverCount: servers.length,
        servers,
        lastSeen: items.reduce<string | null>((m, i) => (m && m > i.createdAt ? m : i.createdAt), null),
      };
    })
    .sort((a, b) => b.totalUsage - a.totalUsage);
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
    apiConfigured ? api.whitelist() : Promise.resolve(mockWhitelist.map((e) => ({ ...e }))),

  buSummary: (): Promise<BuSummary[]> =>
    apiConfigured ? api.buSummary() : Promise.resolve(computeBuSummary(mockAppLogs)),

  appLogsPage: async (params: {
    bu: string;
    search?: string;
    responseStatus?: string;
    sort?: string;
    page: number;
    pageSize: number;
  }): Promise<PagedResult<ApplicationLog>> => {
    if (apiConfigured) return api.appLogs(params);

    let rows = mockAppLogs.filter((l) => (l.buName || NO_BU) === params.bu);
    if (params.responseStatus) rows = rows.filter((l) => l.responseStatus === params.responseStatus);
    const term = (params.search ?? '').trim().toLowerCase();
    if (term) {
      rows = rows.filter((l) =>
        [l.clientIp, l.functionName, l.databaseName ?? ''].join(' ').toLowerCase().includes(term),
      );
    }
    const accessors: Record<string, (l: ApplicationLog) => string | number> = {
      clientIp: (l) => l.clientIp,
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

  networkLogs: async (): Promise<NetworkLog[]> =>
    apiConfigured ? (await api.networkLogs({ pageSize: 1000 })).items : mockNetworkLogs.map((l) => ({ ...l })),

  dashboard: (): Promise<DashboardData> =>
    apiConfigured ? api.dashboard() : Promise.resolve(computeDashboard()),

  // Run the incremental rollups on demand. No-op in mock mode (summary is computed live).
  refreshSummary: (): Promise<void> => (apiConfigured ? api.refreshSummary() : Promise.resolve()),

  createWhitelist: async (input: WhitelistInput): Promise<void> => {
    if (apiConfigured) {
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
    if (apiConfigured) {
      await api.updateWhitelist(id, input);
      return;
    }
    const now = new Date().toISOString();
    mockWhitelist = mockWhitelist.map((e) => (e.id === id ? { ...e, ...input, updatedBy: 'you', updatedAt: now } : e));
  },

  deleteWhitelist: async (id: number): Promise<void> => {
    if (apiConfigured) {
      await api.deleteWhitelist(id);
      return;
    }
    mockWhitelist = mockWhitelist.filter((e) => e.id !== id);
  },

  // ---- ingestion sources ----
  ingestionSources: (): Promise<IngestionSource[]> =>
    apiConfigured ? api.ingestionSources() : Promise.resolve(mockIngestionSources.map((w) => ({ ...w }))),

  ingestionDeliveries: (): Promise<IngestionDelivery[]> =>
    apiConfigured ? api.ingestionDeliveries() : Promise.resolve([]),

  createIngestionSource: async (input: IngestionSourceCreate): Promise<IngestionSecret> => {
    if (apiConfigured) return api.createIngestionSource(input);
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
    if (apiConfigured) return api.rotateIngestionSource(id);
    const token = mockToken();
    mockIngestionSources = mockIngestionSources.map((w) => (w.id === id ? { ...w, tokenPrefix: token.slice(-4), token } : w));
    return { source: mockIngestionSources.find((w) => w.id === id)!, token };
  },

  patchIngestionSource: async (id: number, patch: IngestionSourcePatch): Promise<void> => {
    if (apiConfigured) {
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
    if (apiConfigured) {
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
