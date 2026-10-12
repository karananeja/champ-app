import type { ReactNode } from 'react';
import type { z } from 'zod';
import {
  LOOKUP_KIND_LABELS,
  TASK_TYPE_DESCRIPTIONS,
  canEditLookupKind,
  canEditMasters,
  createActivitySchema,
  createLocationSchema,
  createLookupItemSchema,
  createMakeModelSchema,
  lookupKindToSlug,
  type ActivityDto,
  type LocationDto,
  type LookupItemDto,
  type LookupKind,
  type LookupsResponse,
  type MakeModelDto,
  type UserDto,
} from '@champ/shared';
import type { SelectOption } from '@/components/searchable-select';
import { SystemBadge } from '@/components/system-badge';
import { Badge } from '@/components/ui/badge';

/** The common shape of every master row. */
export interface MasterRow {
  id: string;
  active: boolean;
  isSystem?: boolean;
}

export interface ColumnDef<Row> {
  header: string;
  cell: (row: Row) => ReactNode;
  className?: string;
}

export type FieldDef<Row> =
  | { name: string; label: string; type: 'text'; placeholder?: string }
  | { name: string; label: string; type: 'switch'; description: string }
  | {
      name: string;
      label: string;
      type: 'select';
      placeholder: string;
      options: (lookups: LookupsResponse) => SelectOption[];
      /** The row's current value, kept selectable when it is no longer active. */
      current?: (row: Row) => SelectOption;
    };

export interface FilterDef {
  param: string;
  label: string;
  allLabel: string;
  options: (lookups: LookupsResponse) => SelectOption[];
}

/** Everything the generic MasterTable / MasterFormDialog need to render one master. */
export interface MasterConfig<Row extends MasterRow = MasterRow> {
  slug: string;
  title: string;
  singular: string;
  description: string;
  /** API path for list/create; `${endpoint}/:id` for updates. */
  endpoint: string;
  /** Active item count, from `GET /lookups` (Masters landing page). */
  count: (lookups: LookupsResponse) => number;
  canEdit: (user: UserDto) => boolean;
  /** The first column is the row's title (and the card title on small screens). */
  columns: ColumnDef<Row>[];
  filters?: FilterDef[];
  fields: FieldDef<Row>[];
  /** Form validation (the shared create schema). */
  schema: z.ZodType;
  defaults: (row?: Row) => Record<string, unknown>;
  label: (row: Row) => string;
  searchPlaceholder: string;
}

const defineMaster = <Row extends MasterRow>(config: MasterConfig<Row>) => config as unknown as MasterConfig;

const options = (items: { id: string; name: string }[]): SelectOption[] =>
  items.map((i) => ({ value: i.id, label: i.name }));

/** Keys of `LookupsResponse` holding each simple master, used for item counts. */
const LOOKUP_COUNT_KEY: Record<LookupKind, keyof LookupsResponse> = {
  ASSET_TYPE: 'assetTypes',
  DEVICE_TYPE: 'deviceTypes',
  INSTALLATION_TYPE: 'installationTypes',
  STATE: 'states',
  REGION: 'regions',
  ISSUE_REPORTED: 'issuesReported',
  ISSUE_OBSERVED: 'issuesObserved',
  ACTION_TAKEN: 'actionsTaken',
  FINAL_ISSUE: 'finalIssues',
  ACCESSORY: 'accessories',
  CLOSE_REASON: 'closeReasons',
  SHIFT_TYPE: 'shiftTypes',
  TASK_TYPE: 'taskTypes',
};

const LOOKUP_DESCRIPTIONS: Record<LookupKind, string> = {
  ASSET_TYPE: 'What a device is fitted to. Vehicle and Battery are built in.',
  DEVICE_TYPE: 'Models of tracking device that can be fitted.',
  INSTALLATION_TYPE: 'How the device is installed.',
  STATE: 'Indian states and union territories, used by locations.',
  REGION: 'Regions used to group locations.',
  ISSUE_REPORTED: 'Problems reported by the client.',
  ISSUE_OBSERVED: 'Problems the technician finds on site.',
  ACTION_TAKEN: 'What the technician did to fix the problem.',
  FINAL_ISSUE: 'The final classification of a problem, and whether it is billable.',
  ACCESSORY: 'Accessories that can be fitted with a device.',
  CLOSE_REASON: 'Why a task was closed without being done.',
  SHIFT_TYPE: 'Work shifts. Day, Night and Early morning are built in.',
  TASK_TYPE: 'Kinds of task. OT, TT and FT are built in; others are names only.',
};

function lookupMaster(kind: LookupKind) {
  const labels = LOOKUP_KIND_LABELS[kind];
  const isFinalIssue = kind === 'FINAL_ISSUE';
  return defineMaster<LookupItemDto>({
    slug: lookupKindToSlug(kind),
    title: labels.plural,
    singular: labels.singular,
    description: LOOKUP_DESCRIPTIONS[kind],
    endpoint: `/masters/lookup/${lookupKindToSlug(kind)}`,
    count: (l) => (l[LOOKUP_COUNT_KEY[kind]] as unknown[]).length,
    canEdit: (user) => canEditLookupKind(user, kind),
    columns: [
      {
        header: 'Name',
        cell: (row) => (
          <span className="flex flex-wrap items-center gap-2">
            <span>{row.name}</span>
            {kind === 'TASK_TYPE' && row.code && TASK_TYPE_DESCRIPTIONS[row.code] && (
              <span className="text-muted-foreground">{TASK_TYPE_DESCRIPTIONS[row.code]}</span>
            )}
            {row.isSystem && <SystemBadge />}
          </span>
        ),
      },
      ...(isFinalIssue
        ? [
            {
              header: 'Billable',
              cell: (row: LookupItemDto) => (
                <Badge variant={row.billable ? 'default' : 'secondary'}>{row.billable ? 'Billable' : 'Not billable'}</Badge>
              ),
            },
          ]
        : []),
    ],
    fields: [
      { name: 'name', label: 'Name', type: 'text' },
      ...(isFinalIssue
        ? [
            {
              name: 'billable',
              label: 'Billable',
              type: 'switch' as const,
              description: 'Include this issue in the monthly billing report.',
            },
          ]
        : []),
    ],
    schema: createLookupItemSchema,
    defaults: (row) => ({ name: row?.name ?? '', ...(isFinalIssue ? { billable: row?.billable ?? false } : {}) }),
    label: (row) => row.name,
    searchPlaceholder: `Search ${labels.plural.toLowerCase()}`,
  });
}

