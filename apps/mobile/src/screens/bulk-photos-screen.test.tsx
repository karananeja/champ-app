import { EMPTY_FITMENT_FORM, type FitmentPhotoDto } from '@champ/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import { preparePhoto, uploadAndDiscard, type PreparedPhoto } from '../lib/photo-pipeline';
import { makeBulkRow, makeBulkTask } from '../test/bulk-fixtures';
import { mockFetch, renderWithProviders, router } from '../test/utils';
import { BulkPhotosScreen, START_FIRST_NOTE } from './bulk-photos-screen';

jest.mock('../lib/photo-pipeline', () => ({
  preparePhoto: jest.fn(),
  uploadAndDiscard: jest.fn(),
}));

const prepare = preparePhoto as jest.Mock;
const upload = uploadAndDiscard as jest.Mock;
const params = useLocalSearchParams as jest.Mock;
const stamped: PreparedPhoto = { uri: 'file:///cache/champ-photo-1.jpg', takenAt: '2026-10-12T11:34:00.000Z', fix: null };

/** f1 has every photo; f2 misses after and before (listed out of order); f3 isn't started; f4 (submitted) misses the SIM placement. */
const task = makeBulkTask({
  fitments: [
    makeBulkRow({ id: 'f1', tkId: 'TK-00012', status: 'IN_PROGRESS' }),
    makeBulkRow({ id: 'f2', tkId: 'TK-00013', status: 'IN_PROGRESS', vehicleRegNo: 'KA01AB5678' }, ['Before photo', 'After photo'], ['AFTER', 'BEFORE']),
    makeBulkRow({ id: 'f3', tkId: 'TK-00014', status: 'ASSIGNED' }, ['Before photo'], ['BEFORE']),
    makeBulkRow(
      { id: 'f4', tkId: 'TK-00015', status: 'SUBMITTED', vehicleRegNo: null, form: { ...EMPTY_FITMENT_FORM, deviceReplacement: 'SIM', vehicleRegNo: 'KA05ZZ0001' } },
      ['SIM placement photo'],
      ['PLACEMENT'],
    ),
  ],
});

beforeEach(() => {
  jest.clearAllMocks();
  params.mockReturnValue({ taskId: 't1' });
  prepare.mockResolvedValue(stamped);
  upload.mockImplementation(async (_fid: string, kind: string) => ({ id: `p-${kind}`, kind, url: 'https://img/p.jpg' }) as FitmentPhotoDto);
  mockFetch(() => ({ status: 200, body: task }));
});

describe('BulkPhotosScreen', () => {
  it('walks the missing photos across fitments in order, skips the not-started ones and needs an upload for Next', async () => {
    await renderWithProviders(<BulkPhotosScreen />);
    expect(await screen.findByTestId('step-header')).toHaveTextContent('TK-00013 · KA01AB5678 — 1 of 3');
    expect(screen.getByTestId('skipped-note')).toHaveTextContent(`TK-00014: ${START_FIRST_NOTE}`);
    expect(screen.getByText('Before photo')).toBeOnTheScreen();
    expect(screen.getByTestId('next')).toBeDisabled();

    await fireEvent.press(screen.getByTestId('photo-before-gallery'));
    await waitFor(() => expect(screen.getByTestId('next')).toBeEnabled());
    expect(upload).toHaveBeenCalledWith('f2', 'BEFORE', stamped);
    await fireEvent.press(screen.getByTestId('next'));

    expect(screen.getByTestId('step-header')).toHaveTextContent('TK-00013 · KA01AB5678 — 2 of 3');
    expect(screen.getByText('After photo')).toBeOnTheScreen();
    expect(screen.getByTestId('next')).toBeDisabled();
    await fireEvent.press(screen.getByTestId('skip'));

    expect(screen.getByTestId('step-header')).toHaveTextContent('TK-00015 · KA05ZZ0001 — 3 of 3');
    expect(screen.getByText('SIM placement photo')).toBeOnTheScreen();
    expect(screen.getByTestId('next')).toHaveTextContent('Done');
    expect(router.back).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('skip'));
    expect(router.back).toHaveBeenCalled();
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('with nothing to add says so', async () => {
    mockFetch(() => ({ status: 200, body: makeBulkTask({ fitments: [makeBulkRow({ id: 'f1', status: 'IN_PROGRESS' })] }) }));
    await renderWithProviders(<BulkPhotosScreen />);
    expect(await screen.findByText('No photos to add.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('done'));
    expect(router.back).toHaveBeenCalled();
  });
});
