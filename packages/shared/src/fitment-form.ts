import { z } from 'zod';
import { TECHNICIAN_PHOTO_KINDS, type PhotoKind } from './verification';

/**
 * The technician's fitment form (F10B): the five checks (D-180), the readings, device replacement and device ids,
 * which photos are required (D-182) and what is still missing before SUBMIT (D-183). The API, web and app use it.
 */

/** The `code` of the built-in asset type that makes a fitment a vehicle fitment. */
export const VEHICLE_ASSET_TYPE_CODE = 'VEHICLE';

export const FITMENT_CHECKS = ['assetCondition', 'accessories', 'batteryCondition', 'clusterMeter', 'canVoltage'] as const;
export type FitmentCheck = (typeof FITMENT_CHECKS)[number];

export const CHECK_LABELS: Record<FitmentCheck, string> = {
  assetCondition: 'Asset condition',
  accessories: 'Accessories',
  batteryCondition: 'Vehicle battery condition',
  clusterMeter: 'Cluster meter reading',
  canVoltage: 'CAN voltage',
};

export const CHECK_VALUES = ['OK', 'NOT_OK', 'NA'] as const;
export type CheckValue = (typeof CHECK_VALUES)[number];

export const CHECK_VALUE_LABELS: Record<CheckValue, string> = { OK: 'OK', NOT_OK: 'Not OK', NA: 'Not applicable' };

export const DEVICE_REPLACEMENTS = ['DEVICE', 'SIM', 'NONE'] as const;
export type DeviceReplacement = (typeof DEVICE_REPLACEMENTS)[number];

export const DEVICE_REPLACEMENT_LABELS: Record<DeviceReplacement, string> = { DEVICE: 'Device', SIM: 'SIM', NONE: 'No' };

/** Labels of the form fields (also used in the missing list and the history diffs). */
export const FITMENT_FORM_FIELD_LABELS = {
  vehicleRegNo: 'Vehicle registration no.',
  chassisNo: 'Chassis no.',
  clusterReadingKm: 'Cluster reading (km)',
  deviceReplacement: 'Device replacement',
  deviceId: 'Device id',
  secondaryDeviceId: 'Secondary device id',
  comments: 'Comments',
} as const;
export type FitmentFormField = keyof typeof FITMENT_FORM_FIELD_LABELS;

export const CLUSTER_READING_MAX = 9_999_999;
export const FORM_COMMENTS_MAX = 1000;

