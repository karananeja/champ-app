import { LOOKUP_KIND_LABELS, type LookupKind } from '@champ/shared';
import { Prisma } from '../../generated/prisma/client';
import { badRequest, conflict } from '../../lib/errors';
import { prisma } from '../../lib/prisma';

/**
 * Validates a reference to a `LookupItem` for a new or changed value: it must exist, be of `kind`
 * and be active. Existing references to items that were deactivated later are not re-checked.
 */
export async function requireActiveLookup(id: string, kind: LookupKind, field: string) {
  const label = LOOKUP_KIND_LABELS[kind].singular.toLowerCase();
  const item = await prisma.lookupItem.findUnique({ where: { id } });
  if (!item || item.kind !== kind) {
    throw badRequest('INVALID_REFERENCE', `Choose a valid ${label}`, { fieldErrors: { [field]: [`Not a ${label}`] } });
  }
  if (!item.active) {
    const message = `${item.name} is inactive and can't be chosen`;
    throw badRequest('INACTIVE_REFERENCE', message, { fieldErrors: { [field]: [message] } });
  }
  return item;
}

/** Validates a base location for a technician (new or changed value): it must exist and be active. */
export async function requireActiveLocation(id: string, field = 'baseLocationId') {
  const location = await prisma.location.findUnique({ where: { id } });
  if (!location) {
    throw badRequest('INVALID_REFERENCE', 'Choose a valid location', { fieldErrors: { [field]: ['Not a location'] } });
  }
  if (!location.active) {
    const message = `${location.city} is inactive and can't be chosen`;
    throw badRequest('INACTIVE_REFERENCE', message, { fieldErrors: { [field]: [message] } });
  }
  return location;
}

export const duplicate = (message: string) => conflict('DUPLICATE', message);

const isUniqueViolation = (err: unknown) =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

/**
 * Runs a write and maps a unique-constraint violation (a concurrent duplicate that slipped past the
 * pre-check) to 409 DUPLICATE.
 */
export async function withDuplicateCheck<T>(write: () => Promise<T>, message: string): Promise<T> {
  try {
    return await write();
  } catch (err) {
    if (isUniqueViolation(err)) throw duplicate(message);
    throw err;
  }
}
