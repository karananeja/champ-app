import { mockFetch } from '../test/utils';
import { setAccessToken } from './api-client';
import {
  discardFile,
  fitLongSide,
  formatStampTime,
  NO_GPS_TEXT,
  preparePhoto,
  stampText,
  uploadAndDiscard,
  type PreparedPhoto,
} from './photo-pipeline';

type Ctx = { resize: jest.Mock; renderAsync: jest.Mock };
const manip = (jest.requireMock('expo-image-manipulator') as {
  ImageManipulator: { manipulate: jest.Mock; __context: Ctx; __ref: (w: number, h: number) => { width: number; height: number; saveAsync: jest.Mock } };
}).ImageManipulator;
const skia = jest.requireMock('@shopify/react-native-skia') as {
  Skia: { __canvas: { drawText: jest.Mock; drawRect: jest.Mock }; __snapshot: { encodeToBytes: jest.Mock } };
};
const files = (jest.requireMock('expo-file-system') as { __files: Set<string> }).__files;

const AT = new Date('2026-10-12T11:34:00.000Z'); // 5:04 pm IST
const FIX = { lat: 12.9757, lng: 77.605 };

beforeEach(() => {
  jest.clearAllMocks();
  files.clear();
  const big = manip.__ref(4032, 3024);
  const small = manip.__ref(1600, 1200);
  manip.__context.renderAsync.mockResolvedValueOnce(big).mockResolvedValueOnce(small);
});

describe('stamp text', () => {
  it('formats IST time, the TK id and the GPS fix', () => {
    expect(formatStampTime(AT)).toBe('12 Oct 2026, 5:04 pm IST');
    expect(formatStampTime(new Date('2026-10-11T18:35:00.000Z'))).toBe('12 Oct 2026, 12:05 am IST');
    expect(stampText({ tkId: 'TK-00012', at: AT, fix: FIX })).toBe('TK-00012 · 12 Oct 2026, 5:04 pm IST · 12.97570, 77.60500');
  });

  it('says GPS unavailable without a fix', () => {
    expect(stampText({ tkId: 'TK-00012', at: AT, fix: null })).toBe(`TK-00012 · 12 Oct 2026, 5:04 pm IST · ${NO_GPS_TEXT}`);
  });

  it('resizes only above 1600 px on the long side', () => {
    expect(fitLongSide(4032, 3024)).toEqual({ width: 1600 });
    expect(fitLongSide(3000, 4000)).toEqual({ height: 1600 });
    expect(fitLongSide(1200, 900)).toBeNull();
  });
});

describe('preparePhoto', () => {
  it('resizes to 1600 px, stamps the text into a bar and writes a q70 JPEG temp file', async () => {
    const p = await preparePhoto({ uri: 'file:///cache/camera.jpg' }, { tkId: 'TK-00012', now: () => AT, fix: async () => FIX });
    expect(manip.manipulate).toHaveBeenCalledWith('file:///cache/camera.jpg');
    expect(manip.__context.resize).toHaveBeenCalledWith({ width: 1600 });
    expect(skia.Skia.__canvas.drawRect).toHaveBeenCalled();
    expect(skia.Skia.__canvas.drawText.mock.calls[0][0]).toBe('TK-00012 · 12 Oct 2026, 5:04 pm IST · 12.97570, 77.60500');
    expect(skia.Skia.__snapshot.encodeToBytes).toHaveBeenCalledWith(3, 70);
    expect(p).toEqual({ uri: expect.stringMatching(/^file:\/\/\/cache\/champ-photo-.*\.jpg$/), takenAt: AT.toISOString(), fix: FIX });
    expect(files.has(p.uri)).toBe(true);
  });

  it('stamps "GPS unavailable" when there is no fix', async () => {
    const p = await preparePhoto({ uri: 'file:///x.jpg' }, { tkId: 'TK-00012', now: () => AT, fix: async () => null });
    expect(skia.Skia.__canvas.drawText.mock.calls[0][0]).toContain(NO_GPS_TEXT);
    expect(p.fix).toBeNull();
  });
});

describe('upload', () => {
  const prepared: PreparedPhoto = { uri: 'file:///cache/champ-photo-1.jpg', takenAt: AT.toISOString(), fix: FIX };
  /** React Native's FormData keeps `{ uri, name, type }` file parts; Node's would stringify them, so record instead. */
  class RecordingFormData {
    parts: [string, unknown][] = [];
    append(name: string, value: unknown) {
      this.parts.push([name, value]);
    }
  }
  const realFormData = globalThis.FormData;
  beforeAll(() => {
    globalThis.FormData = RecordingFormData as unknown as typeof FormData;
  });
  afterAll(() => {
    globalThis.FormData = realFormData;
  });
  const parts = (init: RequestInit) => Object.fromEntries((init.body as unknown as RecordingFormData).parts);

  beforeEach(() => {
    setAccessToken('tok');
    files.add(prepared.uri);
  });

  it('posts the multipart body with kind, takenAt, lat and lng, then deletes the temp file', async () => {
    const fetchMock = mockFetch(() => ({ status: 201, body: { id: 'p1', kind: 'BEFORE', url: 'https://img/p1.jpg' } }));
    const dto = await uploadAndDiscard('f1', 'BEFORE', prepared);
    expect(dto.id).toBe('p1');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/mobile\/fitments\/f1\/photos$/);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(parts(init)).toEqual({
      kind: 'BEFORE',
      takenAt: AT.toISOString(),
      lat: '12.9757',
      lng: '77.605',
      file: { uri: prepared.uri, name: 'before.jpg', type: 'image/jpeg' },
    });
    expect(files.has(prepared.uri)).toBe(false);
  });

  it('leaves out lat/lng without a fix and accepts a { photo } body', async () => {
    const fetchMock = mockFetch(() => ({ status: 201, body: { photo: { id: 'p2' } } }));
    const dto = await uploadAndDiscard('f1', 'AFTER', { ...prepared, fix: null });
    expect(dto.id).toBe('p2');
    const body = parts(fetchMock.mock.calls[0][1] as RequestInit);
    expect(body).not.toHaveProperty('lat');
    expect(body).not.toHaveProperty('lng');
  });

  it('keeps the stamped file when the upload fails, so a retry sends it again', async () => {
    mockFetch(() => 'network');
    await expect(uploadAndDiscard('f1', 'BEFORE', prepared)).rejects.toMatchObject({ name: 'NetworkError' });
    expect(files.has(prepared.uri)).toBe(true);
    mockFetch(() => ({ status: 409, body: { error: { code: 'FITMENT_LOCKED', message: 'Locked' } } }));
    await expect(uploadAndDiscard('f1', 'BEFORE', prepared)).rejects.toMatchObject({ status: 409, code: 'FITMENT_LOCKED' });
    expect(files.has(prepared.uri)).toBe(true);
    mockFetch(() => ({ status: 201, body: { id: 'p3' } }));
    await uploadAndDiscard('f1', 'BEFORE', prepared);
    expect(files.has(prepared.uri)).toBe(false);
  });

  it('discardFile ignores a missing file', () => {
    expect(() => discardFile('file:///nope.jpg')).not.toThrow();
  });
});
