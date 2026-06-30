import { Check, Copy, KeyRound, Plus, Trash2, Webhook } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge, Button, CenterMessage, ConfirmDialog, EmptyState, Field, IconButton, Modal, TextInput } from '../components/ui';
import { apiBaseUrl } from '../lib/api';
import { dataSource } from '../lib/dataSource';
import { formatNumber, formatRelative } from '../lib/format';
import { useRefreshVersion } from '../lib/refresh';
import { useAsync } from '../lib/useAsync';
import type { IngestionSecret, IngestionSource } from '../types';

const BASE = apiBaseUrl || '{API_BASE_URL}';

const SAMPLE_APP = `[
  {
    "clientIp": "172.27.10.25",
    "buName": "Retail Banking",
    "appName": "Customer Profile Service",
    "functionName": "GetCustomerProfile",
    "responseStatus": "Success",
    "httpStatusCode": 200,
    "databaseName": "customer_core",
    "durationMs": 42,
    "usageCount": 1,
    "serverName": "prod-api-01",
    "createdAt": "2026-06-22T03:00:00Z"
  }
]`;

const SAMPLE_NETWORK = `[
  {
    "sourceAddress": "203.150.20.14",
    "countryCode": "TH",
    "countryName": "Thailand",
    "url": "/api/partner/lookup",
    "periodMonth": "2026-06-01",
    "usageCount": 1240,
    "createdAt": "2026-06-22T03:00:00Z"
  }
]`;

type EndpointSpec = { kind: string; title: string; description: string; sample: string };

const ENDPOINTS: EndpointSpec[] = [
  {
    kind: 'app-logs',
    title: 'Application IP Logs',
    description: 'Service-side request logs — client IP, function, response status.',
    sample: SAMPLE_APP,
  },
  {
    kind: 'network-logs',
    title: 'Network IP Logs',
    description: 'Edge / source traffic per month — source IP, country, URL.',
    sample: SAMPLE_NETWORK,
  },
];

const buildCurl = (kind: string, sample: string) =>
  `curl -X POST ${BASE}/api/v1/ingestion/${kind} \\
  -H "Authorization: Bearer <source token>" \\
  -H "Content-Type: application/json" \\
  -d '${sample}'`;

function CopyButton({
  text,
  label = 'Copy',
  iconOnly = false,
}: {
  text: string;
  label?: string;
  iconOnly?: boolean;
}) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      title={iconOnly ? label : undefined}
      aria-label={label}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className={`inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 ${
        iconOnly ? 'h-6 w-6 justify-center' : 'px-2 py-0.5 text-[10px]'
      }`}
    >
      {done ? <Check className="h-2.5 w-2.5 text-emerald-600" /> : <Copy className="h-2.5 w-2.5" />}
      {!iconOnly && (done ? 'Copied' : label)}
    </button>
  );
}

function EndpointCard({ kind, title, description, sample }: EndpointSpec) {
  const url = `${BASE}/api/v1/ingestion/${kind}`;
  return (
    <div className="flex flex-col overflow-hidden rounded-xl ring-1 ring-slate-200/70">
      <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2">
        <span className="rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-bold text-teal-700">POST</span>
        <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-700">{url}</code>
        <CopyButton iconOnly text={url} label="Copy URL" />
      </div>

      <div className="px-3 pt-2.5">
        <p className="text-xs font-semibold text-slate-800">{title}</p>
        <p className="mt-0.5 text-[11px] text-slate-500">{description}</p>
      </div>

      <div className="px-3 pb-3 pt-2">
        <div className="overflow-hidden rounded-lg bg-slate-50 ring-1 ring-slate-200/70">
          <div className="flex items-center justify-between border-b border-slate-200/70 px-3 py-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Sample payload</span>
            <CopyButton text={sample} label="Copy JSON" />
          </div>
          <pre className="max-h-56 overflow-auto px-3 py-2.5 font-mono text-[11px] leading-relaxed text-slate-700">{sample}</pre>
        </div>
      </div>

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2">
        <span className="text-[11px] text-slate-400">Send a JSON array (batched)</span>
        <CopyButton text={buildCurl(kind, sample)} label="Copy cURL" />
      </div>
    </div>
  );
}

