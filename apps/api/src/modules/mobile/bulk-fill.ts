import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import Papa from 'papaparse';
import {
  BULK_FILL_COLUMNS,
  BULK_FILL_MAX_BYTES,
  BULK_FILL_MAX_ROWS,
  BULK_FILL_START_STATUSES,
  BULK_FILL_STATUSES,
  FITMENT_STATUS_LABELS,
  GPS_REQUIRED_MESSAGE,
  TECHNICIAN_PHOTO_KINDS,
  csvRowToForm,
  formHasValues,
  formatOmId,
  formatTkId,
  missingForSubmit,
  normalizeCsvHeader,
  parseTaskId,
  requiredPhotoKinds,
  toCsv,
  type BulkFillCellError,
  type BulkFillColumn,
  type BulkFillConfirmInput,
  type BulkFillConfirmResponse,
  type BulkFillPreviewResponse,
  type BulkFillPreviewRow,
  type BulkFillTaskDto,
  type FitmentFormInput,
  type FitmentStatus,
  type PhotoKind,
  type SubmitReadyResponse,
} from '@champ/shared';
import type { Prisma } from '../../generated/prisma/client';
import { HttpError, badRequest, notFound } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { prisma, type User } from '../../lib/prisma';
import { currentUser } from '../../middleware/auth';
import { lockTask } from '../tasks/status';
import { writeEvent } from '../tasks/events';
import { transitionFitment } from '../workflow/engine';
import { assertFormEditable, formDiff, isVehicleAssetType, mergeForm, toFormDto } from './form';
import { myFitmentInclude, toMyFitmentDto, type MyFitmentRow } from './service';

type Tx = Prisma.TransactionClient;

/**
 * Mobile CSV bulk fill (F11): the technician fills the forms of their fitments of one task from a CSV (preview,
 * then confirm, D-021), starts the not-yet-started ones with one GPS fix (D-202) and submits the complete ones.
 */

/** The caller's fitments of a task that isn't deleted, by seq; 404 when there are none (D-158: OT or OE). */
async function myTaskFitments(actor: User, taskId: string): Promise<MyFitmentRow[]> {
  const rows = await prisma.fitment.findMany({
    where: { taskId, technicianId: actor.id, task: { deletedAt: null } },
    include: myFitmentInclude(actor.id),
    orderBy: { seq: 'asc' },
  });
  if (rows.length === 0) throw notFound('Task not found');
  return rows;
}

/** Active technician photo kinds per fitment. */
async function activePhotoKinds(fitmentIds: string[]): Promise<Map<string, PhotoKind[]>> {
  const photos = await prisma.fitmentPhoto.findMany({
    where: { fitmentId: { in: fitmentIds }, status: 'ACTIVE', kind: { in: [...TECHNICIAN_PHOTO_KINDS] } },
    select: { fitmentId: true, kind: true },
  });
  const out = new Map<string, PhotoKind[]>(fitmentIds.map((id) => [id, []]));
  for (const p of photos) out.get(p.fitmentId)!.push(p.kind);
  return out;
}

const missingOf = (f: MyFitmentRow, kinds: PhotoKind[]) =>
  missingForSubmit(toFormDto(f), kinds, { isVehicle: isVehicleAssetType(f.task.assetType) });

/** `GET /mobile/tasks/:taskId/bulk-fill`: the caller's fitments of the task with what each still misses. */
export async function getBulkFill(actor: User, taskId: string): Promise<BulkFillTaskDto> {
  const rows = await myTaskFitments(actor, taskId);
  const [task, kinds] = await Promise.all([
    prisma.task.findUniqueOrThrow({ where: { id: taskId }, select: { omNo: true } }),
    activePhotoKinds(rows.map((f) => f.id)),
  ]);
  const first = toMyFitmentDto(rows[0]!, actor);
  return {
    taskId,
    omId: formatOmId(task.omNo),
    customer: first.customer,
    site: first.site,
    fitmentAt: first.fitmentAt,
    fitments: rows.map((f) => {
      const photoKinds = kinds.get(f.id)!;
      const required = requiredPhotoKinds({ isVehicle: isVehicleAssetType(f.task.assetType), deviceReplacement: f.deviceReplacement });
      return {
        fitment: toMyFitmentDto(f, actor),
        missing: missingOf(f, photoKinds),
        missingPhotos: required.filter((k) => !photoKinds.includes(k)),
      };
    }),
  };
}

