import { EMPTY_FITMENT_FORM, type FitmentFormDto, type FitmentPhotoDto, type MyFitmentDto, type RequiredPhotoKind } from '@champ/shared';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import { makeFitment } from '../test/route-fixtures';
import { jsonBody, mockFetch, renderWithProviders, router, type Route } from '../test/utils';
import { FitmentFormScreen, NOT_SAVED_RETRYING } from './fitment-form-screen';

// The capture agent's components (§6.1) are mocked: these tests don't depend on their internals.
jest.mock(
  '../components/photo-slot',
  () => {
    const { createElement } = jest.requireActual<typeof import('react')>('react');
    const { Pressable, Text } = jest.requireActual<typeof import('react-native')>('react-native');
    return {
      PhotoSlot: (p: { kind: string; label: string; required: boolean; photo: { id: string } | null; disabled?: boolean; testID?: string; onUploaded: (photo: unknown) => void }) =>
        createElement(
          Pressable,
          { testID: p.testID, disabled: p.disabled, onPress: () => p.onUploaded({ id: `p-${p.kind}`, kind: p.kind, url: `https://img/${p.kind}.jpg` }) },
          createElement(Text, null, `${p.label}${p.required ? ' · required' : ''}${p.photo ? ' · has photo' : ''}`),
        ),
    };
  },
  { virtual: true },
);
jest.mock(
  '../components/scan-field',
  () => {
    const { createElement } = jest.requireActual<typeof import('react')>('react');
    const { TextInput } = jest.requireActual<typeof import('react-native')>('react-native');
    return {
      ScanField: (p: { label: string; value: string; onChange: (v: string) => void; onBlur?: () => void; disabled?: boolean; testID?: string }) =>
        createElement(TextInput, { testID: p.testID, accessibilityLabel: p.label, value: p.value, onChangeText: p.onChange, onBlur: p.onBlur, editable: !p.disabled }),
    };
  },
  { virtual: true },
);

const params = useLocalSearchParams as jest.Mock;

const photo = (kind: RequiredPhotoKind) => ({ id: `p-${kind}`, kind, url: `https://img/${kind}.jpg` }) as FitmentPhotoDto;
const fullForm: FitmentFormDto = {
  ...EMPTY_FITMENT_FORM,
  vehicleRegNo: 'KA01AB1234',
  clusterReadingKm: 120_450,
  deviceReplacement: 'NONE',
  deviceId: 'DEV123456',
  checks: { assetCondition: 'OK', accessories: 'OK', batteryCondition: 'OK', clusterMeter: 'OK', canVoltage: 'NA' },
};

/** Serves the fitment, the form PUT (merging into the served form) and the SUBMIT transition. */
function serve(opts: { fitment?: Partial<MyFitmentDto>; put?: ReturnType<Route>; submit?: ReturnType<Route> } = {}) {
  let fitment = makeFitment({ status: 'IN_PROGRESS', availableActions: ['SUBMIT', 'CLOSE_NOT_DONE', 'MARK_FAULTY'], ...opts.fitment });
  return mockFetch((url, init) => {
    if (url.pathname === '/api/mobile/fitments/f1') return { status: 200, body: fitment };
    if (url.pathname === '/api/mobile/fitments/f1/form') {
      if (opts.put) return opts.put;
      const patch = jsonBody(init) as Partial<FitmentFormDto>;
      fitment = { ...fitment, form: { ...fitment.form, ...patch, checks: { ...fitment.form.checks, ...patch.checks }, updatedAt: '2026-10-12T06:00:00.000Z' } };
      return { status: 200, body: fitment };
    }
    if (url.pathname === '/api/fitments/f1/transitions') return opts.submit ?? { status: 200, body: {} };
    return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'nope' } } };
  });
}

const puts = (fetchMock: jest.Mock) =>
  fetchMock.mock.calls.filter(([u, init]) => String(u).endsWith('/form') && (init as RequestInit).method === 'PUT').map(([, init]) => jsonBody(init as RequestInit));
const transitions = (fetchMock: jest.Mock) => fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/transitions'));

beforeEach(() => {
  jest.clearAllMocks();
  params.mockReturnValue({ id: 'f1' });
});

