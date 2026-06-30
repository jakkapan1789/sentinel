import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ChevronUp,
  ListFilter,
  Search,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Identifiable } from '../types';

export type Column<T> = {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
  sortValue?: (row: T) => string | number;
  align?: 'left' | 'right';
  /** Tailwind responsive visibility helper, e.g. "md" hides below md. */
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  /** Enable an Excel-style per-column value filter on this column. */
  filterable?: boolean;
  /** Text used for filtering / building the value list. Falls back to sortValue. */
  filterValue?: (row: T) => string;
  /** Multiple filter values per row (e.g. a group row covering several servers). */
  filterValues?: (row: T) => string[];
};

const hideClasses: Record<NonNullable<Column<unknown>['hideBelow']>, string> = {
  sm: 'hidden sm:table-cell',
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
  xl: 'hidden xl:table-cell',
};

const DEFAULT_PAGE_SIZES = [5, 10, 25, 50, 100];

function filterTextsOf<T>(column: Column<T>, row: T): string[] {
  if (column.filterValues) return column.filterValues(row);
  if (column.filterValue) return [column.filterValue(row)];
  if (column.sortValue) return [String(column.sortValue(row))];
  return [''];
}

/** When provided, paging/sorting are driven by the server; `rows` is just the current page. */
export type ServerMode = {
  total: number;
  page: number;
  pageSize: number;
  sortKey: string | null;
  sortDirection: 'asc' | 'desc';
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  onSortChange: (key: string) => void;
  /**
   * Server-driven Excel-style column filters. The parent supplies the option list
   * (distinct values can't be derived from a single page) and current selections,
   * and applies them by re-querying the API.
   */
  filters?: {
    options: Record<string, string[]>;
    selected: Record<string, string[]>;
    onChange: (key: string, values: string[]) => void;
  };
};

/** Optional multi-select column. The parent owns the selection set. */
export type SelectionMode<T> = {
  isSelected: (row: T) => boolean;
  onToggle: (row: T) => void;
  allOnPageSelected: boolean;
  onToggleAll: (checked: boolean) => void;
};

