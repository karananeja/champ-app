import { EMPTY_FITMENT_FORM, type FitmentPhotoDto, type MyFitmentDto } from '@champ/shared';
import { fireEvent, screen } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import { makeFitment } from '../test/route-fixtures';
import { mockFetch, renderWithProviders, router } from '../test/utils';
import { FitmentSummaryScreen, VERIFIED_READ_ONLY } from './fitment-summary-screen';

const params = useLocalSearchParams as jest.Mock;

const submitted = (over: Partial<MyFitmentDto> = {}) =>
  makeFitment({
    status: 'SUBMITTED',
    availableActions: [],
    startedAt: '2026-10-12T05:00:00.000Z',
    submittedAt: '2026-10-12T06:34:00.000Z',
    form: {
      ...EMPTY_FITMENT_FORM,
      vehicleRegNo: 'KA01AB1234',
      chassisNo: 'MA1CH4551',
      clusterReadingKm: 120_450,
      deviceReplacement: 'SIM',
      deviceId: 'DEV123456',
      secondaryDeviceId: 'SEC77',
      checks: { assetCondition: 'OK', accessories: 'NA', batteryCondition: 'OK', clusterMeter: 'OK', canVoltage: 'NOT_OK' },
      comments: 'CAN wire re-crimped',
    },
    photos: (['BEFORE', 'ASSET', 'PLACEMENT'] as const).map((kind) => ({ id: `p-${kind}`, kind, url: `https://img/${kind}.jpg` }) as FitmentPhotoDto),
    ...over,
  });

beforeEach(() => {
  jest.clearAllMocks();
  params.mockReturnValue({ id: 'f1' });
});

describe('FitmentSummaryScreen', () => {
  it('shows the status, times, every answer, photos and comments; Edit opens the form', async () => {
    mockFetch(() => ({ status: 200, body: submitted() }));
    await renderWithProviders(<FitmentSummaryScreen />);
    expect(await screen.findByText('Submitted')).toBeOnTheScreen();
    expect(screen.getByTestId('started-at')).toHaveTextContent(/12 Oct.*10:30\s?am IST/i);
    expect(screen.getByTestId('submitted-at')).toHaveTextContent(/12 Oct.*12:04\s?pm IST/i);
    expect(screen.getByTestId('summary-check-canVoltage')).toHaveTextContent('Not OK');
    expect(screen.getByTestId('summary-check-accessories')).toHaveTextContent('Not applicable');
    expect(screen.getByTestId('summary-vehicleRegNo')).toHaveTextContent('KA01AB1234');
    expect(screen.getByTestId('summary-chassisNo')).toHaveTextContent('MA1CH4551');
    expect(screen.getByTestId('summary-clusterReadingKm')).toHaveTextContent('1,20,450 km');
    expect(screen.getByTestId('summary-deviceReplacement')).toHaveTextContent('SIM');
    expect(screen.getByTestId('summary-deviceId')).toHaveTextContent('DEV123456');
    expect(screen.getByTestId('summary-secondaryDeviceId')).toHaveTextContent('SEC77');
    expect(screen.getByTestId('summary-comments')).toHaveTextContent('CAN wire re-crimped');
    expect(screen.getByText('SIM placement photo')).toBeOnTheScreen();
    expect(screen.getByTestId('thumb-BEFORE')).toBeOnTheScreen();
    expect(screen.queryByTestId('thumb-AFTER')).toBeNull();
    expect(screen.queryByText(VERIFIED_READ_ONLY)).toBeNull();

    await fireEvent.press(screen.getByTestId('edit'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/fitment/[id]/continue', params: { id: 'f1' } });
    await fireEvent.press(screen.getByTestId('back-to-route'));
    expect(router.dismissTo).toHaveBeenCalledWith('/route');
  });

  it('opens a photo full screen', async () => {
    mockFetch(() => ({ status: 200, body: submitted() }));
    await renderWithProviders(<FitmentSummaryScreen />);
    await fireEvent.press(await screen.findByTestId('thumb-ASSET'));
    expect(screen.getByTestId('photo-viewer')).toBeOnTheScreen();
  });

  it('is read only once the OE verifies: no Edit', async () => {
    mockFetch(() => ({ status: 200, body: submitted({ status: 'OE_VERIFIED' }) }));
    await renderWithProviders(<FitmentSummaryScreen />);
    expect(await screen.findByText(VERIFIED_READ_ONLY)).toBeOnTheScreen();
    expect(screen.queryByTestId('edit')).toBeNull();
    expect(screen.getByTestId('back-to-route')).toBeOnTheScreen();
  });
});
