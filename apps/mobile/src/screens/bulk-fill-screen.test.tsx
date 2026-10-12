import type { BulkFillPreviewResponse, BulkFillTaskDto } from '@champ/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as Location from 'expo-location';
import { useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { makeBulkTask, makePreview } from '../test/bulk-fixtures';
import { jsonBody, mockFetch, renderWithProviders, router } from '../test/utils';
import { BulkFillScreen } from './bulk-fill-screen';
import { LOCATION_DENIED_MESSAGE } from './fitment-screen';

const requestPermission = Location.requestForegroundPermissionsAsync as jest.Mock;
const getPosition = Location.getCurrentPositionAsync as jest.Mock;
const params = useLocalSearchParams as jest.Mock;
const getDocument = DocumentPicker.getDocumentAsync as jest.Mock;
const shareAsync = Sharing.shareAsync as jest.Mock;
const isAvailable = Sharing.isAvailableAsync as jest.Mock;
const files = (jest.requireMock('expo-file-system') as { __files: Set<string> }).__files;

const BASE = '/api/mobile/tasks/t1';

function serve(opts: { task?: BulkFillTaskDto; preview?: BulkFillPreviewResponse } = {}) {
  return mockFetch((url) => {
    switch (url.pathname) {
      case `${BASE}/bulk-fill`:
        return { status: 200, body: opts.task ?? makeBulkTask() };
      case `${BASE}/bulk-fill/sample.csv`:
        return { status: 200, body: 'tk_id' };
      case `${BASE}/bulk-fill/preview`:
        return { status: 200, body: opts.preview ?? makePreview() };
      case `${BASE}/bulk-fill/confirm`:
        return { status: 200, body: { filled: ['TK-00012', 'TK-00014'], started: ['TK-00014'], failed: [{ rowNumber: 3, tkId: 'TK-00014', code: 'ROUTE_ORDER', message: 'Finish TK-00009 first' }] } };
      case `${BASE}/submit-ready`:
        return { status: 200, body: { submitted: ['TK-00012'], incomplete: [{ tkId: 'TK-00013', missing: ['Before photo', 'Device id'] }], skipped: ['TK-00014'] } };
      default:
        return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'nope' } } };
    }
  });
}

const callsTo = (fetchMock: jest.Mock, suffix: string) => fetchMock.mock.calls.filter(([u]) => new URL(String(u)).pathname.endsWith(suffix));

beforeEach(() => {
  jest.clearAllMocks();
  files.clear();
  params.mockReturnValue({ taskId: 't1' });
  requestPermission.mockResolvedValue({ status: 'granted' });
  getPosition.mockResolvedValue({ coords: { latitude: 13.031, longitude: 77.521 } });
  isAvailable.mockResolvedValue(true);
});

async function openPreview(preview?: BulkFillPreviewResponse) {
  const fetchMock = serve({ preview });
  await renderWithProviders(<BulkFillScreen />);
  await fireEvent.press(await screen.findByTestId('upload-csv'));
  await screen.findByTestId('preview-summary');
  return fetchMock;
}

