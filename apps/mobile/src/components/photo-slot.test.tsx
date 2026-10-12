import type { FitmentPhotoDto } from '@champ/shared';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { NetworkError } from '../lib/api-client';
import { preparePhoto, uploadAndDiscard, type PreparedPhoto } from '../lib/photo-pipeline';
import { renderWithProviders } from '../test/utils';
import { PHOTO_AUTO_RETRY_MS, PhotoSlot } from './photo-slot';

jest.mock('../lib/photo-pipeline', () => ({
  preparePhoto: jest.fn(),
  uploadAndDiscard: jest.fn(),
}));

const prepare = preparePhoto as jest.Mock;
const upload = uploadAndDiscard as jest.Mock;
const camera = (jest.requireMock('expo-camera') as { __camera: { takePictureAsync: jest.Mock } }).__camera;

const stamped: PreparedPhoto = { uri: 'file:///cache/champ-photo-1.jpg', takenAt: '2026-10-12T11:34:00.000Z', fix: null };
const uploaded = { id: 'p1', kind: 'BEFORE', url: 'https://img/p1.jpg' } as FitmentPhotoDto;

async function renderSlot(props: Partial<Parameters<typeof PhotoSlot>[0]> = {}) {
  const onUploaded = jest.fn();
  const utils = await renderWithProviders(
    <PhotoSlot fitmentId="f1" tkId="TK-00012" kind="BEFORE" label="Before photo" required photo={null} onUploaded={onUploaded} {...props} />,
  );
  return { onUploaded, utils };
}

beforeEach(() => {
  jest.clearAllMocks();
  prepare.mockResolvedValue(stamped);
});

describe('PhotoSlot', () => {
  it('empty: shows the label, Required and both sources', async () => {
    await renderSlot();
    expect(screen.getByText('Before photo')).toBeTruthy();
    expect(screen.getByText('Required')).toBeTruthy();
    expect(screen.getByTestId('photo-before-take')).toBeTruthy();
    expect(screen.getByTestId('photo-before-gallery')).toBeTruthy();
  });

  it('takes a photo with the camera, stamps it with the TK id and uploads it', async () => {
    upload.mockResolvedValue(uploaded);
    const { onUploaded } = await renderSlot();
    await fireEvent.press(screen.getByTestId('photo-before-take'));
    await fireEvent.press(await screen.findByTestId('photo-before-camera-shutter'));
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith(uploaded));
    expect(camera.takePictureAsync).toHaveBeenCalled();
    expect(prepare).toHaveBeenCalledWith({ uri: 'file:///cache/camera.jpg', width: 4032, height: 3024 }, { tkId: 'TK-00012' });
    expect(upload).toHaveBeenCalledWith('f1', 'BEFORE', stamped);
  });

  it('picks from the gallery', async () => {
    upload.mockResolvedValue(uploaded);
    const { onUploaded } = await renderSlot();
    await fireEvent.press(screen.getByTestId('photo-before-gallery'));
    await waitFor(() => expect(onUploaded).toHaveBeenCalled());
    expect(prepare.mock.calls[0][0]).toEqual({ uri: 'file:///gallery/pick.jpg', width: 3000, height: 4000 });
  });

  it('a gallery cancel does nothing', async () => {
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValueOnce({ canceled: true, assets: null });
    await renderSlot();
    await fireEvent.press(screen.getByTestId('photo-before-gallery'));
    expect(prepare).not.toHaveBeenCalled();
  });

  it('a failed upload shows Retry, which re-sends the same stamped file', async () => {
    upload.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(uploaded);
    const { onUploaded } = await renderSlot();
    await fireEvent.press(screen.getByTestId('photo-before-gallery'));
    expect(await screen.findByText('Upload failed')).toBeTruthy();
    expect(screen.getByTestId('photo-before-thumb')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('photo-before-retry'));
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith(uploaded));
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[1]).toEqual(['f1', 'BEFORE', stamped]);
  });

  it('retries by itself while there is no connection', async () => {
    jest.useFakeTimers();
    try {
      upload.mockRejectedValueOnce(new NetworkError()).mockResolvedValueOnce(uploaded);
      const { onUploaded } = await renderSlot();
      await fireEvent.press(screen.getByTestId('photo-before-gallery'));
      expect(await screen.findByText('Upload failed')).toBeTruthy();
      await act(async () => {
        jest.advanceTimersByTime(PHOTO_AUTO_RETRY_MS);
      });
      await waitFor(() => expect(onUploaded).toHaveBeenCalledWith(uploaded));
    } finally {
      jest.useRealTimers();
    }
  });

  it('filled: thumbnail opens full screen; Retake replaces the photo', async () => {
    upload.mockResolvedValue({ ...uploaded, id: 'p2' });
    const { onUploaded } = await renderSlot({ photo: uploaded });
    expect(screen.queryByText('Required')).toBeNull();
    await fireEvent.press(screen.getByTestId('photo-before-thumb'));
    expect(await screen.findByTestId('photo-viewer')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('photo-viewer'));
    await fireEvent.press(screen.getByTestId('photo-before-retake'));
    await fireEvent.press(await screen.findByTestId('photo-before-chooser-take'));
    await fireEvent.press(await screen.findByTestId('photo-before-camera-shutter'));
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith({ ...uploaded, id: 'p2' }));
  });

  it('disabled: no actions', async () => {
    await renderSlot({ photo: uploaded, disabled: true });
    expect(screen.queryByTestId('photo-before-retake')).toBeNull();
    await renderSlot({ photo: null, disabled: true });
    expect(screen.queryByTestId('photo-before-take')).toBeNull();
    expect(screen.getByText('No photo')).toBeTruthy();
  });
});
