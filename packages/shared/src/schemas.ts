import { z } from 'zod';
import { TECHNICIAN_TYPES } from './masters';
import { ROLES, USER_STATUSES } from './roles';

export const roleSchema = z.enum(ROLES);
export const userStatusSchema = z.enum(USER_STATUSES);

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Email is required')
  .pipe(z.email('Enter a valid email address'));

/** Password policy (D-037): at least 8 characters, one letter and one number. */
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[A-Za-z]/, 'Password must contain at least one letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

export const nameSchema = z.string().trim().min(1, 'Name is required').max(100);

export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9 ()-]{6,19}$/, 'Enter a valid phone number');

const optionalText = z.string().trim().max(100).optional();
const idSchema = z.string().trim().min(1);

// --- Auth ---

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const googleLoginSchema = z.object({
  idToken: z.string().min(1),
});
export type GoogleLoginInput = z.infer<typeof googleLoginSchema>;

// --- Invites ---

export const technicianTypeSchema = z.enum(TECHNICIAN_TYPES, { error: 'Choose a technician type' });

/** Fields an OT invite must carry so that accepting it yields a complete technician (F02). */
const technicianInviteFields = {
  name: nameSchema.optional(),
  phone: phoneSchema.optional(),
  technicianType: technicianTypeSchema.optional(),
  baseLocationId: idSchema.optional(),
};

/** Adds the "required for role OT" checks to an invite-like object schema. */
function requireTechnicianFields(
  value: { role: string; technicianType?: unknown; baseLocationId?: unknown },
  ctx: z.RefinementCtx,
) {
  if (value.role !== 'OT') return;
  if (!value.technicianType) {
    ctx.addIssue({ code: 'custom', path: ['technicianType'], message: 'Choose a technician type' });
  }
  if (!value.baseLocationId) {
    ctx.addIssue({ code: 'custom', path: ['baseLocationId'], message: 'Choose a base location' });
  }
}

export const createInviteSchema = z
  .object({
    email: emailSchema,
    role: roleSchema,
    managerId: idSchema.nullish(),
    jobTitle: optionalText,
    ...technicianInviteFields,
  })
  .superRefine(requireTechnicianFields);
export type CreateInviteInput = z.infer<typeof createInviteSchema>;

export const inviteLookupQuerySchema = z.object({
  token: z.string().trim().min(1),
});

export const acceptInviteSchema = z.object({
  token: z.string().trim().min(1),
  name: nameSchema,
  phone: phoneSchema,
  password: passwordSchema,
});
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;

export const acceptInviteGoogleSchema = z.object({
  token: z.string().trim().min(1),
  idToken: z.string().min(1),
});
export type AcceptInviteGoogleInput = z.infer<typeof acceptInviteGoogleSchema>;

// --- Users ---

