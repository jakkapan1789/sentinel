import type { ApplicationLog, Environment, NetworkLog, ResponseStatus, WhitelistEntry, WhitelistStatus } from '../types';

/** Deterministic PRNG (mulberry32) so generated mock data is stable across reloads. */
function makeRng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(items: readonly T[], r: () => number): T => items[Math.floor(r() * items.length)];
const intBetween = (min: number, max: number, r: () => number) => min + Math.floor(r() * (max - min + 1));

const BASE_TIME = Date.parse('2026-06-22T03:00:00.000Z');
const isoWithin = (days: number, r: () => number) =>
  new Date(BASE_TIME - Math.floor(r() * days * 86_400_000)).toISOString();

const businessUnits = [
  'Retail Banking', 'Corporate', 'Risk', 'Data Platform', 'Digital', 'Operations',
  'Treasury', 'Compliance', 'Wealth', 'Cards', 'Lending', 'Insurance',
] as const;

const buPrefix: Record<string, string> = {
  'Retail Banking': '172.27', Corporate: '172.28', Risk: '10.24', 'Data Platform': '172.29',
  Digital: '10.30', Operations: '172.30', Treasury: '10.40', Compliance: '172.31',
  Wealth: '10.50', Cards: '172.26', Lending: '10.60', Insurance: '172.25',
};

const buShort: Record<string, string> = {
  'Retail Banking': 'retail', Corporate: 'corp', Risk: 'risk', 'Data Platform': 'data',
  Digital: 'digi', Operations: 'ops', Treasury: 'tsy', Compliance: 'cmp',
  Wealth: 'wlth', Cards: 'card', Lending: 'lend', Insurance: 'insu',
};

const serverRoles = ['api', 'web', 'job', 'batch', 'worker', 'proxy', 'svc'];
const databases = [
  'customer_core', 'treasury_ops', 'fraud_signal', 'lakehouse_sync', 'partner_access', 'batch_control',
  'card_ledger', 'loan_book', 'policy_admin', 'wealth_positions', 'compliance_audit', 'digital_session',
];
const functions = [
  'GetCustomerProfile', 'CreatePaymentBatch', 'ScoreTransaction', 'SyncDataset', 'PartnerLookup', 'RunBatchJob',
  'AuthorizeCard', 'SubmitLoanApplication', 'IssuePolicy', 'RebalancePortfolio', 'ExportAuditTrail',
  'RefreshSession', 'ValidateLimit', 'PostLedgerEntry',
];
const applications = [
  'Customer Profile Service', 'Payment Batch Orchestrator', 'Fraud Scoring Engine', 'Lakehouse Sync',
  'Partner Lookup API', 'Batch Control', 'Card Authorization', 'Loan Origination', 'Policy Admin',
  'Wealth Rebalancer', 'Compliance Exporter', 'Digital Session Gateway',
];
const responseStatuses: readonly ResponseStatus[] = ['Success', 'Success', 'Success', 'Success', 'Success', 'Error'];
const httpSuccess = [200, 200, 201, 204];
const httpError = [400, 401, 403, 404, 409, 500, 503];
const countries = ['Thailand', 'Singapore', 'Japan', 'Hong Kong', 'Malaysia', 'United States', 'Germany', 'India'];
const urlPaths = [
  '/api/customer/profile', '/api/payment/batch', '/risk/score', '/data/sync', '/partner/lookup',
  '/ops/batch/run', '/cards/authorize', '/lending/apply', '/insurance/policy', '/wealth/rebalance',
  '/compliance/audit', '/digital/session', '/external/unknown',
];
const months = ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01'];
const statuses: WhitelistStatus[] = ['active', 'active', 'active', 'pending', 'disabled'];
const environments: Environment[] = ['production', 'production', 'staging', 'development'];
const owners = ['Nattaya S.', 'Wichai P.', 'Pim K.', 'Anan T.', 'Korn R.', 'Suda M.', 'Pat C.', 'Mali W.'];

function generateApplicationLogs(count: number): ApplicationLog[] {
  const r = makeRng(101);
  return Array.from({ length: count }, (_, index) => {
    const bu = pick(businessUnits, r);
    const status = pick(responseStatuses, r);
    return {
      id: index + 1,
      clientIp: `${buPrefix[bu]}.${intBetween(1, 60, r)}.${intBetween(1, 250, r)}`,
      buName: bu,
      appName: pick(applications, r),
      functionName: pick(functions, r),
      responseStatus: status,
      httpStatusCode: status === 'Success' ? pick(httpSuccess, r) : pick(httpError, r),
      databaseName: pick(databases, r),
      durationMs: intBetween(4, 1800, r),
      usageCount: intBetween(120, 48000, r),
      serverName: `${buShort[bu]}-${pick(serverRoles, r)}-${String(intBetween(1, 18, r)).padStart(2, '0')}`,
      message: status === 'Error' ? 'Upstream timeout' : null,
      createdAt: isoWithin(30, r),
    };
  });
}

function generateNetworkLogs(count: number): NetworkLog[] {
  const r = makeRng(202);
  return Array.from({ length: count }, (_, index) => {
    const internal = r() < 0.7;
    const prefix = internal ? buPrefix[pick(businessUnits, r)] : `${intBetween(45, 209, r)}.${intBetween(0, 255, r)}`;
    return {
      id: index + 1,
      sourceAddress: `${prefix}.${intBetween(1, 250, r)}.${intBetween(1, 250, r)}`,
      countryName: pick(countries, r),
      url: pick(urlPaths, r),
      periodMonth: pick(months, r),
      usageCount: intBetween(80, 42000, r),
      createdAt: isoWithin(30, r),
    };
  });
}

function generateWhitelist(count: number): WhitelistEntry[] {
  const r = makeRng(303);
  const applications = [
    'Customer Profile Service', 'Payment Batch Orchestrator', 'Fraud Scoring Engine', 'Lakehouse Sync',
    'Partner Lookup API', 'Batch Control', 'Card Authorization', 'Loan Origination', 'Policy Admin',
    'Wealth Rebalancer', 'Compliance Exporter', 'Digital Session Gateway',
  ];
  return Array.from({ length: count }, (_, index) => {
    const bu = pick(businessUnits, r);
    const prefix = buPrefix[bu];
    const isRange = r() < 0.5;
    const created = isoWithin(160, r);
    return {
      id: index + 1,
      ipCidr: isRange ? `${prefix}.${intBetween(0, 60, r)}.0/24` : `${prefix}.${intBetween(1, 60, r)}.${intBetween(1, 250, r)}`,
      appName: pick(applications, r),
      server: `${buShort[bu]}-${pick(serverRoles, r)}-${String(intBetween(1, 18, r)).padStart(2, '0')}`,
      env: pick(environments, r),
      buName: bu,
      status: pick(statuses, r),
      owner: pick(owners, r),
      notes: `${bu} ${isRange ? 'egress range' : 'host'}.`,
      createdBy: 'system',
      updatedBy: pick(owners, r),
      createdAt: created,
      updatedAt: isoWithin(30, r),
    };
  });
}

export const seedWhitelist: WhitelistEntry[] = generateWhitelist(64);
export const seedApplicationLogs: ApplicationLog[] = generateApplicationLogs(1800);
export const seedNetworkLogs: NetworkLog[] = generateNetworkLogs(180);
