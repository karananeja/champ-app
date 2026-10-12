import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FitmentPhotosResponse } from '@champ/shared';
import { Toaster } from '@/components/ui/sonner';
import { callsTo, json, makePhoto, mockApi } from '@/test/fixtures';
import { PhotoGallery } from './photo-gallery';
import { DebugPhotoUpload } from './photo-upload';
import { validateImageFile } from './upload-validation';

/** A stand-in for XMLHttpRequest (photo uploads use it for progress): records sends and answers with `respond`. */
function fakeXhr(respond: (url: string, form: FormData) => { status: number; body: unknown }) {
  const sent: { url: string; form: FormData; headers: Record<string, string> }[] = [];
  class FakeXhr {
    status = 0;
    response: unknown = null;
    responseType = '';
    upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private url = '';
    private headers: Record<string, string> = {};
    open(_method: string, url: string) {
      this.url = url;
    }
    setRequestHeader(name: string, value: string) {
      this.headers[name] = value;
    }
    send(form: FormData) {
      sent.push({ url: this.url, form, headers: this.headers });
      this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
      const { status, body } = respond(this.url, form);
      setTimeout(() => {
        this.status = status;
        this.response = body;
        this.onload?.();
      }, 10);
    }
  }
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  return sent;
}

const jpeg = (name = 'fixed.jpg', size = 2048) => new File([new Uint8Array(size)], name, { type: 'image/jpeg' });