export const listUsersQuerySchema = z.object({
  role: roleSchema.optional(),
  status: userStatusSchema.optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;

export const updateUserSchema = z
  .object({
    role: roleSchema.optional(),
    managerId: idSchema.nullable().optional(),
    status: userStatusSchema.optional(),
    name: nameSchema.optional(),
    phone: phoneSchema.nullable().optional(),
    jobTitle: z.string().trim().max(100).nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Nothing to update',
  });
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

export const delegationSchema = z
  .object({
    canManageUsers: z.boolean().optional(),
    canManageTaskTypes: z.boolean().optional(),
  })
  .refine((v) => v.canManageUsers !== undefined || v.canManageTaskTypes !== undefined, {
    message: 'Nothing to update',
  });
export type DelegationInput = z.infer<typeof delegationSchema>;

export const managersQuerySchema = z.object({
  role: z.enum(['OT', 'OE', 'RO']),
});
export type ManagersQuery = z.infer<typeof managersQuerySchema>;

// --- Masters (F02) ---

/** Trimmed master text with inner whitespace collapsed, e.g. `masterText('City')`. */
export const masterText = (label: string) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(1, `${label} is required`)
    .max(100, `${label} must be at most 100 characters`)
    .transform((v) => v.replace(/\s+/g, ' '));

export const masterNameSchema = masterText('Name');

/** A required reference id with a friendly message, e.g. `refId('Choose a state')`. */
const refId = (message: string) => z.string({ error: message }).trim().min(1, message);

const booleanQuery = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();
const searchQuery = z.string().trim().max(100).optional();

export const masterListQuerySchema = z.object({
  q: searchQuery,
  active: booleanQuery,
});
export type MasterListQuery = z.infer<typeof masterListQuerySchema>;

export const createLookupItemSchema = z.object({
  name: masterNameSchema,
  billable: z.boolean().optional(),
});
export type CreateLookupItemInput = z.infer<typeof createLookupItemSchema>;

const atLeastOne = (v: Record<string, unknown>) => Object.values(v).some((x) => x !== undefined);
const nothingToUpdate = { message: 'Nothing to update' };

export const updateLookupItemSchema = z
  .object({
    name: masterNameSchema.optional(),
    active: z.boolean().optional(),
    billable: z.boolean().optional(),
    sortOrder: z.number().int().min(-10_000).max(10_000).optional(),
  })
  .refine(atLeastOne, nothingToUpdate);
export type UpdateLookupItemInput = z.infer<typeof updateLookupItemSchema>;

export const activityListQuerySchema = masterListQuerySchema.extend({ assetTypeId: idSchema.optional() });
export type ActivityListQuery = z.infer<typeof activityListQuerySchema>;

export const createActivitySchema = z.object({
  name: masterNameSchema,
  assetTypeId: refId('Choose an asset type'),
});
export type CreateActivityInput = z.infer<typeof createActivitySchema>;

export const updateActivitySchema = z
  .object({
    name: masterNameSchema.optional(),
    assetTypeId: idSchema.optional(),
    active: z.boolean().optional(),
  })
  .refine(atLeastOne, nothingToUpdate);
export type UpdateActivityInput = z.infer<typeof updateActivitySchema>;

const makeSchema = masterText('Make');
const modelSchema = masterText('Model');

export const createMakeModelSchema = z.object({ make: makeSchema, model: modelSchema });
export type CreateMakeModelInput = z.infer<typeof createMakeModelSchema>;

export const updateMakeModelSchema = z
  .object({ make: makeSchema.optional(), model: modelSchema.optional(), active: z.boolean().optional() })
  .refine(atLeastOne, nothingToUpdate);
export type UpdateMakeModelInput = z.infer<typeof updateMakeModelSchema>;

export const locationListQuerySchema = masterListQuerySchema.extend({
  stateId: idSchema.optional(),
  regionId: idSchema.optional(),
});
export type LocationListQuery = z.infer<typeof locationListQuerySchema>;

export const createLocationSchema = z.object({
  city: masterText('City'),
  stateId: refId('Choose a state'),
  regionId: refId('Choose a region'),
});
export type CreateLocationInput = z.infer<typeof createLocationSchema>;

export const updateLocationSchema = z
  .object({
    city: masterText('City').optional(),
    stateId: idSchema.optional(),
    regionId: idSchema.optional(),
    active: z.boolean().optional(),
  })
  .refine(atLeastOne, nothingToUpdate);
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;

// --- Technicians (F02) ---

export const listTechniciansQuerySchema = z.object({
  q: searchQuery,
  type: technicianTypeSchema.optional(),
  baseLocationId: idSchema.optional(),
  managerId: idSchema.optional(),
  status: userStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListTechniciansQuery = z.infer<typeof listTechniciansQuerySchema>;

export const createTechnicianSchema = z.object({
  name: nameSchema,
  phone: phoneSchema,
  email: emailSchema,
  technicianType: technicianTypeSchema,
  baseLocationId: refId('Choose a base location'),
  /** The reporting OE. Ignored (forced to self) when an OE adds the technician. */
  managerId: idSchema.nullish(),
});
export type CreateTechnicianInput = z.infer<typeof createTechnicianSchema>;

export const updateTechnicianSchema = z
  .object({
    name: nameSchema.optional(),
    phone: phoneSchema.optional(),
    technicianType: technicianTypeSchema.optional(),
    baseLocationId: idSchema.optional(),
  })
  .refine(atLeastOne, nothingToUpdate);
export type UpdateTechnicianInput = z.infer<typeof updateTechnicianSchema>;
