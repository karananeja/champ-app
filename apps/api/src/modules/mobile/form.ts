import type { NextFunction, Request, Response } from 'express';
import {
  CHECK_LABELS,
  CHECK_VALUE_LABELS,
  FITMENT_CHECKS,
  FITMENT_FORM_FIELD_LABELS,
  TECHNICIAN_PHOTO_KINDS,
  VEHICLE_ASSET_TYPE_CODE,
  formLockedMessage,
  formValueText,
  formatTkId,
  isFormEditable,
  missingForSubmit,
  formIncompleteMessage,
  readableForm,
  sortPhotos,
  type CheckValue,
  type DeviceReplacement,
  type FitmentCheck,
  type FitmentFormDto,
  type FitmentFormField,
  type FitmentFormInput,
  type FitmentPhotoDto,
  type FitmentStatus,
  type RequiredPhotoKind,
  type UploadTechnicianPhotoInput,
} from '@champ/shared';
import type { Prisma } from '../../generated/prisma/client';
import { badRequest, conflict, forbidden } from '../../lib/errors';
import { prisma, type User } from '../../lib/prisma';
import type { Storage } from '../../lib/storage';
import { writeEvent } from '../tasks/events';
import { lockTask } from '../tasks/status';
import { loadFitment, photoData, photoInclude, storeThenWrite, toPhotoDto, type UploadedFile } from '../verification/photos';
import { currentUser } from '../../middleware/auth';

type Tx = Prisma.TransactionClient;

/** The form columns of a fitment (vehicleRegNo, chassisNo and otRemarks are reused, spec §1). */
export interface FormColumns {
  vehicleRegNo: string | null;
  chassisNo: string | null;
  clusterReadingKm: number | null;
  deviceReplacement: DeviceReplacement | null;
  deviceId: string | null;
  secondaryDeviceId: string | null;
  checks: unknown;
  otRemarks: string | null;
  formUpdatedAt: Date | null;
}

/** Only known checks with known values survive (the column is free JSON). */
function storedChecks(raw: unknown): FitmentFormDto['checks'] {
  const out: FitmentFormDto['checks'] = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const c of FITMENT_CHECKS) {
    const v = (raw as Record<string, unknown>)[c];
    if (v === 'OK' || v === 'NOT_OK' || v === 'NA') out[c] = v;
  }
  return out;
}

/** The technician's form of a fitment. */
export const toFormDto = (f: FormColumns): FitmentFormDto => ({
  vehicleRegNo: f.vehicleRegNo,
  chassisNo: f.chassisNo,
  clusterReadingKm: f.clusterReadingKm,
  deviceReplacement: f.deviceReplacement,
  deviceId: f.deviceId,
  secondaryDeviceId: f.secondaryDeviceId,
  checks: storedChecks(f.checks),
  comments: f.otRemarks,
  updatedAt: f.formUpdatedAt ? f.formUpdatedAt.toISOString() : null,
});

export const isVehicleAssetType = (assetType: { code: string | null }) => assetType.code === VEHICLE_ASSET_TYPE_CODE;

const TECHNICIAN_KINDS = [...TECHNICIAN_PHOTO_KINDS];

/** The active technician photos of a fitment, by kind, with presigned URLs. */
export async function technicianPhotos(storage: Storage, fitmentId: string, db: Tx = prisma): Promise<FitmentPhotoDto[]> {
  const rows = await db.fitmentPhoto.findMany({
    where: { fitmentId, status: 'ACTIVE', kind: { in: TECHNICIAN_KINDS } },
    include: photoInclude,
  });
  return Promise.all(sortPhotos(rows).map((p) => toPhotoDto(storage, p)));
}

/**
 * D-184: the assigned technician (OT or OE, D-158) while In progress or Submitted. Someone else gets 403;
 * the technician in any other status 409 FITMENT_LOCKED.
 */
export function assertFormEditable(actor: User, fitment: { tkNo: number; status: FitmentStatus; technicianId: string | null }) {
  if (!fitment.technicianId || fitment.technicianId !== actor.id) {
    throw forbidden('FORBIDDEN', 'Only the assigned technician can change this fitment');
  }
  if (!isFormEditable(fitment.status)) throw conflict('FITMENT_LOCKED', formLockedMessage(formatTkId(fitment.tkNo), fitment.status));
}

/**
 * Express middleware for the photo upload: checks the fitment rule before multer reads the file (D-108), so a
 * refused upload never streams the body into memory. The rule is checked again under the locks.
 */
export function technicianUploadGuard(req: Request, _res: Response, next: NextFunction) {
  loadFitment(req.params.fid as string)
    .then((fitment) => {
      assertFormEditable(currentUser(req), fitment);
      next();
    })
    .catch(next);
}

const SIMPLE_FIELDS = ['vehicleRegNo', 'chassisNo', 'clusterReadingKm', 'deviceReplacement', 'deviceId', 'secondaryDeviceId'] as const;

/** Applies a partial form to the stored one; returns the new form and the Prisma update (without formUpdatedAt). */
export function mergeForm(current: FitmentFormDto, input: FitmentFormInput): { next: FitmentFormDto; data: Prisma.FitmentUncheckedUpdateInput } {
  const next: FitmentFormDto = { ...current, checks: { ...current.checks } };
  const data: Prisma.FitmentUncheckedUpdateInput = {};
  for (const key of SIMPLE_FIELDS) {
    const v = input[key];
    if (v === undefined) continue;
    (next as unknown as Record<string, unknown>)[key] = v;
    data[key] = v as never;
  }
  if (input.comments !== undefined) {
    next.comments = input.comments;
    data.otRemarks = input.comments;
  }
  if (input.checks) {
    for (const [c, v] of Object.entries(input.checks) as [FitmentCheck, CheckValue | null | undefined][]) {
      if (v === undefined) continue;
      if (v === null) delete next.checks[c];
      else next.checks[c] = v;
    }
    data.checks = next.checks;
  }
  return { next, data };
}