/** `GET /mobile/tasks/:taskId/bulk-fill/sample.csv`: one row per fillable fitment, TK id and reg/chassis filled. */
export async function bulkFillSampleCsv(actor: User, taskId: string): Promise<{ filename: string; body: string }> {
  const rows = await myTaskFitments(actor, taskId);
  const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, select: { omNo: true } });
  const data = rows
    .filter((f) => BULK_FILL_STATUSES.includes(f.status))
    .map((f) => BULK_FILL_COLUMNS.map((c) => (c === 'tk_id' ? formatTkId(f.tkNo) : c === 'vehicle_reg_no' ? f.vehicleRegNo : c === 'chassis_no' ? f.chassisNo : '')));
  return { filename: `bulk-fill-${formatOmId(task.omNo)}.csv`, body: `﻿${toCsv(BULK_FILL_COLUMNS, data)}` };
}

// --- Upload ---

const fileError = (code: 'VALIDATION_ERROR' | 'FILE_TOO_LARGE', message: string) =>
  badRequest(code, message, { fieldErrors: { file: [message] } });

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: BULK_FILL_MAX_BYTES, files: 1 } }).single('file');

/**
 * Express middleware for the preview: the caller must have fitments in the task before multer reads the file
 * (D-108); then the multipart `file` (≤ 1 MB) into memory, with friendly 400s.
 */
export function bulkFillUpload(req: Request, res: Response, next: NextFunction) {
  myTaskFitments(currentUser(req), req.params.taskId as string)
    .then(() =>
      upload(req, res, (err: unknown) => {
        if (err instanceof multer.MulterError) {
          return next(err.code === 'LIMIT_FILE_SIZE' ? fileError('FILE_TOO_LARGE', 'The file must be 1 MB or smaller') : fileError('VALIDATION_ERROR', err.message));
        }
        if (err) return next(err);
        if (!req.file) return next(fileError('VALIDATION_ERROR', 'Choose a CSV file to upload'));
        next();
      }),
    )
    .catch(next);
}

type CsvRow = Partial<Record<BulkFillColumn, string>>;

/** Parses the CSV like the F04 bulk upload (BOM, trimmed cells, row numbers count the header as row 1). */
export function parseBulkFillCsv(buffer: Buffer): { rowNumber: number; cells: CsvRow }[] {
  if (buffer.includes(0)) throw fileError('VALIDATION_ERROR', 'Upload a CSV file (this looks like a binary file)');
  const text = buffer.toString('utf8').replace(/^﻿/, '');
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: normalizeCsvHeader,
    transform: (value) => value.trim(),
  });
  if (!(parsed.meta.fields ?? []).includes('tk_id')) {
    throw fileError('VALIDATION_ERROR', 'Missing column: tk_id. Download the sample for the format.');
  }
  if (parsed.data.length === 0) throw fileError('VALIDATION_ERROR', 'The file has no fitment rows');
  if (parsed.data.length > BULK_FILL_MAX_ROWS) {
    throw fileError('VALIDATION_ERROR', `At most ${BULK_FILL_MAX_ROWS} rows per file (this one has ${parsed.data.length})`);
  }
  return parsed.data.map((raw, i) => {
    const cells: CsvRow = {};
    for (const c of BULK_FILL_COLUMNS) if (typeof raw[c] === 'string') cells[c] = raw[c];
    return { rowNumber: i + 2, cells };
  });
}

// --- Row checks (preview and confirm) ---

interface TaskContext {
  /** The caller's fitments of the task by TK number. */
  mine: Map<number, MyFitmentRow>;
  /** TK numbers of every fitment of the task (anyone's). */
  inTask: Set<number>;
}

async function loadContext(actor: User, taskId: string): Promise<TaskContext> {
  const mine = await myTaskFitments(actor, taskId);
  const all = await prisma.fitment.findMany({ where: { taskId }, select: { tkNo: true } });
  return { mine: new Map(mine.map((f) => [f.tkNo, f])), inTask: new Set(all.map((f) => f.tkNo)) };
}

const VERIFIED_STATUSES: readonly FitmentStatus[] = ['OE_VERIFIED', 'OM_APPROVED'];

interface RowRefusal {
  code: 'VALIDATION_ERROR' | 'FORBIDDEN' | 'FITMENT_LOCKED';
  message: string;
}

