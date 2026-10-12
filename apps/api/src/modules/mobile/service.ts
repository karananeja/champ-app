import {
  formatTkId,
  istDayStart,
  type MobileHomeResponse,
  type MyFitmentDto,
  type MyFitmentsResponse,
} from '@champ/shared';
import type { Prisma } from '../../generated/prisma/client';
import { prisma, type User } from '../../lib/prisma';
import { oeVerificationQueueWhere } from '../verification/service';

const DAY_MS = 24 * 3600 * 1000;

/** Fitments whose task's `fitmentAt` falls on an IST calendar day, of tasks that aren't deleted. */
function onIstDay(date: string): Prisma.FitmentWhereInput {
  const start = istDayStart(date);
  if (!start) throw new Error(`Invalid IST day ${date}`); // the route validates the date first
  return { task: { deletedAt: null, fitmentAt: { gte: start, lt: new Date(start.getTime() + DAY_MS) } } };
}

/** Show tasks (F09 §3): my fitments on the day, in any status. */
const myFitmentsWhere = (actor: User, date: string): Prisma.FitmentWhereInput => ({
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

const myFitmentInclude = {
  task: {
    select: {
      fitmentAt: true,
      client: { select: { name: true } },
      site: { select: { name: true, address: true, lat: true, lng: true } },
      activity: { select: { name: true } },
    },
  },
} satisfies Prisma.FitmentInclude;

type MyFitmentRow = Prisma.FitmentGetPayload<{ include: typeof myFitmentInclude }>;

function toMyFitmentDto(f: MyFitmentRow): MyFitmentDto {
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
  };
}

/** `GET /mobile/fitments`: my fitments on the chosen IST day, by fitment time then TK number. */
export async function listMyFitments(actor: User, date: string): Promise<MyFitmentsResponse> {
  const rows = await prisma.fitment.findMany({
    where: myFitmentsWhere(actor, date),
    include: myFitmentInclude,
    orderBy: [{ task: { fitmentAt: 'asc' } }, { tkNo: 'asc' }],
  });
  return { date, items: rows.map(toMyFitmentDto) };
}
