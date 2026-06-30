/**
 * Single data access layer for the SPA.
 * Always calls the real .NET API — there is no mock/seed fallback.
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
  WhitelistAck,
  WhitelistAckCreate,
  WhitelistEntry,
  WhitelistInput,
} from '../types';
import { api, apiConfigured, type IpMatchQuery } from './api';

export const dataSource = {
  whitelist: (): Promise<WhitelistEntry[]> => api.whitelist(),

  buSummary: (): Promise<BuSummary[]> => api.buSummary(),

  appLogFacets: (bu: string): Promise<AppLogFacets> => api.appLogFacets(bu),

  appLogsPage: (params: {
    bu: string;
    search?: string;
    responseStatus?: string;
    app?: string;
    clientIp?: string;
    functionName?: string;
    serverName?: string;
    databaseName?: string;
    sort?: string;
    page: number;
    pageSize: number;
  }): Promise<PagedResult<ApplicationLog>> => api.appLogs(params),

  // ---- IP match reconciliation ----
  ipMatches: (params: IpMatchQuery): Promise<PagedResult<IpMatch>> => api.ipMatches(params),

  ipMatchStats: (params: Omit<IpMatchQuery, 'sort' | 'page' | 'pageSize'>): Promise<IpMatchStats> =>
    api.ipMatchStats(params),

  ipMatchFacets: (): Promise<IpMatchFacets> => api.ipMatchFacets(),

  bulkAddWhitelist: (entries: WhitelistInput[]): Promise<{ created: number; skipped: number }> =>
    api.bulkAddWhitelist(entries),

  // ---- Whitelist acknowledgement (confirm) flow ----
  createWhitelistAck: (input: WhitelistAckCreate): Promise<WhitelistAck> => api.createWhitelistAck(input),

  whitelistAcks: (): Promise<WhitelistAck[]> => api.whitelistAcks(),

  networkLogs: async (): Promise<NetworkLog[]> => (await api.networkLogs({ pageSize: 1000 })).items,

  dashboard: (): Promise<DashboardData> => api.dashboard(),

  // Run the incremental rollups on demand.
  refreshSummary: (): Promise<void> => api.refreshSummary(),

  createWhitelist: async (input: WhitelistInput): Promise<void> => {
    await api.createWhitelist(input);
  },

  updateWhitelist: async (id: number, input: WhitelistInput): Promise<void> => {
    await api.updateWhitelist(id, input);
  },

  deleteWhitelist: async (id: number): Promise<void> => {
    await api.deleteWhitelist(id);
  },

  // ---- ingestion sources ----
  ingestionSources: (): Promise<IngestionSource[]> => api.ingestionSources(),

  ingestionDeliveries: (): Promise<IngestionDelivery[]> => api.ingestionDeliveries(),

  createIngestionSource: (input: IngestionSourceCreate): Promise<IngestionSecret> =>
    api.createIngestionSource(input),

  rotateIngestionSource: (id: number): Promise<IngestionSecret> => api.rotateIngestionSource(id),

  patchIngestionSource: async (id: number, patch: IngestionSourcePatch): Promise<void> => {
    await api.patchIngestionSource(id, patch);
  },

  deleteIngestionSource: async (id: number): Promise<void> => {
    await api.deleteIngestionSource(id);
  },
};

export { apiConfigured };