/** The TK number a row's tk_id names (TK prefix optional), or null. */
function tkNoOf(text: string): number | null {
  const parsed = parseTaskId(text);
  return parsed && (!parsed.prefix || parsed.prefix === 'TK') ? parsed.number : null;
}

/** Row-level checks: the TK id, ownership, duplicates and the status (spec §2). */
function checkRow(ctx: TaskContext, tkText: string, counts: Map<number, number>): { fitment: MyFitmentRow } | { refusal: RowRefusal } {
  const tkNo = tkNoOf(tkText);
  if (!tkText.trim()) return { refusal: { code: 'VALIDATION_ERROR', message: 'Enter the TK id' } };
  if (tkNo === null) return { refusal: { code: 'VALIDATION_ERROR', message: `"${tkText}" is not a TK id (e.g. TK-00012)` } };
  const tkId = formatTkId(tkNo);
  if (!ctx.inTask.has(tkNo)) return { refusal: { code: 'VALIDATION_ERROR', message: `${tkId} is not a fitment of this task` } };
  const fitment = ctx.mine.get(tkNo);
  if (!fitment) return { refusal: { code: 'FORBIDDEN', message: `${tkId} is not assigned to you` } };
  if ((counts.get(tkNo) ?? 0) > 1) return { refusal: { code: 'VALIDATION_ERROR', message: `${tkId} appears more than once in the file` } };
  if (VERIFIED_STATUSES.includes(fitment.status)) return { refusal: { code: 'FITMENT_LOCKED', message: 'Already verified — read only' } };
  if (!BULK_FILL_STATUSES.includes(fitment.status)) {
    return { refusal: { code: 'FITMENT_LOCKED', message: `This fitment is ${FITMENT_STATUS_LABELS[fitment.status]}` } };
  }
  return { fitment };
}

