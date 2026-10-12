import {
  CHECK_LABELS,
  CHECK_VALUE_LABELS,
  DEVICE_REPLACEMENT_LABELS,
  FITMENT_CHECKS,
  FITMENT_FORM_FIELD_LABELS,
  PHOTO_SLOT_LABELS,
  placementLabel,
  requiredPhotoKinds,
  type ApiErrorBody,
  type BulkFillFitmentDto,
  type BulkFillPreviewResponse,
  type BulkFillTaskDto,
  type FitmentFormInput,
  type RequiredPhotoKind,
} from '@champ/shared';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { resolveApiOrigin } from './api-base-url';
import { ApiError, getAccessToken, NetworkError, refreshSession } from './api-client';

/** F11 §5: bulk fill for one task — the task's fitments, the sample CSV, preview/confirm, photos and Submit ready. */

export const bulkFillQueryKey = (taskId: string) => ['mobile-bulk-fill', taskId] as const;
export const bulkFillPath = (taskId: string) => `/mobile/tasks/${encodeURIComponent(taskId)}/bulk-fill`;

/** The task shows *Bulk fill (CSV)* when the technician has two or more fitments in it. */
export const showsBulkFill = (f: { taskFitmentCount?: number }): boolean => (f.taskFitmentCount ?? 0) >= 2;

/** The query keys a bulk change makes stale (the bulk screen, route, home and every fitment). */
export const BULK_STALE_KEYS = [['mobile-bulk-fill'], ['mobile-route'], ['mobile-home'], ['mobile-fitments'], ['mobile-fitment']] as const;

// --- Progress per fitment ---

const PHOTO_LABELS = new Set<string>([...Object.values(PHOTO_SLOT_LABELS), placementLabel('DEVICE'), placementLabel('SIM')]);

/** `missing` without the photo labels: what the form itself still needs. */
export const missingFormItems = (row: BulkFillFitmentDto): string[] => row.missing.filter((m) => !PHOTO_LABELS.has(m));

export function photoProgress(row: BulkFillFitmentDto): { done: number; total: number } {
  const total = requiredPhotoKinds({ isVehicle: row.fitment.isVehicle, deviceReplacement: row.fitment.form.deviceReplacement }).length;
  return { done: Math.max(0, total - row.missingPhotos.length), total };
}

const SUBMITTED_OR_LATER = new Set(['SUBMITTED', 'OE_VERIFIED', 'OM_APPROVED']);

/** In progress with nothing missing: Submit ready sends it. */
export const isReadyToSubmit = (row: BulkFillFitmentDto): boolean => row.fitment.status === 'IN_PROGRESS' && row.missing.length === 0;

/** "Form ✓ · Photos 2 of 4 · Submitted". */
export function progressLine(row: BulkFillFitmentDto): string {
  const form = missingFormItems(row).length === 0 ? 'Form ✓' : 'Form incomplete';
  const { done, total } = photoProgress(row);
  const s = row.fitment.status;
  const stage = SUBMITTED_OR_LATER.has(s)
    ? 'Submitted'
    : isReadyToSubmit(row)
      ? 'Ready to submit'
      : s === 'IN_PROGRESS'
        ? 'In progress'
        : s === 'ASSIGNED' || s === 'REOPENED'
          ? 'Not started'
          : 'Not submitted';
  return `${form} · Photos ${done} of ${total} · ${stage}`;
}

/** "12 fitments · 5 ready to submit". */
export function countsLine(task: BulkFillTaskDto): string {
  const n = task.fitments.length;
  return `${n} fitment${n === 1 ? '' : 's'} · ${task.fitments.filter(isReadyToSubmit).length} ready to submit`;
}

// --- Photos walk-through ---

const WALK_ORDER: RequiredPhotoKind[] = ['BEFORE', 'ASSET', 'CLUSTER', 'PLACEMENT', 'AFTER'];
const PHOTO_EDITABLE = new Set(['IN_PROGRESS', 'SUBMITTED']);

export interface PhotoStep {
  fitmentId: string;
  tkId: string;
  regNo: string | null;
  kind: RequiredPhotoKind;
  label: string;
}

/**
 * The walk-through: fitments with missing photos in the task's order, and within each the missing kinds in form order.
 * Photos can only be added while In progress or Submitted; the others are listed in `skipped`.
 */
