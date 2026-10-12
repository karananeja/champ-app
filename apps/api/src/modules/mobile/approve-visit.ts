import {
  availableActions,
  formatTkId,
  type ApproveVisitDetailDto,
  type ApproveVisitItemDto,
  type ApproveVisitListResponse,
} from '@champ/shared';
import type { Prisma } from '../../generated/prisma/client';
import { forbidden, notFound } from '../../lib/errors';
import { prisma, type User } from '../../lib/prisma';
import type { Storage } from '../../lib/storage';
import { toVerificationDto, verificationInclude } from '../verification/dto';
import { oeVerificationQueueWhere } from '../verification/service';
import { isVehicleAssetType, technicianPhotos, toFormDto } from './form';
import { onIstDay } from './service';

/** Approve visit offers only the review steps; the mobile app calls the existing transitions endpoint. */
const APPROVE_VISIT_ACTIONS = ['VERIFY', 'REOPEN'] as const;

const itemInclude = {
  technician: { select: { id: true, name: true } },
  task: {
    select: {
      oeId: true,
      client: { select: { name: true } },
      site: { select: { name: true, address: true } },
      assetType: { select: { code: true } },
    },
  },
} satisfies Prisma.FitmentInclude;
type ItemRow = Prisma.FitmentGetPayload<{ include: typeof itemInclude }>;

const toItemDto = (f: ItemRow): ApproveVisitItemDto => ({
  fitmentId: f.id,
  tkId: formatTkId(f.tkNo),
  customer: f.task.client.name,
  site: { name: f.task.site.name, address: f.task.site.address },
  technician: f.technician,
  vehicleRegNo: f.vehicleRegNo,
  submittedAt: f.submittedAt ? f.submittedAt.toISOString() : null,
});

function assertOe(actor: User) {
  if (actor.role !== 'OE') throw forbidden('FORBIDDEN', 'Only an operation executive can approve visits');
}

/** `GET /mobile/approve-visit`: the home count's fitments (D-219): Submitted, of my tasks, on the day; by submit time. */
export async function listApproveVisit(actor: User, date: string): Promise<ApproveVisitListResponse> {
  assertOe(actor);
  const rows = await prisma.fitment.findMany({
    where: { AND: [oeVerificationQueueWhere(actor), onIstDay(date)] },
    include: itemInclude,
    orderBy: [{ submittedAt: 'asc' }, { tkNo: 'asc' }],
  });
  return { date, items: rows.map(toItemDto) };
}

/**
 * `GET /mobile/approve-visit/:fid`: one fitment of a task I am the OE of (any status, so the app can show that
 * it was verified meanwhile), with the technician's form and photos and the current verification; 404 otherwise.
 */
export async function getApproveVisit(storage: Storage, actor: User, fitmentId: string): Promise<ApproveVisitDetailDto> {
  assertOe(actor);
  const row = await prisma.fitment.findFirst({
    where: { id: fitmentId, task: { oeId: actor.id, deletedAt: null } },
    include: { ...itemInclude, ...verificationInclude },
  });
  if (!row) throw notFound('Fitment not found');
  const actions = availableActions(actor, { task: { oeId: row.task.oeId }, fitment: { technicianId: row.technicianId, status: row.status } });
  return {
    item: toItemDto(row),
    status: row.status,
    isVehicle: isVehicleAssetType(row.task.assetType),
    form: toFormDto(row),
    photos: await technicianPhotos(storage, row.id),
    verification: toVerificationDto(row),
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    availableActions: actions.filter((a) => (APPROVE_VISIT_ACTIONS as readonly string[]).includes(a)),
  };
}
