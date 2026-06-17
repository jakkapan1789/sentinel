import {
  ArrowUpDown,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Database,
  Download,
  FileSpreadsheet,
  MoreHorizontal,
  Search,
  Server,
  ShieldCheck,
  Upload,
  XCircle,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { WorkSheet } from 'xlsx';

type MatchStatus = 'Matched' | 'App Only' | 'Network Only';

type MatchedLogRecord = {
  id: string;
  clientIp: string;
  sourceAddress: string;
  ipPrefix: string;
  webServiceVersion: string;
  projectId: string;
  bu: string;
  server: string;
  database: string;
  appUsage: string;
  callMemberName: string;
  sourceCountry: string;
  month: string;
  url: string;
  networkUsage: string;
  status: MatchStatus;
};

type ApplicationLogRow = {
  clientIp: string;
  webServiceVersion: string;
  projectId: string;
  bu: string;
  server: string;
  database: string;
  usage: string;
  callMemberName: string;
};

type NetworkLogRow = {
  sourceAddress: string;
  sourceCountry: string;
  month: string;
  url: string;
  usage: string;
};

type SortKey = keyof MatchedLogRecord;

type SortDirection = 'asc' | 'desc';

type SheetToJson = <T>(sheet: WorkSheet, options: { defval: string }) => T[];

const mockApplicationLogs: ApplicationLogRow[] = [
  {
    clientIp: '172.27.10.25',
    webServiceVersion: 'v2.1',
    projectId: 'PRJ-1001',
    bu: 'Retail Banking',
    server: 'prod-api-01',
    database: 'customer_core',
    usage: '14,220',
    callMemberName: 'GetCustomerProfile',
  },
  {
    clientIp: '172.27.44.15',
    webServiceVersion: 'v1.8',
    projectId: 'PRJ-2002',
    bu: 'Corporate',
    server: 'corp-web-03',
    database: 'treasury_ops',
    usage: '8,912',
    callMemberName: 'CreatePaymentBatch',
  },
  {
    clientIp: '10.24.72.9',
    webServiceVersion: 'v3.0',
    projectId: 'PRJ-3104',
    bu: 'Risk',
    server: 'risk-job-02',
    database: 'fraud_signal',
    usage: '31,402',
    callMemberName: 'ScoreTransaction',
  },
  {
    clientIp: '172.28.4.130',
    webServiceVersion: 'v1.4',
    projectId: 'PRJ-4088',
    bu: 'Data Platform',
    server: 'etl-worker-11',
    database: 'lakehouse_sync',
    usage: '4,050',
    callMemberName: 'SyncDataset',
  },
  {
    clientIp: '203.0.113.42',
    webServiceVersion: 'v2.5',
    projectId: 'PRJ-5190',
    bu: 'Digital',
    server: 'dmz-proxy-02',
    database: 'partner_access',
    usage: '1,088',
    callMemberName: 'PartnerLookup',
  },
  {
    clientIp: '172.27.7.44',
    webServiceVersion: 'v2.0',
    projectId: 'PRJ-6401',
    bu: 'Operations',
    server: 'ops-batch-07',
    database: 'batch_control',
    usage: '19,876',
    callMemberName: 'RunBatchJob',
  },
];

const mockNetworkLogs: NetworkLogRow[] = [
  {
    sourceAddress: '172.27.90.18',
    sourceCountry: 'Thailand',
    month: '2026-06',
    url: '/api/customer/profile',
    usage: '15,010',
  },
  {
    sourceAddress: '172.27.12.200',
    sourceCountry: 'Thailand',
    month: '2026-06',
    url: '/api/payment/batch',
    usage: '8,900',
  },
  {
    sourceAddress: '10.24.72.240',
    sourceCountry: 'Singapore',
    month: '2026-06',
    url: '/risk/score',
    usage: '30,221',
  },
  {
    sourceAddress: '198.51.100.10',
    sourceCountry: 'Japan',
    month: '2026-06',
    url: '/external/unknown',
    usage: '502',
  },
];

const records = buildMatchedRecords(mockApplicationLogs, mockNetworkLogs);

const statusStyles: Record<MatchStatus, string> = {
  Matched: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  'App Only': 'bg-amber-50 text-amber-700 ring-amber-200',
  'Network Only': 'bg-rose-50 text-rose-700 ring-rose-200',
};

const statusIcons: Record<MatchStatus, typeof CheckCircle2> = {
  Matched: CheckCircle2,
  'App Only': Clock3,
  'Network Only': XCircle,
};

const sheetColumnAliases = {
  clientIp: ['ClientIp', 'Client IP', 'Client_IP'],
  webServiceVersion: ['Web Service V.', 'Web Service V', 'WebServiceVersion', 'Web Service Version'],
  projectId: ['ProjectId', 'Project ID', 'Project_ID'],
  bu: ['BU', 'Bu'],
  server: ['Server'],
  database: ['Database', 'DB'],
  usage: ['Usage'],
  callMemberName: ['CallMemberName', 'Call Member Name', 'Call_Member_Name'],
  sourceAddress: ['SourceAddress', 'Source Address', 'Source_Address'],
  sourceCountry: ['Source Country', 'SourceCountry', 'Source_Country'],
  month: ['Month'],
  url: ['URL', 'Url'],
} as const;

function App() {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('status');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [logRecords, setLogRecords] = useState<MatchedLogRecord[]>([]);
  const [sourceFileName, setSourceFileName] = useState('No file uploaded');
  const [importError, setImportError] = useState('');

  const filteredRecords = useMemo(() => {
    const term = search.trim().toLowerCase();

    return logRecords.filter((record) => {
      const textMatch =
        term.length === 0 ||
        Object.values(record).some((value) => value.toLowerCase().includes(term));

      return textMatch;
    });
  }, [logRecords, search]);

  const sortedRecords = useMemo(() => {
    return [...filteredRecords].sort((a, b) => {
      const first = String(a[sortKey]).toLowerCase();
      const second = String(b[sortKey]).toLowerCase();
      const comparison = first.localeCompare(second, undefined, { numeric: true });

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [filteredRecords, sortDirection, sortKey]);

  const handleSort = (key: SortKey) => {
    setSortKey((currentKey) => {
      if (currentKey === key) {
        setSortDirection((currentDirection) => (currentDirection === 'asc' ? 'desc' : 'asc'));
        return currentKey;
      }

      setSortDirection('asc');
      return key;
    });
  };

  const handleWorkbookUpload = async (file: File | undefined) => {
    if (!file) {
      return;
    }

    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(await file.arrayBuffer());
      const [applicationSheetName, networkSheetName] = workbook.SheetNames;

      if (!applicationSheetName || !networkSheetName) {
        throw new Error('Workbook must contain at least 2 sheets.');
      }

      const applicationRows = parseApplicationSheet(workbook.Sheets[applicationSheetName], XLSX.utils.sheet_to_json);
      const networkRows = parseNetworkSheet(workbook.Sheets[networkSheetName], XLSX.utils.sheet_to_json);
      const matchedRecords = buildMatchedRecords(applicationRows, networkRows);

      setLogRecords(matchedRecords);
      setSourceFileName(`${file.name} (${applicationSheetName} + ${networkSheetName})`);
      setImportError('');
      setSearch('');
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'Unable to read workbook.');
    }
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#f7f8fb] text-slate-900">
      <Header />
      <main className="min-h-0 flex-1 px-3 pb-3 pt-20 sm:px-5 lg:px-6">
        <section className="mx-auto flex h-full min-h-0 max-w-7xl flex-col">
          <div className="flex shrink-0 flex-col gap-3 border-b border-slate-200 pb-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-medium text-teal-700">Log Compare</p>
              <h1 className="mt-1 text-xl font-semibold tracking-normal text-slate-950 sm:text-2xl">
                IP Log Matching
              </h1>
              <p className="mt-1 hidden max-w-2xl text-xs leading-5 text-slate-600 sm:block">
                Import Application and Network sheets, then show which BU owns each network source IP by the first two IP octets.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md bg-teal-700 px-3 text-xs font-medium text-white shadow-sm hover:bg-teal-800">
                <Upload className="h-4 w-4" />
                Upload Excel
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="sr-only"
                  onChange={(event) => handleWorkbookUpload(event.target.files?.[0])}
                />
              </label>
              <button className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50">
                <Download className="h-4 w-4" />
                Export
              </button>
            </div>
          </div>

          <div className="mt-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              <FileSpreadsheet className="h-4 w-4 text-teal-700" />
              <span className="truncate">Source: {sourceFileName}</span>
              {importError && <span className="ml-auto truncate font-medium text-rose-700">{importError}</span>}
            </div>
            <div className="flex flex-col gap-3 border-b border-slate-200 p-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="relative w-full lg:max-w-md">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search IP, BU, project, server, database, URL"
                  className="h-9 w-full rounded-md border border-slate-300 bg-white pl-9 pr-3 text-xs outline-none ring-teal-600 transition focus:border-teal-600 focus:ring-2"
                />
              </div>
              <div className="text-xs text-slate-500">{sortedRecords.length} records</div>
            </div>

            <div className="min-h-0 w-full flex-1 overflow-y-auto">
              <table className="w-full table-fixed text-left text-[11px] sm:text-xs">
                <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] uppercase tracking-normal text-slate-500 sm:text-[11px]">
                  <tr>
                    <th className="hidden px-2 py-2 font-semibold md:table-cell">
                      <SortHeader label="BU" sortKeyName="bu" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
                    </th>
                    <th className="px-2 py-2 font-semibold">
                      <SortHeader label="Source IP" sortKeyName="sourceAddress" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
                    </th>
                    <th className="hidden px-2 py-2 font-semibold lg:table-cell">
                      <SortHeader label="Server" sortKeyName="server" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
                    </th>
                    <th className="px-2 py-2 font-semibold">
                      <SortHeader label="Client IP" sortKeyName="clientIp" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
                    </th>
                    <th className="hidden px-2 py-2 font-semibold xl:table-cell">
                      <SortHeader label="Project" sortKeyName="projectId" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
                    </th>
                    <th className="hidden px-2 py-2 font-semibold lg:table-cell">
                      <SortHeader label="DB / Call" sortKeyName="database" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
                    </th>
                    <th className="px-2 py-2 font-semibold">
                      <SortHeader label="Status" sortKeyName="status" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
                    </th>
                    <th className="hidden px-2 py-2 font-semibold xl:table-cell">
                      <SortHeader label="Usage / URL" sortKeyName="networkUsage" activeKey={sortKey} direction={sortDirection} onSort={handleSort} />
                    </th>
                    <th className="w-11 px-2 py-2 text-right font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sortedRecords.map((record) => (
                    <WhitelistRow key={record.id} record={record} />
                  ))}
                  {sortedRecords.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-3 py-8 text-center text-xs text-slate-500">
                        Upload an Excel workbook with Application and Network sheets to compare logs.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}

