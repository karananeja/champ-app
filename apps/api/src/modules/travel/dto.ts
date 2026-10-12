import {
  availableTravelActions,
  canEditTravel,
  canManageTravelAttachments,
  canVerifyTravel,
  formatOmId,
  formatTkId,
  formatTtId,
  type TravelAttachmentDto,
  type TravelAttachmentStatus,
  type TravelEventDto,
  type TravelEventType,
  type TravelStatus,
  type TravelTaskDto,
  type TravelTaskListItemDto,
} from '@champ/shared';
import type { Prisma } from '../../generated/prisma/client';
import type { User } from '../../lib/prisma';
import { PHOTO_URL_TTL_SEC, type Storage } from '../../lib/storage';

const userRef = { select: { id: true, name: true } } as const;

/** What a list row needs. */
export const travelListInclude = {
  technician: { select: { id: true, name: true, technicianType: true, managerId: true, manager: userRef } },
  location: { select: { id: true, city: true, active: true } },
  client: { select: { id: true, name: true, active: true } },
  relatedFitment: { select: { id: true, tkNo: true, task: { select: { id: true, omNo: true, client: { select: { name: true } } } } } },
  raisedBy: userRef,
  _count: { select: { attachments: { where: { status: 'ACTIVE' } } } },
} satisfies Prisma.TravelTaskInclude;
export type TravelListRow = Prisma.TravelTaskGetPayload<{ include: typeof travelListInclude }>;

/** What the detail needs: the list fields plus the people, active receipts and the history. */
export const travelDetailInclude = {
  ...travelListInclude,
  verifiedBy: userRef,
  rejectedBy: userRef,
  reopenedBy: userRef,
  attachments: { where: { status: 'ACTIVE' }, include: { uploadedBy: userRef }, orderBy: { createdAt: 'asc' } },
  events: { include: { actor: userRef }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.TravelTaskInclude;
export type TravelDetailRow = Prisma.TravelTaskGetPayload<{ include: typeof travelDetailInclude }>;

type AttachmentRow = TravelDetailRow['attachments'][number];

const isoOrNull = (d: Date | null) => (d ? d.toISOString() : null);

/** A `@db.Date` value (UTC midnight) as the IST calendar day it stands for, `YYYY-MM-DD`. */
export const dayOf = (d: Date): string => d.toISOString().slice(0, 10);
/** An IST calendar day as the `@db.Date` value stored for it. */
export const dateOfDay = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

export const distanceOf = (d: Prisma.Decimal | null): number | null => (d === null ? null : Number(d));

export function toTravelListItem(t: TravelListRow): TravelTaskListItemDto {
  return {
    id: t.id,
    ttId: formatTtId(t.ttNo),
    status: t.status,
    source: t.source,
    travelDate: dayOf(t.travelDate),
    technician: { id: t.technician.id, name: t.technician.name, technicianType: t.technician.technicianType },
    oe: t.technician.manager,
    location: { id: t.location.id, city: t.location.city },
    client: t.client ? { id: t.client.id, name: t.client.name } : null,
    purpose: t.purpose,
    distanceKm: distanceOf(t.distanceKm),
    relatedFitment: t.relatedFitment ? { id: t.relatedFitment.id, tkId: formatTkId(t.relatedFitment.tkNo) } : null,
    attachmentCount: t._count.attachments,
    raisedBy: t.raisedBy,
    createdAt: t.createdAt.toISOString(),
  };
}

/** A receipt with a presigned GET URL (10 minutes), images and PDFs alike. */
export async function toAttachmentDto(storage: Storage, a: AttachmentRow): Promise<TravelAttachmentDto> {
  return {
    id: a.id,
    status: a.status as TravelAttachmentStatus,
    url: await storage.signedGetUrl(a.objectKey, PHOTO_URL_TTL_SEC),
    contentType: a.contentType,
    sizeBytes: a.sizeBytes,
    width: a.width,
    height: a.height,
    originalName: a.originalName,
    uploadedBy: a.uploadedBy,
    createdAt: a.createdAt.toISOString(),
  };
}

const toEventDto = (e: TravelDetailRow['events'][number]): TravelEventDto => ({
  id: e.id,
  at: e.createdAt.toISOString(),
  actor: e.actor,
  type: e.type as TravelEventType,
  fromStatus: e.fromStatus as TravelStatus | null,
  toStatus: e.toStatus as TravelStatus | null,
  data: e.data,
});

/** The rules' view of a TT and its technician. */
export const ruleContext = (t: { status: TravelStatus; raisedById: string; technician: { id: string; managerId: string | null } }) => ({
  tt: { status: t.status, raisedById: t.raisedById },
  tech: { id: t.technician.id, managerId: t.technician.managerId },
});

/** `GET /travel-tasks/:id` for this caller (flags from the shared rules). */
export async function toTravelDto(storage: Storage, t: TravelDetailRow, actor: User): Promise<TravelTaskDto> {
  const { tt, tech } = ruleContext(t);
  return {
    ...toTravelListItem(t),
    location: { id: t.location.id, city: t.location.city, active: t.location.active },
    client: t.client ? { id: t.client.id, name: t.client.name, active: t.client.active } : null,
    relatedFitment: t.relatedFitment
      ? {
          id: t.relatedFitment.id,
          tkId: formatTkId(t.relatedFitment.tkNo),
          taskId: t.relatedFitment.task.id,
          omId: formatOmId(t.relatedFitment.task.omNo),
          client: t.relatedFitment.task.client.name,
        }
      : null,
    verifiedAt: isoOrNull(t.verifiedAt),
    verifiedBy: t.verifiedBy,
    rejectedAt: isoOrNull(t.rejectedAt),
    rejectedBy: t.rejectedBy,
    rejectionReason: t.rejectionReason,
    reopenedAt: isoOrNull(t.reopenedAt),
    reopenedBy: t.reopenedBy,
    reopenReason: t.reopenReason,
    updatedAt: t.updatedAt.toISOString(),
    attachments: await Promise.all(t.attachments.map((a) => toAttachmentDto(storage, a))),
    events: t.events.map(toEventDto),
    canEdit: canEditTravel(actor, tt),
    canVerify: canVerifyTravel(actor, tech),
    canManageAttachments: canManageTravelAttachments(actor, tt, tech),
    availableActions: availableTravelActions(actor, tt, tech),
  };
}
