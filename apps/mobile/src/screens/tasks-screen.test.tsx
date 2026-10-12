import type { MyFitmentDto } from '@champ/shared';
import { screen, within } from '@testing-library/react-native';
import { mockFetch, renderWithProviders } from '../test/utils';
import { TasksScreen } from './tasks-screen';

const fitment = (over: Partial<MyFitmentDto>): MyFitmentDto => ({
  id: 'f1',
  tkId: 'TK-00012',
  status: 'ASSIGNED',
  fitmentAt: '2026-10-12T04:30:00.000Z',
  customer: 'Acme Logistics',
  site: { name: 'Peenya depot', address: '12 Industrial Rd, Bengaluru', lat: 13.03, lng: 77.52 },
  vehicleRegNo: 'KA01AB1234',
  activity: 'New installation',
  ...over,
});

describe('TasksScreen', () => {
  it('lists my fitments for the header date as cards', async () => {
    const fetchMock = mockFetch((url) => ({
      status: 200,
      body: {
        date: url.searchParams.get('date'),
        items: [fitment({}), fitment({ id: 'f2', tkId: 'TK-00013', status: 'SUBMITTED', vehicleRegNo: null, site: { name: 'Hosur yard', address: null, lat: null, lng: null } })],
      },
    }));
    await renderWithProviders(<TasksScreen />, { date: '2026-10-12' });
    const card = within(await screen.findByTestId('fitment-f1'));
    expect(card.getByText('TK-00012')).toBeOnTheScreen();
    expect(card.getByText('Assigned')).toBeOnTheScreen();
    expect(card.getByText(/10:00\s?am IST/i)).toBeOnTheScreen();
    expect(card.getByText('Acme Logistics')).toBeOnTheScreen();
    expect(card.getByText('Peenya depot')).toBeOnTheScreen();
    expect(card.getByText('12 Industrial Rd, Bengaluru')).toBeOnTheScreen();
    expect(card.getByText(/KA01AB1234 · New installation/)).toBeOnTheScreen();
    const second = within(screen.getByTestId('fitment-f2'));
    expect(second.getByText('Submitted')).toBeOnTheScreen();
    expect(second.getByText(/No vehicle/)).toBeOnTheScreen();
    const url = new URL(fetchMock.mock.calls[0]?.[0] as string);
    expect(url.pathname).toBe('/api/mobile/fitments');
    expect(url.searchParams.get('date')).toBe('2026-10-12');
  });

  it('shows the empty state with an illustration', async () => {
    mockFetch(() => ({ status: 200, body: { date: '2026-10-12', items: [] } }));
    await renderWithProviders(<TasksScreen />, { date: '2026-10-12' });
    expect(await screen.findByText('No tasks')).toBeOnTheScreen();
    expect(screen.getByTestId('illustration-tasks-empty')).toBeOnTheScreen();
  });

  it('shows No connection when offline', async () => {
    mockFetch(() => 'network');
    await renderWithProviders(<TasksScreen />, { date: '2026-10-12' });
    expect(await screen.findByText('No connection')).toBeOnTheScreen();
    expect(screen.getByTestId('illustration-offline')).toBeOnTheScreen();
  });
});