describe('BulkFillScreen', () => {
  it('shows the task, the counts and each fitment with its progress and what is missing', async () => {
    serve();
    await renderWithProviders(<BulkFillScreen />);
    expect(await screen.findByText('OM-00012 · Acme Logistics')).toBeOnTheScreen();
    expect(screen.getByText('Peenya depot')).toBeOnTheScreen();
    expect(screen.getByTestId('counts')).toHaveTextContent('3 fitments · 1 ready to submit');
    expect(screen.getByTestId('progress-f1')).toHaveTextContent('Form ✓ · Photos 4 of 4 · Ready to submit');
    expect(screen.getByTestId('progress-f2')).toHaveTextContent('Form incomplete · Photos 3 of 4 · In progress');
    expect(screen.getByTestId('progress-f3')).toHaveTextContent('Form incomplete · Photos 0 of 4 · Not started');
    expect(screen.getByTestId('missing-f2')).toHaveTextContent('Missing: Before photo, Device id');
    expect(screen.queryByTestId('missing-f1')).toBeNull();
    expect(within(screen.getByTestId('bulk-row-f3')).getByText('Assigned')).toBeOnTheScreen();
    expect(screen.getByTestId('submit-ready')).toHaveTextContent('Submit ready (1)');

    await fireEvent.press(screen.getByTestId('add-photos'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/task/[taskId]/photos', params: { taskId: 't1' } });
    await fireEvent.press(screen.getByTestId('bulk-row-f2'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/fitment/[id]', params: { id: 'f2' } });
  });

  it('hides Add photos and Submit ready when nothing needs them', async () => {
    const task = makeBulkTask();
    task.fitments = task.fitments.map((r) => ({ ...r, missing: r.fitment.status === 'IN_PROGRESS' ? ['Device id'] : r.missing, missingPhotos: [] }));
    serve({ task });
    await renderWithProviders(<BulkFillScreen />);
    expect(await screen.findByTestId('counts')).toHaveTextContent('3 fitments · 0 ready to submit');
    expect(screen.queryByTestId('add-photos')).toBeNull();
    expect(screen.queryByTestId('submit-ready')).toBeNull();
  });

  it('Download sample CSV fetches it, writes it to the cache and shares it as text/csv', async () => {
    const fetchMock = serve();
    await renderWithProviders(<BulkFillScreen />);
    await fireEvent.press(await screen.findByTestId('download-sample'));
    await waitFor(() => expect(shareAsync).toHaveBeenCalled());
    expect(callsTo(fetchMock, '/sample.csv')).toHaveLength(1);
    expect(files.has('file:///cache/bulk-fill-OM-00012.csv')).toBe(true);
    expect(shareAsync).toHaveBeenCalledWith('file:///cache/bulk-fill-OM-00012.csv', expect.objectContaining({ mimeType: 'text/csv' }));
  });

  it('without a share sheet the sample is saved and its path shown', async () => {
    isAvailable.mockResolvedValue(false);
    serve();
    await renderWithProviders(<BulkFillScreen />);
    await fireEvent.press(await screen.findByTestId('download-sample'));
    expect(await screen.findByText('Saved to file:///cache/bulk-fill-OM-00012.csv')).toBeOnTheScreen();
    expect(shareAsync).not.toHaveBeenCalled();
  });

  it('Upload CSV picks a file, posts it and shows valid and invalid rows with the counts', async () => {
    const fetchMock = await openPreview();
    expect(getDocument).toHaveBeenCalledWith(expect.objectContaining({ type: expect.arrayContaining(['text/csv']), copyToCacheDirectory: true }));
    const [call] = callsTo(fetchMock, '/preview');
    expect(call?.[1]?.method).toBe('POST');
    expect(call?.[1]?.body).toBeInstanceOf(FormData);

    expect(screen.getByTestId('preview-summary')).toHaveTextContent('2 ready, 1 with problems · 1 will be started');
    const ok = within(screen.getByTestId('preview-row-2'));
    expect(ok.getByText('TK-00012')).toBeOnTheScreen();
    expect(ok.getByText('Device id: DEV-1')).toBeOnTheScreen();
    expect(ok.getByText('Asset condition: Not OK')).toBeOnTheScreen();
    expect(screen.getByTestId('will-start-3')).toBeOnTheScreen();
    expect(screen.queryByTestId('will-start-2')).toBeNull();
    const bad = within(screen.getByTestId('preview-row-4'));
    expect(bad.getByText('Row 4 · TK-00099')).toBeOnTheScreen();
    expect(bad.getByText('tk_id: Unknown TK id')).toBeOnTheScreen();
    expect(bad.getByText('can_voltage: Use OK, Not OK or NA')).toBeOnTheScreen();
    expect(screen.getByTestId('confirm')).toHaveTextContent('Confirm (2)');
    expect(screen.getByTestId('confirm')).toBeEnabled();
  });

  it('a cancelled pick sends nothing', async () => {
    getDocument.mockResolvedValueOnce({ canceled: true, assets: null });
    const fetchMock = serve();
    await renderWithProviders(<BulkFillScreen />);
    await fireEvent.press(await screen.findByTestId('upload-csv'));
    await waitFor(() => expect(getDocument).toHaveBeenCalled());
    expect(callsTo(fetchMock, '/preview')).toHaveLength(0);
    expect(screen.queryByTestId('preview-summary')).toBeNull();
  });

  it('Confirm is disabled with no valid rows', async () => {
    const all = makePreview();
    await openPreview({ rows: all.rows.filter((r) => !r.valid), validCount: 0, invalidCount: 1, startCount: 0 });
    expect(screen.getByTestId('confirm')).toHaveTextContent('Confirm (0)');
    expect(screen.getByTestId('confirm')).toBeDisabled();
  });

  it('Confirm with fitments to start gets one fix and sends only the valid rows with it, then shows the result', async () => {
    const fetchMock = await openPreview();
    await fireEvent.press(screen.getByTestId('confirm'));
    expect(await screen.findByTestId('confirm-result')).toBeOnTheScreen();
    expect(getPosition).toHaveBeenCalledTimes(1);
    const [call] = callsTo(fetchMock, '/confirm');
    expect(jsonBody(call?.[1] as RequestInit)).toEqual({
      rows: [
        { rowNumber: 2, tkId: 'TK-00012', form: { deviceId: 'DEV-1', checks: { assetCondition: 'NOT_OK' } } },
        { rowNumber: 3, tkId: 'TK-00014', form: { clusterReadingKm: 120500 } },
      ],
      lat: 13.031,
      lng: 77.521,
    });
    expect(screen.getByTestId('filled-count')).toHaveTextContent('Filled 2 fitments: TK-00012, TK-00014');
    expect(screen.getByText('Started 1 fitment: TK-00014')).toBeOnTheScreen();
    expect(screen.getByText('Row 3 · TK-00014: Finish TK-00009 first')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('confirm-result-done'));
    expect(await screen.findByTestId('counts')).toBeOnTheScreen();
    // The bulk data is refetched after the confirm.
    await waitFor(() => expect(callsTo(fetchMock, '/bulk-fill').length).toBeGreaterThanOrEqual(2));
  });

  it('Confirm with location denied explains why and sends nothing', async () => {
    requestPermission.mockResolvedValue({ status: 'denied' });
    const fetchMock = await openPreview();
    await fireEvent.press(screen.getByTestId('confirm'));
    expect(await screen.findByText(LOCATION_DENIED_MESSAGE)).toBeOnTheScreen();
    expect(callsTo(fetchMock, '/confirm')).toHaveLength(0);
  });

  it('Confirm without fitments to start sends no location', async () => {
    const p = makePreview();
    const fetchMock = await openPreview({ ...p, rows: p.rows.map((r) => ({ ...r, willStart: false })), startCount: 0 });
    expect(screen.getByTestId('preview-summary')).toHaveTextContent(/^2 ready, 1 with problems$/);
    await fireEvent.press(screen.getByTestId('confirm'));
    await screen.findByTestId('confirm-result');
    expect(requestPermission).not.toHaveBeenCalled();
    expect(getPosition).not.toHaveBeenCalled();
    const body = jsonBody(callsTo(fetchMock, '/confirm')[0]?.[1] as RequestInit) as Record<string, unknown>;
    expect(body).not.toHaveProperty('lat');
    expect(body).not.toHaveProperty('lng');
  });

  it('Submit ready asks first, then lists the submitted and the incomplete fitments', async () => {
    const fetchMock = serve();
    await renderWithProviders(<BulkFillScreen />);
    await fireEvent.press(await screen.findByTestId('submit-ready'));
    expect(screen.getByText('Submit 1 fitment?')).toBeOnTheScreen();
    expect(callsTo(fetchMock, '/submit-ready')).toHaveLength(0);
    await fireEvent.press(screen.getByTestId('submit-confirm'));
    expect(await screen.findByTestId('submit-result')).toBeOnTheScreen();
    expect(callsTo(fetchMock, '/submit-ready')[0]?.[1]?.method).toBe('POST');
    expect(screen.getByTestId('submitted-list')).toHaveTextContent('Submitted 1 fitment: TK-00012');
    expect(screen.getByText('TK-00013 — still needed: Before photo, Device id')).toBeOnTheScreen();
  });
});
