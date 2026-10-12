import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { sortRows, type SortDir } from './report-utils';

export interface KpiColumn<T> {
  key: string;
  header: string;
  /** Sort value (null sorts last). */
  value: (row: T) => string | number | null;
  cell: (row: T) => ReactNode;
  /** Numbers align right. */
  numeric?: boolean;
}

interface Props<T> {
  rows: T[];
  columns: KpiColumn<T>[];
  rowKey: (row: T) => string;
  label: string;
  testId: string;
}

/** A table sortable by any column (click a header; again to flip) on md+, cards on phones in the same order. */
export function KpiTable<T>({ rows, columns, rowKey, label, testId }: Props<T>) {
  const [sort, setSort] = useState<{ key: string; dir: SortDir } | null>(null);
  const column = sort ? columns.find((c) => c.key === sort.key) : undefined;
  const sorted = column && sort ? sortRows(rows, column.value, sort.dir) : rows;
  const toggle = (key: string, numeric?: boolean) =>
    setSort((prev) => (prev?.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: numeric ? 'desc' : 'asc' }));
  const [first, ...rest] = columns;

  return (
    <>
      {/* Many columns: the table scrolls sideways inside its box on narrower screens (data-scroll-x, D-261). */}
      <div className="hidden rounded-md border md:block" data-scroll-x>
        <Table aria-label={label}>
          <TableHeader>
            <TableRow>
              {columns.map((c) => {
                const active = sort?.key === c.key;
                const Icon = active ? (sort.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
                return (
                  <TableHead key={c.key} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined} className={c.numeric ? 'text-right' : undefined}>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded-sm font-medium hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                      onClick={() => toggle(c.key, c.numeric)}
                    >
                      {c.header}
                      <Icon className={active ? 'size-3.5' : 'size-3.5 opacity-40'} aria-hidden="true" />
                    </button>
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((row) => (
              <TableRow key={rowKey(row)} data-testid={`${testId}-row`}>
                {columns.map((c) => (
                  <TableCell key={c.key} className={c.numeric ? 'text-right tabular-nums' : 'whitespace-normal'}>
                    {c.cell(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="grid grid-cols-1 gap-2 md:hidden">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Sort by
          <select
            className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-foreground"
            value={sort ? `${sort.key}:${sort.dir}` : ''}
            onChange={(e) => {
              const [key, dir] = e.target.value.split(':') as [string, SortDir];
              setSort(key ? { key, dir } : null);
            }}
          >
            <option value="">Name</option>
            {columns.flatMap((c) => [
              <option key={`${c.key}:asc`} value={`${c.key}:asc`}>{`${c.header} ↑`}</option>,
              <option key={`${c.key}:desc`} value={`${c.key}:desc`}>{`${c.header} ↓`}</option>,
            ])}
          </select>
        </label>
        <ul className="grid grid-cols-1 gap-2">
          {sorted.map((row) => (
            <li key={rowKey(row)} className="rounded-md border p-3" data-testid={`${testId}-card`}>
              <div className="font-medium break-words">{first?.cell(row)}</div>
              <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-sm min-[420px]:grid-cols-2">
                {rest.map((c) => (
                  <div key={c.key} className="flex min-w-0 justify-between gap-2">
                    <dt className="truncate text-muted-foreground">{c.header}</dt>
                    <dd className="tabular-nums">{c.cell(row)}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
