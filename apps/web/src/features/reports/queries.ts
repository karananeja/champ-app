import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { AnalyticsResponse, BillingReportResponse } from '@champ/shared';
import { api, apiDownload } from '@/lib/api';
import { saveBlob } from '@/lib/download';

/** Query string of a report request; empty values are left out. */
export type ReportParams = Record<string, string | undefined>;

export const reportsKeys = {
  billing: (query: ReportParams) => ['reports', 'billing', query] as const,
  analytics: (query: ReportParams) => ['reports', 'analytics', query] as const,
};

export function useBillingReport(query: ReportParams) {
  return useQuery({
    queryKey: reportsKeys.billing(query),
    queryFn: () => api<BillingReportResponse>('/reports/billing', { query }),
    placeholderData: keepPreviousData,
  });
}

export function useAnalytics(query: ReportParams, enabled = true) {
  return useQuery({
    queryKey: reportsKeys.analytics(query),
    queryFn: () => api<AnalyticsResponse>('/reports/analytics', { query }),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** Downloads a report file (CSV/Excel) with the server's file name, else `fallback`. */
export async function downloadReport(path: string, query: ReportParams, fallback: string) {
  const { blob, filename } = await apiDownload(path, query);
  saveBlob(blob, filename ?? fallback);
}
