import { z } from 'zod';
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

export const createInviteSchema = z.object({
  email: emailSchema,
  role: roleSchema,
  managerId: idSchema.nullish(),
  jobTitle: optionalText,
});
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
