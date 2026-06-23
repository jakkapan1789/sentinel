/**
 * Typed client for the Sentinel Whitelist Center .NET 8 API.
 * Configure via env: VITE_API_BASE_URL and VITE_API_TOKEN (a "read,admin" bearer token).
 * When not configured, the app falls back to local seed data (see src/lib/dataSource.ts).
 */
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

export type IpMatchQuery = {
  minUsage?: number;
  bu?: string;
  country?: string;
  whitelisted?: string;
  search?: string;
  sort?: string;
  page?: number;
  pageSize?: number;
};

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
const TOKEN = import.meta.env.VITE_API_TOKEN ?? '';

export const apiConfigured = Boolean(BASE_URL && TOKEN);
export const apiBaseUrl = BASE_URL;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`API ${response.status} ${response.statusText} on ${path}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

const qs = (params: Record<string, string | number | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const str = search.toString();
  return str ? `?${str}` : '';
};

export const api = {
  dashboard: () => request<DashboardData>('/api/v1/dashboard'),

  refreshSummary: () => request<void>('/api/v1/summary/refresh', { method: 'POST' }),

  buSummary: () => request<BuSummary[]>('/api/v1/app-logs/bu-summary'),

  appLogFacets: (bu: string) => request<AppLogFacets>(`/api/v1/app-logs/facets${qs({ bu })}`),

  appLogs: (params: {
    bu?: string;
    search?: string;
    responseStatus?: string;
    app?: string;
    clientIp?: string;
    functionName?: string;
    databaseName?: string;
    sort?: string;
    page?: number;
    pageSize?: number;
  }) => request<PagedResult<ApplicationLog>>(`/api/v1/app-logs${qs(params)}`),

  networkLogs: (params: { search?: string; page?: number; pageSize?: number }) =>
    request<PagedResult<NetworkLog>>(`/api/v1/network-logs${qs(params)}`),

  whitelist: (params: { status?: string; search?: string } = {}) =>
    request<WhitelistEntry[]>(`/api/v1/whitelist${qs(params)}`),

  createWhitelist: (body: WhitelistInput) =>
    request<WhitelistEntry>('/api/v1/whitelist', { method: 'POST', body: JSON.stringify(body) }),

  updateWhitelist: (id: number, body: WhitelistInput) =>
    request<WhitelistEntry>(`/api/v1/whitelist/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  deleteWhitelist: (id: number) =>
    request<void>(`/api/v1/whitelist/${id}`, { method: 'DELETE' }),

  bulkAddWhitelist: (body: WhitelistInput[]) =>
    request<{ created: number; skipped: number }>('/api/v1/whitelist/bulk', { method: 'POST', body: JSON.stringify(body) }),

  ipMatches: (params: IpMatchQuery) => request<PagedResult<IpMatch>>(`/api/v1/ip-matches${qs(params)}`),

  ipMatchStats: (params: Omit<IpMatchQuery, 'sort' | 'page' | 'pageSize'>) =>
    request<IpMatchStats>(`/api/v1/ip-matches/stats${qs(params)}`),

  ipMatchFacets: () => request<IpMatchFacets>('/api/v1/ip-matches/facets'),

  ingestionSources: () => request<IngestionSource[]>('/api/v1/ingestion/sources'),

  ingestionDeliveries: (take = 20) => request<IngestionDelivery[]>(`/api/v1/ingestion/deliveries?take=${take}`),

  createIngestionSource: (body: IngestionSourceCreate) =>
    request<IngestionSecret>('/api/v1/ingestion/sources', { method: 'POST', body: JSON.stringify(body) }),

  rotateIngestionSource: (id: number) =>
    request<IngestionSecret>(`/api/v1/ingestion/sources/${id}/rotate`, { method: 'POST' }),

  patchIngestionSource: (id: number, body: IngestionSourcePatch) =>
    request<IngestionSource>(`/api/v1/ingestion/sources/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  deleteIngestionSource: (id: number) =>
    request<void>(`/api/v1/ingestion/sources/${id}`, { method: 'DELETE' }),
};
