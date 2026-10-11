import {
  canManageTechnician,
  type CreateInviteResponse,
  type CreateTechnicianInput,
  type ListTechniciansQuery,
  type Paginated,
  type TechnicianDto,
  type UpdateTechnicianInput,
} from '@champ/shared';
import type { Prisma } from '../../generated/prisma/client';
import { forbidden, notFound } from '../../lib/errors';
import { prisma, type User } from '../../lib/prisma';
import { createInvite } from '../invites/service';
import { requireActiveLocation } from '../masters/refs';
import { toUserDto, userWithManager } from '../users/dto';

const technicianInclude = {
  ...userWithManager,
  baseLocation: { select: { id: true, city: true, state: { select: { name: true } } } },
} satisfies Prisma.UserInclude;
type TechnicianRow = Prisma.UserGetPayload<{ include: typeof technicianInclude }>;

function toTechnicianDto(user: TechnicianRow): TechnicianDto {
  const { baseLocation } = user;
  return {
    ...toUserDto(user),
    baseLocation: baseLocation ? { id: baseLocation.id, city: baseLocation.city, state: baseLocation.state.name } : null,
  };
}

/** Technicians the actor may see: everyone for SA, OM and RO; an OE only their own reportees. */
function scopeFor(actor: User): Prisma.UserWhereInput {
  return actor.role === 'OE' ? { role: 'OT', managerId: actor.id } : { role: 'OT' };
}

export async function listTechnicians(actor: User, query: ListTechniciansQuery): Promise<Paginated<TechnicianDto>> {
  const where: Prisma.UserWhereInput = {
    AND: [
      scopeFor(actor),
      query.type ? { technicianType: query.type } : {},
      query.baseLocationId ? { baseLocationId: query.baseLocationId } : {},
      query.managerId ? { managerId: query.managerId } : {},
      query.status ? { status: query.status } : {},
      query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { email: { contains: query.q, mode: 'insensitive' } },
              { phone: { contains: query.q } },
            ],
          }
        : {},
    ],
  };
  const [total, users] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      include: technicianInclude,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return { items: users.map(toTechnicianDto), total, page: query.page, pageSize: query.pageSize };
}

/** Creates the technician's OT invite with the F01 rules (an OE is always the manager). */
export function createTechnician(actor: User, input: CreateTechnicianInput): Promise<CreateInviteResponse> {
  return createInvite(actor, {
    email: input.email,
    role: 'OT',
    managerId: actor.role === 'OE' ? actor.id : input.managerId,
    name: input.name,
    phone: input.phone,
    technicianType: input.technicianType,
    baseLocationId: input.baseLocationId,
  });
}

export async function updateTechnician(actor: User, id: string, input: UpdateTechnicianInput): Promise<TechnicianDto> {
  const tech = await prisma.user.findUnique({ where: { id } });
  if (!tech || tech.role !== 'OT') throw notFound('Technician not found');
  if (!canManageTechnician(actor, tech)) throw forbidden();

  if (input.baseLocationId !== undefined && input.baseLocationId !== tech.baseLocationId) {
    await requireActiveLocation(input.baseLocationId);
  }
  const updated = await prisma.user.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.phone !== undefined ? { phone: input.phone } : {}),
      ...(input.technicianType !== undefined ? { technicianType: input.technicianType } : {}),
      ...(input.baseLocationId !== undefined ? { baseLocationId: input.baseLocationId } : {}),
    },
    include: technicianInclude,
  });
  return toTechnicianDto(updated);
}
