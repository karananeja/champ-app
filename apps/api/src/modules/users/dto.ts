import { isMobileRole, type HomeLocationDto, type UserDto } from '@champ/shared';
import type { Prisma } from '../../generated/prisma/client';

/** Prisma include that loads what `toUserDto` needs. */
export const userWithManager = {
  manager: { select: { id: true, name: true, phone: true } },
} satisfies Prisma.UserInclude;

export type UserWithManager = Prisma.UserGetPayload<{ include: typeof userWithManager }>;

export function toUserDto(user: UserWithManager): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    phone: user.phone,
    jobTitle: user.jobTitle,
    role: user.role,
    status: user.status,
    authProvider: user.authProvider,
    managerId: user.managerId,
    manager: user.manager,
    canManageUsers: user.canManageUsers,
    canManageTaskTypes: user.canManageTaskTypes,
    technicianType: user.technicianType,
    baseLocationId: user.baseLocationId,
    homeLocation: toHomeLocationDto(user),
    createdAt: user.createdAt.toISOString(),
  };
}

/** The home location (F09, D-129): OT and OE only, and only when every part is set. */
export function toHomeLocationDto(user: {
  role: UserWithManager['role'];
  homeLat: number | null;
  homeLng: number | null;
  homeAddress: string | null;
  homeUpdatedAt: Date | null;
}): HomeLocationDto | null {
  if (!isMobileRole(user.role)) return null;
  const { homeLat: lat, homeLng: lng, homeAddress: address, homeUpdatedAt: updatedAt } = user;
  if (lat === null || lng === null || address === null || updatedAt === null) return null;
  return { lat, lng, address, updatedAt: updatedAt.toISOString() };
}
