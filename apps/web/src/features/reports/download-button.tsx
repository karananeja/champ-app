import { useState, type ReactNode } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { downloadReport, type ReportParams } from './queries';

interface Props {
  path: string;
  query: ReportParams;
  fallbackName: string;
  disabled?: boolean;
  children: ReactNode;
}

/** A report download (CSV/Excel) with a spinner while it runs and a toast on failure. */
export function DownloadButton({ path, query, fallbackName, disabled, children }: Props) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await downloadReport(path, query, fallbackName);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not download the file');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button variant="outline" size="sm" disabled={disabled || busy} onClick={() => void run()}>
      {busy ? <Loader2 className="animate-spin" /> : <Download />} {children}
    </Button>
  );
}