const tkCounts = (tkTexts: string[]) => {
  const counts = new Map<number, number>();
  for (const t of tkTexts) {
    const n = tkNoOf(t);
    if (n !== null) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  return counts;
};

const willStart = (f: MyFitmentRow) => BULK_FILL_START_STATUSES.includes(f.status);
const NOTHING_TO_FILL = 'Nothing to fill';

/** `POST /mobile/tasks/:taskId/bulk-fill/preview`: checks every row and writes nothing. */
export async function previewBulkFill(actor: User, taskId: string, buffer: Buffer): Promise<BulkFillPreviewResponse> {
  const ctx = await loadContext(actor, taskId);
  const parsed = parseBulkFillCsv(buffer);
  const counts = tkCounts(parsed.map((r) => r.cells.tk_id ?? ''));
  const rows: BulkFillPreviewRow[] = parsed.map(({ rowNumber, cells }) => {
    const tkId = cells.tk_id ?? '';
    const { form, errors: cellErrors } = csvRowToForm(cells);
    const checked = checkRow(ctx, tkId, counts);
    const errors: BulkFillCellError[] = [];
    let fitmentId: string | null = null;
    let start = false;
    if ('refusal' in checked) {
      errors.push({ column: checked.refusal.code === 'FITMENT_LOCKED' ? '' : 'tk_id', message: checked.refusal.message });
    } else {
      fitmentId = checked.fitment.id;
      start = willStart(checked.fitment);
    }
    errors.push(...cellErrors);
    if (errors.length === 0 && !start && !formHasValues(form)) errors.push({ column: '', message: NOTHING_TO_FILL });
    return { rowNumber, tkId, fitmentId, form, willStart: start && errors.length === 0, errors, valid: errors.length === 0 };
  });
  const validCount = rows.filter((r) => r.valid).length;
  return { rows, validCount, invalidCount: rows.length - validCount, startCount: rows.filter((r) => r.willStart).length };
}

/** Merges a CSV row into the stored form; one FITMENT_FORM_CSV_FILLED event when anything changed (D-190, D-205). */
async function fillForm(tx: Tx, actor: User, fitmentId: string, input: FitmentFormInput) {
  const fitment = await tx.fitment.findUniqueOrThrow({ where: { id: fitmentId } });
  assertFormEditable(actor, fitment);
  const current = toFormDto(fitment);
  const { next, data } = mergeForm(current, input);
  const diff = formDiff(current, next);
  await tx.fitment.update({ where: { id: fitmentId }, data: { ...data, formUpdatedAt: new Date() } });
  if (Object.keys(diff).length) {
    await writeEvent(tx, actor, {
      taskId: fitment.taskId,
      fitmentId,
      type: 'FITMENT_FORM_CSV_FILLED',
      data: { tkId: formatTkId(fitment.tkNo), ...diff },
    });
  }
}

const failure = (err: unknown): { code: string; message: string } => {
  if (err instanceof HttpError) return { code: err.code, message: err.message };
  logger.error({ err }, 'Bulk fill: unexpected error');
  return { code: 'INTERNAL_ERROR', message: 'Could not fill this fitment' };
};

/**
 * `POST /mobile/tasks/:taskId/bulk-fill/confirm`: checks the rows again, then in seq order starts the
 * Assigned/Reopened fitments (one GPS fix, D-202) and fills the forms, each fitment in its own transaction.
 */
export async function confirmBulkFill(actor: User, taskId: string, input: BulkFillConfirmInput): Promise<BulkFillConfirmResponse> {
  const ctx = await loadContext(actor, taskId);
  const counts = tkCounts(input.rows.map((r) => r.tkId));
  const result: BulkFillConfirmResponse = { filled: [], started: [], failed: [] };
  const valid: { rowNumber: number; fitment: MyFitmentRow; form: FitmentFormInput }[] = [];
  for (const row of input.rows) {
    const checked = checkRow(ctx, row.tkId, counts);
    if ('refusal' in checked) {
      result.failed.push({ rowNumber: row.rowNumber, tkId: row.tkId, ...checked.refusal });
    } else if (!willStart(checked.fitment) && !formHasValues(row.form)) {
      result.failed.push({ rowNumber: row.rowNumber, tkId: row.tkId, code: 'VALIDATION_ERROR', message: NOTHING_TO_FILL });
    } else {
      valid.push({ rowNumber: row.rowNumber, fitment: checked.fitment, form: row.form });
    }
  }
  const { lat, lng } = input;
  const gps = lat !== undefined && lng !== undefined ? { lat, lng } : null;
  if (!gps && valid.some((r) => willStart(r.fitment))) throw badRequest('GPS_REQUIRED', GPS_REQUIRED_MESSAGE);

  valid.sort((a, b) => a.fitment.seq - b.fitment.seq);
  for (const { rowNumber, fitment, form } of valid) {
    const tkId = formatTkId(fitment.tkNo);
    try {
      if (willStart(fitment)) {
        // The START (route order, event) and the fill share the engine's transaction.
        await transitionFitment(actor, fitment.id, 'START', { lat: gps!.lat, lng: gps!.lng }, { afterApply: (tx) => fillForm(tx, actor, fitment.id, form) });
        result.started.push(tkId);
      } else {
        await prisma.$transaction(async (tx) => {
          await lockTask(tx, fitment.taskId);
          await tx.$queryRaw`SELECT "id" FROM "Fitment" WHERE "id" = ${fitment.id} FOR UPDATE`;
          await fillForm(tx, actor, fitment.id, form);
        });
      }
      result.filled.push(tkId);
    } catch (err) {
      result.failed.push({ rowNumber, tkId, ...failure(err) });
    }
  }
  result.failed.sort((a, b) => a.rowNumber - b.rowNumber);
  return result;
}

/**
 * `POST /mobile/tasks/:taskId/submit-ready` (D-204): submits every In-progress fitment of the caller in the task
 * whose form and photos are complete, in seq order, each in its own transaction.
 */
export async function submitReady(actor: User, taskId: string): Promise<SubmitReadyResponse> {
  const rows = await myTaskFitments(actor, taskId);
  const kinds = await activePhotoKinds(rows.map((f) => f.id));
  const result: SubmitReadyResponse = { submitted: [], incomplete: [], skipped: [] };
  for (const f of rows) {
    const tkId = formatTkId(f.tkNo);
    if (f.status !== 'IN_PROGRESS') {
      result.skipped.push(tkId);
      continue;
    }
    const missing = missingOf(f, kinds.get(f.id)!);
    if (missing.length) {
      result.incomplete.push({ tkId, missing });
      continue;
    }
    try {
      await transitionFitment(actor, f.id, 'SUBMIT');
      result.submitted.push(tkId);
    } catch (err) {
      if (err instanceof HttpError && err.code === 'FORM_INCOMPLETE') {
        result.incomplete.push({ tkId, missing: (err.details as { missing: string[] }).missing });
      } else if (err instanceof HttpError) {
        // Changed in between (e.g. closed): left alone.
        result.skipped.push(tkId);
      } else {
        throw err;
      }
    }
  }
  return result;
}