export function DataTable<T extends Identifiable>({
  rows,
  columns,
  empty,
  pageSizeOptions = DEFAULT_PAGE_SIZES,
  initialPageSize,
  onRowClick,
  bodyHeight,
  server,
  selection,
}: {
  rows: T[];
  columns: Column<T>[];
  empty: ReactNode;
  pageSizeOptions?: number[];
  initialPageSize?: number;
  onRowClick?: (row: T) => void;
  /** Optional fixed height for the scroll area. When unset, the table grows to fit all rows. */
  bodyHeight?: string;
  server?: ServerMode;
  selection?: SelectionMode<T>;
}) {
  const [localSortKey, setLocalSortKey] = useState<string | null>(null);
  const [localDirection, setLocalDirection] = useState<'asc' | 'desc'>('asc');
  const [localPageSize, setLocalPageSize] = useState<number>(initialPageSize ?? pageSizeOptions[0]);
  const [localPage, setLocalPage] = useState(1);
  const [filters, setFilters] = useState<Record<string, string[]>>({});

  const sortKey = server ? server.sortKey : localSortKey;
  const direction = server ? server.sortDirection : localDirection;

  // Distinct values per filterable column (client mode only).
  const filterOptions = useMemo(() => {
    const map: Record<string, string[]> = {};
    if (server) return map;
    for (const column of columns) {
      if (!column.filterable) continue;
      const values = new Set<string>();
      for (const row of rows) for (const value of filterTextsOf(column, row)) values.add(value);
      map[column.key] = Array.from(values).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    }
    return map;
  }, [rows, columns, server]);

  const filteredRows = useMemo(() => {
    if (server) return rows;
    const activeKeys = Object.keys(filters).filter((key) => filters[key]?.length);
    if (activeKeys.length === 0) return rows;
    return rows.filter((row) =>
      activeKeys.every((key) => {
        const column = columns.find((col) => col.key === key);
        return column ? filterTextsOf(column, row).some((value) => filters[key].includes(value)) : true;
      }),
    );
  }, [rows, columns, filters, server]);

  const sortedRows = useMemo(() => {
    if (server) return filteredRows;
    const column = columns.find((col) => col.key === sortKey);
    if (!column?.sortValue) return filteredRows;
    const accessor = column.sortValue;
    return [...filteredRows].sort((a, b) => {
      const first = accessor(a);
      const second = accessor(b);
      const comparison =
        typeof first === 'number' && typeof second === 'number'
          ? first - second
          : String(first).localeCompare(String(second), undefined, { numeric: true });
      return direction === 'asc' ? comparison : -comparison;
    });
  }, [filteredRows, columns, sortKey, direction, server]);

  const handleFilterChange = (key: string, values: string[]) => {
    setFilters((current) => ({ ...current, [key]: values }));
    setLocalPage(1);
  };

  const pageSize = server ? server.pageSize : localPageSize;
  const total = server ? server.total : sortedRows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Keep the client page within bounds when data / page size change.
  useEffect(() => {
    if (!server) setLocalPage((current) => Math.min(current, totalPages));
  }, [totalPages, server]);

  const currentPage = server ? server.page : Math.min(localPage, totalPages);
  const start = total === 0 ? 0 : (currentPage - 1) * pageSize;
  const pageRows = server ? rows : sortedRows.slice(start, start + pageSize);

  const handleSort = (column: Column<T>) => {
    if (!column.sortValue) return;
    if (server) {
      server.onSortChange(column.key);
      return;
    }
    if (localSortKey === column.key) {
      setLocalDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
    } else {
      setLocalSortKey(column.key);
      setLocalDirection('asc');
    }
    setLocalPage(1);
  };

  return (
    <div className="flex w-full flex-col">
      <div className="overflow-x-auto" style={bodyHeight ? { height: bodyHeight, overflowY: 'auto' } : undefined}>
        <table className="w-full min-w-[640px] text-left text-xs">
          <thead className="sticky top-0 z-10 bg-slate-50/90 text-[10px] uppercase tracking-wider text-slate-500 backdrop-blur">
            <tr className="border-b border-slate-200">
              {selection && (
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label="Select all on page"
                    checked={selection.allOnPageSelected}
                    onChange={(e) => selection.onToggleAll(e.target.checked)}
                    className="h-3.5 w-3.5 cursor-pointer accent-teal-600"
                  />
                </th>
              )}
              {columns.map((column) => {
                const isActive = sortKey === column.key;
                const Icon = !isActive ? ArrowUpDown : direction === 'asc' ? ArrowUp : ArrowDown;
                return (
                  <th
                    key={column.key}
                    className={`px-4 py-3 font-semibold ${column.align === 'right' ? 'text-right' : ''} ${
                      column.hideBelow ? hideClasses[column.hideBelow] : ''
                    } ${column.className ?? ''}`}
                  >
                    <div className={`flex items-center gap-1 ${column.align === 'right' ? 'justify-end' : ''}`}>
                      {column.sortValue ? (
                        <button
                          type="button"
                          onClick={() => handleSort(column)}
                          className={`inline-flex items-center gap-1 font-semibold hover:text-slate-900 ${
                            column.align === 'right' ? 'flex-row-reverse' : ''
                          } ${isActive ? 'text-teal-700' : 'text-slate-500'}`}
                        >
                          <span>{column.header}</span>
                          <Icon className={`h-3 w-3 ${isActive ? 'text-teal-600' : 'text-slate-300'}`} />
                        </button>
                      ) : (
                        <span>{column.header}</span>
                      )}
                      {column.filterable && !server && (
                        <ColumnFilter
                          label={column.header}
                          options={filterOptions[column.key] ?? []}
                          selected={filters[column.key] ?? []}
                          onChange={(values) => handleFilterChange(column.key, values)}
                        />
                      )}
                      {column.filterable && server?.filters?.options[column.key] && (
                        <ColumnFilter
                          label={column.header}
                          options={server.filters.options[column.key]}
                          selected={server.filters.selected[column.key] ?? []}
                          onChange={(values) => server.filters!.onChange(column.key, values)}
                        />
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {pageRows.map((row) => (
              <tr
                key={row.id}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`bg-white transition-colors hover:bg-teal-50/40 ${
                  selection?.isSelected(row) ? 'bg-teal-50/40' : ''
                } ${onRowClick ? 'cursor-pointer' : ''}`}
              >
                {selection && (
                  <td className="w-10 px-4 py-3 align-middle" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label="Select row"
                      checked={selection.isSelected(row)}
                      onChange={() => selection.onToggle(row)}
                      className="h-3.5 w-3.5 cursor-pointer accent-teal-600"
                    />
                  </td>
                )}
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`px-4 py-3 align-middle text-slate-700 ${
                      column.align === 'right' ? 'text-right' : ''
                    } ${column.hideBelow ? hideClasses[column.hideBelow] : ''} ${column.className ?? ''}`}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
            {total === 0 && (
              <tr>
                <td colSpan={columns.length + (selection ? 1 : 0)} className="p-0">
                  {empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {total > 0 && (
        <Pagination
          start={start}
          shown={pageRows.length}
          total={total}
          page={currentPage}
          totalPages={totalPages}
          pageSize={pageSize}
          pageSizeOptions={pageSizeOptions}
          onPageChange={server ? server.onPageChange : setLocalPage}
          onPageSizeChange={(size) => {
            if (server) {
              server.onPageSizeChange(size);
              return;
            }
            setLocalPageSize(size);
            setLocalPage(1);
          }}
        />
      )}
    </div>
  );
}

/** Build a compact page list with ellipses, e.g. [1, '…', 4, 5, 6, '…', 12]. */
function pageRange(page: number, totalPages: number): (number | 'gap')[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const pages: (number | 'gap')[] = [1];
  const left = Math.max(2, page - 1);
  const right = Math.min(totalPages - 1, page + 1);
  if (left > 2) pages.push('gap');
  for (let i = left; i <= right; i += 1) pages.push(i);
  if (right < totalPages - 1) pages.push('gap');
  pages.push(totalPages);
  return pages;
}

function Pagination({
  start,
  shown,
  total,
  page,
  totalPages,
  pageSize,
  pageSizeOptions,
  onPageChange,
  onPageSizeChange,
}: {
  start: number;
  shown: number;
  total: number;
  page: number;
  totalPages: number;
  pageSize: number;
  pageSizeOptions: number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}) {
  const from = total === 0 ? 0 : start + 1;
  const to = start + shown;

  return (
    <div className="flex shrink-0 flex-col gap-3 border-t border-slate-100 bg-slate-50/60 px-4 py-3 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2">
        <span className="text-slate-500">Rows per page</span>
        <PageSizeSelect value={pageSize} options={pageSizeOptions} onChange={onPageSizeChange} />
        <span className="ml-1 hidden text-slate-500 sm:inline">
          Showing <span className="font-medium text-slate-700">{from}</span>–
          <span className="font-medium text-slate-700">{to}</span> of{' '}
          <span className="font-medium text-slate-700">{total}</span>
        </span>
      </div>

      <div className="flex items-center gap-1">
        <PageButton label="First page" disabled={page === 1} onClick={() => onPageChange(1)}>
          <ChevronsLeft className="h-4 w-4" />
        </PageButton>
        <PageButton label="Previous page" disabled={page === 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft className="h-4 w-4" />
        </PageButton>

        {pageRange(page, totalPages).map((item, index) =>
          item === 'gap' ? (
            <span key={`gap-${index}`} className="px-1 text-slate-400">
              …
            </span>
          ) : (
            <button
              key={item}
              onClick={() => onPageChange(item)}
              aria-current={item === page ? 'page' : undefined}
              className={`inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-xs font-medium transition ${
                item === page
                  ? 'bg-gradient-to-b from-teal-500 to-teal-600 text-white'
                  : 'text-slate-600 hover:bg-white hover:text-slate-900 hover:ring-1 hover:ring-slate-200'
              }`}
            >
              {item}
            </button>
          ),
        )}

        <PageButton label="Next page" disabled={page === totalPages} onClick={() => onPageChange(page + 1)}>
          <ChevronRight className="h-4 w-4" />
        </PageButton>
        <PageButton label="Last page" disabled={page === totalPages} onClick={() => onPageChange(totalPages)}>
          <ChevronsRight className="h-4 w-4" />
        </PageButton>
      </div>
    </div>
  );
}

function ColumnFilter({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  const active = selected.length > 0;

  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = 240;
      const left = Math.min(rect.left, window.innerWidth - width - 8);
      setPos({ top: rect.bottom + 6, left: Math.max(8, left) });
    };
    reposition();
    const handlePointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        !popoverRef.current?.contains(target) &&
        !buttonRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', handlePointer);
    window.addEventListener('keydown', handleKey);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('mousedown', handlePointer);
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open]);

  const visibleOptions = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return options;
    return options.filter((option) => option.toLowerCase().includes(term));
  }, [options, query]);

  const allVisibleSelected =
    visibleOptions.length > 0 && visibleOptions.every((option) => selected.includes(option));

  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  };

  const toggleAll = () => {
    if (allVisibleSelected) {
      onChange(selected.filter((item) => !visibleOptions.includes(item)));
    } else {
      onChange(Array.from(new Set([...selected, ...visibleOptions])));
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={`Filter ${label}`}
        title={`Filter ${label}`}
        className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded transition ${
          active ? 'bg-teal-100 text-teal-700' : 'text-slate-300 hover:bg-slate-200 hover:text-slate-600'
        }`}
      >
        <ListFilter className="h-3 w-3" />
      </button>

      {open &&
        createPortal(
          <div
            ref={popoverRef}
            style={{ top: pos.top, left: pos.left }}
            className="fixed z-50 w-60 rounded-lg border border-slate-200 bg-white p-2 text-left text-slate-700 normal-case tracking-normal ring-1 ring-slate-900/5 animate-pop-in"
          >
          <div className="relative mb-2">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Contains…"
              className="h-8 w-full rounded-md border border-slate-200 bg-white pl-7 pr-2 text-[11px] font-normal text-slate-700 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-500/15"
            />
          </div>

          <label className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={toggleAll}
              className="h-3.5 w-3.5 accent-teal-600"
            />
            Select all
          </label>

          <div className="mt-1 h-52 overflow-y-auto">
            {visibleOptions.length === 0 ? (
              <p className="px-2 py-4 text-center text-[11px] text-slate-400">No matches</p>
            ) : (
              visibleOptions.map((option) => (
                <label
                  key={option || '__blank__'}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[11px] font-normal text-slate-600 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(option)}
                    onChange={() => toggle(option)}
                    className="h-3.5 w-3.5 shrink-0 accent-teal-600"
                  />
                  <span className="truncate">{option || '(blank)'}</span>
                </label>
              ))
            )}
          </div>

          <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2">
            <span className="text-[11px] text-slate-400">{selected.length} selected</span>
            <button
              type="button"
              onClick={() => onChange([])}
              disabled={selected.length === 0}
              className="text-[11px] font-medium text-teal-700 hover:underline disabled:text-slate-300 disabled:no-underline"
            >
              Clear
            </button>
          </div>
          </div>,
          document.body,
        )}
    </>
  );
}

function PageSizeSelect({
  value,
  options,
  onChange,
}: {
  value: number;
  options: number[];
  onChange: (size: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
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
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`inline-flex h-8 items-center gap-1.5 rounded-lg border bg-white pl-2.5 pr-2 text-xs font-medium text-slate-700 transition ${
          open ? 'border-teal-400 ring-4 ring-teal-500/15' : 'border-slate-200 hover:border-slate-300'
        }`}
      >
        <span className="tabular-nums">{value}</span>
        <ChevronUp className={`h-3.5 w-3.5 text-slate-400 transition-transform ${open ? '' : 'rotate-180'}`} />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute bottom-full left-0 z-20 mb-1.5 min-w-full overflow-hidden rounded-lg border border-slate-200 bg-white p-1 animate-pop-in"
        >
          {options.map((size) => {
            const selected = size === value;
            return (
              <li key={size}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(size);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                    selected ? 'bg-teal-50 font-semibold text-teal-700' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <span className="tabular-nums">{size}</span>
                  {selected && <Check className="h-3.5 w-3.5 text-teal-600" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function PageButton({
  children,
  label,
  disabled,
  onClick,
}: {
  children: ReactNode;
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-white hover:text-slate-900 hover:ring-1 hover:ring-slate-200 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:ring-0"
    >
      {children}
    </button>
  );
}
