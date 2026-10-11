import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BulkPreviewResponse } from '@champ/shared';
import { callsTo, json, mockApi } from '@/test/fixtures';
import { BulkUploadPage } from './BulkUploadPage';

const data = (overrides: Record<string, string> = {}) => ({
  customer: 'ZOOM',
  site: 'Bengaluru depot',
  oe_email: 'oe@intellicar.in',
  asset_type: 'Vehicle',
  activity: 'New installation',
  fitment_at: '2026-10-21 10:30',
  vehicle_count: '2',
  ...overrides,
});

const preview: BulkPreviewResponse = {
  rows: [
    { rowNumber: 2, data: data(), errors: [], valid: true },
    {
      rowNumber: 3,
      data: data({ customer: 'Nobody', fitment_at: '21/10/2026' }),
      errors: [
        { column: 'customer', message: 'No active customer "Nobody"' },
        { column: 'fitment_at', message: 'Use YYYY-MM-DD HH:mm (IST), e.g. 2026-10-15 10:30' },
      ],
      valid: false,
    },
    { rowNumber: 4, data: data({ vehicle_count: '5' }), errors: [], valid: true },
  ],
  validCount: 2,
  invalidCount: 1,
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <BulkUploadPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const csv = () => new File(['customer,site\n'], 'tasks.csv', { type: 'text/csv' });

describe('BulkUploadPage', () => {
  let saved: Blob[];
  beforeEach(() => {
    saved = [];
    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        createObjectURL: vi.fn((blob: Blob) => {
          saved.push(blob);
          return 'blob:x';
        }),
        revokeObjectURL: vi.fn(),
      }),
    );
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('previews rows with per-cell errors, imports only the valid ones and offers the error rows', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({
      'POST /api/tasks/bulk/preview': preview,
      'POST /api/tasks/bulk/import': () =>
        json({
          created: [
            { rowNumber: 2, id: 'task-1', omId: 'OM-00001' },
            { rowNumber: 4, id: 'task-2', omId: 'OM-00002' },
          ],
          failed: [],
        }),
    });
    renderPage();
    await user.upload(screen.getByLabelText('Task CSV file'), csv());

    expect(await screen.findByTestId('bulk-summary')).toHaveTextContent('tasks.csv: 2 valid · 1 with errors');
    const table = within(screen.getByRole('table'));
    const rows = table.getAllByTestId('bulk-row');
    expect(rows.map((r) => r.getAttribute('data-valid'))).toEqual(['true', 'false', 'true']);
    const bad = within(rows[1]!);
    const customerCell = bad.getByText('Nobody');
    expect(customerCell).toHaveAttribute('title', 'No active customer "Nobody"');
    expect(customerCell).toHaveAttribute('data-invalid', 'true');
    expect(bad.getByText('21/10/2026')).toHaveAttribute('title', 'Use YYYY-MM-DD HH:mm (IST), e.g. 2026-10-15 10:30');
    expect(rows[1]).toHaveTextContent('customer: No active customer "Nobody"');
    expect(within(rows[0]!).getByLabelText('Valid')).toBeInTheDocument();
    expect(within(rows[1]!).getByLabelText('Has errors')).toBeInTheDocument();
    // Cards for phones carry the same information.
    expect(screen.getAllByTestId('bulk-card').map((c) => c.getAttribute('data-valid'))).toEqual(['true', 'false', 'true']);

    // The file went up as multipart "file".
    const form = fetchMock.mock.calls.find(([url]) => url === '/api/tasks/bulk/preview')![1]!.body as FormData;
    expect((form.get('file') as File).name).toBe('tasks.csv');

    // Error rows download: original columns plus an errors column.
    await user.click(screen.getByRole('button', { name: 'Download error rows (CSV)' }));
    const text = await saved.at(-1)!.text();
    const [header, line] = text.replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(header).toBe(
      'customer,site,oe_email,technician_email,technician_type,asset_type,activity,device_type,vehicle_make,vehicle_model,installation_type,requested_fitment_at,fitment_at,shift_type,vehicle_count,issue_reported,poc_name,poc_phone,poc_email,gps_address,comments,errors',
    );
    expect(line).toContain('Nobody,Bengaluru depot');
    expect(line).toContain('"customer: No active customer ""Nobody""; fitment_at: Use YYYY-MM-DD HH:mm (IST), e.g. 2026-10-15 10:30"');

    await user.click(screen.getByRole('button', { name: 'Import 2 valid rows' }));
    expect(await screen.findByTestId('bulk-result')).toHaveTextContent('2 task(s) created');
    expect(callsTo(fetchMock, 'POST', '/api/tasks/bulk/import')).toEqual([
      { rows: [{ rowNumber: 2, data: preview.rows[0]!.data }, { rowNumber: 4, data: preview.rows[2]!.data }] },
    ]);
    expect(screen.getByRole('link', { name: 'OM-00001' })).toHaveAttribute('href', '/tasks/task-1');
    expect(screen.queryByRole('button', { name: /^Import/ })).not.toBeInTheDocument();
  });

  it('shows a file-level error from the server', async () => {
    const user = userEvent.setup();
    mockApi({
      'POST /api/tasks/bulk/preview': () =>
        json({ error: { code: 'VALIDATION_ERROR', message: 'Missing column(s): fitment_at. Download the sample for the format.' } }, 400),
    });
    renderPage();
    await user.upload(screen.getByLabelText('Task CSV file'), csv());
    expect(await screen.findByRole('alert')).toHaveTextContent('Missing column(s): fitment_at');
    expect(screen.queryByTestId('bulk-summary')).not.toBeInTheDocument();
  });

  it('downloads the sample from the API', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({
      'GET /api/tasks/bulk/sample': () =>
        new Response('customer,site\r\n', { headers: { 'Content-Disposition': 'attachment; filename=champ-bulk-tasks-sample.csv' } }),
    });
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Download sample CSV' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(await saved[0]!.text()).toBe('customer,site\r\n');
    expect(fetchMock).toHaveBeenCalledWith('/api/tasks/bulk/sample', expect.anything());
  });
});