export function IngestionPage() {
  const version = useRefreshVersion();
  const { data, loading, error, reload } = useAsync(async () => {
    const [sources, deliveries] = await Promise.all([dataSource.ingestionSources(), dataSource.ingestionDeliveries()]);
    return { sources, deliveries };
  }, [version]);

  const [sources, setSources] = useState<IngestionSource[]>([]);
  useEffect(() => {
    if (data?.sources) setSources(data.sources);
  }, [data]);
  const deliveries = data?.deliveries ?? [];

  // Optimistic enable/disable — flips instantly, syncs to the API in the background.
  const toggleEnabled = (s: IngestionSource) => {
    setSources((prev) => prev.map((x) => (x.id === s.id ? { ...x, enabled: !x.enabled } : x)));
    dataSource.patchIngestionSource(s.id, { enabled: !s.enabled }).catch(() => reload());
  };

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [cidr, setCidr] = useState('');
  const [secret, setSecret] = useState<IngestionSecret | null>(null);
  const [deleting, setDeleting] = useState<IngestionSource | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      reload();
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const result = await dataSource.createIngestionSource({ name: name.trim(), allowedCidr: cidr.trim() || null });
      setSecret(result);
      setCreating(false);
      setName('');
      setCidr('');
      reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 animate-page-in">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">Ingestion</h1>
        <p className="mt-0.5 text-xs text-slate-500">Manage inbound sources that push logs into Sentinel.</p>
      </div>

      {/* Endpoints */}
      <section className="rounded-2xl bg-white p-4 ring-1 ring-slate-200/70">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold tracking-tight text-slate-800">Ingestion Endpoints</h2>
          <span className="text-[11px] text-slate-500">
            Auth: <code className="font-mono">Authorization: Bearer &lt;source token&gt;</code>
          </span>
        </div>
        <p className="text-[11px] text-slate-500">
          Each source token is scoped to ingestion. POST a JSON array of records to the matching endpoint.
        </p>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {ENDPOINTS.map((ep) => (
            <EndpointCard key={ep.kind} {...ep} />
          ))}
        </div>
      </section>

      {/* Sources */}
      <section className="flex flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200/70">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold tracking-tight text-slate-800">Ingestion Sources</h2>
          <Button onClick={() => setCreating(true)} className="h-8 px-3 text-xs">
            <Plus className="h-3.5 w-3.5" /> New source
          </Button>
        </div>
        {loading && !data ? (
          <CenterMessage>Loading sources…</CenterMessage>
        ) : error && !data ? (
          <CenterMessage tone="error">Could not load — {error}</CenterMessage>
        ) : sources.length === 0 ? (
          <EmptyState
            icon={<Webhook className="h-6 w-6" />}
            title="No ingestion sources"
            description="Create a source to get a token for your ETL pipeline."
            action={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> New source</Button>}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-xs">
              <thead className="bg-slate-50/90 text-[10px] uppercase tracking-wider text-slate-500">
                <tr className="border-b border-slate-200">
                  <th className="px-4 py-3 font-semibold">Name</th>
                  <th className="px-4 py-3 font-semibold">Token</th>
                  <th className="px-4 py-3 font-semibold">Allowed CIDR</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 text-right font-semibold">Received</th>
                  <th className="px-4 py-3 font-semibold">Last used</th>
                  <th className="px-4 py-3 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sources.map((s) => (
                  <tr key={s.id} className="bg-white transition-colors hover:bg-slate-50/70">
                    <td className="px-4 py-3 font-medium text-slate-800">{s.name}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[11px] text-slate-500">swc_etl_••••{s.tokenPrefix}</span>
                        {s.token && <CopyButton iconOnly text={s.token} label="Copy token" />}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-500">{s.allowedCidr || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={s.enabled}
                          aria-label={s.enabled ? 'Disable source' : 'Enable source'}
                          onClick={() => toggleEnabled(s)}
                          className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                            s.enabled ? 'bg-emerald-500' : 'bg-slate-300'
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white ring-1 ring-slate-900/10 transition-transform ${
                              s.enabled ? 'translate-x-4' : 'translate-x-0.5'
                            }`}
                          />
                        </button>
                        <span className={`text-[11px] font-medium ${s.enabled ? 'text-emerald-700' : 'text-slate-400'}`}>
                          {s.enabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">{formatNumber(s.totalReceived)}</td>
                    <td className="px-4 py-3 text-[11px] text-slate-500">{s.lastUsedAt ? formatRelative(s.lastUsedAt) : '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <IconButton label="Delete" danger onClick={() => setDeleting(s)}><Trash2 className="h-3.5 w-3.5" /></IconButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recent deliveries */}
      {deliveries.length > 0 && (
        <section className="flex flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-slate-200/70">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold tracking-tight text-slate-800">Recent Deliveries</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {deliveries.map((d) => (
              <div key={d.id} className="flex items-center gap-3 px-4 py-2.5 text-xs">
                <Badge tone={d.status === 'ok' ? 'emerald' : 'rose'}>{d.status}</Badge>
                <span className="font-medium text-slate-700">{d.sourceName ?? '—'}</span>
                <span className="text-slate-400">{d.kind}</span>
                <span className="text-slate-500">received {d.received} · inserted {d.inserted}</span>
                <span className="ml-auto text-[11px] text-slate-400">{formatRelative(d.createdAt)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* New source modal */}
      {creating && (
        <Modal
          title="New ingestion source"
          description="Generates a bearer token for an ETL pipeline."
          onClose={() => setCreating(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
              <Button onClick={create} disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create source'}</Button>
            </>
          }
        >
          <div className="grid grid-cols-1 gap-4">
            <Field label="Name" required>
              <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="etl-prod" />
            </Field>
            <Field label="Allowed CIDR" hint="Optional — restrict which source IPs may push (e.g. 10.0.0.0/8)">
              <TextInput value={cidr} onChange={(e) => setCidr(e.target.value)} placeholder="leave blank to allow any" />
            </Field>
          </div>
        </Modal>
      )}

      {/* Token reveal (once) */}
      {secret && (
        <Modal
          title="Copy your token now"
          description="This token is shown only once. Store it securely in your ETL pipeline."
          onClose={() => setSecret(null)}
          footer={<Button onClick={() => setSecret(null)}>Done</Button>}
        >
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2.5">
              <KeyRound className="h-4 w-4 shrink-0 text-teal-300" />
              <code className="min-w-0 flex-1 truncate font-mono text-xs text-teal-200">{secret.token}</code>
              <CopyButton text={secret.token} />
            </div>
            <p className="text-xs text-slate-500">
              Source <span className="font-medium text-slate-700">{secret.source.name}</span> · scope{' '}
              <span className="font-mono">{secret.source.scope}</span>
            </p>
          </div>
        </Modal>
      )}

      {deleting && (
        <ConfirmDialog
          title="Delete ingestion source?"
          message={`"${deleting.name}" will stop accepting data immediately. This cannot be undone.`}
          onCancel={() => setDeleting(null)}
          onConfirm={() => run(() => dataSource.deleteIngestionSource(deleting.id)).then(() => setDeleting(null))}
        />
      )}
    </div>
  );
}