function Header() {
  return (
    <header className="fixed inset-x-0 top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-teal-700 text-white">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-950 sm:text-base">IP Log Compare</p>
            <p className="hidden text-xs text-slate-500 sm:block">Application and Network log matching</p>
          </div>
        </div>
        <div className="hidden items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 sm:inline-flex">
          <FileSpreadsheet className="h-4 w-4 text-teal-700" />
          Compare Mode
        </div>
      </div>
    </header>
  );
}

function SortHeader({
  label,
  sortKeyName,
  activeKey,
  direction,
  onSort,
}: {
  label: string;
  sortKeyName: SortKey;
  activeKey: SortKey;
  direction: SortDirection;
  onSort: (key: SortKey) => void;
}) {
  const isActive = activeKey === sortKeyName;

  return (
    <button
      onClick={() => onSort(sortKeyName)}
      className="inline-flex max-w-full items-center gap-1 text-left font-semibold text-slate-500 hover:text-slate-900"
      type="button"
    >
      <span className="truncate">{label}</span>
      <ArrowUpDown className={`h-3 w-3 shrink-0 ${isActive ? 'text-teal-700' : 'text-slate-300'}`} />
      {isActive && <span className="sr-only">Sorted {direction}</span>}
    </button>
  );
}

function WhitelistRow({ record }: { record: MatchedLogRecord }) {
  const Icon = statusIcons[record.status];

  return (
    <tr className="hover:bg-slate-50">
      <td className="hidden truncate px-2 py-2 font-medium text-slate-900 md:table-cell">{record.bu}</td>
      <td className="truncate px-2 py-2 font-medium text-slate-900">
        <span className="block truncate font-mono text-[11px]">{record.sourceAddress || '-'}</span>
        <span className="mt-1 block truncate text-[10px] font-normal text-slate-500">
          {record.bu ? `BU ${record.bu}` : 'No BU match'} / prefix {record.ipPrefix || '-'}
        </span>
      </td>
      <td className="hidden px-2 py-2 lg:table-cell">
        <span className="flex max-w-full items-start gap-2 text-slate-700">
          <Server className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span className="min-w-0">
            <span className="block truncate">{record.server || '-'}</span>
            <span className="mt-1 block truncate text-[10px] text-slate-500">{record.callMemberName || '-'}</span>
          </span>
        </span>
      </td>
      <td className="truncate px-2 py-2">
        <span className="block truncate font-mono text-[11px] text-slate-700">{record.clientIp || '-'}</span>
        <span className="mt-1 block truncate text-[10px] text-slate-500">
          {record.sourceCountry || '-'} / {record.month || record.webServiceVersion || '-'}
        </span>
      </td>
      <td className="hidden px-2 py-2 xl:table-cell">
        <span className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-slate-700">{record.projectId || '-'}</span>
      </td>
      <td className="hidden px-2 py-2 text-slate-700 lg:table-cell">
        <span className="flex max-w-full items-start gap-2">
          <Database className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span className="min-w-0">
            <span className="block truncate">{record.database || '-'}</span>
            <span className="mt-1 block truncate text-[10px] text-slate-500">{record.callMemberName || '-'}</span>
          </span>
        </span>
      </td>
      <td className="px-2 py-2">
        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${statusStyles[record.status]}`}>
          <Icon className="h-3 w-3" />
          <span className="hidden sm:inline">{record.status}</span>
        </span>
      </td>
      <td className="hidden truncate px-2 py-2 text-slate-600 xl:table-cell">
        <span className="block truncate">App {record.appUsage || '-'}</span>
        <span className="mt-1 block truncate">Net {record.networkUsage || '-'}</span>
        <span className="mt-1 block truncate text-[10px] text-slate-500">{record.url || '-'}</span>
      </td>
      <td className="px-2 py-2 text-right">
        <button className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-900" aria-label={`Open actions for ${record.id}`}>
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </td>
    </tr>
  );
}

function parseApplicationSheet(sheet: WorkSheet, sheetToJson: SheetToJson): ApplicationLogRow[] {
  return readSheetRows(sheet, sheetToJson).map((row) => ({
    clientIp: getSheetValue(row, sheetColumnAliases.clientIp),
    webServiceVersion: getSheetValue(row, sheetColumnAliases.webServiceVersion),
    projectId: getSheetValue(row, sheetColumnAliases.projectId),
    bu: getSheetValue(row, sheetColumnAliases.bu),
    server: getSheetValue(row, sheetColumnAliases.server),
    database: getSheetValue(row, sheetColumnAliases.database),
    usage: getSheetValue(row, sheetColumnAliases.usage),
    callMemberName: getSheetValue(row, sheetColumnAliases.callMemberName),
  }));
}

function parseNetworkSheet(sheet: WorkSheet, sheetToJson: SheetToJson): NetworkLogRow[] {
  return readSheetRows(sheet, sheetToJson).map((row) => ({
    sourceAddress: getSheetValue(row, sheetColumnAliases.sourceAddress),
    sourceCountry: getSheetValue(row, sheetColumnAliases.sourceCountry),
    month: getSheetValue(row, sheetColumnAliases.month),
    url: getSheetValue(row, sheetColumnAliases.url),
    usage: getSheetValue(row, sheetColumnAliases.usage),
  }));
}

function readSheetRows(sheet: WorkSheet, sheetToJson: SheetToJson) {
  return sheetToJson<Record<string, unknown>>(sheet, { defval: '' });
}

function getSheetValue(row: Record<string, unknown>, aliases: readonly string[]) {
  const normalizedRow = Object.entries(row).reduce<Record<string, unknown>>((result, [key, value]) => {
    result[normalizeColumnName(key)] = value;
    return result;
  }, {});

  for (const alias of aliases) {
    const value = normalizedRow[normalizeColumnName(alias)];

    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }

  return '';
}

function normalizeColumnName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function getIpPrefix(ipAddress: string) {
  const parts = ipAddress.trim().replace(/\/\d+$/, '').split('.');

  if (parts.length < 2 || !parts[0] || !parts[1]) {
    return '';
  }

  return `${parts[0]}.${parts[1]}`;
}

function buildMatchedRecords(applicationLogs: ApplicationLogRow[], networkLogs: NetworkLogRow[]): MatchedLogRecord[] {
  const applicationByPrefix = new Map<string, { row: ApplicationLogRow; index: number }[]>();

  applicationLogs.forEach((row, index) => {
    const prefix = getIpPrefix(row.clientIp);

    if (!prefix) {
      return;
    }

    applicationByPrefix.set(prefix, [...(applicationByPrefix.get(prefix) ?? []), { row, index }]);
  });

  const consumedApplicationRows = new Set<number>();
  const matchedRecords: MatchedLogRecord[] = [];

  networkLogs.forEach((networkRow, networkIndex) => {
    const prefix = getIpPrefix(networkRow.sourceAddress);
    const applicationMatches = prefix ? applicationByPrefix.get(prefix) ?? [] : [];

    if (applicationMatches.length === 0) {
      matchedRecords.push(createMatchedRecord(`NET-${networkIndex + 1}`, undefined, networkRow, prefix, 'Network Only'));
      return;
    }

    applicationMatches.forEach(({ row: applicationRow, index: applicationIndex }, matchIndex) => {
      consumedApplicationRows.add(applicationIndex);
      matchedRecords.push(createMatchedRecord(`MATCH-${networkIndex + 1}-${matchIndex + 1}`, applicationRow, networkRow, prefix, 'Matched'));
    });
  });

  applicationLogs.forEach((applicationRow, applicationIndex) => {
    if (consumedApplicationRows.has(applicationIndex)) {
      return;
    }

    matchedRecords.push(createMatchedRecord(`APP-${applicationIndex + 1}`, applicationRow, undefined, getIpPrefix(applicationRow.clientIp), 'App Only'));
  });

  return matchedRecords;
}

function createMatchedRecord(
  id: string,
  applicationRow: ApplicationLogRow | undefined,
  networkRow: NetworkLogRow | undefined,
  ipPrefix: string,
  status: MatchStatus,
): MatchedLogRecord {
  return {
    id,
    clientIp: applicationRow?.clientIp ?? '',
    sourceAddress: networkRow?.sourceAddress ?? '',
    ipPrefix,
    webServiceVersion: applicationRow?.webServiceVersion ?? '',
    projectId: applicationRow?.projectId ?? '',
    bu: applicationRow?.bu ?? '',
    server: applicationRow?.server ?? '',
    database: applicationRow?.database ?? '',
    appUsage: applicationRow?.usage ?? '',
    callMemberName: applicationRow?.callMemberName ?? '',
    sourceCountry: networkRow?.sourceCountry ?? '',
    month: networkRow?.month ?? '',
    url: networkRow?.url ?? '',
    networkUsage: networkRow?.usage ?? '',
    status,
  };
}

function Footer() {
  return (
    <footer className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
        <p>Sentinel Whitelist Center</p>
        <p>Mock data only - Last updated 2026-06-17</p>
      </div>
    </footer>
  );
}

export default App;
