export type WhitelistStatus = 'active' | 'disabled' | 'pending';

export type Environment = 'production' | 'staging' | 'development';

export type ResponseStatus = 'Success' | 'Error';

export type ViewKey = 'dashboard' | 'whitelist' | 'application-logs' | 'network-logs' | 'ingestion';

export interface IngestionSource {
  id: number;
  name: string;
  tokenPrefix: string;
  token: string | null;
  scope: string;
  enabled: boolean;
  allowedCidr: string | null;
  lastUsedAt: string | null;
  totalReceived: number;
  totalInserted: number;
  createdBy: string;
  createdAt: string;
}

export interface IngestionSourceCreate {
  name: string;
  allowedCidr: string | null;
}

export interface IngestionSourcePatch {
  enabled?: boolean;
  allowedCidr?: string | null;
}

export interface IngestionSecret {
  source: IngestionSource;
  token: string;
}

export interface IngestionDelivery {
  id: number;
  sourceId: number | null;
  sourceName: string | null;
  kind: string;
  received: number;
  inserted: number;
  status: string;
  message: string | null;
  createdAt: string;
}

/** Shapes mirror the .NET API DTOs (camelCase) so one type flows end-to-end. */

export interface WhitelistEntry {
  id: number;
  ipCidr: string;
  appName: string;
  server: string;
  env: Environment;
  buName: string;
  status: WhitelistStatus;
  owner: string | null;
  notes: string | null;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface WhitelistInput {
  ipCidr: string;
  appName: string;
  server: string;
  env: Environment;
  buName: string;
  status: WhitelistStatus;
  owner: string | null;
  notes: string | null;
}

export interface ApplicationLog {
  id: number;
  clientIp: string;
  buName: string;
  functionName: string;
  responseStatus: ResponseStatus;
  httpStatusCode: number | null;
  databaseName: string | null;
  durationMs: number | null;
  usageCount: number;
  serverName: string | null;
  message: string | null;
  createdAt: string;
}

export interface NetworkLog {
  id: number;
  sourceAddress: string;
  countryName: string | null;
  url: string;
  periodMonth: string;
  usageCount: number;
  createdAt: string;
}

export interface BuSummary {
  buName: string;
  totalUsage: number;
  transactions: number;
  successCount: number;
  errorCount: number;
  serverCount: number;
  servers: string[];
  lastSeen: string | null;
}

export interface DashboardData {
  whitelistTotal: number;
  whitelistActive: number;
  whitelistPending: number;
  whitelistDisabled: number;
  appTotalUsage: number;
  appTransactions: number;
  appSuccess: number;
  appError: number;
  successRate: number;
  unmatchedSources: number;
}

export interface PagedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Identifiable {
  id: string | number;
}
