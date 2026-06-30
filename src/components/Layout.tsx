import {
  ChevronDown,
  ChevronRight,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  User,
  Webhook,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Fragment, useEffect, useRef, useState } from 'react';
import { dataSource } from '../lib/dataSource';
import { useRefreshBump } from '../lib/refresh';
import type { ViewKey } from '../types';

type NavItem = {
  key: ViewKey;
  label: string;
  description: string;
  icon: LucideIcon;
};

export type Crumb = { label: string; onClick?: () => void };

const navSections: { label: string; items: NavItem[] }[] = [
  {
    label: 'General',
    items: [
      { key: 'whitelist', label: 'Whitelist', description: 'Allowed connections', icon: ShieldCheck },
      { key: 'application-logs', label: 'Application IP Logs', description: 'Service-side traffic', icon: ServerCog },
    ],
  },
  {
    label: 'Settings',
    items: [{ key: 'ingestion', label: 'Ingestion', description: 'Inbound data sources', icon: Webhook }],
  },
];

const navItems: NavItem[] = navSections.flatMap((s) => s.items);

const COLLAPSE_KEY = 'swc.sidebar-collapsed';

export function Layout({
  active,
  onNavigate,
  breadcrumbs,
  breadcrumbAction,
  children,
}: {
  active: ViewKey;
  onNavigate: (key: ViewKey) => void;
  breadcrumbs?: Crumb[];
  breadcrumbAction?: ReactNode;
  children: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const bump = useRefreshBump();
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try {
      await dataSource.refreshSummary();
      bump();
    } finally {
      setRefreshing(false);
    }
  };
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(COLLAPSE_KEY) === '1';
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      // ignore unavailable storage
    }
  }, [collapsed]);

  const activeItem = navItems.find((item) => item.key === active) ?? navItems[0];

  const handleNavigate = (key: ViewKey) => {
    onNavigate(key);
    setMobileOpen(false);
  };

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 text-slate-900">
      {/* Desktop sidebar — collapses to an icon rail */}
      <Sidebar active={active} collapsed={collapsed} onNavigate={handleNavigate} className="hidden lg:flex" />

      {/* Mobile drawer — always expanded */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm animate-fade-in"
            onClick={() => setMobileOpen(false)}
          />
          <Sidebar
            active={active}
            collapsed={false}
            onNavigate={handleNavigate}
            onClose={() => setMobileOpen(false)}
            className="relative z-50 flex"
          />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b border-slate-200 bg-white/80 px-3 backdrop-blur-xl sm:gap-3 sm:px-6">
          {/* Mobile: open drawer */}
          <button
            onClick={() => setMobileOpen((open) => !open)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 lg:hidden"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
          {/* Desktop: collapse / expand rail */}
          <button
            onClick={() => setCollapsed((value) => !value)}
            className="hidden h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition hover:bg-slate-100 lg:inline-flex"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
          </button>

          {/* Right cluster */}
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <button
              onClick={refresh}
              disabled={refreshing}
              title="Re-run summary rollups and reload"
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{refreshing ? 'Refreshing…' : 'Refresh'}</span>
            </button>
            <ProfileMenu />
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex min-h-full w-full flex-col px-4 py-5 sm:px-6 lg:px-8">
            <div className="mb-4 flex min-h-7 shrink-0 items-center justify-between gap-3">
              <nav aria-label="Breadcrumb" className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs">
                <button
                  onClick={() => onNavigate('whitelist')}
                  className="font-medium text-slate-400 transition hover:text-slate-600"
                >
                  Home
                </button>
                {(breadcrumbs && breadcrumbs.length > 0
                  ? breadcrumbs
                  : [{ label: activeItem.label } as Crumb]
                ).map((crumb, index, list) => {
                  const isLast = index === list.length - 1;
                  return (
                    <Fragment key={`${crumb.label}-${index}`}>
                      <ChevronRight className="h-3.5 w-3.5 text-slate-300" />
                      {isLast || !crumb.onClick ? (
                        <span className={isLast ? 'font-semibold text-slate-700' : 'font-medium text-slate-400'}>
                          {crumb.label}
                        </span>
                      ) : (
                        <button
                          onClick={crumb.onClick}
                          className="font-medium text-slate-400 transition hover:text-slate-600"
                        >
                          {crumb.label}
                        </button>
                      )}
                    </Fragment>
                  );
                })}
              </nav>
              {breadcrumbAction && <div className="shrink-0">{breadcrumbAction}</div>}
            </div>
            <div className="flex min-h-0 flex-1 flex-col">{children}</div>
          </div>
        </main>
      </div>
    </div>
  );
}

function ProfileMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', handlePointer);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('mousedown', handlePointer);
      window.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`flex items-center gap-2.5 rounded-lg border py-1 pl-1 pr-1.5 transition sm:pr-2.5 ${
          open ? 'border-teal-300 bg-teal-50/40' : 'border-slate-200 bg-white hover:bg-slate-50'
        }`}
      >
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slate-400 to-slate-500 text-xs font-semibold text-white">
          <User className="h-4 w-4" />
        </span>
        <div className="hidden text-left leading-tight sm:block">
          <p className="whitespace-nowrap text-[13px] font-semibold text-slate-800">Anonymous</p>
          <p className="whitespace-nowrap text-[11px] text-slate-400">Guest access</p>
        </div>
        <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-64 rounded-lg border border-slate-200 bg-white p-1.5 ring-1 ring-slate-900/5 animate-pop-in"
        >
          <div className="mb-1 flex items-center gap-2.5 border-b border-slate-100 px-2.5 pb-2.5 pt-1.5">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-slate-400 to-slate-500 text-sm font-semibold text-white">
              <User className="h-5 w-5" />
            </span>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-[13px] font-semibold text-slate-800">Anonymous</p>
              <p className="truncate text-[11px] font-medium text-slate-500">Guest access</p>
              <p className="truncate text-[11px] text-slate-400">Not signed in</p>
            </div>
          </div>
          <MenuItem icon={LogOut} label="Sign out" tone="danger" disabled onClick={() => setOpen(false)} />
          <p className="px-2.5 pb-1 pt-1.5 text-[11px] text-slate-400">Anonymous mode — authentication coming soon</p>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon: Icon,
  label,
  tone = 'default',
  disabled = false,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] font-medium transition disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent ${
        tone === 'danger'
          ? 'text-rose-600 hover:bg-rose-50'
          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
      }`}
    >
      <Icon className={`h-4 w-4 shrink-0 ${tone === 'danger' ? 'text-rose-500' : 'text-slate-400'}`} />
      {label}
    </button>
  );
}

function Sidebar({
  active,
  collapsed,
  onNavigate,
  onClose,
  className = '',
}: {
  active: ViewKey;
  collapsed: boolean;
  onNavigate: (key: ViewKey) => void;
  onClose?: () => void;
  className?: string;
}) {
  return (
    <aside
      className={`relative z-10 h-full shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white text-slate-600 transition-[width] duration-200 ${
        collapsed ? 'w-[68px]' : 'w-60'
      } ${className}`}
    >
      {/* Brand */}
      <div
        className={`relative flex h-16 items-center border-b border-slate-200 ${
          collapsed ? 'justify-center px-2' : 'gap-2.5 px-4'
        }`}
      >
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-teal-400 to-emerald-500 text-white">
          <ShieldCheck className="h-5 w-5" />
        </span>
        {!collapsed && (
          <div className="min-w-0 leading-tight">
            <p className="truncate text-[13px] font-bold tracking-tight text-slate-900">Sentinel</p>
            <p className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-teal-600">
              Whitelist Center
            </p>
          </div>
        )}
        {onClose && (
          <button
            onClick={onClose}
            className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 lg:hidden"
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className={`relative flex-1 space-y-3 overflow-y-auto py-3 ${collapsed ? 'px-2.5' : 'px-3'}`}>
        {navSections.map((section) => (
          <div key={section.label} className="space-y-1">
            {!collapsed && (
              <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                {section.label}
              </p>
            )}
            {section.items.map((item) => {
              const Icon = item.icon;
              const isActive = item.key === active;
              return (
                <button
                  key={item.key}
                  onClick={() => onNavigate(item.key)}
                  title={collapsed ? item.label : undefined}
                  aria-label={item.label}
                  className={`group relative flex w-full items-center rounded-lg text-left text-[10px] tracking-tight transition ${
                    collapsed ? 'justify-center px-0 py-2' : 'gap-2 px-2.5 py-1.5'
                  } ${
                    isActive
                      ? 'bg-teal-50 font-semibold text-teal-700'
                      : 'font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  {isActive && (
                    <span className="absolute -left-3 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-teal-500" />
                  )}
                  <span
                    className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition ${
                      isActive
                        ? 'bg-teal-100/70 text-teal-700'
                        : 'text-slate-400 group-hover:bg-slate-100 group-hover:text-slate-600'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
    </aside>
  );
}
