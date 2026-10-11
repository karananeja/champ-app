import { TECHNICIAN_TYPE_LABELS, makeModelIssue, type TechnicianType } from '@champ/shared';
import { HttpError, badRequest, forbidden } from '../../lib/errors';
import { prisma, type User } from '../../lib/prisma';
import { inactiveReference, invalidReference, requireActiveLookup } from '../masters/refs';

/** The references of a task, as stored (after a create body or a merged PATCH). */
export interface TaskRefValues {
  clientId: string;
  siteId: string;
  oeId: string;
  technicianType: TechnicianType | null;
  assetTypeId: string;
  activityId: string;
  deviceTypeId: string;
  makeModelId: string | null;
  installationTypeId: string;
  shiftTypeId: string;
  issueReportedId: string;
}

const fieldError = (field: string, message: string) =>
  badRequest('INVALID_REFERENCE', message, { fieldErrors: { [field]: [message] } });

/**
 * Validates a task's references (spec §1, §4). A value that is new (create) or changed (edit, when
 * `previous` is given) must exist, be of the right kind and be active; an unchanged value may have been
 * deactivated since. Cross-field rules always apply: the site belongs to the client, the activity to the
 * asset type, make/model is required for vehicles only, and an OE can only act for themselves.
 * Returns the site's location (D-061).
 */
export async function validateTaskRefs(
  actor: User,
  values: TaskRefValues,
  previous?: TaskRefValues,
): Promise<{ locationId: string }> {
  const changed = (field: keyof TaskRefValues) => !previous || previous[field] !== values[field];

  if (actor.role === 'OE' && values.oeId !== actor.id) {
    throw forbidden('FORBIDDEN', 'An operation executive can only create and manage their own tasks');
  }

  if (changed('clientId')) {
    const client = await prisma.client.findUnique({ where: { id: values.clientId } });
    if (!client) throw invalidReference('clientId', 'customer');
    if (!client.active) throw inactiveReference('clientId', client.name);
  }
  const site = await prisma.clientSite.findUnique({ where: { id: values.siteId } });
  if (!site || site.clientId !== values.clientId) {
    throw fieldError('siteId', "Choose one of this customer's sites");
  }
  if (changed('siteId') && !site.active) throw inactiveReference('siteId', site.name);

  if (changed('oeId')) {
    const oe = await prisma.user.findUnique({ where: { id: values.oeId } });
    if (!oe || oe.role !== 'OE') throw invalidReference('oeId', 'operation executive');
    if (oe.status !== 'ACTIVE') throw inactiveReference('oeId', oe.name);
  }

  const assetType = changed('assetTypeId')
    ? await requireActiveLookup(values.assetTypeId, 'ASSET_TYPE', 'assetTypeId')
    : await prisma.lookupItem.findUniqueOrThrow({ where: { id: values.assetTypeId } });

  const activity = await prisma.activity.findUnique({ where: { id: values.activityId } });
  if (!activity) throw invalidReference('activityId', 'activity');
  if (changed('activityId') && !activity.active) throw inactiveReference('activityId', activity.name);
  if (activity.assetTypeId !== assetType.id) {
    throw fieldError('activityId', `${activity.name} isn't an activity for ${assetType.name}`);
  }

  const issue = makeModelIssue(assetType.code === 'VEHICLE', values.makeModelId);
  if (issue) throw new HttpError(400, 'VALIDATION_ERROR', issue, { fieldErrors: { makeModelId: [issue] } });
  if (values.makeModelId && changed('makeModelId')) {
    const makeModel = await prisma.vehicleMakeModel.findUnique({ where: { id: values.makeModelId } });
    if (!makeModel) throw invalidReference('makeModelId', 'vehicle make/model');
    if (!makeModel.active) throw inactiveReference('makeModelId', `${makeModel.make} ${makeModel.model}`);
  }

  if (changed('deviceTypeId')) await requireActiveLookup(values.deviceTypeId, 'DEVICE_TYPE', 'deviceTypeId');
  if (changed('installationTypeId')) {
    await requireActiveLookup(values.installationTypeId, 'INSTALLATION_TYPE', 'installationTypeId');
  }
  if (changed('shiftTypeId')) await requireActiveLookup(values.shiftTypeId, 'SHIFT_TYPE', 'shiftTypeId');
  if (changed('issueReportedId')) {
    await requireActiveLookup(values.issueReportedId, 'ISSUE_REPORTED', 'issueReportedId');
  }

  return { locationId: site.locationId };
}

/** An active technician (OT) for an assignment; `technicianType`, when given, must match theirs. */
export async function requireTechnician(id: string, technicianType?: TechnicianType | null, field = 'technicianId') {
  const tech = await prisma.user.findUnique({ where: { id } });
  if (!tech || tech.role !== 'OT') throw invalidReference(field, 'technician');
  if (tech.status !== 'ACTIVE') throw inactiveReference(field, tech.name);
  if (technicianType && tech.technicianType !== technicianType) {
    throw fieldError(field, `${tech.name} isn't a ${TECHNICIAN_TYPE_LABELS[technicianType]} technician`);
  }
  return tech;
}

/** The built-in "OT" (operation task) task type, which every F04 task gets. */
export async function operationTaskType() {
  const taskType = await prisma.lookupItem.findUnique({ where: { kind_code: { kind: 'TASK_TYPE', code: 'OT' } } });
  if (!taskType) throw new Error('Task type OT is missing. Run `pnpm db:seed`.');
  return taskType;
}
