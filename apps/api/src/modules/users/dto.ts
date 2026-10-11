import type { UserDto } from '@champ/shared';
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
    createdAt: user.createdAt.toISOString(),
  };
}
