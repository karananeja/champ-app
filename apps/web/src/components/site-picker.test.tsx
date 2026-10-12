import { useState } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GeoResultDto } from '@champ/shared';
import { callsTo, json, mockApi } from '@/test/fixtures';
import { GEOCODER_UNAVAILABLE_MESSAGE, SitePicker, type SitePickerValue } from './site-picker';

vi.mock('@/components/map/pin-map', async () => ({ PinMap: (await import('@/test/fake-pin-map')).FakePinMap }));

const mgRoad: GeoResultDto = {
  displayName: 'MG Road, Bengaluru, Karnataka, 560001, India',
  lat: 12.975,
  lng: 77.606,
  city: 'Bengaluru',
  state: 'Karnataka',
  suggestedLocationId: 'loc-blr',
};

const reversed: GeoResultDto = {
  displayName: 'Cubbon Park, Bengaluru, Karnataka, India',
  lat: 12.9716,
  lng: 77.5946,
  city: 'Bengaluru',
  state: 'Karnataka',
  suggestedLocationId: 'loc-blr',
};

const unavailable = () =>
  json({ error: { code: 'GEOCODER_UNAVAILABLE', message: GEOCODER_UNAVAILABLE_MESSAGE } }, 503);

function renderPicker(initial: SitePickerValue = { address: '', lat: null, lng: null }) {
  const onSuggest = vi.fn();
  function Harness() {
    const [value, setValue] = useState(initial);
    return <SitePicker id="site" value={value} onChange={setValue} onSuggestLocation={onSuggest} />;
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
  return { onSuggest };
}

const slow = { timeout: 3000 };

describe('SitePicker', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('picking a search result sets the pin, address and suggested city (search is debounced)', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({ 'GET /api/geo/search': { items: [mgRoad] } });
    const { onSuggest } = renderPicker();
    expect(screen.getByText('No pin yet: search an address, or tap the map.')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Search address'), 'MG Road');
    const option = await screen.findByRole('option', { name: /MG Road, Bengaluru/ }, slow);
    // One request for the whole word, not one per keystroke.
    expect(callsTo(fetchMock, 'GET', '/api/geo/search')).toHaveLength(1);
    expect(fetchMock.mock.calls.find(([url]) => url.startsWith('/api/geo/search'))![0]).toBe('/api/geo/search?q=MG+Road');

    await user.click(option);
    expect(screen.getByLabelText('Address')).toHaveValue(mgRoad.displayName);
    expect(screen.getByTestId('fake-pin')).toHaveTextContent('12.975,77.606');
    expect(screen.getByTestId('site-coords')).toHaveTextContent('Pin: 12.97500, 77.60600');
    expect(onSuggest).toHaveBeenCalledWith('loc-blr');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    // Picking a result does not trigger a reverse lookup.
    expect(callsTo(fetchMock, 'GET', '/api/geo/reverse')).toHaveLength(0);
  });

  it('tapping the map sets the pin, then the reverse lookup fills the address and suggests the city', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({ 'GET /api/geo/reverse': { item: reversed } });
    const { onSuggest } = renderPicker();

    await user.click(screen.getByRole('button', { name: 'Tap map' }));
    expect(screen.getByTestId('fake-pin')).toHaveTextContent('12.9716,77.5946');
    await waitFor(() => expect(screen.getByLabelText('Address')).toHaveValue(reversed.displayName), slow);
    expect(onSuggest).toHaveBeenCalledWith('loc-blr');
    expect(fetchMock.mock.calls.find(([url]) => url.startsWith('/api/geo/reverse'))![0]).toBe(
      '/api/geo/reverse?lat=12.971600&lng=77.594600',
    );
  });

  it('does not overwrite an address typed by hand when the pin moves', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({ 'GET /api/geo/reverse': { item: reversed } });
    const { onSuggest } = renderPicker();

    await user.type(screen.getByLabelText('Address'), 'Gate 3, Plot 7, KIADB');
    await user.click(screen.getByRole('button', { name: 'Tap map' }));
    await waitFor(() => expect(callsTo(fetchMock, 'GET', '/api/geo/reverse')).toHaveLength(1), slow);
    await waitFor(() => expect(onSuggest).toHaveBeenCalledWith('loc-blr'));
    expect(screen.getByLabelText('Address')).toHaveValue('Gate 3, Plot 7, KIADB');
    expect(screen.getByTestId('fake-pin')).toHaveTextContent('12.9716,77.5946');
  });

  it('shows an inline message when the geocoder is unavailable; pin and address still work by hand', async () => {
    const user = userEvent.setup();
    mockApi({ 'GET /api/geo/search': unavailable, 'GET /api/geo/reverse': unavailable });
    renderPicker();

    await user.type(screen.getByLabelText('Search address'), 'MG Road');
    expect(await screen.findByRole('alert', {}, slow)).toHaveTextContent(GEOCODER_UNAVAILABLE_MESSAGE);

    await user.click(screen.getByRole('button', { name: 'Tap map' }));
    await user.type(screen.getByLabelText('Address'), 'Plot 7, Hosur Road');
    expect(screen.getByLabelText('Address')).toHaveValue('Plot 7, Hosur Road');
    expect(screen.getByTestId('site-coords')).toHaveTextContent('Pin: 12.97160, 77.59460');
    expect(screen.getByRole('alert')).toHaveTextContent(GEOCODER_UNAVAILABLE_MESSAGE);
  });

  it('a failed reverse lookup alone also shows the message', async () => {
    const user = userEvent.setup();
    mockApi({ 'GET /api/geo/reverse': unavailable });
    renderPicker();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Tap map' }));
    expect(await screen.findByRole('alert', {}, slow)).toHaveTextContent(GEOCODER_UNAVAILABLE_MESSAGE);
  });
});
