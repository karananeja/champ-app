import { z } from 'zod';
import { CLIENT_CODE_PATTERN } from './clients';
import { TECHNICIAN_TYPES } from './masters';
import { ROLES, USER_STATUSES } from './roles';
import { BOARD_MAX_PAGE_SIZE, BOARD_PAGE_SIZE } from './board';
import {
  BULK_MAX_ROWS,
  FITMENT_STATUSES,
  MAX_VEHICLES_PER_TASK,
  TASK_STATUSES,
  VEHICLE_CSV_COLUMNS,
  istDayStart,
  type VehicleCsvColumn,
} from './tasks';
import { PHOTO_KINDS } from './verification';
import {
  DEFAULT_TRAVEL_SORT,
  TRAVEL_MAX_DISTANCE_KM,
  TRAVEL_PURPOSE_MAX,
  TRAVEL_PURPOSE_MIN,
  TRAVEL_REASON_MAX,
  TRAVEL_REASON_MIN,
  TRAVEL_SORTS,
  TRAVEL_STATUSES,
  istTodayDay,
} from './travel';
import { MAX_BULK_APPROVE } from './workflow';

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

// --- Clients and sites (F03) ---

/**
 * An optional text field: blank (or whitespace) becomes `null`, so forms can send empty inputs and a PATCH
 * can clear the value; `undefined` (omitted) stays `undefined`.
 */
const blankable = <T extends z.ZodType<unknown, string>>(schema: T) =>
  z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : v))
    .pipe(schema.nullable())
    .nullish();

export const clientCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(CLIENT_CODE_PATTERN, 'Code must be 2–12 letters, digits or dashes (e.g. ZOOM)');

export const latSchema = z
  .number({ error: 'Place the pin on the map' })
  .min(-90, 'Latitude must be between -90 and 90')
  .max(90, 'Latitude must be between -90 and 90');

export const lngSchema = z
  .number({ error: 'Place the pin on the map' })
  .min(-180, 'Longitude must be between -180 and 180')
  .max(180, 'Longitude must be between -180 and 180');

const addressSchema = z
  .string({ error: 'Address is required' })
  .trim()
  .min(1, 'Address is required')
  .max(500, 'Address must be at most 500 characters');

const contactNameSchema = z
  .string({ error: 'Contact name is required' })
  .trim()
  .min(1, 'Contact name is required')
  .max(100, 'Contact name must be at most 100 characters');

const notesSchema = z.string().max(2000, 'Notes must be at most 2000 characters');

export const siteInputSchema = z.object({
  name: masterText('Site name'),
  address: addressSchema,
  lat: latSchema,
  lng: lngSchema,
  locationId: refId('Choose a city'),
  contactName: blankable(contactNameSchema),
  contactPhone: blankable(phoneSchema),
});
export type SiteInput = z.infer<typeof siteInputSchema>;

export const createSiteSchema = siteInputSchema;
export type CreateSiteInput = SiteInput;

export const updateSiteSchema = z
  .object({
    name: masterText('Site name').optional(),
    address: addressSchema.optional(),
    lat: latSchema.optional(),
    lng: lngSchema.optional(),
    locationId: idSchema.optional(),
    contactName: blankable(contactNameSchema),
    contactPhone: blankable(phoneSchema),
    active: z.boolean().optional(),
  })
  .refine(atLeastOne, nothingToUpdate)
  .refine((v) => (v.lat === undefined) === (v.lng === undefined), {
    message: 'Send latitude and longitude together',
    path: ['lat'],
  });
export type UpdateSiteInput = z.infer<typeof updateSiteSchema>;

const clientFields = {
  name: masterText('Client name'),
  code: blankable(clientCodeSchema),
  contactName: contactNameSchema,
  contactPhone: phoneSchema,
  contactEmail: blankable(emailSchema),
  billingEmail: blankable(emailSchema),
  notes: blankable(notesSchema),
};

export const createClientSchema = z.object({
  ...clientFields,
  sites: z
    .array(siteInputSchema, { error: 'Add at least one site' })
    .min(1, 'Add at least one site')
    .max(50, 'A client can have at most 50 sites in one request'),
});
export type CreateClientInput = z.infer<typeof createClientSchema>;

