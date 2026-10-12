import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { extractTextFromImage } from 'expo-text-extractor';
import { useState } from 'react';
import { Linking } from 'react-native';
import { renderWithProviders } from '../test/utils';
import { ScanField } from './scan-field';

type Perm = { granted: boolean; canAskAgain: boolean; status: string };
const camera = (jest.requireMock('expo-camera') as {
  __camera: { permission: Perm; requestPermission: jest.Mock; props: { onBarcodeScanned?: (r: { data: string }) => void } | null };
}).__camera;
const extract = extractTextFromImage as jest.Mock;

function Harness({ onChange, onBlur }: { onChange: jest.Mock; onBlur: jest.Mock }) {
  const [v, setV] = useState('');
  return (
    <ScanField
      label="Device id"
      value={v}
      onChange={(x) => {
        setV(x);
        onChange(x);
      }}
      onBlur={onBlur}
      required
      testID="device-id"
    />
  );
}

async function open() {
  const onChange = jest.fn();
  const onBlur = jest.fn();
  await renderWithProviders(<Harness onChange={onChange} onBlur={onBlur} />);
  await fireEvent.press(screen.getByTestId('device-id-scan'));
  return { onChange, onBlur };
}

beforeEach(() => {
  jest.clearAllMocks();
  camera.permission = { granted: true, canAskAgain: true, status: 'granted' };
});

describe('ScanField', () => {
  it('scans a barcode, asks to confirm and fills the field', async () => {
    const { onChange, onBlur } = await open();
    expect(await screen.findByTestId('device-id-camera-view')).toBeTruthy();
    await act(async () => camera.props?.onBarcodeScanned?.({ data: ' IC8612345 ' }));
    expect(await screen.findByText('Use this code?')).toBeTruthy();
    expect(screen.getByText('IC8612345')).toBeTruthy();
    // Paused while confirming: no second read.
    expect(camera.props?.onBarcodeScanned).toBeUndefined();
    await fireEvent.press(screen.getByTestId('device-id-use-code'));
    expect(onChange).toHaveBeenCalledWith('IC8612345');
    await waitFor(() => expect(onBlur).toHaveBeenCalled());
    expect(screen.getByTestId('device-id-input').props.value).toBe('IC8612345');
  });

  it('Scan again discards the read code and keeps scanning', async () => {
    const { onChange } = await open();
    await act(async () => camera.props?.onBarcodeScanned?.({ data: 'WRONG1' }));
    await fireEvent.press(await screen.findByTestId('device-id-scan-again'));
    expect(screen.queryByText('Use this code?')).toBeNull();
    expect(camera.props?.onBarcodeScanned).toBeDefined();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reads text and lists candidates longest first to pick from', async () => {
    extract.mockResolvedValueOnce(['Model ICX200', 'S/N 8612345678901', 'Batch AB1234']);
    const { onChange } = await open();
    await fireEvent.press(await screen.findByTestId('device-id-camera-read-text'));
    expect(await screen.findByText('Pick the id')).toBeTruthy();
    expect(extract).toHaveBeenCalledWith('file:///cache/camera.jpg');
    expect(screen.getByTestId('device-id-candidate-0')).toHaveTextContent('8612345678901');
    expect(screen.getByTestId('device-id-candidate-1')).toHaveTextContent('ICX200');
    expect(screen.getByTestId('device-id-candidate-2')).toHaveTextContent('AB1234');
    await fireEvent.press(screen.getByTestId('device-id-candidate-1'));
    expect(onChange).toHaveBeenCalledWith('ICX200');
    expect(screen.getByTestId('device-id-input').props.value).toBe('ICX200');
  });

  it('says so when no id-like text was read', async () => {
    extract.mockResolvedValueOnce(['OK', 'v2']);
    await open();
    await fireEvent.press(await screen.findByTestId('device-id-camera-read-text'));
    expect(await screen.findByText('No id found')).toBeTruthy();
  });

  it('the value stays editable by hand', async () => {
    const onChange = jest.fn();
    await renderWithProviders(<Harness onChange={onChange} onBlur={jest.fn()} />);
    await fireEvent.changeText(screen.getByTestId('device-id-input'), 'MANUAL01');
    expect(onChange).toHaveBeenCalledWith('MANUAL01');
  });

  it('camera permission denied: explains and offers Open settings', async () => {
    camera.permission = { granted: false, canAskAgain: false, status: 'denied' };
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    await open();
    expect(await screen.findByText('Camera access is off')).toBeTruthy();
    expect(camera.requestPermission).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('camera-open-settings'));
    expect(openSettings).toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('camera-denied-close'));
    await waitFor(() => expect(screen.queryByText('Camera access is off')).toBeNull());
  });

  it('asks for the permission when it can', async () => {
    camera.permission = { granted: false, canAskAgain: true, status: 'undetermined' };
    await open();
    await waitFor(() => expect(camera.requestPermission).toHaveBeenCalled());
  });
});
