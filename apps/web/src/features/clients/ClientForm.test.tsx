import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientDto } from '@champ/shared';
import { callsTo, json, mockApi } from '@/test/fixtures';
import { ClientForm } from './ClientFormPage';

vi.mock('@/components/map/PinMap', async () => ({ PinMap: (await import('@/test/FakePinMap')).FakePinMap }));

const savedClient: ClientDto = {
  id: 'cl-1',
  name: 'Zoomcar',
  code: 'ZOOM',
  contactName: 'Priya Rao',
  contactPhone: '+91 98765 43210',
  contactEmail: null,
  billingEmail: null,
  notes: null,
  active: true,
  siteCount: 1,
  activeSiteCount: 1,
  createdBy: { id: 'om-1', name: 'Maya' },
  createdAt: '2026-10-11T00:00:00.000Z',
  updatedAt: '2026-10-11T00:00:00.000Z',
  sites: [
    {
      id: 'site-1',
      clientId: 'cl-1',
      name: 'Bengaluru depot',
      address: 'Cubbon Park, Bengaluru',
      lat: 12.9716,
      lng: 77.5946,
      locationId: 'loc-blr',
      location: { id: 'loc-blr', city: 'Bengaluru', state: 'Karnataka', active: true },
      contactName: null,
      contactPhone: null,
      active: true,
      createdAt: '2026-10-11T00:00:00.000Z',
      updatedAt: '2026-10-11T00:00:00.000Z',
    },
  ],
};

function renderForm(client?: ClientDto, entry = client ? `/clients/${client.id}/edit` : '/clients/new') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/clients/new" element={<ClientForm />} />
          <Route path="/clients/:id/edit" element={<ClientForm client={client} />} />
          <Route path="/clients/:id" element={<p>Client detail page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function fillClientFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Client name'), 'Zoomcar');
  await user.type(screen.getByLabelText('Short code (optional)'), 'zoom');
  await user.type(screen.getByLabelText('Contact name'), 'Priya Rao');
  await user.type(screen.getByLabelText('Contact phone'), '+91 98765 43210');
}

describe('ClientForm — create', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('validates client and site fields without calling the API', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({});
    renderForm();
    await user.click(screen.getByRole('button', { name: 'Create client' }));

    expect(await screen.findByText('Client name is required')).toBeInTheDocument();
    expect(screen.getByText('Contact name is required')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid phone number')).toBeInTheDocument();
    const card = screen.getByTestId('site-card');
    expect(within(card).getByText('Site name is required')).toBeInTheDocument();
    expect(within(card).getByText('Place the pin on the map')).toBeInTheDocument();
    expect(within(card).getByText('Address is required')).toBeInTheDocument();
    expect(within(card).getByText('Choose a city')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', '/api/clients')).toHaveLength(0);
  });

  it('requires at least one site', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({});
    renderForm();
    await fillClientFields(user);
    await user.click(screen.getByRole('button', { name: 'Remove Site 1' }));
    expect(screen.queryByTestId('site-card')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create client' }));
    expect(await screen.findByText('Add at least one site')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', '/api/clients')).toHaveLength(0);

    // Adding a site back opens a fresh site card.
    await user.click(screen.getByRole('button', { name: 'Add site' }));
    expect(screen.getByTestId('site-card')).toBeInTheDocument();
    expect(screen.getByLabelText('Site name')).toBeInTheDocument();
  });

  it('creates a client with a site placed by tapping the map; the city is suggested', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({
      'GET /api/geo/reverse': {
        item: { displayName: 'Cubbon Park, Bengaluru', lat: 12.9716, lng: 77.5946, suggestedLocationId: 'loc-blr' },
      },
      'POST /api/clients': savedClient,
    });
    renderForm();
    await fillClientFields(user);
    await user.type(screen.getByLabelText('Site name'), 'Bengaluru depot');
    await user.click(screen.getByRole('button', { name: 'Tap map' }));
    await waitFor(() => expect(screen.getByLabelText('Address')).toHaveValue('Cubbon Park, Bengaluru'), { timeout: 3000 });
    expect(screen.getByRole('combobox', { name: 'City' })).toHaveTextContent('Bengaluru, Karnataka');

    await user.click(screen.getByRole('button', { name: 'Create client' }));
    expect(await screen.findByText('Client detail page')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', '/api/clients')).toEqual([
      {
        name: 'Zoomcar',
        code: 'zoom',
        contactName: 'Priya Rao',
        contactPhone: '+91 98765 43210',
        contactEmail: '',
        billingEmail: '',
        notes: '',
        sites: [
          {
            name: 'Bengaluru depot',
            address: 'Cubbon Park, Bengaluru',
            lat: 12.9716,
            lng: 77.5946,
            locationId: 'loc-blr',
            contactName: '',
            contactPhone: '',
          },
        ],
      },
    ]);
  });

  it('shows a duplicate name from the server on the name field', async () => {
    const user = userEvent.setup();
    const message = 'A client named "Zoomcar" already exists';
    mockApi({
      'GET /api/geo/reverse': { item: null },
      'POST /api/clients': () =>
        json({ error: { code: 'DUPLICATE', message, details: { fieldErrors: { name: [message] } } } }, 409),
    });
    renderForm();
    await fillClientFields(user);
    await user.type(screen.getByLabelText('Site name'), 'Depot');
    await user.click(screen.getByRole('button', { name: 'Tap map' }));
    await user.type(screen.getByLabelText('Address'), 'Plot 7');
    await user.click(screen.getByRole('combobox', { name: 'City' }));
    await user.click(await screen.findByRole('option', { name: /Pune, Maharashtra/ }));
    await user.click(screen.getByRole('button', { name: 'Create client' }));
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByLabelText('Client name')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('ClientForm — edit', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('adds a new site with POST and leaves unchanged sites and client fields alone', async () => {
    const user = userEvent.setup();
    const fetchMock = mockApi({
      'POST /api/clients/cl-1/sites': { ...savedClient.sites[0], id: 'site-2', name: 'Pune yard' },
    });
    renderForm(savedClient, '/clients/cl-1/edit?add=site');

    const cards = screen.getAllByTestId('site-card');
    expect(cards).toHaveLength(2);
    // The existing site is collapsed; the new one is open.
    const fresh = cards[1]!;
    await user.type(within(fresh).getByLabelText('Site name'), 'Pune yard');
    await user.click(within(fresh).getByRole('button', { name: 'Tap map' }));
    await user.type(within(fresh).getByLabelText('Address'), 'Hinjewadi');
    await user.click(within(fresh).getByRole('combobox', { name: 'City' }));
    await user.click(await screen.findByRole('option', { name: /Pune, Maharashtra/ }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Client detail page')).toBeInTheDocument();
    expect(callsTo(fetchMock, 'POST', '/api/clients/cl-1/sites')).toEqual([
      expect.objectContaining({ name: 'Pune yard', address: 'Hinjewadi', locationId: 'loc-pune', lat: 12.9716 }),
    ]);
    expect(callsTo(fetchMock, 'PATCH', '/api/clients/cl-1')).toHaveLength(0);
    expect(callsTo(fetchMock, 'PATCH', '/api/clients/cl-1/sites/site-1')).toHaveLength(0);
  });
});
