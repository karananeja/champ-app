import { describe, expect, it } from 'vitest';
import type { User } from '../src/lib/prisma';
import { bearer, createLocation, createLookup, createOrg, createUser, testApi } from './helpers';

const api = () => testApi();

describe('LookupItem masters — CRUD', () => {
  it('SA creates, lists, renames, deactivates and reactivates an accessory', async () => {
    const { sa } = await createOrg();
    const created = await api().post('/api/masters/lookup/accessory').set(bearer(sa)).send({ name: '  GPS   Relay ' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ kind: 'ACCESSORY', name: 'GPS Relay', active: true, isSystem: false, billable: null });

    const id = created.body.id as string;
    const renamed = await api().patch(`/api/masters/lookup/accessory/${id}`).set(bearer(sa)).send({ name: 'Relay 12V' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('Relay 12V');

    const off = await api().patch(`/api/masters/lookup/accessory/${id}`).set(bearer(sa)).send({ active: false });
    expect(off.body.active).toBe(false);

    const all = await api().get('/api/masters/lookup/accessory').set(bearer(sa));
    expect(all.body.items).toHaveLength(1);
    const active = await api().get('/api/masters/lookup/accessory').query({ active: 'true' }).set(bearer(sa));
    expect(active.body.items).toHaveLength(0);
    const inactive = await api().get('/api/masters/lookup/accessory').query({ active: 'false' }).set(bearer(sa));
    expect(inactive.body.items.map((i: { name: string }) => i.name)).toEqual(['Relay 12V']);

    const on = await api().patch(`/api/masters/lookup/accessory/${id}`).set(bearer(sa)).send({ active: true });
    expect(on.body.active).toBe(true);
  });

  it('searches by name and only lists the requested kind', async () => {
    const { sa } = await createOrg();
    await createLookup('ACCESSORY', 'Buzzer');
    await createLookup('ACCESSORY', 'SOS button');
    await createLookup('REGION', 'North');
    const res = await api().get('/api/masters/lookup/accessory').query({ q: 'buzz' }).set(bearer(sa));
    expect(res.body.items.map((i: { name: string }) => i.name)).toEqual(['Buzzer']);
    const all = await api().get('/api/masters/lookup/accessory').set(bearer(sa));
    expect(all.body.items).toHaveLength(2);
  });

  it('unknown kinds are 404 and an id of another kind is 404', async () => {
    const { sa } = await createOrg();
    expect((await api().get('/api/masters/lookup/nope').set(bearer(sa))).status).toBe(404);
    const region = await createLookup('REGION', 'North');
    const res = await api().patch(`/api/masters/lookup/accessory/${region.id}`).set(bearer(sa)).send({ name: 'X' });
    expect(res.status).toBe(404);
  });

  it('validates the body', async () => {
    const { sa } = await createOrg();
    const res = await api().post('/api/masters/lookup/accessory').set(bearer(sa)).send({ name: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.fieldErrors.name).toEqual(['Name is required']);
    const empty = await api().patch(`/api/masters/lookup/accessory/x`).set(bearer(sa)).send({});
    expect(empty.status).toBe(400);
  });

  it('custom task types sort after the ordered built-ins; other masters stay alphabetical', async () => {
    const { sa } = await createOrg();
    for (const [i, code] of ['OT', 'TT', 'FT'].entries()) {
      await createLookup('TASK_TYPE', code, { code, isSystem: true, sortOrder: i + 1 });
    }
    await api().post('/api/masters/lookup/task-type').set(bearer(sa)).send({ name: 'Audit' }).expect(201);
    await api().post('/api/masters/lookup/task-type').set(bearer(sa)).send({ name: 'Survey' }).expect(201);
    const tasks = await api().get('/api/masters/lookup/task-type').set(bearer(sa));
    expect(tasks.body.items.map((i: { name: string }) => i.name)).toEqual(['OT', 'TT', 'FT', 'Audit', 'Survey']);

    await createLookup('ACCESSORY', 'Relay');
    await api().post('/api/masters/lookup/accessory').set(bearer(sa)).send({ name: 'Buzzer' }).expect(201);
    const accessories = await api().get('/api/masters/lookup/accessory').set(bearer(sa));
    expect(accessories.body.items.map((i: { name: string }) => i.name)).toEqual(['Buzzer', 'Relay']);
  });
});

describe('LookupItem masters — duplicates, system items, billable', () => {
  it('rejects duplicate names case-insensitively, with a message naming the value', async () => {
    const { om } = await createOrg();
    await createLookup('ACCESSORY', 'Relay');
    const dup = await api().post('/api/masters/lookup/accessory').set(bearer(om)).send({ name: ' RELAY ' });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toEqual({ code: 'DUPLICATE', message: '"Relay" already exists in Accessories' });

    const other = await createLookup('ACCESSORY', 'Buzzer');
    const rename = await api().patch(`/api/masters/lookup/accessory/${other.id}`).set(bearer(om)).send({ name: 'relay' });
    expect(rename.status).toBe(409);
    expect(rename.body.error.code).toBe('DUPLICATE');

    // The same name in another master is fine, and so is a case-only rename of the item itself.
    expect((await api().post('/api/masters/lookup/region').set(bearer(om)).send({ name: 'Relay' })).status).toBe(201);
    const caseOnly = await api().patch(`/api/masters/lookup/accessory/${other.id}`).set(bearer(om)).send({ name: 'BUZZER' });
    expect(caseOnly.status).toBe(200);
  });

  it('built-in items cannot be renamed or deactivated', async () => {
    const { sa } = await createOrg();
    const vehicle = await createLookup('ASSET_TYPE', 'Vehicle', { code: 'VEHICLE', isSystem: true });
    const url = `/api/masters/lookup/asset-type/${vehicle.id}`;

    const rename = await api().patch(url).set(bearer(sa)).send({ name: 'Car' });
    expect(rename.status).toBe(409);
    expect(rename.body.error.code).toBe('SYSTEM_ITEM');
    const off = await api().patch(url).set(bearer(sa)).send({ active: false });
    expect(off.status).toBe(409);
    expect(off.body.error.code).toBe('SYSTEM_ITEM');

    // Re-sending the same name or changing the sort order is allowed.
    expect((await api().patch(url).set(bearer(sa)).send({ name: 'Vehicle', sortOrder: 5 })).status).toBe(200);
  });

  it('a final issue needs a billable flag, which can be toggled', async () => {
    const { om } = await createOrg();
    const missing = await api().post('/api/masters/lookup/final-issue').set(bearer(om)).send({ name: 'Wiring issue' });
    expect(missing.status).toBe(400);
    expect(missing.body.error.details.fieldErrors.billable).toBeDefined();

    const created = await api()
      .post('/api/masters/lookup/final-issue')
      .set(bearer(om))
      .send({ name: 'Wiring issue', billable: true });
    expect(created.status).toBe(201);
    expect(created.body.billable).toBe(true);

    const toggled = await api()
      .patch(`/api/masters/lookup/final-issue/${created.body.id}`)
      .set(bearer(om))
      .send({ billable: false });
    expect(toggled.body.billable).toBe(false);
  });

  it('billable is ignored outside final issues', async () => {
    const { om } = await createOrg();
    const res = await api().post('/api/masters/lookup/accessory').set(bearer(om)).send({ name: 'Relay', billable: true });
    expect(res.status).toBe(201);
    expect(res.body.billable).toBeNull();
  });
});

describe('Activities', () => {
  it('CRUD and filter by asset type', async () => {
    const { om, sa } = await createOrg();
    const vehicle = await createLookup('ASSET_TYPE', 'Vehicle', { code: 'VEHICLE', isSystem: true });
    const battery = await createLookup('ASSET_TYPE', 'Battery', { code: 'BATTERY', isSystem: true });

    const created = await api().post('/api/masters/activities').set(bearer(om)).send({ name: 'Removal', assetTypeId: vehicle.id });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ name: 'Removal', assetTypeId: vehicle.id, assetType: { id: vehicle.id, name: 'Vehicle' } });
    await api().post('/api/masters/activities').set(bearer(om)).send({ name: 'Removal', assetTypeId: battery.id }).expect(201);
    await api().post('/api/masters/activities').set(bearer(om)).send({ name: 'Health check', assetTypeId: vehicle.id }).expect(201);

    const forBattery = await api().get('/api/masters/activities').query({ assetTypeId: battery.id }).set(bearer(sa));
    expect(forBattery.body.items.map((a: { name: string }) => a.name)).toEqual(['Removal']);
    const forVehicle = await api().get('/api/masters/activities').query({ assetTypeId: vehicle.id }).set(bearer(sa));
    expect(forVehicle.body.items).toHaveLength(2);

    const moved = await api()
      .patch(`/api/masters/activities/${created.body.id}`)
      .set(bearer(om))
      .send({ name: 'Device removal', active: false });
    expect(moved.body).toMatchObject({ name: 'Device removal', active: false });
  });

  it('an activity must belong to an asset type', async () => {
    const { om } = await createOrg();
    const missing = await api().post('/api/masters/activities').set(bearer(om)).send({ name: 'Removal' });
    expect(missing.status).toBe(400);
    expect(missing.body.error.details.fieldErrors.assetTypeId).toEqual(['Choose an asset type']);

    const state = await createLookup('STATE', 'Karnataka');
    const wrongKind = await api().post('/api/masters/activities').set(bearer(om)).send({ name: 'Removal', assetTypeId: state.id });
    expect(wrongKind.status).toBe(400);
    expect(wrongKind.body.error.code).toBe('INVALID_REFERENCE');
  });

  it('rejects duplicates per asset type, case-insensitively', async () => {
    const { om } = await createOrg();
    const vehicle = await createLookup('ASSET_TYPE', 'Vehicle');
    await api().post('/api/masters/activities').set(bearer(om)).send({ name: 'Removal', assetTypeId: vehicle.id }).expect(201);
    const dup = await api().post('/api/masters/activities').set(bearer(om)).send({ name: 'removal', assetTypeId: vehicle.id });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toEqual({ code: 'DUPLICATE', message: '"Removal" already exists for Vehicle' });
  });

  it('an inactive asset type cannot be chosen, but existing activities keep it', async () => {
    const { om } = await createOrg();
    const asset = await createLookup('ASSET_TYPE', 'Trailer');
    const activity = await api().post('/api/masters/activities').set(bearer(om)).send({ name: 'Removal', assetTypeId: asset.id });
    await api().patch(`/api/masters/lookup/asset-type/${asset.id}`).set(bearer(om)).send({ active: false }).expect(200);

    const res = await api().post('/api/masters/activities').set(bearer(om)).send({ name: 'Install', assetTypeId: asset.id });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INACTIVE_REFERENCE');

    // Editing the existing activity without changing the asset type still works.
    const edit = await api().patch(`/api/masters/activities/${activity.body.id}`).set(bearer(om)).send({ name: 'Uninstall' });
    expect(edit.status).toBe(200);
    expect(edit.body.assetTypeId).toBe(asset.id);

    // Moving another activity onto the inactive asset type is rejected.
    const other = await createLookup('ASSET_TYPE', 'Container');
    const second = await api().post('/api/masters/activities').set(bearer(om)).send({ name: 'Check', assetTypeId: other.id });
    const move = await api().patch(`/api/masters/activities/${second.body.id}`).set(bearer(om)).send({ assetTypeId: asset.id });
    expect(move.status).toBe(400);
    expect(move.body.error.code).toBe('INACTIVE_REFERENCE');
  });
});

describe('Vehicle make/models', () => {
  it('CRUD, search and case-insensitive duplicates', async () => {
    const { om } = await createOrg();
    const created = await api().post('/api/masters/make-models').set(bearer(om)).send({ make: 'Tata', model: 'Ace' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ make: 'Tata', model: 'Ace', active: true });
    await api().post('/api/masters/make-models').set(bearer(om)).send({ make: 'Tata', model: 'Ultra' }).expect(201);

    const dup = await api().post('/api/masters/make-models').set(bearer(om)).send({ make: ' TATA', model: 'ace ' });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toEqual({ code: 'DUPLICATE', message: '"Tata Ace" already exists' });

    const search = await api().get('/api/masters/make-models').query({ q: 'ultra' }).set(bearer(om));
    expect(search.body.items.map((m: { model: string }) => m.model)).toEqual(['Ultra']);

    const edited = await api().patch(`/api/masters/make-models/${created.body.id}`).set(bearer(om)).send({ model: 'Ace Gold', active: false });
    expect(edited.body).toMatchObject({ make: 'Tata', model: 'Ace Gold', active: false });
    const renameClash = await api().patch(`/api/masters/make-models/${created.body.id}`).set(bearer(om)).send({ model: 'ULTRA' });
    expect(renameClash.status).toBe(409);
  });
});

describe('Locations', () => {
  it('CRUD and filters by state and region', async () => {
    const { om, sa } = await createOrg();
    const ka = await createLookup('STATE', 'Karnataka');
    const mh = await createLookup('STATE', 'Maharashtra');
    const south = await createLookup('REGION', 'South');
    const west = await createLookup('REGION', 'West');

    const blr = await api().post('/api/masters/locations').set(bearer(om)).send({ city: 'Bengaluru', stateId: ka.id, regionId: south.id });
    expect(blr.status).toBe(201);
    expect(blr.body).toMatchObject({
      city: 'Bengaluru',
      state: { id: ka.id, name: 'Karnataka' },
      region: { id: south.id, name: 'South' },
      active: true,
    });
    await api().post('/api/masters/locations').set(bearer(om)).send({ city: 'Pune', stateId: mh.id, regionId: west.id }).expect(201);

    const byState = await api().get('/api/masters/locations').query({ stateId: mh.id }).set(bearer(sa));
    expect(byState.body.items.map((l: { city: string }) => l.city)).toEqual(['Pune']);
    const byRegion = await api().get('/api/masters/locations').query({ regionId: south.id }).set(bearer(sa));
    expect(byRegion.body.items.map((l: { city: string }) => l.city)).toEqual(['Bengaluru']);
    const search = await api().get('/api/masters/locations').query({ q: 'beng' }).set(bearer(sa));
    expect(search.body.items).toHaveLength(1);

    const edited = await api().patch(`/api/masters/locations/${blr.body.id}`).set(bearer(om)).send({ regionId: west.id, active: false });
    expect(edited.body).toMatchObject({ regionId: west.id, active: false });
  });

  it('rejects the same city in the same state, but allows it in another state', async () => {
    const { om } = await createOrg();
    const ka = await createLookup('STATE', 'Karnataka');
    const tn = await createLookup('STATE', 'Tamil Nadu');
    const south = await createLookup('REGION', 'South');
    await api().post('/api/masters/locations').set(bearer(om)).send({ city: 'Hosur', stateId: ka.id, regionId: south.id }).expect(201);

    const dup = await api().post('/api/masters/locations').set(bearer(om)).send({ city: 'HOSUR', stateId: ka.id, regionId: south.id });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toEqual({ code: 'DUPLICATE', message: 'Hosur already exists in Karnataka' });
    await api().post('/api/masters/locations').set(bearer(om)).send({ city: 'Hosur', stateId: tn.id, regionId: south.id }).expect(201);
  });

  it('checks the kind of the state and region references', async () => {
    const { om } = await createOrg();
    const ka = await createLookup('STATE', 'Karnataka');
    const south = await createLookup('REGION', 'South');
    const swapped = await api().post('/api/masters/locations').set(bearer(om)).send({ city: 'Mysuru', stateId: south.id, regionId: ka.id });
    expect(swapped.status).toBe(400);
    expect(swapped.body.error.code).toBe('INVALID_REFERENCE');
    expect(swapped.body.error.details.fieldErrors).toHaveProperty('stateId');
    const unknown = await api().post('/api/masters/locations').set(bearer(om)).send({ city: 'Mysuru', stateId: 'nope', regionId: south.id });
    expect(unknown.body.error.code).toBe('INVALID_REFERENCE');
  });

  it('inactive states and regions cannot be chosen; existing locations keep them', async () => {
    const { om } = await createOrg();
    const state = await createLookup('STATE', 'Goa');
    const region = await createLookup('REGION', 'West');
    const loc = await createLocation({ city: 'Panaji', stateId: state.id, regionId: region.id });
    await api().patch(`/api/masters/lookup/region/${region.id}`).set(bearer(om)).send({ active: false }).expect(200);
    await api().patch(`/api/masters/lookup/state/${state.id}`).set(bearer(om)).send({ active: false }).expect(200);

    const res = await api().post('/api/masters/locations').set(bearer(om)).send({ city: 'Margao', stateId: state.id, regionId: region.id });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INACTIVE_REFERENCE');

    const edit = await api().patch(`/api/masters/locations/${loc.id}`).set(bearer(om)).send({ city: 'Panjim' });
    expect(edit.status).toBe(200);
    expect(edit.body).toMatchObject({ city: 'Panjim', stateId: state.id, regionId: region.id });
  });
});

describe('GET /api/lookups', () => {
  it('returns only active values, grouped and sorted', async () => {
    const { ot } = await createOrg();
    const vehicle = await createLookup('ASSET_TYPE', 'Vehicle', { code: 'VEHICLE', isSystem: true });
    const oldAsset = await createLookup('ASSET_TYPE', 'Old asset', { active: false });
    await createLookup('FINAL_ISSUE', 'Wiring issue', { billable: true });
    await createLookup('FINAL_ISSUE', 'Retired issue', { active: false });
    await createLookup('ACCESSORY', 'Relay');
    await createLookup('ACCESSORY', 'Buzzer');
    const { prisma } = await import('../src/lib/prisma');
    await prisma.activity.createMany({
      data: [
        { name: 'Removal', nameKey: 'removal', assetTypeId: vehicle.id },
        { name: 'Old', nameKey: 'old', assetTypeId: vehicle.id, active: false },
        { name: 'Orphan', nameKey: 'orphan', assetTypeId: oldAsset.id },
      ],
    });
    const active = await createLocation({ city: 'Bengaluru' });
    await createLocation({ city: 'Closed city', active: false });
    await prisma.vehicleMakeModel.create({ data: { make: 'Tata', model: 'Ace', key: 'tata|ace' } });
    await prisma.vehicleMakeModel.create({ data: { make: 'Old', model: 'Truck', key: 'old|truck', active: false } });

    const res = await api().get('/api/lookups').set(bearer(ot));
    expect(res.status).toBe(200);
    expect(res.body.assetTypes).toEqual([{ id: vehicle.id, name: 'Vehicle', code: 'VEHICLE' }]);
    expect(res.body.finalIssues).toEqual([expect.objectContaining({ name: 'Wiring issue', billable: true })]);
    expect(res.body.accessories.map((a: { name: string }) => a.name)).toEqual(['Buzzer', 'Relay']);
    expect(res.body.activities).toEqual([expect.objectContaining({ name: 'Removal', assetTypeId: vehicle.id })]);
    expect(res.body.makeModels).toEqual([expect.objectContaining({ make: 'Tata', model: 'Ace' })]);
    expect(res.body.locations).toEqual([
      expect.objectContaining({ id: active.id, city: 'Bengaluru', stateName: expect.any(String), regionName: expect.any(String) }),
    ]);
    expect(res.body.technicianTypes).toEqual([
      { value: 'PAYROLL', label: 'Payroll' },
      { value: 'THIRD_PARTY', label: 'Third party' },
      { value: 'CONTRACTUAL', label: 'Contractual' },
    ]);
    for (const key of [
      'deviceTypes', 'installationTypes', 'states', 'regions', 'issuesReported', 'issuesObserved',
      'actionsTaken', 'closeReasons', 'shiftTypes', 'taskTypes',
    ]) {
      expect(res.body[key]).toBeInstanceOf(Array);
    }
  });

  it('requires authentication', async () => {
    expect((await api().get('/api/lookups')).status).toBe(401);
    expect((await api().get('/api/masters/lookup/accessory')).status).toBe(401);
  });
});

describe('Permission matrix', () => {
  type Actor = 'SA' | 'OM' | 'OM_DELEGATED' | 'OE' | 'OT' | 'RO';
  const actors: Actor[] = ['SA', 'OM', 'OM_DELEGATED', 'OE', 'OT', 'RO'];
  const canEditMasters: Actor[] = ['SA', 'OM', 'OM_DELEGATED'];
  const canEditTaskTypes: Actor[] = ['SA', 'OM_DELEGATED'];

  async function actorFor(actor: Actor): Promise<User> {
    const org = await createOrg();
    if (actor === 'OM_DELEGATED') return createUser({ role: 'OM', canManageTaskTypes: true });
    return { SA: org.sa, OM: org.om, OE: org.oe, OT: org.ot, RO: org.ro }[actor];
  }

  const canViewMasters: Actor[] = ['SA', 'OM', 'OM_DELEGATED'];
  const masterReadPaths = [
    '/api/masters/lookup/accessory',
    '/api/masters/lookup/task-type',
    '/api/masters/lookup/final-issue',
    '/api/masters/activities',
    '/api/masters/make-models',
    '/api/masters/locations',
  ];

  for (const actor of actors) {
    const reads = canViewMasters.includes(actor) ? 'reads every master' : 'gets 403 on master reads';
    it(`${actor}: ${reads}; /lookups is open; writes ${canEditMasters.includes(actor) ? 'masters' : 'nothing'}${canEditTaskTypes.includes(actor) ? ' and task types' : ''}`, async () => {
      const user = await actorFor(actor);
      const auth = bearer(user);
      const masterStatus = canEditMasters.includes(actor) ? [201, 200] : [403, 403];
      const taskStatus = canEditTaskTypes.includes(actor) ? [201, 200] : [403, 403];

      // CR-01 (D-059): the masters admin reads are SA/OM only; /lookups stays open to every signed-in user.
      expect((await api().get('/api/lookups').set(auth)).status).toBe(200);
      const readStatus = canViewMasters.includes(actor) ? 200 : 403;
      for (const path of masterReadPaths) {
        const res = await api().get(path).set(auth);
        expect(res.status, path).toBe(readStatus);
        if (readStatus === 403) expect(res.body.error.code, path).toBe('FORBIDDEN');
      }

      // LookupItem (non task type)
      const accessory = await createLookup('ACCESSORY', 'Existing');
      expect((await api().post('/api/masters/lookup/accessory').set(auth).send({ name: 'Relay' })).status).toBe(masterStatus[0]);
      expect((await api().patch(`/api/masters/lookup/accessory/${accessory.id}`).set(auth).send({ active: false })).status).toBe(masterStatus[1]);

      // Task types
      const taskType = await createLookup('TASK_TYPE', 'Audit');
      expect((await api().post('/api/masters/lookup/task-type').set(auth).send({ name: 'Survey' })).status).toBe(taskStatus[0]);
      expect((await api().patch(`/api/masters/lookup/task-type/${taskType.id}`).set(auth).send({ name: 'Audit 2' })).status).toBe(taskStatus[1]);

      // Structured masters
      const assetType = await createLookup('ASSET_TYPE', 'Vehicle');
      const activity = await api().post('/api/masters/activities').set(auth).send({ name: 'Removal', assetTypeId: assetType.id });
      expect(activity.status).toBe(masterStatus[0]);
      const makeModel = await api().post('/api/masters/make-models').set(auth).send({ make: 'Tata', model: 'Ace' });
      expect(makeModel.status).toBe(masterStatus[0]);
      const location = await createLocation();
      const newLocation = await api()
        .post('/api/masters/locations')
        .set(auth)
        .send({ city: 'Somewhere', stateId: location.stateId, regionId: location.regionId });
      expect(newLocation.status).toBe(masterStatus[0]);
      expect((await api().patch(`/api/masters/locations/${location.id}`).set(auth).send({ active: false })).status).toBe(masterStatus[1]);
    });
  }

  it('OE and RO still get dropdown values from /lookups (CR-01)', async () => {
    const { oe, ro } = await createOrg();
    const location = await createLocation({ city: 'Bengaluru' });
    for (const user of [oe, ro]) {
      const res = await api().get('/api/lookups').set(bearer(user));
      expect(res.status).toBe(200);
      expect(res.body.locations).toEqual([expect.objectContaining({ id: location.id, city: 'Bengaluru' })]);
    }
  });

  it('non-viewers get 403 before the kind or query is checked (CR-01)', async () => {
    const { om, oe, ot, ro } = await createOrg();
    for (const user of [oe, ot, ro]) {
      expect((await api().get('/api/masters/lookup/nope').set(bearer(user))).status).toBe(403);
      expect((await api().get('/api/masters/lookup/accessory').query({ active: 'yes' }).set(bearer(user))).status).toBe(403);
    }
    expect((await api().get('/api/masters/lookup/nope').set(bearer(om))).status).toBe(404);
  });

  it('write permission is checked before body validation', async () => {
    const { ro } = await createOrg();
    expect((await api().post('/api/masters/lookup/accessory').set(bearer(ro)).send({})).status).toBe(403);
  });

  it('task-type delegation takes effect immediately', async () => {
    const { sa, om } = await createOrg();
    expect((await api().post('/api/masters/lookup/task-type').set(bearer(om)).send({ name: 'Audit' })).status).toBe(403);
    await api().patch(`/api/users/${om.id}/delegation`).set(bearer(sa)).send({ canManageTaskTypes: true }).expect(200);
    expect((await api().post('/api/masters/lookup/task-type').set(bearer(om)).send({ name: 'Audit' })).status).toBe(201);
  });
});
