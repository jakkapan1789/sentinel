import { useEffect, useState } from 'react';
import type { Crumb } from './components/Layout';
import { Layout } from './components/Layout';
import { ApplicationLogsPage } from './pages/ApplicationLogsPage';
import { Dashboard } from './pages/Dashboard';
import { IpMatchPage } from './pages/IpMatchPage';
import { NetworkLogsPage } from './pages/NetworkLogsPage';
import { IngestionPage } from './pages/IngestionPage';
import { WhitelistPage } from './pages/WhitelistPage';
import type { ViewKey } from './types';

const VIEWS: ViewKey[] = ['dashboard', 'whitelist', 'ip-match', 'application-logs', 'network-logs', 'ingestion'];

function readRoute(): { view: ViewKey; bu: string | null } {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [segment, ...rest] = raw.split('/');
  const view = (VIEWS as string[]).includes(segment) ? (segment as ViewKey) : 'whitelist';
  const bu = view === 'application-logs' && rest.length > 0 ? decodeURIComponent(rest.join('/')) : null;
  return { view, bu };
}

function buildHash(view: ViewKey, bu: string | null): string {
  const detail = view === 'application-logs' && bu ? `/${encodeURIComponent(bu)}` : '';
  return `#/${view}${detail}`;
}

function App() {
  const initial = readRoute();
  const [view, setView] = useState<ViewKey>(initial.view);
  const [appLogBu, setAppLogBu] = useState<string | null>(initial.bu);

  useEffect(() => {
    const current = readRoute();
    if (current.view !== view || current.bu !== appLogBu) {
      window.location.hash = buildHash(view, appLogBu);
    }
  }, [view, appLogBu]);

  useEffect(() => {
    const onHashChange = () => {
      const route = readRoute();
      setView(route.view);
      setAppLogBu(route.bu);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const navigate = (key: ViewKey) => {
    setView(key);
    setAppLogBu(null);
  };

  const inAppLogDetail = view === 'application-logs' && appLogBu;
  const breadcrumbs: Crumb[] | undefined = inAppLogDetail
    ? [{ label: 'Application IP Logs', onClick: () => setAppLogBu(null) }, { label: appLogBu as string }]
    : undefined;

  return (
    <Layout active={view} onNavigate={navigate} breadcrumbs={breadcrumbs}>
      {view === 'dashboard' && <Dashboard onNavigate={navigate} />}
      {view === 'whitelist' && <WhitelistPage />}
      {view === 'ip-match' && <IpMatchPage />}
      {view === 'application-logs' && <ApplicationLogsPage selectedBu={appLogBu} onSelectBu={setAppLogBu} />}
      {view === 'network-logs' && <NetworkLogsPage />}
      {view === 'ingestion' && <IngestionPage />}
    </Layout>
  );
}

export default App;
