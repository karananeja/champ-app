import { BULK_TASK_COLUMNS, toCsv, type BulkCellError } from '@champ/shared';

/** `customer: No active customer "X"` (or just the message for a row-level error). */
export const describeCellError = (e: BulkCellError) => (e.column ? `${e.column}: ${e.message}` : e.message);

/** The rows to fix as CSV: the original columns plus an `errors` column, ready to correct and re-upload. */
export function errorRowsCsv(rows: { data: Record<string, string>; errors: BulkCellError[] }[]): string {
  return toCsv(
    [...BULK_TASK_COLUMNS, 'errors'],
    rows.map((r) => [...BULK_TASK_COLUMNS.map((c) => r.data[c] ?? ''), r.errors.map(describeCellError).join('; ')]),
  );
}
