import { MANAGER_RULES, ROLE_LABELS, type Role } from '@champ/shared';
import { badRequest } from '../../lib/errors';
import { prisma } from '../../lib/prisma';

/**
 * Validates a manager for a user with `role` against the reporting rules (D-024).
 * Returns the manager id to store (null when the role has no manager).
 */
export async function resolveManagerId(role: Role, managerId: string | null | undefined): Promise<string | null> {
  const rule = MANAGER_RULES[role];
  if (!rule.managerRole) {
    if (managerId) throw badRequest('MANAGER_NOT_ALLOWED', `A ${ROLE_LABELS[role]} has no manager`);
    return null;
  }
  if (!managerId) {
    if (rule.required) {
      throw badRequest('MANAGER_REQUIRED', `A ${ROLE_LABELS[role]} needs a ${ROLE_LABELS[rule.managerRole]} as manager`);
    }
    return null;
  }
  const manager = await prisma.user.findUnique({ where: { id: managerId } });
  if (!manager || manager.role !== rule.managerRole || manager.status !== 'ACTIVE') {
    throw badRequest(
      'MANAGER_INVALID',
      `The manager of a ${ROLE_LABELS[role]} must be an active ${ROLE_LABELS[rule.managerRole]}`,
    );
  }
  return manager.id;
}