function renderGallery(photos: FitmentPhotosResponse, extra: Record<string, unknown> = {}, history?: FitmentPhotosResponse) {
  const fetchMock = mockApi({
    'GET /api/fitments/fit-1/photos': (url: string) => (url.includes('history=true') && history ? history : photos),
    ...extra,
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <PhotoGallery fitmentId="fit-1" />
      <DebugPhotoUpload fitmentId="fit-1" tkId="TK-00001" />
      <Toaster />
    </QueryClientProvider>,
  );
  return fetchMock;
}

const ACTIVE = [
  makePhoto({ id: 'debug', kind: 'DEBUG', source: 'OE', uploadedBy: { id: 'oe-1', name: 'Esha Exec' } }),
  makePhoto({ id: 'after', kind: 'AFTER' }),
  makePhoto({ id: 'before', kind: 'BEFORE' }),
  makePhoto({ id: 'before-2', kind: 'BEFORE', createdAt: '2026-10-12T06:00:00.000Z' }),
];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('photo viewer (F06)', () => {
  it('groups thumbnails by kind in the fixed order, with uploader and IST time; an empty fitment shows EmptyState', async () => {
    renderGallery({ items: ACTIVE, canViewHistory: true, canManage: true });
    const groups = await screen.findAllByTestId('photo-group');
    expect(groups.map((g) => g.querySelector('h3')!.textContent)).toEqual(['Before (2)', 'After (1)', 'Debug image (1)']);
    expect(within(groups[0]!).getByRole('button', { name: 'Open Before photo 1' })).toBeInTheDocument();
    expect(within(groups[0]!).getAllByText('Ravi Kumar · 12 Oct 2026, 10:40')).toHaveLength(2);
    expect(within(groups[2]!).getByRole('img', { name: 'Debug image photo' })).toHaveAttribute('src', ACTIVE[0]!.url);
  });

  it('shows the empty state when there are no photos', async () => {
    renderGallery({ items: [], canViewHistory: false, canManage: false });
    expect(await screen.findByText('No photos yet')).toBeInTheDocument();
    expect(screen.queryByText('Show history')).not.toBeInTheDocument();
  });

  it('opens the lightbox with zoom and the photo caption', async () => {
    const user = userEvent.setup();
    renderGallery({ items: ACTIVE, canViewHistory: false, canManage: false });
    await user.click(await screen.findByRole('button', { name: 'Open After photo' }));
    expect(await screen.findByRole('button', { name: 'Close photo viewer' })).toBeInTheDocument();
    expect(screen.getAllByText(/GPS 12\.97000, 77\.59000/).length).toBeGreaterThan(0);
  });

  it('Replace needs a file and a reason (3+), uploads with the reason, and shows server errors verbatim', async () => {
    const user = userEvent.setup();
    let answer = { status: 400, body: { error: { code: 'UNSUPPORTED_FILE', message: 'Only JPEG, PNG or WebP images can be uploaded' } } as unknown };
    const sent = fakeXhr(() => answer);
    renderGallery({ items: ACTIVE, canViewHistory: true, canManage: true });
    await user.click(await screen.findByRole('button', { name: 'Replace After photo' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Replace photo' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Choose the corrected image');

    await user.upload(within(dialog).getByLabelText('Choose the corrected image'), jpeg());
    await user.type(within(dialog).getByLabelText('Reason'), 'ab');
    await user.click(within(dialog).getByRole('button', { name: 'Replace photo' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Give a reason (at least 3 characters)');
    expect(sent).toHaveLength(0);

    await user.type(within(dialog).getByLabelText('Reason'), 'c blurry');
    await user.click(within(dialog).getByRole('button', { name: 'Replace photo' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Only JPEG, PNG or WebP images can be uploaded');
    expect(sent[0]!.url).toBe('/api/fitments/fit-1/photos/after/replace');
    expect(sent[0]!.form.get('reason')).toBe('abc blurry');
    expect((sent[0]!.form.get('file') as File).name).toBe('fixed.jpg');

    answer = { status: 201, body: { photo: makePhoto({ id: 'after-2', kind: 'AFTER' }) } };
    await user.click(within(dialog).getByRole('button', { name: 'Replace photo' }));
    expect(await screen.findByText('After photo replaced')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('Remove asks for a reason and posts it', async () => {
    const user = userEvent.setup();
    const fetchMock = renderGallery({ items: ACTIVE, canViewHistory: true, canManage: true }, {
      'POST /api/fitments/fit-1/photos/debug/remove': () => new Response(null, { status: 204 }),
    });
    await user.click(await screen.findByRole('button', { name: 'Remove Debug image photo' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Remove photo' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Give a reason');
    await user.type(within(dialog).getByLabelText('Reason'), 'Wrong vehicle');
    await user.click(within(dialog).getByRole('button', { name: 'Remove photo' }));
    await waitFor(() => expect(callsTo(fetchMock, 'POST', '/api/fitments/fit-1/photos/debug/remove')).toEqual([{ reason: 'Wrong vehicle' }]));
    expect(await screen.findByText('Debug image photo removed')).toBeInTheDocument();
  });

  it('managers only: no Replace/Remove without canManage', async () => {
    renderGallery({ items: ACTIVE, canViewHistory: false, canManage: false });
    await screen.findAllByTestId('photo-group');
    expect(screen.queryByRole('button', { name: /^Replace/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
  });

  it('"Show history" reveals replaced and removed photos, greyed with who, when and why', async () => {
    const user = userEvent.setup();
    const replaced = makePhoto({
      id: 'old-before',
      kind: 'BEFORE',
      status: 'REPLACED',
      replacedById: 'before',
      changeReason: 'Blurry',
      changedBy: { id: 'oe-2', name: 'Suraj' },
      changedAt: '2026-10-12T05:10:00.000Z',
    });
    const fetchMock = renderGallery({ items: ACTIVE, canViewHistory: true, canManage: true }, {}, { items: [replaced, ...ACTIVE], canViewHistory: true, canManage: true });
    await screen.findAllByTestId('photo-group');
    expect(screen.queryByTestId('photo-change')).not.toBeInTheDocument();
    await user.click(screen.getByRole('switch', { name: 'Show history' }));
    const badge = await screen.findByTestId('photo-change');
    expect(badge).toHaveTextContent('Replaced by Suraj · 12 Oct 2026, 10:40 · Blurry');
    const item = badge.closest('[data-testid="photo-item"]')!;
    expect(item).toHaveAttribute('data-status', 'REPLACED');
    expect(within(item as HTMLElement).getByRole('img')).toHaveClass('grayscale');
    expect(within(item as HTMLElement).queryByRole('button', { name: /^Replace/ })).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => (url as string).includes('history=true'))).toBe(true);
  });
});

describe('upload validation (F06)', () => {
  it('accepts JPEG, PNG and WebP up to 10 MB', () => {
    expect(validateImageFile({ type: 'image/jpeg', size: 1000 })).toBeNull();
    expect(validateImageFile({ type: 'image/png', size: 1000 })).toBeNull();
    expect(validateImageFile({ type: 'image/webp', size: 10 * 1024 * 1024 })).toBeNull();
    expect(validateImageFile({ type: 'image/gif', size: 1000 })).toBe('Only JPEG, PNG or WebP images can be uploaded');
    expect(validateImageFile({ type: 'application/pdf', size: 1000 })).toBe('Only JPEG, PNG or WebP images can be uploaded');
    expect(validateImageFile({ type: 'image/jpeg', size: 10 * 1024 * 1024 + 1 })).toBe('The image must be 10 MB or smaller');
    expect(validateImageFile({ type: 'image/jpeg', size: 0 })).toBe('The file is empty');
  });

  it('debug upload: refuses a non-image before sending; sends a valid one with progress and shows the server message verbatim', async () => {
    const user = userEvent.setup({ applyAccept: false });
    const sent = fakeXhr(() => ({ status: 400, body: { error: { code: 'UNSUPPORTED_FILE', message: 'Only JPEG, PNG or WebP images can be uploaded' } } }));
    renderGallery({ items: [], canViewHistory: false, canManage: true });
    const input = await screen.findByLabelText('Upload a debug image');
    await user.upload(input, new File(['%PDF'], 'notes.pdf', { type: 'application/pdf' }));
    expect(screen.getByTestId('upload-error')).toHaveTextContent('Only JPEG, PNG or WebP images can be uploaded');
    await user.upload(input, jpeg('huge.jpg', 10 * 1024 * 1024 + 1));
    expect(screen.getByTestId('upload-error')).toHaveTextContent('The image must be 10 MB or smaller');
    expect(sent).toHaveLength(0);

    await user.upload(input, jpeg('fake.jpg'));
    expect(await screen.findByTestId('upload-progress')).toHaveTextContent('50%');
    expect(await screen.findByTestId('upload-error')).toHaveTextContent('Only JPEG, PNG or WebP images can be uploaded');
    expect(sent[0]!.url).toBe('/api/fitments/fit-1/photos');
    expect(sent[0]!.form.get('kind')).toBe('DEBUG');
  });

  it('a successful debug upload refreshes the photos', async () => {
    const user = userEvent.setup();
    fakeXhr(() => ({ status: 201, body: { photo: makePhoto({ id: 'new', kind: 'DEBUG' }) } }));
    const fetchMock = renderGallery({ items: [], canViewHistory: false, canManage: true }, { 'GET /api/tasks/task-1': json({}) });
    await screen.findByText('No photos yet');
    const before = fetchMock.mock.calls.length;
    await user.upload(screen.getByLabelText('Upload a debug image'), jpeg('debug.jpg'));
    expect(await screen.findByText('Debug image added to TK-00001')).toBeInTheDocument();
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(before));
  });
});
