import {
  TECHNICIAN_TYPE_LABELS,
  TRAVEL_STATUS_LABELS,
  formatIstDateTime,
  formatTkId,
  formatTtId,
  istFileStamp,
  type ExportTravelQuery,
} from '@champ/shared';
import type { Prisma } from '../../generated/prisma/client';
import { prisma, type User } from '../../lib/prisma';
import { EXPORT_MAX_ROWS, writeFile, type ExportColumn, type ExportFile } from '../tasks/export';
import { dayOf, distanceOf } from './dto';
import { travelOrderBy, travelWhere } from './filters';

const name = { select: { name: true } } as const;

const exportInclude = {
  technician: { select: { name: true, technicianType: true, manager: name } },
  location: { select: { city: true } },
  client: name,
  relatedFitment: { select: { tkNo: true } },
  raisedBy: name,
  verifiedBy: name,
  rejectedBy: name,
  _count: { select: { attachments: { where: { status: 'ACTIVE' } } } },
} satisfies Prisma.TravelTaskInclude;
type ExportRow = Prisma.TravelTaskGetPayload<{ include: typeof exportInclude }>;

const istOrBlank = (d: Date | null) => (d ? formatIstDateTime(d) : '');

/** One row per TT for the reimbursement team (spec §3); times in IST. */
export const TRAVEL_COLUMNS: ExportColumn<ExportRow>[] = [
  { header: 'TT id', width: 12, value: (t) => formatTtId(t.ttNo) },
  { header: 'Travel date', width: 12, value: (t) => dayOf(t.travelDate) },
  { header: 'Technician', width: 20, value: (t) => t.technician.name },
  { header: 'Technician type', width: 14, value: (t) => (t.technician.technicianType ? TECHNICIAN_TYPE_LABELS[t.technician.technicianType] : '') },
  { header: 'OE', width: 20, value: (t) => t.technician.manager?.name ?? '' },
  { header: 'Location', width: 14, value: (t) => t.location.city },
  { header: 'Customer', width: 22, value: (t) => t.client?.name ?? '' },
  { header: 'Purpose', width: 40, value: (t) => t.purpose },
  { header: 'Related TK', width: 12, value: (t) => (t.relatedFitment ? formatTkId(t.relatedFitment.tkNo) : '') },
  { header: 'Distance (km)', width: 10, value: (t) => distanceOf(t.distanceKm) ?? '' },
  { header: 'Status', width: 10, value: (t) => TRAVEL_STATUS_LABELS[t.status] },
  { header: 'Raised by', width: 18, value: (t) => t.raisedBy.name },
  { header: 'Raised at (IST)', width: 18, value: (t) => formatIstDateTime(t.createdAt) },
  { header: 'Verified by', width: 18, value: (t) => t.verifiedBy?.name ?? '' },
  { header: 'Verified at (IST)', width: 18, value: (t) => istOrBlank(t.verifiedAt) },
  { header: 'Rejected by', width: 18, value: (t) => (t.status === 'REJECTED' ? (t.rejectedBy?.name ?? '') : '') },
  { header: 'Rejected at (IST)', width: 18, value: (t) => (t.status === 'REJECTED' ? istOrBlank(t.rejectedAt) : '') },
  { header: 'Rejection reason', width: 30, value: (t) => (t.status === 'REJECTED' ? (t.rejectionReason ?? '') : '') },
  { header: 'Attachments', width: 10, value: (t) => t._count.attachments },
];

/** `GET /travel-tasks/export`: the list filters and scope without paging (capped at 10,000 rows), CSV or Excel. */
export async function exportTravel(actor: User, query: ExportTravelQuery): Promise<ExportFile> {
  const rows = await prisma.travelTask.findMany({
    where: travelWhere(actor, query),
    include: exportInclude,
    orderBy: travelOrderBy(query),
    take: EXPORT_MAX_ROWS,
  });
  return writeFile(TRAVEL_COLUMNS, rows, query.format, `champ-travel-tasks-${istFileStamp()}`, 'Travel tasks');
}