/** `{ label: [before, after] }` of what changed, readable (checks and the replacement by their labels). */
export function formDiff(before: FitmentFormDto, after: FitmentFormDto): Record<string, [string | null, string | null]> {
  const diff: Record<string, [string | null, string | null]> = {};
  for (const c of FITMENT_CHECKS) {
    const b = before.checks[c] ?? null;
    const a = after.checks[c] ?? null;
    if (b !== a) diff[CHECK_LABELS[c]] = [b && CHECK_VALUE_LABELS[b], a && CHECK_VALUE_LABELS[a]];
  }
  for (const f of Object.keys(FITMENT_FORM_FIELD_LABELS) as FitmentFormField[]) {
    const b = formValueText(f, before);
    const a = formValueText(f, after);
    if (b !== a) diff[FITMENT_FORM_FIELD_LABELS[f]] = [b, a];
  }
  return diff;
}

/**
 * `PUT /mobile/fitments/:fid/form`: merges the partial form and sets `formUpdatedAt`. While In progress no event is
 * written (autosave); while Submitted a change writes FITMENT_FORM_UPDATED with the readable diff (D-184).
 */
export async function saveForm(actor: User, fitmentId: string, input: FitmentFormInput): Promise<void> {
  const located = await loadFitment(fitmentId);
  assertFormEditable(actor, located);
  await prisma.$transaction(async (tx) => {
    await lockTask(tx, located.taskId);
    await tx.$queryRaw`SELECT "id" FROM "Fitment" WHERE "id" = ${fitmentId} FOR UPDATE`;
    const fitment = await tx.fitment.findUniqueOrThrow({ where: { id: fitmentId } });
    assertFormEditable(actor, fitment);
    const current = toFormDto(fitment);
    const { next, data } = mergeForm(current, input);
    const diff = formDiff(current, next);
    await tx.fitment.update({ where: { id: fitmentId }, data: { ...data, formUpdatedAt: new Date() } });
    if (fitment.status === 'SUBMITTED' && Object.keys(diff).length) {
      await writeEvent(tx, actor, {
        taskId: fitment.taskId,
        fitmentId,
        type: 'FITMENT_FORM_UPDATED',
        data: { tkId: formatTkId(fitment.tkNo), ...diff },
      });
    }
  });
}

const RETAKE_REASON = 'Retaken by the technician';

/**
 * `POST /mobile/fitments/:fid/photos`: one active photo per technician kind. A new upload of a kind that has one
 * marks the old one REPLACED (linked) and writes PHOTO_REPLACED; a first upload writes PHOTO_ADDED. Same keys and
 * validation as F06; `takenAt`, `lat` and `lng` are stored.
 */
export async function uploadTechnicianPhoto(
  storage: Storage,
  actor: User,
  fitmentId: string,
  file: UploadedFile,
  input: UploadTechnicianPhotoInput,
): Promise<FitmentPhotoDto> {
  const kind: RequiredPhotoKind = input.kind;
  const photo = await storeThenWrite(
    storage,
    actor,
    fitmentId,
    file,
    async (tx, fitment, upload) => {
      const old = await tx.fitmentPhoto.findFirst({ where: { fitmentId, kind, status: 'ACTIVE' } });
      const created = await tx.fitmentPhoto.create({
        data: {
          ...photoData(actor, fitmentId, kind, file, upload),
          takenAt: input.takenAt ? new Date(input.takenAt) : null,
          lat: input.lat ?? null,
          lng: input.lng ?? null,
        },
        include: photoInclude,
      });
      const tkId = formatTkId(fitment.tkNo);
      if (old) {
        await tx.fitmentPhoto.update({
          where: { id: old.id },
          data: { status: 'REPLACED', replacedById: created.id, changeReason: RETAKE_REASON, changedById: actor.id, changedAt: new Date() },
        });
        await writeEvent(tx, actor, {
          taskId: fitment.taskId,
          fitmentId,
          type: 'PHOTO_REPLACED',
          data: { tkId, photoId: old.id, replacementId: created.id, kind, reason: RETAKE_REASON },
        });
      } else {
        await writeEvent(tx, actor, { taskId: fitment.taskId, fitmentId, type: 'PHOTO_ADDED', data: { tkId, photoId: created.id, kind } });
      }
      return created;
    },
    undefined,
    assertFormEditable,
  );
  return toPhotoDto(storage, photo);
}

/**
 * Inside the SUBMIT transaction (spec §3): 400 FORM_INCOMPLETE with `details.missing` when anything required is
 * missing; otherwise the readable form snapshot for the FITMENT_SUBMITTED event.
 */
export async function assertReadyToSubmit(tx: Tx, fitmentId: string): Promise<Record<string, string>> {
  const fitment = await tx.fitment.findUniqueOrThrow({
    where: { id: fitmentId },
    include: { task: { select: { assetType: { select: { code: true } } } } },
  });
  const photos = await tx.fitmentPhoto.findMany({ where: { fitmentId, status: 'ACTIVE' }, select: { kind: true } });
  const form = toFormDto(fitment);
  const missing = missingForSubmit(
    form,
    photos.map((p) => p.kind),
    { isVehicle: isVehicleAssetType(fitment.task.assetType) },
  );
  if (missing.length) throw badRequest('FORM_INCOMPLETE', formIncompleteMessage(missing), { missing });
  return readableForm(form);
}
