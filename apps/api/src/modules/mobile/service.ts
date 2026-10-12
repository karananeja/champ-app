import {
  availableActions,
  formatTkId,
  istDayStart,
  type MobileHomeResponse,
  type MyFitmentDto,
  type MyFitmentsResponse,
} from '@champ/shared';
import type { Prisma } from '../../generated/prisma/client';
import { notFound } from '../../lib/errors';
import { prisma, type User } from '../../lib/prisma';
import { oeVerificationQueueWhere } from '../verification/service';

const DAY_MS = 24 * 3600 * 1000;

/** Fitments whose task's `fitmentAt` falls on an IST calendar day, of tasks that aren't deleted. */
export function onIstDay(date: string): Prisma.FitmentWhereInput {
  const start = istDayStart(date);
  if (!start) throw new Error(`Invalid IST day ${date}`); // the route validates the date first
  return { task: { deletedAt: null, fitmentAt: { gte: start, lt: new Date(start.getTime() + DAY_MS) } } };
}

/** Show tasks (F09 §3): my fitments on the day, in any status. */
export const myFitmentsWhere = (actor: User, date: string): Prisma.FitmentWhereInput => ({
  AND: [{ technicianId: actor.id }, onIstDay(date)],
});

/** `GET /mobile/home`: the home screen counts for the chosen IST day. */
export async function getHome(actor: User, date: string): Promise<MobileHomeResponse> {
  const [showTasks, approveVisit] = await Promise.all([
    prisma.fitment.count({ where: myFitmentsWhere(actor, date) }),
    actor.role === 'OE'
      ? prisma.fitment.count({ where: { AND: [oeVerificationQueueWhere(actor), onIstDay(date)] } })
      : Promise.resolve(null),
  ]);
  return { date, showTasks, approveVisit };
}

export const myFitmentInclude = {
  task: {
    select: {
      id: true,
      oeId: true,
      fitmentAt: true,
      client: { select: { name: true } },
      site: { select: { name: true, address: true, lat: true, lng: true } },
      activity: { select: { name: true } },
      oe: { select: { name: true, phone: true } },
      assetType: { select: { name: true } },
      installationType: { select: { name: true } },
    },
  },
} satisfies Prisma.FitmentInclude;

export type MyFitmentRow = Prisma.FitmentGetPayload<{ include: typeof myFitmentInclude }>;

/** The field app's view of one of my fitments (F09, F10 additions), with what I may do now. */
export function toMyFitmentDto(f: MyFitmentRow, actor: User): MyFitmentDto {
  const { site } = f.task;
  return {
    id: f.id,
    tkId: formatTkId(f.tkNo),
    status: f.status,
    fitmentAt: f.task.fitmentAt.toISOString(),
    customer: f.task.client.name,
    site: { name: site.name, address: site.address, lat: site.lat, lng: site.lng },
    vehicleRegNo: f.vehicleRegNo,
    activity: f.task.activity.name,
    taskId: f.task.id,
    oe: f.task.oe ? { name: f.task.oe.name, phone: f.task.oe.phone } : null,
    chassisNo: f.chassisNo,
    assetNumber: f.assetNumber,
    assetType: f.task.assetType.name,
    installationType: f.task.installationType.name,
    availableActions: availableActions(actor, { task: { oeId: f.task.oeId }, fitment: { technicianId: f.technicianId, status: f.status } }),
  };
}

/** `GET /mobile/fitments`: my fitments on the chosen IST day, by fitment time then TK number. */
export async function listMyFitments(actor: User, date: string): Promise<MyFitmentsResponse> {
  const rows = await prisma.fitment.findMany({
    where: myFitmentsWhere(actor, date),
    include: myFitmentInclude,
    orderBy: [{ task: { fitmentAt: 'asc' } }, { tkNo: 'asc' }],
  });
  return { date, items: rows.map((f) => toMyFitmentDto(f, actor)) };
}

/** `GET /mobile/fitments/:fid`: one of my fitments (of a task that isn't deleted), else 404. */
export async function getMyFitment(actor: User, fitmentId: string): Promise<MyFitmentDto> {
  const row = await prisma.fitment.findFirst({
    where: { id: fitmentId, technicianId: actor.id, task: { deletedAt: null } },
    include: myFitmentInclude,
  });
  if (!row) throw notFound('Fitment not found');
  return toMyFitmentDto(row, actor);
}
