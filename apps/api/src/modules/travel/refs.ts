import { formatTkId } from '@champ/shared';
import { prisma } from '../../lib/prisma';
import { inactiveReference, invalidReference, requireActiveLocation } from '../masters/refs';
import { requireTechnician } from '../tasks/refs';

/** The references of a TT, as stored (after a create body or a merged edit). */
export interface TravelRefValues {
  technicianId: string;
  locationId: string;
  clientId: string | null;
  relatedFitmentId: string | null;
}

/** Readable names of the references, for history diffs (`technician`, `location`, `customer`, `relatedTask`). */
export interface TravelRefNames {
  technician: string;
  location: string;
  customer: string | null;
  relatedTask: string | null;
}

/**
 * Validates a TT's references with the shared refs helpers (spec §1). A new or changed value must be valid:
 * an active OT, an active location, an active client, and a fitment that exists on a task that isn't deleted
 * (any technician's, e.g. picking up someone else's faulty device). An unchanged value is accepted even if it
 * was deactivated since. Returns the technician (for the permission rules) and the readable names.
 */
export async function validateTravelRefs(values: TravelRefValues, previous?: TravelRefValues) {
  const changed = (field: keyof TravelRefValues) => !previous || previous[field] !== values[field];

  const technician = changed('technicianId')
    ? await requireTechnician(values.technicianId)
    : await prisma.user.findUniqueOrThrow({ where: { id: values.technicianId } });

  const location = changed('locationId')
    ? await requireActiveLocation(values.locationId, 'locationId')
    : await prisma.location.findUniqueOrThrow({ where: { id: values.locationId } });

  let customer: string | null = null;
  if (values.clientId) {
    const client = await prisma.client.findUnique({ where: { id: values.clientId } });
    if (!client) throw invalidReference('clientId', 'customer');
    if (changed('clientId') && !client.active) throw inactiveReference('clientId', client.name);
    customer = client.name;
  }

  let relatedTask: string | null = null;
  if (values.relatedFitmentId) {
    const fitment = await prisma.fitment.findUnique({
      where: { id: values.relatedFitmentId },
      select: { tkNo: true, task: { select: { deletedAt: true } } },
    });
    if (!fitment || (changed('relatedFitmentId') && fitment.task.deletedAt)) {
      throw invalidReference('relatedFitmentId', 'related task', 'Choose an existing TK id');
    }
    relatedTask = formatTkId(fitment.tkNo);
  }

  const names: TravelRefNames = { technician: technician.name, location: location.city, customer, relatedTask };
  return { technician, names };
}