const activities = defineMaster<ActivityDto>({
  slug: 'activities',
  title: 'Activities',
  singular: 'Activity',
  description: 'Work done on an asset. Each activity belongs to one asset type.',
  endpoint: '/masters/activities',
  count: (l) => l.activities.length,
  canEdit: canEditMasters,
  columns: [
    { header: 'Activity', cell: (row) => row.name },
    { header: 'Asset type', cell: (row) => row.assetType.name },
  ],
  filters: [{ param: 'assetTypeId', label: 'Asset type', allLabel: 'All asset types', options: (l) => options(l.assetTypes) }],
  fields: [
    { name: 'name', label: 'Name', type: 'text' },
    {
      name: 'assetTypeId',
      label: 'Asset type',
      type: 'select',
      placeholder: 'Select an asset type',
      options: (l) => options(l.assetTypes),
      current: (row) => ({ value: row.assetTypeId, label: row.assetType.name }),
    },
  ],
  schema: createActivitySchema,
  defaults: (row) => ({ name: row?.name ?? '', assetTypeId: row?.assetTypeId ?? '' }),
  label: (row) => `${row.name} (${row.assetType.name})`,
  searchPlaceholder: 'Search activities',
});

const makeModels = defineMaster<MakeModelDto>({
  slug: 'make-models',
  title: 'Vehicle make/model',
  singular: 'Make/model',
  description: 'Vehicle makes and models that devices are fitted to.',
  endpoint: '/masters/make-models',
  count: (l) => l.makeModels.length,
  canEdit: canEditMasters,
  columns: [
    { header: 'Make', cell: (row) => row.make },
    { header: 'Model', cell: (row) => row.model },
  ],
  fields: [
    { name: 'make', label: 'Make', type: 'text', placeholder: 'e.g. Tata' },
    { name: 'model', label: 'Model', type: 'text', placeholder: 'e.g. Ace' },
  ],
  schema: createMakeModelSchema,
  defaults: (row) => ({ make: row?.make ?? '', model: row?.model ?? '' }),
  label: (row) => `${row.make} ${row.model}`,
  searchPlaceholder: 'Search make or model',
});

const locations = defineMaster<LocationDto>({
  slug: 'locations',
  title: 'Locations',
  singular: 'Location',
  description: 'Cities used as technician base locations. A city is unique within its state.',
  endpoint: '/masters/locations',
  count: (l) => l.locations.length,
  canEdit: canEditMasters,
  columns: [
    { header: 'City', cell: (row) => row.city },
    { header: 'State', cell: (row) => row.state.name },
    { header: 'Region', cell: (row) => row.region.name },
  ],
  filters: [
    { param: 'stateId', label: 'State', allLabel: 'All states', options: (l) => options(l.states) },
    { param: 'regionId', label: 'Region', allLabel: 'All regions', options: (l) => options(l.regions) },
  ],
  fields: [
    { name: 'city', label: 'City', type: 'text' },
    {
      name: 'stateId',
      label: 'State',
      type: 'select',
      placeholder: 'Select a state',
      options: (l) => options(l.states),
      current: (row) => ({ value: row.stateId, label: row.state.name }),
    },
    {
      name: 'regionId',
      label: 'Region',
      type: 'select',
      placeholder: 'Select a region',
      options: (l) => options(l.regions),
      current: (row) => ({ value: row.regionId, label: row.region.name }),
    },
  ],
  schema: createLocationSchema,
  defaults: (row) => ({ city: row?.city ?? '', stateId: row?.stateId ?? '', regionId: row?.regionId ?? '' }),
  label: (row) => `${row.city}, ${row.state.name}`,
  searchPlaceholder: 'Search cities',
});

/** The 16 masters, in the order of the F02 intent. */
export const MASTERS: MasterConfig[] = [
  lookupMaster('ASSET_TYPE'),
  activities,
  lookupMaster('DEVICE_TYPE'),
  makeModels,
  lookupMaster('INSTALLATION_TYPE'),
  lookupMaster('STATE'),
  lookupMaster('REGION'),
  locations,
  lookupMaster('ISSUE_REPORTED'),
  lookupMaster('ISSUE_OBSERVED'),
  lookupMaster('ACTION_TAKEN'),
  lookupMaster('FINAL_ISSUE'),
  lookupMaster('ACCESSORY'),
  lookupMaster('CLOSE_REASON'),
  lookupMaster('SHIFT_TYPE'),
  lookupMaster('TASK_TYPE'),
];

export const masterBySlug = (slug: string | undefined) => MASTERS.find((m) => m.slug === slug);
