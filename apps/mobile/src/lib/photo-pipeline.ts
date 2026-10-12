import type { ApiErrorBody, FitmentPhotoDto, RequiredPhotoKind } from '@champ/shared';
import { ImageFormat, matchFont, Skia, type SkFont } from '@shopify/react-native-skia';
import { File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';
import { resolveApiOrigin } from './api-base-url';
import { ApiError, getAccessToken, NetworkError, refreshSession } from './api-client';
import { tryRouteFix, type Fix } from './location';

/**
 * F10B §6 photo pipeline (D-181): capture or pick → GPS fix → resize → Skia stamp → temp file → multipart upload →
 * delete the temp file. The stamped file is kept until its upload succeeds, so a retry sends the same image.
 */

export const MAX_LONG_SIDE = 1600;
/** Final JPEG quality (spec: q 0.7). The resize step keeps more, so the image is compressed hard only once. */
export const JPEG_QUALITY = 0.7;
const RESIZE_QUALITY = 0.95;
export const NO_GPS_TEXT = 'GPS unavailable';

/** A captured or picked image, before processing. */
export interface SourceImage {
  uri: string;
  width?: number;
  height?: number;
}

/** A stamped photo in a temp file, ready to upload (and to re-upload on retry). */
export interface PreparedPhoto {
  uri: string;
  takenAt: string;
  fix: Fix | null;
}

// --- Pure helpers ---

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const IST_OFFSET_MS = 330 * 60_000;

/** "12 Oct 2026, 5:04 pm IST". IST has no DST, so a fixed offset avoids depending on the engine's Intl data. */
export function formatStampTime(at: Date): string {
  const d = new Date(at.getTime() + IST_OFFSET_MS);
  const h24 = d.getUTCHours();
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${h}:${mm} ${h24 < 12 ? 'am' : 'pm'} IST`;
}

/** `TK-00012 · 12 Oct 2026, 5:04 pm IST · 12.97570, 77.60500` (or "GPS unavailable"). */
export function stampText(input: { tkId: string; at: Date; fix: Fix | null }): string {
  const where = input.fix ? `${input.fix.lat.toFixed(5)}, ${input.fix.lng.toFixed(5)}` : NO_GPS_TEXT;
  return `${input.tkId} · ${formatStampTime(input.at)} · ${where}`;
}

/** The resize that brings the long side down to `max`, or null when the image is already small enough. */
export function fitLongSide(width: number, height: number, max: number = MAX_LONG_SIDE): { width: number } | { height: number } | null {
  if (Math.max(width, height) <= max) return null;
  return width >= height ? { width: max } : { height: max };
}

/** The stamp bar's geometry for an image of this size: a bottom bar about 4.5% of the long side tall. */
export function stampLayout(width: number, height: number): { barHeight: number; fontSize: number; padding: number } {
  const barHeight = Math.max(28, Math.round(Math.max(width, height) * 0.045));
  return { barHeight, fontSize: Math.round(barHeight * 0.45), padding: Math.round(barHeight * 0.35) };
}

// --- Native steps ---

/** Step 3: orientation-normalised, long side ≤ 1600 px, saved as a high-quality JPEG in the cache. */
export async function resizePhoto(uri: string): Promise<{ uri: string; width: number; height: number }> {
  const decoded = await ImageManipulator.manipulate(uri).renderAsync();
  const resize = fitLongSide(decoded.width, decoded.height);
  const ref = resize ? await ImageManipulator.manipulate(decoded).resize(resize).renderAsync() : decoded;
  const saved = await ref.saveAsync({ format: SaveFormat.JPEG, compress: RESIZE_QUALITY });
  return { uri: saved.uri, width: saved.width, height: saved.height };
}

function stampFont(size: number): SkFont {
  return matchFont({ fontFamily: Platform.select({ ios: 'Helvetica', default: 'sans-serif' }), fontSize: size, fontWeight: '600' });
}

/**
 * Steps 4–5: burns `text` into a semi-transparent bar at the bottom, off-screen (a raster surface, nothing is shown),
 * and writes the JPEG (q 0.7) to a new temp file. Returns its uri.
 */
export async function stampPhoto(uri: string, text: string): Promise<string> {
  const data = await Skia.Data.fromURI(uri);
  const image = Skia.Image.MakeImageFromEncoded(data);
  if (!image) throw new Error('Could not read the photo');
  const width = image.width();
  const height = image.height();
  const surface = Skia.Surface.Make(width, height);
  if (!surface) throw new Error('Could not stamp the photo');
  const canvas = surface.getCanvas();
  canvas.drawImage(image, 0, 0);

  const { barHeight, fontSize, padding } = stampLayout(width, height);
  const bar = Skia.Paint();
  bar.setColor(Skia.Color('rgba(0,0,0,0.55)'));
  canvas.drawRect(Skia.XYWHRect(0, height - barHeight, width, barHeight), bar);

  let font = stampFont(fontSize);
  const textWidth = font.getTextWidth(text);
  const room = width - padding * 2;
  if (textWidth > room) font = stampFont(Math.max(8, Math.floor((fontSize * room) / textWidth)));
  const ink = Skia.Paint();
  ink.setColor(Skia.Color('#ffffff'));
  canvas.drawText(text, padding, height - barHeight / 2 + font.getSize() * 0.35, ink, font);

  surface.flush();
  const bytes = surface.makeImageSnapshot().encodeToBytes(ImageFormat.JPEG, Math.round(JPEG_QUALITY * 100));
  const out = new File(Paths.cache, `champ-photo-${Date.now()}-${Math.round(Math.random() * 1e6)}.jpg`);
  out.create({ overwrite: true });
  out.write(bytes);
  return out.uri;
}

/** Best-effort delete of a temp file. */
export function discardFile(uri: string): void {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // A leftover cache file is harmless; the OS clears the cache.
  }
}

/** Steps 2–5: GPS fix (balanced, 10 s, none → "GPS unavailable"), resize, stamp, temp file. */
export async function preparePhoto(
  source: SourceImage,
  ctx: { tkId: string; now?: () => Date; fix?: () => Promise<Fix | null> },
): Promise<PreparedPhoto> {
  const fix = await (ctx.fix ?? tryRouteFix)();
  const at = (ctx.now ?? (() => new Date()))();
  const resized = await resizePhoto(source.uri);
  try {
    const uri = await stampPhoto(resized.uri, stampText({ tkId: ctx.tkId, at, fix }));
    return { uri, takenAt: at.toISOString(), fix };
  } finally {
    discardFile(resized.uri);
  }
}

// --- Upload ---

/** The multipart body for `POST /mobile/fitments/:fid/photos`. */
export function photoFormData(kind: RequiredPhotoKind, photo: PreparedPhoto): FormData {
  const body = new FormData();
  body.append('kind', kind);
  body.append('takenAt', photo.takenAt);
  if (photo.fix) {
    body.append('lat', String(photo.fix.lat));
    body.append('lng', String(photo.fix.lng));
  }
  // React Native's FormData takes a { uri, name, type } file part.
  body.append('file', { uri: photo.uri, name: `${kind.toLowerCase()}.jpg`, type: 'image/jpeg' } as unknown as Blob);
  return body;
}

async function postPhoto(fitmentId: string, kind: RequiredPhotoKind, photo: PreparedPhoto): Promise<Response> {
  const token = getAccessToken();
  try {
    return await fetch(`${resolveApiOrigin()}/api/mobile/fitments/${encodeURIComponent(fitmentId)}/photos`, {
      method: 'POST',
      headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: photoFormData(kind, photo),
    });
  } catch {
    throw new NetworkError();
  }
}

/** Step 6: uploads the stamped file (refreshing the session once on 401). Doesn't delete it. */
export async function uploadPhoto(fitmentId: string, kind: RequiredPhotoKind, photo: PreparedPhoto): Promise<FitmentPhotoDto> {
  let res = await postPhoto(fitmentId, kind, photo);
  if (res.status === 401 && (await refreshSession())) res = await postPhoto(fitmentId, kind, photo);
  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const err = (json as ApiErrorBody | undefined)?.error;
    throw new ApiError(res.status, err?.code ?? 'UNKNOWN', err?.message ?? `Upload failed (${res.status})`, err?.details);
  }
  // The spec returns the photo itself; F06's upload wraps it in { photo }. Accept both.
  const body = json as FitmentPhotoDto | { photo: FitmentPhotoDto };
  return 'photo' in body ? body.photo : body;
}

/** Steps 6–7: upload, then delete the temp file. On failure the file stays for the retry. */
export async function uploadAndDiscard(fitmentId: string, kind: RequiredPhotoKind, photo: PreparedPhoto): Promise<FitmentPhotoDto> {
  const dto = await uploadPhoto(fitmentId, kind, photo);
  discardFile(photo.uri);
  return dto;
}