describe('FitmentFormScreen', () => {
  it('pre-fills from the saved form and the task, with the sections in order', async () => {
    serve({
      fitment: {
        vehicleRegNo: 'KA01AB1234',
        chassisNo: 'MA1CH4551',
        form: { ...EMPTY_FITMENT_FORM, clusterReadingKm: 5400, deviceId: 'DEV9', checks: { canVoltage: 'NOT_OK' }, comments: 'Loose wire' },
        photos: [photo('BEFORE')],
      },
    });
    await renderWithProviders(<FitmentFormScreen />);
    expect((await screen.findByTestId('field-vehicleRegNo')).props.value).toBe('KA01AB1234');
    expect(screen.getByTestId('field-chassisNo').props.value).toBe('MA1CH4551');
    expect(screen.getByTestId('field-clusterReadingKm').props.value).toBe('5400');
    expect(screen.getByTestId('field-deviceId').props.value).toBe('DEV9');
    expect(screen.getByTestId('field-comments').props.value).toBe('Loose wire');
    expect(screen.getByTestId('check-canVoltage-NOT_OK')).toBeSelected();
    expect(screen.getByTestId('check-canVoltage-OK')).not.toBeSelected();
    expect(screen.getByText('Before photo · required · has photo')).toBeOnTheScreen();
    expect(screen.getByText('Cluster reading photo · required')).toBeOnTheScreen();
    expect(screen.queryByTestId('photo-PLACEMENT')).toBeNull();
    expect(screen.getByTestId('save-status')).toHaveTextContent('Saved');
  });

  it('hides the cluster photo for non-vehicle assets', async () => {
    serve({ fitment: { isVehicle: false } });
    await renderWithProviders(<FitmentFormScreen />);
    await screen.findByTestId('photo-BEFORE');
    expect(screen.queryByTestId('photo-CLUSTER')).toBeNull();
  });

  it('saves a text field on blur with only that field, and validates the reading', async () => {
    const fetchMock = serve();
    await renderWithProviders(<FitmentFormScreen />);
    await fireEvent.changeText(await screen.findByTestId('field-chassisNo'), '  ma1ch999 ');
    expect(puts(fetchMock)).toHaveLength(0);
    await fireEvent(screen.getByTestId('field-chassisNo'), 'blur');
    await waitFor(() => expect(puts(fetchMock)).toEqual([{ chassisNo: 'ma1ch999' }]));

    await fireEvent.changeText(screen.getByTestId('field-deviceId'), 'dev42');
    await fireEvent(screen.getByTestId('field-deviceId'), 'blur');
    await waitFor(() => expect(puts(fetchMock)[1]).toEqual({ deviceId: 'DEV42' }));

    await fireEvent.changeText(screen.getByTestId('field-clusterReadingKm'), '12.5');
    await fireEvent(screen.getByTestId('field-clusterReadingKm'), 'blur');
    expect(screen.getByText('Enter whole kilometres')).toBeOnTheScreen();
    expect(puts(fetchMock)).toHaveLength(2);
    await waitFor(() => expect(screen.getByTestId('save-status')).toHaveTextContent('Saved'));
  });

  it('saves a segmented choice on change', async () => {
    const fetchMock = serve();
    await renderWithProviders(<FitmentFormScreen />);
    await fireEvent.press(await screen.findByTestId('check-canVoltage-NOT_OK'));
    await waitFor(() => expect(puts(fetchMock)).toEqual([{ checks: { canVoltage: 'NOT_OK' } }]));
    expect(screen.getByTestId('check-canVoltage-NOT_OK')).toBeSelected();
  });

  it('the placement slot and its label follow the device replacement', async () => {
    const fetchMock = serve();
    await renderWithProviders(<FitmentFormScreen />);
    await screen.findByTestId('replacement-SIM');
    expect(screen.queryByTestId('photo-PLACEMENT')).toBeNull();
    await fireEvent.press(screen.getByTestId('replacement-SIM'));
    expect(await screen.findByText('SIM placement photo · required')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('replacement-DEVICE'));
    expect(await screen.findByText('Device placement photo · required')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('replacement-NONE'));
    await waitFor(() => expect(screen.queryByTestId('photo-PLACEMENT')).toBeNull());
    await waitFor(() => expect(puts(fetchMock).map((b) => (b as { deviceReplacement: string }).deviceReplacement)).toEqual(['SIM', 'DEVICE', 'NONE']));
  });

  it('a failed save says Not saved — retrying', async () => {
    serve({ put: 'network' });
    await renderWithProviders(<FitmentFormScreen />);
    await fireEvent.press(await screen.findByTestId('check-accessories-OK'));
    expect(await screen.findByText(NOT_SAVED_RETRYING)).toBeOnTheScreen();
    expect(screen.getByTestId('save-status')).toHaveTextContent('Not saved');
  });

  it('Submit with things missing lists them and sends nothing; an item closes the list', async () => {
    const fetchMock = serve({ fitment: { photos: [photo('BEFORE')] } });
    await renderWithProviders(<FitmentFormScreen />);
    await fireEvent.press(await screen.findByTestId('submit'));
    expect(await screen.findByTestId('missing-dialog')).toBeOnTheScreen();
    expect(screen.getByText(/Still needed: Asset photo, Cluster reading photo, Asset condition/)).toBeOnTheScreen();
    for (const label of ['Asset photo', 'CAN voltage', 'Device replacement', 'Device id', 'After photo']) {
      expect(screen.getByTestId(`missing-${label}`)).toBeOnTheScreen();
    }
    expect(screen.queryByTestId('missing-Before photo')).toBeNull();
    expect(transitions(fetchMock)).toHaveLength(0);
    await fireEvent.press(screen.getByTestId('missing-CAN voltage'));
    await waitFor(() => expect(screen.queryByTestId('missing-dialog')).toBeNull());
  });

  it('Submit saves the whole form, sends SUBMIT and replaces with the summary', async () => {
    const fetchMock = serve({ fitment: { form: fullForm, photos: [photo('BEFORE'), photo('ASSET'), photo('CLUSTER')] } });
    await renderWithProviders(<FitmentFormScreen />);
    // The After photo is taken now (the mocked slot reports an upload).
    await fireEvent.press(await screen.findByTestId('photo-AFTER'));
    await fireEvent.changeText(screen.getByTestId('field-comments'), 'All good');
    await fireEvent.press(screen.getByTestId('submit'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith({ pathname: '/fitment/[id]/summary', params: { id: 'f1' } }));
    expect(puts(fetchMock).at(-1)).toMatchObject({ comments: 'All good', deviceId: 'DEV123456', deviceReplacement: 'NONE', clusterReadingKm: 120450 });
    expect(jsonBody(transitions(fetchMock)[0]?.[1] as RequestInit)).toEqual({ action: 'SUBMIT' });
  });

  it('a server FORM_INCOMPLETE shows the same list', async () => {
    serve({
      fitment: { form: fullForm, photos: (['BEFORE', 'ASSET', 'CLUSTER', 'AFTER'] as const).map(photo) },
      submit: { status: 400, body: { error: { code: 'FORM_INCOMPLETE', message: 'Still needed: After photo', details: { missing: ['After photo'] } } } },
    });
    await renderWithProviders(<FitmentFormScreen />);
    await fireEvent.press(await screen.findByTestId('submit'));
    expect(await screen.findByTestId('missing-After photo')).toBeOnTheScreen();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('while Submitted, saves and returns to the summary without SUBMIT', async () => {
    const fetchMock = serve({ fitment: { status: 'SUBMITTED', availableActions: [], form: fullForm } });
    await renderWithProviders(<FitmentFormScreen />);
    await fireEvent.press(await screen.findByTestId('submit'));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith({ pathname: '/fitment/[id]/summary', params: { id: 'f1' } }));
    expect(puts(fetchMock)).toHaveLength(1);
    expect(transitions(fetchMock)).toHaveLength(0);
  });

  it('is read only once verified', async () => {
    serve({ fitment: { status: 'OE_VERIFIED', availableActions: [], form: fullForm } });
    await renderWithProviders(<FitmentFormScreen />);
    expect(await screen.findByText('Verified by your OE — read only')).toBeOnTheScreen();
    expect(screen.getByTestId('check-canVoltage-OK')).toBeDisabled();
    expect(screen.queryByTestId('submit')).toBeNull();
    expect(screen.getByTestId('view-summary')).toBeOnTheScreen();
  });
});
