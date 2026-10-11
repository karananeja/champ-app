import {
  MANAGER_RULES,
  type DelegationInput,
  type ListUsersQuery,
  type ManagersQuery,
  type Paginated,
  type UpdateUserInput,
  type UserDto,
  type UserRef,
} from '@champ/shared';
import type { Prisma } from '../../generated/prisma/client';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors';
import { prisma, type User } from '../../lib/prisma';
import { revokeAllForUser } from '../auth/service';
import { toUserDto, userWithManager } from './dto';
import { resolveManagerId } from './managers';

/** Users the actor may see: SA, OM and RO see everyone; an OE sees self and own reportees. */
function scopeFor(actor: User): Prisma.UserWhereInput {
  if (actor.role === 'OE') return { OR: [{ id: actor.id }, { managerId: actor.id }] };
  if (actor.role === 'OT') return { id: actor.id };
  return {};
}

export async function getMe(actor: User): Promise<UserDto> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.id }, include: userWithManager });
  return toUserDto(user);
}

export async function listUsers(actor: User, query: ListUsersQuery): Promise<Paginated<UserDto>> {
  const where: Prisma.UserWhereInput = {
    AND: [
      scopeFor(actor),
      query.role ? { role: query.role } : {},
      query.status ? { status: query.status } : {},
      query.q
        ? {
            OR: [
              { name: { contains: query.q, mode: 'insensitive' } },
              { email: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {},
    ],
  };
  const [total, users] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      include: userWithManager,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);
  return { items: users.map(toUserDto), total, page: query.page, pageSize: query.pageSize };
}

export async function getUser(actor: User, id: string): Promise<UserDto> {
  const user = await prisma.user.findFirst({ where: { AND: [{ id }, scopeFor(actor)] }, include: userWithManager });
  if (!user) throw notFound('User not found');
  return toUserDto(user);
}

/** SA, or an OM with delegated user management. */
export function canManageUsers(actor: User): boolean {
  return actor.role === 'SUPER_ADMIN' || (actor.role === 'OM' && actor.canManageUsers);
}

const PRIVILEGED_ROLES = new Set(['SUPER_ADMIN', 'OM']);

export async function updateUser(actor: User, id: string, input: UpdateUserInput): Promise<UserDto> {
  if (!canManageUsers(actor)) throw forbidden();

  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) throw notFound('User not found');

  if (actor.role === 'OM') {
    if (PRIVILEGED_ROLES.has(target.role)) throw forbidden('FORBIDDEN', 'You cannot change Super Admin or OM users');
    if (input.role && PRIVILEGED_ROLES.has(input.role)) {
      throw forbidden('FORBIDDEN', 'You cannot grant the Super Admin or OM role');
    }
  }
  if (target.id === actor.id && (input.role !== undefined || input.status !== undefined)) {
    throw forbidden('CANNOT_MODIFY_SELF', 'You cannot change your own role or status');
  }

  const data: Prisma.UserUncheckedUpdateInput = {};
  const newRole = input.role ?? target.role;

  if (newRole !== target.role) {
    const reportees = await prisma.user.count({ where: { managerId: target.id } });
    if (reportees > 0) {
      throw conflict('HAS_REPORTEES', 'Reassign this user’s reportees before changing their role');
    }
    data.role = newRole;
    if (newRole !== 'OM') {
      data.canManageUsers = false;
      data.canManageTaskTypes = false;
    }
  }

  if (newRole !== target.role || input.managerId !== undefined) {
    // Keep the current manager if the patch doesn't change it and it is still valid for the new role.
    let managerId = input.managerId !== undefined ? input.managerId : target.managerId;
    if (!MANAGER_RULES[newRole].managerRole) managerId = null;
    if (managerId === target.id) throw badRequest('MANAGER_INVALID', 'A user cannot be their own manager');
    data.managerId = await resolveManagerId(newRole, managerId);
  }

  if (input.status !== undefined) data.status = input.status;
  if (input.name !== undefined) data.name = input.name;
  if (input.phone !== undefined) data.phone = input.phone;
  if (input.jobTitle !== undefined) data.jobTitle = input.jobTitle || null;

  const updated = await prisma.user.update({ where: { id }, data, include: userWithManager });
  if (input.status === 'INACTIVE') await revokeAllForUser(id);
  return toUserDto(updated);
}

export async function updateDelegation(id: string, input: DelegationInput): Promise<UserDto> {
  const target = await prisma.user.findUnique({ where: { id } });
  if (!target) throw notFound('User not found');
  if (target.role !== 'OM') throw badRequest('TARGET_NOT_OM', 'Delegation applies to Operations Managers only');
  const updated = await prisma.user.update({
    where: { id },
    data: {
      canManageUsers: input.canManageUsers,
      canManageTaskTypes: input.canManageTaskTypes,
    },
    include: userWithManager,
  });
  return toUserDto(updated);
}

/** Active candidate managers for a user with `role`. An OE can only pick themselves for an OT. */
export async function listManagerCandidates(actor: User, { role }: ManagersQuery): Promise<UserRef[]> {
  const managerRole = MANAGER_RULES[role].managerRole;
  if (!managerRole) return [];
  return prisma.user.findMany({
    where: {
      role: managerRole,
      status: 'ACTIVE',
      ...(actor.role === 'OE' ? { id: actor.id } : {}),
    },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  });
}