export function photoSteps(task: BulkFillTaskDto): { steps: PhotoStep[]; skipped: string[] } {
  const steps: PhotoStep[] = [];
  const skipped: string[] = [];
  for (const row of task.fitments) {
    if (row.missingPhotos.length === 0) continue;
    const f = row.fitment;
    if (!PHOTO_EDITABLE.has(f.status)) {
      skipped.push(f.tkId);
      continue;
    }
    for (const kind of WALK_ORDER) {
      if (!row.missingPhotos.includes(kind)) continue;
      steps.push({
        fitmentId: f.id,
        tkId: f.tkId,
        regNo: f.form.vehicleRegNo ?? f.vehicleRegNo,
        kind,
        label: kind === 'PLACEMENT' ? placementLabel(f.form.deviceReplacement) : PHOTO_SLOT_LABELS[kind],
      });
    }
  }
  return { steps, skipped };
}

// --- Preview values ---

/** What a preview row will fill, as readable "Label: value" pairs in form order. */
export function readableFill(form: FitmentFormInput): [string, string][] {
  const out: [string, string][] = [];
  const text = (field: keyof typeof FITMENT_FORM_FIELD_LABELS, v: string | number | null | undefined) => {
    if (v !== undefined && v !== null && v !== '') out.push([FITMENT_FORM_FIELD_LABELS[field], String(v)]);
  };
  text('vehicleRegNo', form.vehicleRegNo);
  text('chassisNo', form.chassisNo);
  if (form.clusterReadingKm != null) out.push([FITMENT_FORM_FIELD_LABELS.clusterReadingKm, form.clusterReadingKm.toLocaleString('en-IN')]);
  for (const c of FITMENT_CHECKS) {
    const v = form.checks?.[c];
    if (v) out.push([CHECK_LABELS[c], CHECK_VALUE_LABELS[v]]);
  }
  if (form.deviceReplacement) out.push([FITMENT_FORM_FIELD_LABELS.deviceReplacement, DEVICE_REPLACEMENT_LABELS[form.deviceReplacement]]);
  text('deviceId', form.deviceId);
  text('secondaryDeviceId', form.secondaryDeviceId);
  text('comments', form.comments);
  return out;
}

// --- Raw requests (file download and multipart upload) ---

async function rawFetch(path: string, init: { method?: 'GET' | 'POST'; body?: FormData; accept: string }): Promise<Response> {
  const go = async () => {
    const token = getAccessToken();
    try {
      return await fetch(`${resolveApiOrigin()}/api${path}`, {
        method: init.method ?? 'GET',
        headers: { Accept: init.accept, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: init.body,
      });
    } catch {
      throw new NetworkError();
    }
  };
  let res = await go();
  if (res.status === 401 && (await refreshSession())) res = await go();
  return res;
}

async function failure(res: Response, fallback: string): Promise<ApiError> {
  const text = await res.text();
  let err: ApiErrorBody['error'] | undefined;
  try {
    err = text ? (JSON.parse(text) as ApiErrorBody).error : undefined;
  } catch {
    err = undefined;
  }
  return new ApiError(res.status, err?.code ?? 'UNKNOWN', err?.message ?? `${fallback} (${res.status})`, err?.details);
}

/**
 * Download sample CSV: fetch it with the session, write it to the cache, open the share sheet (Files, Drive, email,
 * Sheets). Returns the file uri, and whether the share sheet was shown (not every device has one).
 */
export async function shareSampleCsv(taskId: string, omId: string): Promise<{ uri: string; shared: boolean }> {
  const res = await rawFetch(`${bulkFillPath(taskId)}/sample.csv`, { accept: 'text/csv' });
  if (!res.ok) throw await failure(res, 'Download failed');
  const csv = await res.text();
  const file = new File(Paths.cache, `bulk-fill-${omId}.csv`);
  file.create({ overwrite: true });
  file.write(csv);
  if (!(await Sharing.isAvailableAsync())) return { uri: file.uri, shared: false };
  await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text', dialogTitle: `Bulk fill ${omId}` });
  return { uri: file.uri, shared: true };
}

/** Upload CSV: the picked file as multipart `file` to `/preview`. Nothing is written on the server. */
export async function previewCsv(taskId: string, file: { uri: string; name: string; mimeType?: string | null }): Promise<BulkFillPreviewResponse> {
  const body = new FormData();
  // React Native's FormData takes a { uri, name, type } file part.
  body.append('file', { uri: file.uri, name: file.name, type: file.mimeType || 'text/csv' } as unknown as Blob);
  const res = await rawFetch(`${bulkFillPath(taskId)}/preview`, { method: 'POST', body, accept: 'application/json' });
  if (!res.ok) throw await failure(res, 'Upload failed');
  return JSON.parse(await res.text()) as BulkFillPreviewResponse;
}

/** The file types the picker offers (some Android file managers label CSVs as text or Excel). */
export const CSV_PICKER_TYPES = ['text/csv', 'text/comma-separated-values', 'text/plain', 'application/vnd.ms-excel'];