/** Trimmed text; '' (after trimming) means "clear" and becomes null. */
const clearableText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters`)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional();

const deviceIdText = (label: string) =>
  z
    .string()
    .trim()
    .max(64, `${label} must be at most 64 characters`)
    .transform((v) => (v === '' ? null : v.toUpperCase()))
    .nullable()
    .optional();

/**
 * `PUT /mobile/fitments/:fid/form`: a partial save. Every field is optional (left out = unchanged); null or ''
 * clears it. `checks` is merged per check (a null value clears that check).
 */
export const fitmentFormSchema = z.object({
  vehicleRegNo: clearableText('Vehicle registration no.', 32),
  chassisNo: clearableText('Chassis no.', 32),
  clusterReadingKm: z
    .number({ error: 'Enter the reading in km' })
    .int('Enter whole kilometres')
    .min(0, 'The reading cannot be negative')
    .max(CLUSTER_READING_MAX, `The reading must be at most ${CLUSTER_READING_MAX.toLocaleString('en-IN')} km`)
    .nullable()
    .optional(),
  deviceReplacement: z.enum(DEVICE_REPLACEMENTS, { error: 'Choose Device, SIM or No' }).nullable().optional(),
  deviceId: deviceIdText('Device id'),
  secondaryDeviceId: deviceIdText('Secondary device id'),
  checks: z.partialRecord(z.enum(FITMENT_CHECKS), z.enum(CHECK_VALUES, { error: 'Choose OK, Not OK or Not applicable' }).nullable()).optional(),
  comments: clearableText('Comments', FORM_COMMENTS_MAX),
});
export type FitmentFormInput = z.infer<typeof fitmentFormSchema>;

/** The stored form (all nullable; checks hold only the answered ones). */
export interface FitmentFormDto {
  vehicleRegNo: string | null;
  chassisNo: string | null;
  clusterReadingKm: number | null;
  deviceReplacement: DeviceReplacement | null;
  deviceId: string | null;
  secondaryDeviceId: string | null;
  checks: Partial<Record<FitmentCheck, CheckValue>>;
  comments: string | null;
  /** When the technician last saved the form (UTC ISO). */
  updatedAt: string | null;
}

export const EMPTY_FITMENT_FORM: FitmentFormDto = {
  vehicleRegNo: null,
  chassisNo: null,
  clusterReadingKm: null,
  deviceReplacement: null,
  deviceId: null,
  secondaryDeviceId: null,
  checks: {},
  comments: null,
  updatedAt: null,
};

// --- Photos and submit ---

export type RequiredPhotoKind = 'BEFORE' | 'AFTER' | 'ASSET' | 'CLUSTER' | 'PLACEMENT';

export const PHOTO_SLOT_LABELS: Record<RequiredPhotoKind, string> = {
  BEFORE: 'Before photo',
  ASSET: 'Asset photo',
  CLUSTER: 'Cluster reading photo',
  PLACEMENT: 'Device/SIM placement photo',
  AFTER: 'After photo',
};

/** The placement slot's label follows the device replacement choice. */
export const placementLabel = (r: DeviceReplacement | null): string =>
  r === 'SIM' ? 'SIM placement photo' : 'Device placement photo';

/** Whether the placement photo is needed (Device or SIM replaced). */
export const needsPlacementPhoto = (r: DeviceReplacement | null): boolean => r === 'DEVICE' || r === 'SIM';

/** D-182: which photo kinds this fitment needs, in form order. */
export function requiredPhotoKinds(input: { isVehicle: boolean; deviceReplacement: DeviceReplacement | null }): RequiredPhotoKind[] {
  const kinds: RequiredPhotoKind[] = ['BEFORE', 'ASSET'];
  if (input.isVehicle) kinds.push('CLUSTER');
  if (needsPlacementPhoto(input.deviceReplacement)) kinds.push('PLACEMENT');
  kinds.push('AFTER');
  return kinds;
}

const photoLabel = (kind: RequiredPhotoKind, r: DeviceReplacement | null) =>
  kind === 'PLACEMENT' ? placementLabel(r) : PHOTO_SLOT_LABELS[kind];

/**
 * D-180/182/183: what is still missing before SUBMIT, as readable labels in form order (e.g. 'Before photo',
 * 'Device id', 'CAN voltage'). Empty = ready.
 */
export function missingForSubmit(
  form: Pick<FitmentFormDto, 'vehicleRegNo' | 'clusterReadingKm' | 'deviceReplacement' | 'deviceId' | 'checks'>,
  activePhotoKinds: readonly PhotoKind[],
  ctx: { isVehicle: boolean },
): string[] {
  const r = form.deviceReplacement;
  const required = requiredPhotoKinds({ isVehicle: ctx.isVehicle, deviceReplacement: r });
  const missingPhoto = (k: RequiredPhotoKind) => required.includes(k) && !activePhotoKinds.includes(k);
  const missing: string[] = [];
  for (const k of ['BEFORE', 'ASSET', 'CLUSTER'] as const) if (missingPhoto(k)) missing.push(photoLabel(k, r));
  for (const c of FITMENT_CHECKS) if (!form.checks?.[c]) missing.push(CHECK_LABELS[c]);
  if (ctx.isVehicle && !form.vehicleRegNo) missing.push(FITMENT_FORM_FIELD_LABELS.vehicleRegNo);
  if (ctx.isVehicle && form.clusterReadingKm == null) missing.push(FITMENT_FORM_FIELD_LABELS.clusterReadingKm);
  if (!r) missing.push(FITMENT_FORM_FIELD_LABELS.deviceReplacement);
  if (!form.deviceId) missing.push(FITMENT_FORM_FIELD_LABELS.deviceId);
  for (const k of ['PLACEMENT', 'AFTER'] as const) if (missingPhoto(k)) missing.push(photoLabel(k, r));
  return missing;
}

/** The 400 FORM_INCOMPLETE message; `details.missing` holds the labels. */
export const formIncompleteMessage = (missing: readonly string[]): string => `Still needed: ${missing.join(', ')}`;

/** The 409 FITMENT_LOCKED message when the technician may no longer change the form or photos. */
export const FORM_LOCKED_MESSAGE = 'This fitment can no longer be changed: the form is editable only while In progress or Submitted.';

/** Statuses in which the assigned technician may save the form and upload photos (D-184). */
export const FORM_EDITABLE_STATUSES = ['IN_PROGRESS', 'SUBMITTED'] as const;

const TAKEN_AT_SKEW_MS = 5 * 60_000;

/** A multipart number field: '' or absent = not given. */
const multipartNumber = (min: number, max: number) =>
  z.preprocess(
    (v) => (v === '' || v === undefined || v === null ? undefined : typeof v === 'string' ? Number(v) : v),
    z.number({ error: 'Must be a number' }).min(min).max(max).optional(),
  );

/** Multipart fields of `POST /mobile/fitments/:fid/photos` (with the `file`). */
export const uploadTechnicianPhotoSchema = z
  .object({
    kind: z.enum(TECHNICIAN_PHOTO_KINDS as readonly RequiredPhotoKind[] as [RequiredPhotoKind, ...RequiredPhotoKind[]], {
      error: 'Choose a photo kind',
    }),
    lat: multipartNumber(-90, 90),
    lng: multipartNumber(-180, 180),
    takenAt: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z.iso
        .datetime({ offset: true, error: 'takenAt must be an ISO date-time' })
        .refine((v) => new Date(v).getTime() <= Date.now() + TAKEN_AT_SKEW_MS, 'takenAt cannot be in the future')
        .optional(),
    ),
  })
  .refine((v) => (v.lat === undefined) === (v.lng === undefined), {
    message: 'Send both lat and lng, or neither',
    path: ['lat'],
  });
export type UploadTechnicianPhotoInput = z.infer<typeof uploadTechnicianPhotoSchema>;