export const updateClientSchema = z
  .object({
    name: clientFields.name.optional(),
    code: clientFields.code,
    contactName: contactNameSchema.optional(),
    contactPhone: phoneSchema.optional(),
    contactEmail: clientFields.contactEmail,
    billingEmail: clientFields.billingEmail,
    notes: clientFields.notes,
    active: z.boolean().optional(),
  })
  .refine(atLeastOne, nothingToUpdate);
export type UpdateClientInput = z.infer<typeof updateClientSchema>;

export const listClientsQuerySchema = z.object({
  q: searchQuery,
  active: booleanQuery,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>;

// --- Geocoding (F03) ---

export const geoSearchQuerySchema = z.object({
  q: z.string({ error: 'Type at least 3 characters' }).trim().min(3, 'Type at least 3 characters').max(200),
});
export type GeoSearchQuery = z.infer<typeof geoSearchQuerySchema>;

export const geoReverseQuerySchema = z.object({
  lat: z.coerce.number().pipe(latSchema),
  lng: z.coerce.number().pipe(lngSchema),
});
export type GeoReverseQuery = z.infer<typeof geoReverseQuerySchema>;

// --- Tasks (F04) ---

const VEHICLE_FIELD_MAX = 50;
const vehicleText = (label: string) =>
  blankable(z.string().max(VEHICLE_FIELD_MAX, `${label} must be at most ${VEHICLE_FIELD_MAX} characters`));

/** One vehicle of a task (D-062). Every field is optional; blanks become null. */
export const vehicleRowSchema = z.object({
  vehicleRegNo: vehicleText('Registration number'),
  chassisNo: vehicleText('Chassis number'),
  assetNumber: vehicleText('Asset number'),
  oldDeviceId: vehicleText('Old device id'),
});
export type VehicleRowInput = z.infer<typeof vehicleRowSchema>;

/** Vehicles of a new task: a count (blank fitments) or one CSV row per vehicle. */
export const vehiclesSchema = z.discriminatedUnion(
  'entry',
  [
    z.object({
      entry: z.literal('COUNT'),
      count: z
        .number({ error: 'Enter the number of vehicles' })
        .int('Enter a whole number')
        .min(1, 'At least 1 vehicle')
        .max(MAX_VEHICLES_PER_TASK, `At most ${MAX_VEHICLES_PER_TASK} vehicles`),
    }),
    z.object({
      entry: z.literal('CSV'),
      rows: z
        .array(vehicleRowSchema, { error: 'Upload a vehicle CSV' })
        .min(1, 'The CSV has no vehicle rows')
        .max(MAX_VEHICLES_PER_TASK, `At most ${MAX_VEHICLES_PER_TASK} vehicles`),
    }),
  ],
  { error: 'Choose how to enter vehicles' },
);
export type VehiclesInput = z.infer<typeof vehiclesSchema>;

const isoDateTime = (message: string) => z.iso.datetime({ offset: true, error: message });
const optionalRef = idSchema.nullish();

const pocNameSchema = z
  .string({ error: 'POC name is required' })
  .trim()
  .min(1, 'POC name is required')
  .max(100, 'POC name must be at most 100 characters');

/** The task fields shared by create and edit ("header" fields; vehicles are create-only). */
const taskHeaderFields = {
  clientId: refId('Choose a customer'),
  siteId: refId('Choose a site'),
  pocName: pocNameSchema,
  pocPhone: phoneSchema,
  pocEmail: blankable(emailSchema),
  oeId: refId('Choose an operation executive'),
  technicianType: technicianTypeSchema.nullish(),
  assetTypeId: refId('Choose an asset type'),
  activityId: refId('Choose an activity'),
  deviceTypeId: refId('Choose a device type'),
  makeModelId: optionalRef,
  installationTypeId: refId('Choose an installation type'),
  requestedAt: isoDateTime('Choose the requested fitment date and time'),
  fitmentAt: isoDateTime('Choose the fitment date and time'),
  shiftTypeId: refId('Choose a shift type'),
  issueReportedId: refId('Choose the issue reported'),
  gpsAddress: blankable(z.string().max(500, 'GPS address must be at most 500 characters')),
  comments: blankable(z.string().max(2000, 'Comments must be at most 2000 characters')),
};

export const createTaskSchema = z.object({
  ...taskHeaderFields,
  vehicles: vehiclesSchema,
  /** Optional (D-063): every fitment is assigned to this technician. */
  technicianId: optionalRef,
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

export const MAKE_MODEL_REQUIRED = 'Choose the vehicle make/model';
export const MAKE_MODEL_NOT_ALLOWED = 'Make/model applies to vehicles only';

/**
 * The make/model rule: required when the asset type is a vehicle, empty otherwise. The API checks it against
 * the database; forms that know which asset type ids are vehicles use `createTaskSchemaFor`.
 */
export function makeModelIssue(isVehicle: boolean, makeModelId: string | null | undefined): string | null {
  if (isVehicle && !makeModelId) return MAKE_MODEL_REQUIRED;
  if (!isVehicle && makeModelId) return MAKE_MODEL_NOT_ALLOWED;
  return null;
}

/** `createTaskSchema` plus the make/model rule, given a way to tell vehicle asset types. */
export const createTaskSchemaFor = (isVehicle: (assetTypeId: string) => boolean) =>
  createTaskSchema.superRefine((value, ctx) => {
    const message = makeModelIssue(isVehicle(value.assetTypeId), value.makeModelId);
    if (message) ctx.addIssue({ code: 'custom', path: ['makeModelId'], message });
  });

/** PATCH /tasks/:id: header fields only (not vehicles or the count). */
export const updateTaskSchema = z
  .object({
    clientId: idSchema.optional(),
    siteId: idSchema.optional(),
    pocName: pocNameSchema.optional(),
    pocPhone: phoneSchema.optional(),
    pocEmail: taskHeaderFields.pocEmail,
    oeId: idSchema.optional(),
    technicianType: technicianTypeSchema.nullish(),
    assetTypeId: idSchema.optional(),
    activityId: idSchema.optional(),
    deviceTypeId: idSchema.optional(),
    makeModelId: optionalRef,
    installationTypeId: idSchema.optional(),
    requestedAt: taskHeaderFields.requestedAt.optional(),
    fitmentAt: taskHeaderFields.fitmentAt.optional(),
    shiftTypeId: idSchema.optional(),
    issueReportedId: idSchema.optional(),
    gpsAddress: taskHeaderFields.gpsAddress,
    comments: taskHeaderFields.comments,
  })
  .refine(atLeastOne, nothingToUpdate);
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

export const updateFitmentSchema = vehicleRowSchema.refine(atLeastOne, nothingToUpdate);
export type UpdateFitmentInput = z.infer<typeof updateFitmentSchema>;

export const assignFitmentsSchema = z.object({
  fitmentIds: z
    .array(idSchema, { error: 'Choose at least one fitment' })
    .min(1, 'Choose at least one fitment')
    .max(MAX_VEHICLES_PER_TASK),
  /** null unassigns. */
  technicianId: idSchema.nullable(),
});
export type AssignFitmentsInput = z.infer<typeof assignFitmentsSchema>;

/** Task list views: open = not completed; assigned = the caller's own (OE); completed (CR-04); all. */
export const TASK_VIEWS = ['open', 'assigned', 'completed', 'all'] as const;
export type TaskView = (typeof TASK_VIEWS)[number];

export const TASK_SORTS = [
  'fitmentAt:asc',
  'fitmentAt:desc',
  'createdAt:asc',
  'createdAt:desc',
  'completedAt:desc',
  'completedAt:asc',
] as const;
export type TaskSort = (typeof TASK_SORTS)[number];

/** The sort used when none is given: latest completion first for Completed tasks (CR-04), else soonest fitment. */
export const defaultTaskSort = (view: TaskView): TaskSort => (view === 'completed' ? 'completedAt:desc' : 'fitmentAt:asc');

const istDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/** Filters shared by `GET /tasks` and `GET /tasks/export`. `from`/`to` are IST days, both inclusive. */
const taskFilterFields = {
  view: z.enum(TASK_VIEWS).default('open'),
  q: searchQuery,
  clientId: idSchema.optional(),
  oeId: idSchema.optional(),
  technicianId: idSchema.optional(),
  status: z.enum(TASK_STATUSES).optional(),
  activityId: idSchema.optional(),
  from: istDay.optional(),
  to: istDay.optional(),
  /** Optional: when left out, `defaultTaskSort(view)` applies. */
  sort: z.enum(TASK_SORTS).optional(),
};

export const listTasksQuerySchema = z.object({
  ...taskFilterFields,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
export type TaskFilters = Omit<ListTasksQuery, 'page' | 'pageSize'>;

export const EXPORT_FORMATS = ['csv', 'xlsx'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** Export level (F06): one row per task (default) or one row per fitment with the verification columns. */
export const EXPORT_LEVELS = ['task', 'fitment'] as const;
export type ExportLevel = (typeof EXPORT_LEVELS)[number];

export const exportTasksQuerySchema = z.object({
  ...taskFilterFields,
  format: z.enum(EXPORT_FORMATS).default('csv'),
  level: z.enum(EXPORT_LEVELS).default('task'),
});
export type ExportTasksQuery = z.infer<typeof exportTasksQuerySchema>;

/** POST /tasks/bulk/import: the preview rows sent back (the server validates them again). */
export const bulkImportSchema = z.object({
  rows: z
    .array(
      z.object({
        rowNumber: z.number().int().min(1),
        data: z.record(z.string(), z.string().max(2000)),
      }),
      { error: 'Nothing to import' },
    )
    .min(1, 'Nothing to import')
    .max(BULK_MAX_ROWS, `At most ${BULK_MAX_ROWS} rows`),
});
export type BulkImportInput = z.infer<typeof bulkImportSchema>;

/**
 * Turns parsed vehicle CSV records (keys = normalised headers) into vehicle rows, with readable errors.
 * At least one data row, at most 500, and at least one known column; other columns are ignored.
 */
export function vehicleRowsFromCsv(
  headers: readonly string[],
  records: readonly Record<string, string | undefined>[],
): { rows: VehicleRowInput[]; errors: string[] } {
  const known = Object.keys(VEHICLE_CSV_COLUMNS) as VehicleCsvColumn[];
  const errors: string[] = [];
  if (!headers.some((h) => (known as string[]).includes(h))) {
    return { rows: [], errors: [`The header must have at least one of: ${known.join(', ')}`] };
  }
  if (records.length === 0) return { rows: [], errors: ['The CSV has no vehicle rows'] };
  if (records.length > MAX_VEHICLES_PER_TASK) {
    return { rows: [], errors: [`At most ${MAX_VEHICLES_PER_TASK} vehicles (the file has ${records.length})`] };
  }
  const rows: VehicleRowInput[] = [];
  records.forEach((record, i) => {
    const raw = Object.fromEntries(known.map((col) => [VEHICLE_CSV_COLUMNS[col], record[col] ?? '']));
    const parsed = vehicleRowSchema.safeParse(raw);
    if (parsed.success) rows.push(parsed.data);
    else errors.push(...parsed.error.issues.map((issue) => `Row ${i + 2}: ${issue.message}`));
  });
  return { rows, errors };
}

// --- Workflow (F05) ---

const noteSchema = blankable(z.string().max(500, 'The note must be at most 500 characters'));
const gpsCoordinate = (min: number, max: number) =>
  z.number({ error: 'The current GPS location is required' }).min(min, 'Invalid GPS location').max(max, 'Invalid GPS location');
const startPayload = z.object(
  { lat: gpsCoordinate(-90, 90), lng: gpsCoordinate(-180, 180), note: noteSchema },
  { error: 'The current GPS location is required' },
);
const notePayload = z.object({ note: noteSchema });
const closeNotDonePayload = z.object(
  {
    closeReasonId: refId('Choose a close reason'),
    comments: z
      .string({ error: 'Add comments' })
      .trim()
      .min(1, 'Add comments')
      .max(1000, 'Comments must be at most 1000 characters'),
    note: noteSchema,
  },
  { error: 'Choose a close reason and add comments' },
);
const markFaultyPayload = z.object(
  {
    reason: z
      .string({ error: 'Give the fault reason' })
      .trim()
      .min(1, 'Give the fault reason')
      .max(500, 'The fault reason must be at most 500 characters'),
    note: noteSchema,
  },
  { error: 'Give the fault reason' },
);
export const REOPEN_REASON_MIN = 3;
/** Reason of a reopen (D-027): 3–500 characters. Also used by the web dialog. */
export const reopenReasonSchema = z
  .string({ error: 'Give a reason for reopening' })
  .trim()
  .min(REOPEN_REASON_MIN, `Give a reason for reopening (at least ${REOPEN_REASON_MIN} characters)`)
  .max(500, 'The reason must be at most 500 characters');
const reopenPayload = z.object({ reason: reopenReasonSchema, note: noteSchema }, { error: 'Give a reason for reopening' });
/** Reason of an undo faulty (D-257): the reopen reason rules (3–500 characters). Also used by the web dialog. */
export const undoFaultyReasonSchema = z
  .string({ error: 'Give a reason for undoing the fault marking' })
  .trim()
  .min(REOPEN_REASON_MIN, `Give a reason for undoing the fault marking (at least ${REOPEN_REASON_MIN} characters)`)
  .max(500, 'The reason must be at most 500 characters');
const undoFaultyPayload = z.object(
  { reason: undoFaultyReasonSchema, note: noteSchema },
  { error: 'Give a reason for undoing the fault marking' },
);

// --- Verification (F06) ---

/** A verification reference: an id, or null to clear it; omitted = unchanged. */
const verificationRef = z.string().trim().min(1).nullable().optional();

/**
 * The verification fields (F06 spec §4), all optional: a draft save sends what it has. `null` clears a field;
 * `accessoryIds` replaces the whole set; blank remarks become null.
 */
export const verificationFieldsShape = {
  issueObservedId: verificationRef,
  actionTakenId: verificationRef,
  accessoryIds: z.array(idSchema).max(50, 'At most 50 accessories').optional(),
  oeRemarks: blankable(z.string().max(1000, 'The remarks must be at most 1000 characters')),
  finalIssueId: verificationRef,
};
export const VERIFICATION_FIELD_KEYS = Object.keys(verificationFieldsShape) as (keyof typeof verificationFieldsShape)[];

/** `PUT /fitments/:fid/verification` (draft save). */
export const updateVerificationSchema = z.object(verificationFieldsShape);
export type UpdateVerificationInput = z.infer<typeof updateVerificationSchema>;

/** Reason of a photo replacement or removal: 3–300 characters. */
export const PHOTO_REASON_MIN = 3;
export const photoReasonSchema = z
  .string({ error: 'Give a reason' })
  .trim()
  .min(PHOTO_REASON_MIN, `Give a reason (at least ${PHOTO_REASON_MIN} characters)`)
  .max(300, 'The reason must be at most 300 characters');

/** Multipart fields of `POST /fitments/:fid/photos`: only debug images are uploaded on the web. */
export const uploadPhotoSchema = z.object({
  kind: z
    .enum(PHOTO_KINDS, { error: 'Choose a photo kind' })
    .default('DEBUG')
    .refine((kind) => kind === 'DEBUG', 'Technician photos come from the mobile app; only debug images can be uploaded here'),
});
export type UploadPhotoInput = z.infer<typeof uploadPhotoSchema>;

/** Multipart fields of `POST /fitments/:fid/photos/:pid/replace`. */
export const replacePhotoSchema = z.object({ reason: photoReasonSchema });
/** `POST /fitments/:fid/photos/:pid/remove`. */
export const removePhotoSchema = z.object({ reason: photoReasonSchema });
export type PhotoChangeInput = z.infer<typeof removePhotoSchema>;

/** `GET /fitments/:fid/photos?history=true`: also replaced and removed photos (SA, OM, the task's OE). */
export const photoListQuerySchema = z.object({ history: booleanQuery });
export type PhotoListQuery = z.infer<typeof photoListQuerySchema>;

/** `POST /fitments/:fid/transitions`: `{ action, payload }`, the payload validated per action. */
export const transitionSchema = z.discriminatedUnion(
  'action',
  [
    z.object({ action: z.literal('START'), payload: startPayload }),
    z.object({ action: z.literal('SUBMIT'), payload: notePayload.optional() }),
    z.object({ action: z.literal('CLOSE_NOT_DONE'), payload: closeNotDonePayload }),
    z.object({ action: z.literal('MARK_FAULTY'), payload: markFaultyPayload }),
    // F06: VERIFY may carry the verification fields, saved first in the same transaction.
    z.object({ action: z.literal('VERIFY'), payload: notePayload.extend(verificationFieldsShape).optional() }),
    z.object({ action: z.literal('APPROVE'), payload: notePayload.optional() }),
    z.object({ action: z.literal('REOPEN'), payload: reopenPayload }),
    z.object({ action: z.literal('UNDO_FAULTY'), payload: undoFaultyPayload }),
  ],
  { error: 'Choose a valid action' },
);
export type TransitionInput = z.infer<typeof transitionSchema>;
/** The payload of any action (the engine reads the fields its action needs). */
export type TransitionPayload = {
  lat?: number;
  lng?: number;
  closeReasonId?: string;
  comments?: string;
  reason?: string;
  note?: string | null;
} & UpdateVerificationInput;

/**
 * `POST /dev/fitments/:fid/simulate` (D-073): a technician step. START may leave out the location (the
 * site's coordinates are used).
 */
export const simulateSchema = z.discriminatedUnion(
  'action',
  [
    z.object({ action: z.literal('START'), payload: startPayload.optional() }),
    z.object({ action: z.literal('SUBMIT'), payload: notePayload.optional() }),
    z.object({ action: z.literal('CLOSE_NOT_DONE'), payload: closeNotDonePayload }),
    z.object({ action: z.literal('MARK_FAULTY'), payload: markFaultyPayload }),
  ],
  { error: 'Choose a technician step' },
);
export type SimulateInput = z.infer<typeof simulateSchema>;

/** `POST /fitments/approve`: bulk final approve. */
export const approveFitmentsSchema = z.object({
  fitmentIds: z
    .array(idSchema, { error: 'Choose at least one fitment' })
    .min(1, 'Choose at least one fitment')
    .max(MAX_BULK_APPROVE, `At most ${MAX_BULK_APPROVE} fitments at a time`),
});
export type ApproveFitmentsInput = z.infer<typeof approveFitmentsSchema>;

/**
 * Filters of the workflow fitment lists (Awaiting approval, Re-opened, Faulty). `from`/`to` are IST days on
 * the list's date (verified, last reopened or moved to FT), both inclusive. `current` (Re-opened only):
 * still in status Reopened.
 */
export const workflowListQuerySchema = z.object({
  clientId: idSchema.optional(),
  oeId: idSchema.optional(),
  technicianId: idSchema.optional(),
  from: istDay.optional(),
  to: istDay.optional(),
  current: booleanQuery,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type WorkflowListQuery = z.infer<typeof workflowListQuerySchema>;

export const taskEventsQuerySchema = z.object({ format: z.enum(['json', 'csv']).default('json') });
export type TaskEventsQuery = z.infer<typeof taskEventsQuerySchema>;

// --- Board (F07) ---

/**
 * `GET /board` filters: customer, OE, technician, activity, fitment date (`from`/`to`, IST days, both
 * inclusive; when set, the finished columns drop their 7-day window, D-111) and `q`, a TK, OM or OE id (a bare
 * number matches any of the three). `pageSize` cards per column.
 */
export const boardQuerySchema = z.object({
  clientId: idSchema.optional(),
  oeId: idSchema.optional(),
  technicianId: idSchema.optional(),
  activityId: idSchema.optional(),
  from: istDay.optional(),
  to: istDay.optional(),
  q: searchQuery,
  pageSize: z.coerce.number().int().min(1).max(BOARD_MAX_PAGE_SIZE).default(BOARD_PAGE_SIZE),
});
export type BoardQuery = z.infer<typeof boardQuerySchema>;

/** `GET /board/:status`: the same filters plus `page` ("Load more"). */
export const boardColumnQuerySchema = boardQuerySchema.extend({ page: z.coerce.number().int().min(1).default(1) });
export type BoardColumnQuery = z.infer<typeof boardColumnQuerySchema>;

export const boardColumnParamsSchema = z.object({ status: z.enum(FITMENT_STATUSES, { error: 'Unknown board column' }) });

// --- Travel tasks (F08) ---

/** Purpose of travel: 3–1000 characters. */
export const travelPurposeSchema = z
  .string({ error: 'Describe the purpose of travel' })
  .trim()
  .min(TRAVEL_PURPOSE_MIN, `Describe the purpose of travel (at least ${TRAVEL_PURPOSE_MIN} characters)`)
  .max(TRAVEL_PURPOSE_MAX, `The purpose must be at most ${TRAVEL_PURPOSE_MAX} characters`);

/** Travel date: an IST calendar day, not in the future (D-119). */
export const travelDateSchema = z
  .string({ error: 'Choose the travel date' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose the travel date')
  .refine((day) => !!istDayStart(day), 'Choose a valid travel date')
  .refine((day) => day <= istTodayDay(), "The travel date can't be in the future");

/** Distance in km, as reported: more than 0, at most 5,000; rounded to one decimal. Null clears it. */
export const travelDistanceSchema = z
  .number({ error: 'Enter the distance in km' })
  .gt(0, 'The distance must be more than 0 km')
  .max(TRAVEL_MAX_DISTANCE_KM, `The distance must be at most ${TRAVEL_MAX_DISTANCE_KM.toLocaleString('en-IN')} km`)
  .transform((km) => Math.max(0.1, Math.round(km * 10) / 10))
  .nullish();

/** Reason of a reject or reopen: 3–500 characters. */
export const travelReasonSchema = z
  .string({ error: 'Give a reason' })
  .trim()
  .min(TRAVEL_REASON_MIN, `Give a reason (at least ${TRAVEL_REASON_MIN} characters)`)
  .max(TRAVEL_REASON_MAX, `The reason must be at most ${TRAVEL_REASON_MAX} characters`);

/** An optional reference: an id, or null / '' to clear it. */
const optionalTravelRef = z
  .string()
  .trim()
  .transform((v) => (v === '' ? null : v))
  .nullish();

/** `POST /travel-tasks`. Customer, related task and distance are optional (D-119). */
export const createTravelSchema = z.object({
  technicianId: refId('Choose a technician'),
  locationId: refId('Choose a location'),
  clientId: optionalTravelRef,
  purpose: travelPurposeSchema,
  travelDate: travelDateSchema,
  relatedFitmentId: optionalTravelRef,
  distanceKm: travelDistanceSchema,
});
export type CreateTravelInput = z.infer<typeof createTravelSchema>;

/** The editable fields, all optional (a PATCH or the `changes` of a resubmit). */
export const travelChangesSchema = z.object({
  technicianId: idSchema.optional(),
  locationId: idSchema.optional(),
  clientId: optionalTravelRef,
  purpose: travelPurposeSchema.optional(),
  travelDate: travelDateSchema.optional(),
  relatedFitmentId: optionalTravelRef,
  distanceKm: travelDistanceSchema,
});
export type TravelChangesInput = z.infer<typeof travelChangesSchema>;

/** `PATCH /travel-tasks/:id`. */
export const updateTravelSchema = travelChangesSchema.refine(atLeastOne, nothingToUpdate);
export type UpdateTravelInput = z.infer<typeof updateTravelSchema>;

/** `POST /travel-tasks/:id/transitions`: `{ action, reason?, changes? }`. */
export const travelTransitionSchema = z.discriminatedUnion(
  'action',
  [
    z.object({ action: z.literal('VERIFY') }),
    z.object({ action: z.literal('REJECT'), reason: travelReasonSchema }),
    z.object({ action: z.literal('RESUBMIT'), changes: travelChangesSchema.optional() }),
    z.object({ action: z.literal('REOPEN'), reason: travelReasonSchema }),
  ],
  { error: 'Choose a valid action' },
);
export type TravelTransitionInput = z.infer<typeof travelTransitionSchema>;

/** Filters of `GET /travel-tasks` and its export. `from`/`to`: travel date, IST days, both inclusive. */
const travelFilterFields = {
  technicianId: idSchema.optional(),
  /** The technician's reporting OE. */
  oeId: idSchema.optional(),
  clientId: idSchema.optional(),
  locationId: idSchema.optional(),
  status: z.enum(TRAVEL_STATUSES).optional(),
  from: istDay.optional(),
  to: istDay.optional(),
  /** A TT id or number. */
  q: searchQuery,
  sort: z.enum(TRAVEL_SORTS).default(DEFAULT_TRAVEL_SORT),
};

export const listTravelQuerySchema = z.object({
  ...travelFilterFields,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListTravelQuery = z.infer<typeof listTravelQuerySchema>;
export type TravelFilters = Omit<ListTravelQuery, 'page' | 'pageSize'>;

export const exportTravelQuerySchema = z.object({ ...travelFilterFields, format: z.enum(EXPORT_FORMATS).default('csv') });
export type ExportTravelQuery = z.infer<typeof exportTravelQuerySchema>;

/** `POST /travel-tasks/:id/attachments/:aid/remove`: an optional reason. */
export const removeTravelAttachmentSchema = z.object({
  reason: blankable(z.string().max(300, 'The reason must be at most 300 characters')),
});
export type RemoveTravelAttachmentInput = z.infer<typeof removeTravelAttachmentSchema>;

/** `GET /fitments/lookup?q=`: a TK id or number. */
export const fitmentLookupQuerySchema = z.object({
  q: z.string({ error: 'Type a TK id' }).trim().min(1, 'Type a TK id').max(100),
});
export type FitmentLookupQuery = z.infer<typeof fitmentLookupQuerySchema>;
