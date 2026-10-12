import { parseTravelId, travelScope, type TravelFilters } from '@champ/shared';
import type { Prisma } from '../../generated/prisma/client';
import type { User } from '../../lib/prisma';
import { dateOfDay } from './dto';

/**
 * The caller's scope (shared `travelScope`): SA, OM and RO see every TT; an OE the TTs of technicians who report
 * to them; an OT their own.
 */
export function travelScopeWhere(actor: User): Prisma.TravelTaskWhereInput {
  const scope = travelScope(actor);
  switch (scope.kind) {
    case 'all':
      return {};
    case 'team':
      return { technician: { managerId: scope.managerId } };
    case 'own':
      return { technicianId: scope.technicianId };
    case 'none':
      return { id: { in: [] } };
  }
}

/**
 * The `where` of `GET /travel-tasks` and its export: the caller's scope plus the filters. `oeId` is the
 * technician's reporting OE; `from`/`to` are travel dates (IST days, both inclusive); `q` is a TT id or number
 * (anything else matches nothing).
 */
export function travelWhere(actor: User, filters: Omit<TravelFilters, 'sort'>): Prisma.TravelTaskWhereInput {
  const and: Prisma.TravelTaskWhereInput[] = [travelScopeWhere(actor)];
  if (filters.technicianId) and.push({ technicianId: filters.technicianId });
  if (filters.oeId) and.push({ technician: { managerId: filters.oeId } });
  if (filters.clientId) and.push({ clientId: filters.clientId });
  if (filters.locationId) and.push({ locationId: filters.locationId });
  if (filters.status) and.push({ status: filters.status });
  if (filters.from) and.push({ travelDate: { gte: dateOfDay(filters.from) } });
  if (filters.to) and.push({ travelDate: { lte: dateOfDay(filters.to) } });
  if (filters.q) {
    const n = parseTravelId(filters.q);
    and.push(n ? { ttNo: n } : { id: { in: [] } });
  }
  return { AND: and };
}

/** The list order (travel date, newest first, by default); ties by TT number in the same direction. */
export function travelOrderBy(filters: Pick<TravelFilters, 'sort'>): Prisma.TravelTaskOrderByWithRelationInput[] {
  const [field, dir] = filters.sort.split(':') as ['travelDate' | 'createdAt', 'asc' | 'desc'];
  return [{ [field]: dir }, { ttNo: dir }];
}
