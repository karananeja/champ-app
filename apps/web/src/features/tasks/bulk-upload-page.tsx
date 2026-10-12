import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { CheckCircle2, Download, FileWarning, Loader2, RotateCcw, Upload, XCircle } from 'lucide-react';
import {
  BULK_MAX_ROWS,
  type BulkImportResponse,
  type BulkPreviewResponse,
  type BulkPreviewRow,
  type BulkTaskColumn,
} from '@champ/shared';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ApiError } from '@/lib/api';
import { saveText } from '@/lib/download';
import { cn } from '@/lib/utils';
import { describeCellError as describe, errorRowsCsv } from './bulk-csv';
import { downloadBulkSample, previewBulk, useImportBulk } from './queries';
import { PageHeader } from '@/components/page-header';

/** The preview columns shown in the table (every column's errors are listed under Problems). */
const SHOWN: { column: BulkTaskColumn; label: string }[] = [
  { column: 'customer', label: 'Customer' },
  { column: 'site', label: 'Site' },
  { column: 'asset_type', label: 'Asset type' },
  { column: 'activity', label: 'Activity' },
  { column: 'fitment_at', label: 'Fitment (IST)' },
  { column: 'vehicle_count', label: 'Vehicles' },
];


/** `/tasks/bulk`: sample → upload → preview (per-cell errors) → import the valid rows → results. */
export function BulkUploadPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<BulkPreviewResponse | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkImportResponse | null>(null);
  const [sampleLoading, setSampleLoading] = useState(false);
  const importBulk = useImportBulk();

  const reset = () => {
    setFileName(null);
    setPreview(null);
    setUploadError(null);
    setResult(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setPreview(null);
    setResult(null);
    setUploadError(null);
    setUploading(true);
    try {
      setPreview(await previewBulk(file));
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : 'Could not read the file');
    } finally {
      setUploading(false);
    }
  };

  const onSample = async () => {
    setSampleLoading(true);
    try {
      await downloadBulkSample();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not download the sample');
    } finally {
      setSampleLoading(false);
    }
  };

  const validRows = preview?.rows.filter((r) => r.valid) ?? [];
  const onImport = () =>
    importBulk.mutate(
      { rows: validRows.map(({ rowNumber, data }) => ({ rowNumber, data })) },
      {
        onSuccess: (res) => {
          setResult(res);
          if (res.created.length) toast.success(`Imported ${res.created.length} task(s)`);
        },
        onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Could not import'),
      },
    );

  // Rows to fix: invalid in the preview, plus rows the import rejected.
  const byNumber = new Map(preview?.rows.map((r) => [r.rowNumber, r]));
  const errorRows = [
    ...(preview?.rows.filter((r) => !r.valid) ?? []),
    ...(result?.failed.map((f) => ({ ...byNumber.get(f.rowNumber)!, errors: f.errors })) ?? []),
  ].sort((a, b) => a.rowNumber - b.rowNumber);

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader
        icon={Upload}
        title="Bulk upload"
        description={
          <>
            Create many tasks from one CSV: one row per task, with the number of vehicles in <code>vehicle_count</code>.
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>1. Get the sample</CardTitle>
          <CardDescription>
            Every create-form field is a column. Use customer code or name, site name, OE/technician emails and the
            master names; dates are <code>YYYY-MM-DD HH:mm</code> in IST.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => void onSample()} disabled={sampleLoading}>
            {sampleLoading ? <Loader2 className="animate-spin" /> : <Download />} Download sample CSV
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Upload your file</CardTitle>
          <CardDescription>CSV, up to 2 MB and {BULK_MAX_ROWS} rows. Nothing is created until you import.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:max-w-sm">
              <Label htmlFor="bulk-file">Task CSV file</Label>
              <Input
                ref={inputRef}
                id="bulk-file"
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
            </div>
            {(preview || uploadError) && (
              <Button variant="ghost" onClick={reset}>
                <RotateCcw /> Start over
              </Button>
            )}
          </div>
          {uploading && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Checking {fileName}…
            </p>
          )}
          {uploadError && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{uploadError}</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {preview && (
        <Card>
          <CardHeader>
            <CardTitle>3. Check and import</CardTitle>
            <CardDescription data-testid="bulk-summary">
              {fileName}: {preview.validCount} valid · {preview.invalidCount} with errors
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4">
            <PreviewTable rows={preview.rows} />
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              {!result && (
                <Button onClick={onImport} disabled={validRows.length === 0 || importBulk.isPending}>
                  {importBulk.isPending ? <Loader2 className="animate-spin" /> : <Upload />} Import {validRows.length} valid
                  row{validRows.length === 1 ? '' : 's'}
                </Button>
              )}
              {errorRows.length > 0 && (
                <Button variant="outline" onClick={() => saveText(errorRowsCsv(errorRows), 'champ-bulk-tasks-errors.csv')}>
                  <FileWarning /> Download error rows (CSV)
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {result && (
        <Card data-testid="bulk-result">
          <CardHeader>
            <CardTitle>Import result</CardTitle>
            <CardDescription>
              {result.created.length} task(s) created
              {result.failed.length > 0 && ` · ${result.failed.length} row(s) could not be imported`}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 text-sm">
            {result.created.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {result.created.map((c) => (
                  <li key={c.id}>
                    <Link to={`/tasks/${c.id}`} className="font-mono underline">
                      {c.omId}
                    </Link>
                    <span className="text-muted-foreground"> (row {c.rowNumber})</span>
                  </li>
                ))}
              </ul>
            )}
            {result.failed.map((f) => (
              <p key={f.rowNumber} className="text-destructive">
                Row {f.rowNumber}: {f.errors.map(describe).join('; ')}
              </p>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PreviewTable({ rows }: { rows: BulkPreviewRow[] }) {
  const errorOf = (row: BulkPreviewRow, column: BulkTaskColumn) =>
    row.errors.filter((e) => e.column === column).map((e) => e.message).join('; ') || undefined;
  const statusIcon = (row: BulkPreviewRow) =>
    row.valid ? (
      <CheckCircle2 className="size-4 text-emerald-600" aria-label="Valid" />
    ) : (
      <XCircle className="size-4 text-destructive" aria-label="Has errors" />
    );

  return (
    <>
      <div className="hidden overflow-x-auto rounded-md border md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Row</TableHead>
              <TableHead>
                <span className="sr-only">Status</span>
              </TableHead>
              {SHOWN.map((c) => (
                <TableHead key={c.column}>{c.label}</TableHead>
              ))}
              <TableHead>Problems</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={row.rowNumber}
                data-testid="bulk-row"
                data-valid={row.valid}
                className={cn(!row.valid && 'bg-destructive/5')}
              >
                <TableCell>{row.rowNumber}</TableCell>
                <TableCell>{statusIcon(row)}</TableCell>
                {SHOWN.map(({ column }) => {
                  const message = errorOf(row, column);
                  return (
                    <TableCell
                      key={column}
                      title={message}
                      data-invalid={!!message || undefined}
                      className={cn('whitespace-normal', message && 'font-medium text-destructive underline decoration-dotted')}
                    >
                      {row.data[column] || '—'}
                    </TableCell>
                  );
                })}
                <TableCell className="text-xs whitespace-normal text-destructive">
                  {row.errors.map((e) => (
                    <div key={`${e.column}-${e.message}`}>{describe(e)}</div>
                  ))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ul className="grid grid-cols-1 gap-2 md:hidden">
        {rows.map((row) => (
          <li
            key={row.rowNumber}
            data-testid="bulk-card"
            data-valid={row.valid}
            className={cn('rounded-md border p-3 text-sm', !row.valid && 'border-destructive/50 bg-destructive/5')}
          >
            <div className="flex items-center gap-2 font-medium">
              {statusIcon(row)} Row {row.rowNumber}
            </div>
            <div className="mt-1 break-words">
              {row.data.customer || '—'} · {row.data.site || '—'}
            </div>
            <div className="break-words text-muted-foreground">
              {row.data.activity || '—'} ({row.data.asset_type || '—'}) · {row.data.vehicle_count || '—'} vehicle(s) ·{' '}
              {row.data.fitment_at || '—'}
            </div>
            {row.errors.map((e) => (
              <div key={`${e.column}-${e.message}`} className="mt-1 text-xs break-words text-destructive">
                {describe(e)}
              </div>
            ))}
          </li>
        ))}
      </ul>
    </>
  );
}
