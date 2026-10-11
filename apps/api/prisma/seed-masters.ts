/**
 * Master data seed (F02). Idempotent: built-ins are upserted on (kind, code), everything else on its
 * natural key, so a second run creates nothing. Existing non-system rows are left untouched (edits and
 * deactivations survive a re-seed). Values other than the built-ins are dummy data (D-017).
 */
import { toMakeModelKey, toNameKey, type LookupKind } from '@champ/shared';
import type { PrismaClient } from '../src/generated/prisma/client';

interface SeedItem {
  name: string;
  code?: string;
  isSystem?: boolean;
  billable?: boolean;
  sortOrder?: number;
}

const builtIn = (name: string, code: string, sortOrder = 0): SeedItem => ({ name, code, isSystem: true, sortOrder });
const plain = (...names: string[]): SeedItem[] => names.map((name) => ({ name }));

export const INDIAN_STATES_AND_UTS = [
  // 28 states
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
  // 8 union territories
  'Andaman and Nicobar Islands',
  'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Jammu and Kashmir',
  'Ladakh',
  'Lakshadweep',
  'Puducherry',
];

export const LOOKUP_SEED: Record<LookupKind, SeedItem[]> = {
  ASSET_TYPE: [builtIn('Vehicle', 'VEHICLE', 1), builtIn('Battery', 'BATTERY', 2)],
  DEVICE_TYPE: [{ name: 'LAF5', code: 'LAF5' }],
  INSTALLATION_TYPE: plain('GPS', 'GPS+CAN'),
  STATE: plain(...INDIAN_STATES_AND_UTS),
  REGION: plain('North', 'South', 'East', 'West', 'Central'),
  ISSUE_REPORTED: plain(
    'Device not reporting',
    'Wrong GPS location',
    'Ignition status incorrect',
    'Vehicle battery draining',
    'Data delayed',
  ),
  ISSUE_OBSERVED: plain('Loose wiring', 'Antenna damaged', 'SIM not detected', 'Power cable cut', 'Device tampered'),
  ACTION_TAKEN: plain('Rewired power supply', 'Replaced antenna', 'Replaced SIM', 'Replaced device', 'Reconfigured device'),
  FINAL_ISSUE: [
    { name: 'Wiring issue', billable: true },
    { name: 'Device fault', billable: false },
    { name: 'SIM / network issue', billable: false },
    { name: 'Vehicle-side issue', billable: true },
    { name: 'Customer tampering', billable: true },
  ],
  ACCESSORY: plain('Relay', 'Buzzer', 'SOS button', 'CAN cable', 'Fuel sensor', 'Temperature sensor'),
  CLOSE_REASON: plain('Client not available', 'Device has some issue'),
  SHIFT_TYPE: [builtIn('Day', 'DAY', 1), builtIn('Night', 'NIGHT', 2), builtIn('Early morning', 'EARLY_MORNING', 3)],
  TASK_TYPE: [builtIn('OT', 'OT', 1), builtIn('TT', 'TT', 2), builtIn('FT', 'FT', 3)],
};

export const ACTIVITY_SEED: Record<'VEHICLE' | 'BATTERY', string[]> = {
  VEHICLE: ['New installation', 'Reinstallation', 'Removal', 'Device replacement', 'Health check'],
  BATTERY: ['New installation', 'Removal', 'Device replacement'],
};

export const MAKE_MODEL_SEED: [make: string, model: string][] = [
  ['Tata', 'Ace'],
  ['Ashok Leyland', 'Dost'],
  ['Mahindra', 'Bolero Pickup'],
  ['Eicher', 'Pro 2049'],
  ['Tata', 'Ultra T.7'],
  ['BharatBenz', '1015R'],
];

export const LOCATION_SEED: [city: string, state: string, region: string][] = [
  ['Bengaluru', 'Karnataka', 'South'],
  ['Chennai', 'Tamil Nadu', 'South'],
  ['Hyderabad', 'Telangana', 'South'],
  ['Mumbai', 'Maharashtra', 'West'],
  ['Pune', 'Maharashtra', 'West'],
  ['New Delhi', 'Delhi', 'North'],
  ['Kolkata', 'West Bengal', 'East'],
  ['Bhopal', 'Madhya Pradesh', 'Central'],
];

async function upsertLookup(db: PrismaClient, kind: LookupKind, item: SeedItem) {
  const nameKey = toNameKey(item.name);
  const data = {
    kind,
    name: item.name,
    nameKey,
    code: item.code ?? null,
    isSystem: item.isSystem ?? false,
    billable: kind === 'FINAL_ISSUE' ? (item.billable ?? false) : null,
    sortOrder: item.sortOrder ?? 0,
  };
  // Built-ins are re-asserted (name, active, system flag); other rows are left as they are.
  const update = item.isSystem ? { name: item.name, nameKey, isSystem: true, active: true } : {};
  return item.code
    ? db.lookupItem.upsert({ where: { kind_code: { kind, code: item.code } }, create: data, update })
    : db.lookupItem.upsert({ where: { kind_nameKey: { kind, nameKey } }, create: data, update });
}

export async function seedMasters(db: PrismaClient): Promise<void> {
  const byKind = new Map<LookupKind, Map<string, string>>(); // kind → nameKey/code → id
  for (const [kind, items] of Object.entries(LOOKUP_SEED) as [LookupKind, SeedItem[]][]) {
    const ids = new Map<string, string>();
    for (const item of items) {
      const row = await upsertLookup(db, kind, item);
      ids.set(item.code ?? toNameKey(item.name), row.id);
    }
    byKind.set(kind, ids);
  }
  const idOf = (kind: LookupKind, key: string) => {
    const id = byKind.get(kind)?.get(key);
    if (!id) throw new Error(`Seed: missing ${kind} ${key}`);
    return id;
  };

  for (const [assetCode, names] of Object.entries(ACTIVITY_SEED)) {
    const assetTypeId = idOf('ASSET_TYPE', assetCode);
    for (const name of names) {
      const nameKey = toNameKey(name);
      await db.activity.upsert({
        where: { assetTypeId_nameKey: { assetTypeId, nameKey } },
        create: { name, nameKey, assetTypeId },
        update: {},
      });
    }
  }

  for (const [make, model] of MAKE_MODEL_SEED) {
    const key = toMakeModelKey(make, model);
    await db.vehicleMakeModel.upsert({ where: { key }, create: { make, model, key }, update: {} });
  }

  for (const [city, state, region] of LOCATION_SEED) {
    const stateId = idOf('STATE', toNameKey(state));
    const cityKey = toNameKey(city);
    await db.location.upsert({
      where: { stateId_cityKey: { stateId, cityKey } },
      create: { city, cityKey, stateId, regionId: idOf('REGION', toNameKey(region)) },
      update: {},
    });
  }
}
