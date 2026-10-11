import { describe, expect, it } from 'vitest';
import type { TaskDto } from '@champ/shared';
import { prisma, type User } from '../src/lib/prisma';
import { recomputeTaskStatus } from '../src/modules/tasks/status';
import { bearer, createTaskWorld, createUser, testApi } from './helpers';

const api = () => testApi();
type World = Awaited<ReturnType<typeof createTaskWorld>>;

async function createTask(world: World, actor: User, overrides: Record<string, unknown> = {}): Promise<TaskDto> {
  const res = await api().post('/api/tasks').set(bearer(actor)).send(world.taskBody(overrides));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as TaskDto;
}

const eventsOf = (taskId: string) => prisma.taskEvent.findMany({ where: { taskId }, orderBy: { createdAt: 'asc' } });

describe('tasks — create', () => {
  it('creates a task with N blank fitments from a vehicle count, with OM/OE/TK ids and an event', async () => {
    const w = await createTaskWorld();
    const res = await api().post('/api/tasks').set(bearer(w.om)).send(w.taskBody({ vehicles: { entry: 'COUNT', count: 3 } }));
    expect(res.status).toBe(201);
    const task = res.body as TaskDto;
    expect(task).toMatchObject({
      omId: 'OM-00001',
      oeTaskId: 'OE-00001',
      status: 'OPEN',
      taskType: { code: 'OT' },
      client: { id: w.client.id, name: 'Zoomcar' },
      site: { name: 'Bengaluru depot' },
      location: { id: w.location.id, city: 'Bengaluru' },
      oe: { id: w.oe.id },
      assetType: { code: 'VEHICLE' },
      makeModel: { make: 'Tata', model: 'Ace' },
      vehicleEntry: 'COUNT',
      pocEmail: null,
      counts: { total: 3, assigned: 0, open: 3 },
      createdBy: { id: w.om.id },
      requestedAt: '2026-10-20T04:30:00.000Z',
      fitmentAt: '2026-10-21T05:00:00.000Z',
    });
    expect(task.fitments.map((f) => [f.tkId, f.seq, f.status, f.technician])).toEqual([
      ['TK-00001', 1, 'OPEN', null],
      ['TK-00002', 2, 'OPEN', null],
      ['TK-00003', 3, 'OPEN', null],
    ]);
    // Fitment location comes from the site (D-061).
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).locationId).toBe(w.location.id);
    const events = await eventsOf(task.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'TASK_CREATED', actorId: w.om.id, toStatus: 'OPEN' });
  });

  it('creates one fitment per CSV vehicle row with its details', async () => {
    const w = await createTaskWorld();
    const rows = [
      { vehicleRegNo: 'KA01AB1234', chassisNo: 'CH1', assetNumber: '', oldDeviceId: '' },
      { vehicleRegNo: '', chassisNo: 'CH2', assetNumber: 'A-2' },
      { oldDeviceId: 'OLD-3' },
    ];
    const task = await createTask(w, w.om, { vehicles: { entry: 'CSV', rows } });
    expect(task.vehicleEntry).toBe('CSV');
    expect(task.fitments.map((f) => [f.tkId, f.vehicleRegNo, f.chassisNo, f.assetNumber, f.oldDeviceId])).toEqual([
      ['TK-00001', 'KA01AB1234', 'CH1', null, null],
      ['TK-00002', null, 'CH2', 'A-2', null],
      ['TK-00003', null, null, null, 'OLD-3'],
    ]);
  });

  it('validates the vehicles union (count bounds, at least one CSV row)', async () => {
    const w = await createTaskWorld();
    for (const vehicles of [{ entry: 'COUNT', count: 0 }, { entry: 'COUNT', count: 501 }, { entry: 'CSV', rows: [] }, {}]) {
      const res = await api().post('/api/tasks').set(bearer(w.om)).send(w.taskBody({ vehicles }));
      expect(res.status, JSON.stringify(vehicles)).toBe(400);
      expect(res.body.error.details.fieldErrors.vehicles).toBeDefined();
    }
    const noDate = await api().post('/api/tasks').set(bearer(w.om)).send(w.taskBody({ fitmentAt: '' }));
    expect(noDate.body.error.details.fieldErrors.fitmentAt).toEqual(['Choose the fitment date and time']);
    expect(await prisma.task.count()).toBe(0);
  });

  it('with a technician every fitment is Assigned to them and the type is taken from them', async () => {
    const w = await createTaskWorld();
    const task = await createTask(w, w.om, { technicianId: w.techA.id, vehicles: { entry: 'COUNT', count: 5 } });
    expect(task.status).toBe('ASSIGNED');
    expect(task.technicianType).toBe('PAYROLL');
    expect(task.counts).toEqual({ total: 5, assigned: 5, open: 0 });
    expect(task.fitments.every((f) => f.status === 'ASSIGNED' && f.technician?.id === w.techA.id)).toBe(true);
    expect(task.fitments.at(-1)?.tkId).toBe('TK-00005');
  });

  it('rejects a technician whose type differs from the chosen technician type, or who is not an active OT', async () => {
    const w = await createTaskWorld();
    const mismatch = await api()
      .post('/api/tasks')
      .set(bearer(w.om))
      .send(w.taskBody({ technicianId: w.techA.id, technicianType: 'THIRD_PARTY' }));
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error.details.fieldErrors.technicianId).toEqual(["Arjun Tech isn't a Third party technician"]);

    const notOt = await api().post('/api/tasks').set(bearer(w.om)).send(w.taskBody({ technicianId: w.oe.id }));
    expect(notOt.body.error.code).toBe('INVALID_REFERENCE');
    await prisma.user.update({ where: { id: w.techB.id }, data: { status: 'INACTIVE' } });
    const inactive = await api().post('/api/tasks').set(bearer(w.om)).send(w.taskBody({ technicianId: w.techB.id }));
    expect(inactive.body.error.code).toBe('INACTIVE_REFERENCE');
    expect(await prisma.task.count()).toBe(0);
  });

  it('gives sequential, unique ids, also to tasks created at the same time', async () => {
    const w = await createTaskWorld();
    const first = await createTask(w, w.om);
    const concurrent = await Promise.all(
      [1, 2, 3, 4].map(() => api().post('/api/tasks').set(bearer(w.om)).send(w.taskBody({ vehicles: { entry: 'COUNT', count: 3 } }))),
    );
    expect(concurrent.map((r) => r.status)).toEqual([201, 201, 201, 201]);
    const all = [first, ...concurrent.map((r) => r.body as TaskDto)];
    const omIds = all.map((t) => t.omId).sort();
    expect(omIds).toEqual(['OM-00001', 'OM-00002', 'OM-00003', 'OM-00004', 'OM-00005']);
    expect(new Set(all.map((t) => t.oeTaskId)).size).toBe(5);
    const tkIds = all.flatMap((t) => t.fitments.map((f) => f.tkId)).sort();
    expect(tkIds).toHaveLength(14);
    expect(new Set(tkIds).size).toBe(14);
    expect(tkIds.at(-1)).toBe('TK-00014');
    // A failed create gives no number away.
    await api().post('/api/tasks').set(bearer(w.om)).send(w.taskBody({ siteId: w.otherClient.sites[0]!.id }));
    expect((await createTask(w, w.om)).omId).toBe('OM-00006');
  });
});

describe('tasks — reference rules', () => {
  it("rejects a site of another customer, and an unknown customer", async () => {
    const w = await createTaskWorld();
    const res = await api().post('/api/tasks').set(bearer(w.om)).send(w.taskBody({ siteId: w.otherClient.sites[0]!.id }));
    expect(res.status).toBe(400);
    expect(res.body.error.details.fieldErrors.siteId).toEqual(["Choose one of this customer's sites"]);
    const unknown = await api().post('/api/tasks').set(bearer(w.om)).send(w.taskBody({ clientId: 'nope' }));
    expect(unknown.body.error).toMatchObject({ code: 'INVALID_REFERENCE', details: { fieldErrors: { clientId: expect.any(Array) } } });
  });

  it('rejects inactive customers, sites, OEs, activities and masters', async () => {
    const w = await createTaskWorld();
    const expectInactive = async (field: string, overrides: Record<string, unknown> = {}) => {
      const res = await api().post('/api/tasks').set(bearer(w.om)).send(w.taskBody(overrides));
      expect(res.status, field).toBe(400);
      expect(res.body.error.code, field).toBe('INACTIVE_REFERENCE');
      expect(res.body.error.details.fieldErrors[field], field).toBeDefined();
    };
    await prisma.clientSite.update({ where: { id: w.client.sites[1]!.id }, data: { active: false } });
    await expectInactive('siteId', { siteId: w.client.sites[1]!.id });
    const oe2 = await createUser({ role: 'OE', managerId: w.om.id, status: 'INACTIVE' });
    await expectInactive('oeId', { oeId: oe2.id });
    const oldShift = await prisma.lookupItem.update({ where: { id: w.night.id }, data: { active: false } });
    await expectInactive('shiftTypeId', { shiftTypeId: oldShift.id });
    const oldActivity = await prisma.activity.create({
      data: { name: 'Removal', nameKey: 'removal', assetTypeId: w.vehicle.id, active: false },
    });
    await expectInactive('activityId', { activityId: oldActivity.id });
    await prisma.vehicleMakeModel.update({ where: { id: w.makeModel.id }, data: { active: false } });
    await expectInactive('makeModelId');
    await prisma.vehicleMakeModel.update({ where: { id: w.makeModel.id }, data: { active: true } });
    await prisma.client.update({ where: { id: w.client.id }, data: { active: false } });
    await expectInactive('clientId');

    const wrongKind = await api().post('/api/tasks').set(bearer(w.om)).send(w.taskBody({ clientId: w.otherClient.id, siteId: w.otherClient.sites[0]!.id, shiftTypeId: w.issue.id }));
    expect(wrongKind.body.error).toMatchObject({ code: 'INVALID_REFERENCE', details: { fieldErrors: { shiftTypeId: ['Not a shift type'] } } });
  });

  it('requires make/model for Vehicle assets only', async () => {
    const w = await createTaskWorld();
    const missing = await api().post('/api/tasks').set(bearer(w.om)).send(w.taskBody({ makeModelId: null }));
    expect(missing.status).toBe(400);
    expect(missing.body.error.details.fieldErrors.makeModelId).toEqual(['Choose the vehicle make/model']);

    const battery = { assetTypeId: w.battery.id, activityId: w.batteryInstall.id };
    const notAllowed = await api().post('/api/tasks').set(bearer(w.om)).send(w.taskBody(battery));
    expect(notAllowed.body.error.details.fieldErrors.makeModelId).toEqual(['Make/model applies to vehicles only']);

    const ok = await createTask(w, w.om, { ...battery, makeModelId: null });
    expect(ok.makeModel).toBeNull();
    expect(ok.assetType.code).toBe('BATTERY');
  });

  it("rejects an activity of another asset type", async () => {
    const w = await createTaskWorld();
    const res = await api().post('/api/tasks').set(bearer(w.om)).send(w.taskBody({ activityId: w.batteryInstall.id }));
    expect(res.status).toBe(400);
    expect(res.body.error.details.fieldErrors.activityId).toEqual(["New installation isn't an activity for Vehicle"]);
  });

  it('an OE creates tasks for themselves only (403 for another OE)', async () => {
    const w = await createTaskWorld();
    const own = await createTask(w, w.oe);
    expect(own.oe.id).toBe(w.oe.id);
    expect(own.createdBy.id).toBe(w.oe.id);
    const otherOe = await createUser({ role: 'OE', managerId: w.om.id });
    const res = await api().post('/api/tasks').set(bearer(w.oe)).send(w.taskBody({ oeId: otherOe.id }));
    expect(res.status).toBe(403);
    // SA and OM may pick any active OE.
    expect((await createTask(w, w.sa, { oeId: otherOe.id })).oe.id).toBe(otherOe.id);
  });
});

describe('tasks — lists', () => {
  async function seedTasks(w: World) {
    const otherOe = await createUser({ role: 'OE', managerId: w.om.id, name: 'Other OE' });
    const t1 = await createTask(w, w.om); // OM-00001, TK 1-2, Zoomcar, our OE
    const t2 = await createTask(w, w.om, { technicianId: w.techA.id, fitmentAt: '2026-11-05T05:00:00.000Z' }); // OM-2, TK 3-4
    const t3 = await createTask(w, w.sa, {
      oeId: otherOe.id,
      clientId: w.otherClient.id,
      siteId: w.otherClient.sites[0]!.id,
      pocName: 'Kiran',
      assetTypeId: w.battery.id,
      activityId: w.batteryInstall.id,
      makeModelId: null,
      fitmentAt: '2026-10-25T20:00:00.000Z', // 26 Oct 01:30 IST
    }); // OM-3, TK 5-6
    return { t1, t2, t3, otherOe };
  }

  const ids = (body: { items: { omId: string }[] }) => body.items.map((i) => i.omId);
  const list = (actor: User, query: Record<string, string> = {}) => api().get('/api/tasks').set(bearer(actor)).query(query);

  it('open view lists every task not completed, sorted by fitment date; completed tasks drop out', async () => {
    const w = await createTaskWorld();
    const { t1 } = await seedTasks(w);
    const res = await list(w.ro);
    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual(['OM-00001', 'OM-00003', 'OM-00002']);
    expect(res.body.total).toBe(3);
    expect(res.body.items[0]).toMatchObject({
      oeTaskId: 'OE-00001',
      client: { name: 'Zoomcar', code: 'ZOOM' },
      site: { name: 'Bengaluru depot' },
      city: 'Bengaluru',
      activity: { name: 'New installation' },
      assetType: { name: 'Vehicle' },
      oe: { id: w.oe.id },
      fitments: { total: 2, assigned: 0, open: 2 },
      status: 'OPEN',
    });
    const desc = await list(w.ro, { sort: 'fitmentAt:desc' });
    expect(ids(desc.body)).toEqual(['OM-00002', 'OM-00003', 'OM-00001']);

    await prisma.fitment.updateMany({ where: { taskId: t1.id }, data: { status: 'OM_APPROVED' } });
    await recomputeTaskStatus(prisma, t1.id);
    expect(ids((await list(w.ro)).body)).toEqual(['OM-00003', 'OM-00002']);
    expect(ids((await list(w.ro, { view: 'all' })).body)).toContain('OM-00001');
  });

  it('assigned view shows the OE their own tasks', async () => {
    const w = await createTaskWorld();
    const { otherOe } = await seedTasks(w);
    expect(ids((await list(w.oe, { view: 'assigned' })).body)).toEqual(['OM-00001', 'OM-00002']);
    expect(ids((await list(otherOe, { view: 'assigned' })).body)).toEqual(['OM-00003']);
    // An OE still sees every open task in the Open view.
    expect((await list(w.oe)).body.total).toBe(3);
  });

  it('filters by customer, OE, technician, status, activity and fitment date (IST days)', async () => {
    const w = await createTaskWorld();
    const { otherOe } = await seedTasks(w);
    expect(ids((await list(w.om, { clientId: w.otherClient.id })).body)).toEqual(['OM-00003']);
    expect(ids((await list(w.om, { oeId: otherOe.id })).body)).toEqual(['OM-00003']);
    expect(ids((await list(w.om, { technicianId: w.techA.id })).body)).toEqual(['OM-00002']);
    expect(ids((await list(w.om, { status: 'ASSIGNED' })).body)).toEqual(['OM-00002']);
    expect(ids((await list(w.om, { activityId: w.batteryInstall.id })).body)).toEqual(['OM-00003']);
    // OM-3's fitment is 26 Oct 01:30 IST (25 Oct in UTC).
    expect(ids((await list(w.om, { from: '2026-10-26', to: '2026-10-26' })).body)).toEqual(['OM-00003']);
    expect(ids((await list(w.om, { to: '2026-10-25' })).body)).toEqual(['OM-00001']);
    expect(ids((await list(w.om, { from: '2026-10-22' })).body)).toEqual(['OM-00003', 'OM-00002']);
    const bad = await list(w.om, { from: '26/10/2026' });
    expect(bad.status).toBe(400);
  });

  it('searches by OM, OE or TK id (any case, with or without zeros), customer and POC name', async () => {
    const w = await createTaskWorld();
    await seedTasks(w);
    expect(ids((await list(w.om, { q: 'OM-00002' })).body)).toEqual(['OM-00002']);
    expect(ids((await list(w.om, { q: 'oe-3' })).body)).toEqual(['OM-00003']);
    expect(ids((await list(w.om, { q: 'tk-1' })).body)).toEqual(['OM-00001']);
    expect(ids((await list(w.om, { q: 'TK-00004' })).body)).toEqual(['OM-00002']);
    // A bare number matches OM 1, OE 1 and TK 1, all on the first task here; 5 matches TK 5 (third task).
    expect(ids((await list(w.om, { q: '1' })).body)).toEqual(['OM-00001']);
    expect(ids((await list(w.om, { q: '5' })).body)).toEqual(['OM-00003']);
    expect(ids((await list(w.om, { q: 'other fl' })).body)).toEqual(['OM-00003']);
    expect(ids((await list(w.om, { q: 'kiran' })).body)).toEqual(['OM-00003']);
    expect(ids((await list(w.om, { q: 'zoom' })).body)).toEqual(['OM-00001', 'OM-00002']);
  });

  it('paginates', async () => {
    const w = await createTaskWorld();
    await seedTasks(w);
    const res = await list(w.om, { page: '2', pageSize: '2' });
    expect(res.body).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(ids(res.body)).toEqual(['OM-00002']);
  });
});

describe('tasks — detail and permissions', () => {
  it('returns permission flags for the caller', async () => {
    const w = await createTaskWorld();
    const task = await createTask(w, w.om);
    const otherOe = await createUser({ role: 'OE', managerId: w.om.id });
    const flags = async (actor: User) => (await api().get(`/api/tasks/${task.id}`).set(bearer(actor))).body.permissions;
    expect(await flags(w.sa)).toEqual({ canEdit: true, canAssign: true, canDelete: true });
    expect(await flags(w.om)).toEqual({ canEdit: true, canAssign: true, canDelete: true });
    expect(await flags(w.oe)).toEqual({ canEdit: true, canAssign: true, canDelete: false });
    expect(await flags(otherOe)).toEqual({ canEdit: false, canAssign: false, canDelete: false });
    expect(await flags(w.ro)).toEqual({ canEdit: false, canAssign: false, canDelete: false });

    await prisma.fitment.updateMany({ where: { taskId: task.id, seq: 1 }, data: { status: 'IN_PROGRESS' } });
    expect(await flags(w.om)).toEqual({ canEdit: false, canAssign: true, canDelete: false });
    await prisma.fitment.updateMany({ where: { taskId: task.id }, data: { status: 'SUBMITTED' } });
    expect(await flags(w.om)).toEqual({ canEdit: false, canAssign: false, canDelete: false });
  });

  it('404 for unknown and deleted tasks', async () => {
    const w = await createTaskWorld();
    expect((await api().get('/api/tasks/nope').set(bearer(w.om))).status).toBe(404);
  });

  it('RO reads but cannot change anything; OT gets 403 on every /tasks route', async () => {
    const w = await createTaskWorld();
    const task = await createTask(w, w.om);
    const fid = task.fitments[0]!.id;
    expect((await api().get('/api/tasks').set(bearer(w.ro))).status).toBe(200);
    expect((await api().get(`/api/tasks/${task.id}`).set(bearer(w.ro))).status).toBe(200);
    expect((await api().get('/api/tasks/export').set(bearer(w.ro))).status).toBe(200);
    const roWrites = [
      api().post('/api/tasks').set(bearer(w.ro)).send(w.taskBody()),
      api().patch(`/api/tasks/${task.id}`).set(bearer(w.ro)).send({ pocName: 'X' }),
      api().patch(`/api/tasks/${task.id}/fitments/${fid}`).set(bearer(w.ro)).send({ chassisNo: 'X' }),
      api().post(`/api/tasks/${task.id}/assign`).set(bearer(w.ro)).send({ fitmentIds: [fid], technicianId: w.techA.id }),
      api().delete(`/api/tasks/${task.id}`).set(bearer(w.ro)),
      api().get('/api/tasks/bulk/sample').set(bearer(w.ro)),
      api().post('/api/tasks/bulk/import').set(bearer(w.ro)).send({ rows: [] }),
    ];
    for (const [i, res] of (await Promise.all(roWrites)).entries()) expect(res.status, `write ${i}`).toBe(403);

    const otReads = [
      api().get('/api/tasks').set(bearer(w.ot)),
      api().get(`/api/tasks/${task.id}`).set(bearer(w.ot)),
      api().get('/api/tasks/options').set(bearer(w.ot)),
      api().get('/api/tasks/export').set(bearer(w.ot)),
      api().get('/api/tasks/bulk/sample').set(bearer(w.ot)),
      api().post('/api/tasks').set(bearer(w.ot)).send(w.taskBody()),
    ];
    for (const [i, res] of (await Promise.all(otReads)).entries()) expect(res.status, `OT call ${i}`).toBe(403);
    expect((await api().get('/api/tasks')).status).toBe(401);
  });

  it('options: active OEs (an OE gets only themselves) and active technicians', async () => {
    const w = await createTaskWorld();
    await createUser({ role: 'OE', managerId: w.om.id, name: 'Zed OE', status: 'INACTIVE' });
    const sa = await api().get('/api/tasks/options').set(bearer(w.sa));
    expect(sa.body.oes).toEqual([{ id: w.oe.id, name: w.oe.name }]);
    expect(sa.body.technicians).toEqual([
      { id: w.techA.id, name: 'Arjun Tech', technicianType: 'PAYROLL', baseLocation: 'Bengaluru' },
      { id: w.techB.id, name: 'Bhavna Tech', technicianType: 'THIRD_PARTY', baseLocation: 'Pune' },
      expect.objectContaining({ id: w.ot.id, baseLocation: null }),
    ]);
    const oe = await api().get('/api/tasks/options').set(bearer(w.oe));
    expect(oe.body.oes).toEqual([{ id: w.oe.id, name: w.oe.name }]);
    expect((await api().get('/api/tasks/options').set(bearer(w.ro))).status).toBe(200);
  });
});

describe('tasks — edit', () => {
  it('edits header fields while untouched and records the diff; 409 once a fitment has started', async () => {
    const w = await createTaskWorld();
    const task = await createTask(w, w.oe);
    const res = await api()
      .patch(`/api/tasks/${task.id}`)
      .set(bearer(w.oe))
      .send({ pocName: 'Anil', siteId: w.client.sites[1]!.id, fitmentAt: '2026-10-22T05:00:00.000Z', comments: 'Gate 3' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      pocName: 'Anil',
      site: { name: 'Pune yard' },
      location: { city: 'Pune' },
      fitmentAt: '2026-10-22T05:00:00.000Z',
      comments: 'Gate 3',
    });
    const update = (await eventsOf(task.id)).find((e) => e.type === 'TASK_UPDATED');
    expect(update?.actorId).toBe(w.oe.id);
    expect(update?.data).toEqual({
      pocName: ['Priya Rao', 'Anil'],
      siteId: [w.client.sites[0]!.id, w.client.sites[1]!.id],
      locationId: [w.location.id, w.pune.id],
      fitmentAt: ['2026-10-21T05:00:00.000Z', '2026-10-22T05:00:00.000Z'],
      comments: [null, 'Gate 3'],
    });

    // Saving the same values records nothing.
    await api().patch(`/api/tasks/${task.id}`).set(bearer(w.oe)).send({ pocName: 'Anil' });
    expect((await eventsOf(task.id)).filter((e) => e.type === 'TASK_UPDATED')).toHaveLength(1);

    await prisma.fitment.updateMany({ where: { taskId: task.id, seq: 1 }, data: { status: 'IN_PROGRESS' } });
    const started = await api().patch(`/api/tasks/${task.id}`).set(bearer(w.om)).send({ pocName: 'Late' });
    expect(started.status).toBe(409);
    expect(started.body.error.code).toBe('TASK_STARTED');
  });

  it('keeps an unchanged reference that was deactivated, but rejects switching to an inactive one', async () => {
    const w = await createTaskWorld();
    const task = await createTask(w, w.om, { shiftTypeId: w.night.id });
    await prisma.lookupItem.update({ where: { id: w.night.id }, data: { active: false } });
    await prisma.client.update({ where: { id: w.client.id }, data: { active: false } });
    const ok = await api().patch(`/api/tasks/${task.id}`).set(bearer(w.om)).send({ pocName: 'Still fine', shiftTypeId: w.night.id });
    expect(ok.status).toBe(200);
    expect(ok.body.shiftType).toMatchObject({ name: 'Night', active: false });
    expect(ok.body.client.active).toBe(false);

    await prisma.lookupItem.update({ where: { id: w.night.id }, data: { active: true } });
    const back = await api().patch(`/api/tasks/${task.id}`).set(bearer(w.om)).send({ shiftTypeId: w.day.id });
    expect(back.status).toBe(200);
    await prisma.lookupItem.update({ where: { id: w.night.id }, data: { active: false } });
    const switched = await api().patch(`/api/tasks/${task.id}`).set(bearer(w.om)).send({ shiftTypeId: w.night.id });
    expect(switched.body.error.code).toBe('INACTIVE_REFERENCE');
  });

  it('switching to a battery clears make/model; the cross-field rules still apply', async () => {
    const w = await createTaskWorld();
    const task = await createTask(w, w.om);
    const mismatch = await api().patch(`/api/tasks/${task.id}`).set(bearer(w.om)).send({ assetTypeId: w.battery.id });
    expect(mismatch.body.error.details.fieldErrors.activityId).toBeDefined();
    const res = await api()
      .patch(`/api/tasks/${task.id}`)
      .set(bearer(w.om))
      .send({ assetTypeId: w.battery.id, activityId: w.batteryInstall.id });
    expect(res.status).toBe(200);
    expect(res.body.makeModel).toBeNull();
    const clientOnly = await api().patch(`/api/tasks/${task.id}`).set(bearer(w.om)).send({ clientId: w.otherClient.id });
    expect(clientOnly.body.error.details.fieldErrors.siteId).toBeDefined();
  });

  it("an OE can't edit another OE's task, or hand their own to someone else", async () => {
    const w = await createTaskWorld();
    const otherOe = await createUser({ role: 'OE', managerId: w.om.id });
    const theirs = await createTask(w, w.om, { oeId: otherOe.id });
    expect((await api().patch(`/api/tasks/${theirs.id}`).set(bearer(w.oe)).send({ pocName: 'X' })).status).toBe(403);
    const mine = await createTask(w, w.oe);
    expect((await api().patch(`/api/tasks/${mine.id}`).set(bearer(w.oe)).send({ oeId: otherOe.id })).status).toBe(403);
    // An OM can move it to another OE.
    const moved = await api().patch(`/api/tasks/${mine.id}`).set(bearer(w.om)).send({ oeId: otherOe.id });
    expect(moved.body.oe.id).toBe(otherOe.id);
  });

  it('edits one fitment vehicle while Open/Assigned; 409 FITMENT_LOCKED later', async () => {
    const w = await createTaskWorld();
    const task = await createTask(w, w.oe);
    const [f1, f2] = task.fitments;
    const res = await api()
      .patch(`/api/tasks/${task.id}/fitments/${f1!.id}`)
      .set(bearer(w.oe))
      .send({ vehicleRegNo: 'KA01AB1234', chassisNo: '' });
    expect(res.status).toBe(200);
    expect(res.body.fitments[0]).toMatchObject({ vehicleRegNo: 'KA01AB1234', chassisNo: null });
    const event = (await eventsOf(task.id)).find((e) => e.type === 'FITMENT_UPDATED');
    expect(event).toMatchObject({ fitmentId: f1!.id, data: { vehicleRegNo: [null, 'KA01AB1234'] } });

    await prisma.fitment.update({ where: { id: f2!.id }, data: { status: 'IN_PROGRESS' } });
    const locked = await api().patch(`/api/tasks/${task.id}/fitments/${f2!.id}`).set(bearer(w.oe)).send({ chassisNo: 'X' });
    expect(locked.status).toBe(409);
    expect(locked.body.error).toMatchObject({ code: 'FITMENT_LOCKED', message: 'TK-00002 has already started, so it can\'t be changed.' });
    expect((await api().patch(`/api/tasks/${task.id}/fitments/nope`).set(bearer(w.oe)).send({ chassisNo: 'X' })).status).toBe(404);
  });
});

describe('tasks — assign', () => {
  it('assigns fitments to different technicians, reassigns and unassigns, recomputing the task status', async () => {
    const w = await createTaskWorld();
    const task = await createTask(w, w.oe, { vehicles: { entry: 'COUNT', count: 3 } });
    const [f1, f2, f3] = task.fitments.map((f) => f.id);
    const assign = (fitmentIds: string[], technicianId: string | null) =>
      api().post(`/api/tasks/${task.id}/assign`).set(bearer(w.oe)).send({ fitmentIds, technicianId });

    let res = await assign([f1!], w.techA.id);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('OPEN');
    res = await assign([f2!, f3!], w.techB.id);
    expect(res.body.status).toBe('ASSIGNED');
    expect(res.body.counts).toEqual({ total: 3, assigned: 3, open: 0 });
    expect(res.body.fitments.map((f: { technician: { name: string } }) => f.technician.name)).toEqual([
      'Arjun Tech',
      'Bhavna Tech',
      'Bhavna Tech',
    ]);

    res = await assign([f3!], w.techA.id); // reassign: ASSIGNED → ASSIGNED
    expect(res.body.fitments[2]).toMatchObject({ status: 'ASSIGNED', technician: { id: w.techA.id } });
    res = await assign([f1!, f2!], null);
    expect(res.body.status).toBe('OPEN');
    expect(res.body.counts).toEqual({ total: 3, assigned: 1, open: 2 });

    const events = (await eventsOf(task.id)).filter((e) => e.type.startsWith('FITMENT_'));
    expect(events.map((e) => [e.type, e.fromStatus, e.toStatus])).toEqual([
      ['FITMENT_ASSIGNED', 'OPEN', 'ASSIGNED'],
      ['FITMENT_ASSIGNED', 'OPEN', 'ASSIGNED'],
      ['FITMENT_ASSIGNED', 'OPEN', 'ASSIGNED'],
      ['FITMENT_ASSIGNED', 'ASSIGNED', 'ASSIGNED'],
      ['FITMENT_UNASSIGNED', 'ASSIGNED', 'OPEN'],
      ['FITMENT_UNASSIGNED', 'ASSIGNED', 'OPEN'],
    ]);
    expect(events[3]!.data).toMatchObject({ technicianId: w.techA.id, previousTechnicianId: w.techB.id });
  });

  it('is all or nothing: a started fitment gives 409 and changes nothing', async () => {
    const w = await createTaskWorld();
    const task = await createTask(w, w.om, { vehicles: { entry: 'COUNT', count: 2 } });
    const [f1, f2] = task.fitments.map((f) => f.id);
    await prisma.fitment.update({ where: { id: f2! }, data: { status: 'SUBMITTED' } });
    const res = await api()
      .post(`/api/tasks/${task.id}/assign`)
      .set(bearer(w.om))
      .send({ fitmentIds: [f1, f2], technicianId: w.techA.id });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('FITMENT_LOCKED');
    expect((await prisma.fitment.findUniqueOrThrow({ where: { id: f1! } })).technicianId).toBeNull();
  });

  it('rejects fitments of another task, non-technicians, and other OEs', async () => {
    const w = await createTaskWorld();
    const a = await createTask(w, w.om);
    const b = await createTask(w, w.om);
    const foreign = await api()
      .post(`/api/tasks/${a.id}/assign`)
      .set(bearer(w.om))
      .send({ fitmentIds: [b.fitments[0]!.id], technicianId: w.techA.id });
    expect(foreign.status).toBe(400);
    const notOt = await api()
      .post(`/api/tasks/${a.id}/assign`)
      .set(bearer(w.om))
      .send({ fitmentIds: [a.fitments[0]!.id], technicianId: w.ro.id });
    expect(notOt.body.error.code).toBe('INVALID_REFERENCE');
    const empty = await api().post(`/api/tasks/${a.id}/assign`).set(bearer(w.om)).send({ fitmentIds: [], technicianId: null });
    expect(empty.status).toBe(400);
    const otherOe = await createUser({ role: 'OE', managerId: w.om.id });
    const forbidden = await api()
      .post(`/api/tasks/${a.id}/assign`)
      .set(bearer(otherOe))
      .send({ fitmentIds: [a.fitments[0]!.id], technicianId: w.techA.id });
    expect(forbidden.status).toBe(403);
  });
});

describe('tasks — delete', () => {
  it('an OM soft-deletes an untouched task; it disappears everywhere and an event is kept', async () => {
    const w = await createTaskWorld();
    const task = await createTask(w, w.oe);
    expect((await api().delete(`/api/tasks/${task.id}`).set(bearer(w.oe))).status).toBe(403);
    const res = await api().delete(`/api/tasks/${task.id}`).set(bearer(w.om));
    expect(res.status).toBe(204);
    const row = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.deletedById).toBe(w.om.id);
    expect((await api().get(`/api/tasks/${task.id}`).set(bearer(w.om))).status).toBe(404);
    expect((await api().get('/api/tasks').query({ view: 'all' }).set(bearer(w.om))).body.total).toBe(0);
    expect((await api().get('/api/tasks').query({ view: 'assigned' }).set(bearer(w.oe))).body.total).toBe(0);
    expect((await api().patch(`/api/tasks/${task.id}`).set(bearer(w.om)).send({ pocName: 'X' })).status).toBe(404);
    expect((await api().delete(`/api/tasks/${task.id}`).set(bearer(w.sa))).status).toBe(404);
    const deleted = (await eventsOf(task.id)).find((e) => e.type === 'TASK_DELETED');
    expect(deleted).toMatchObject({ actorId: w.om.id, fromStatus: 'OPEN' });
  });

  it('409 once work has started', async () => {
    const w = await createTaskWorld();
    const task = await createTask(w, w.om, { technicianId: w.techA.id });
    await prisma.fitment.updateMany({ where: { taskId: task.id, seq: 2 }, data: { status: 'IN_PROGRESS' } });
    const res = await api().delete(`/api/tasks/${task.id}`).set(bearer(w.sa));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TASK_STARTED');
  });
});

describe('recomputeTaskStatus', () => {
  it('derives the stored task status from its fitments', async () => {
    const w = await createTaskWorld();
    const task = await createTask(w, w.om, { vehicles: { entry: 'COUNT', count: 2 } });
    const set = async (s1: string, s2: string) => {
      await prisma.fitment.updateMany({ where: { taskId: task.id, seq: 1 }, data: { status: s1 as never } });
      await prisma.fitment.updateMany({ where: { taskId: task.id, seq: 2 }, data: { status: s2 as never } });
      const status = await recomputeTaskStatus(prisma, task.id);
      expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe(status);
      return status;
    };
    expect(await set('OPEN', 'ASSIGNED')).toBe('OPEN');
    expect(await set('ASSIGNED', 'ASSIGNED')).toBe('ASSIGNED');
    expect(await set('ASSIGNED', 'IN_PROGRESS')).toBe('IN_PROGRESS');
    expect(await set('OM_APPROVED', 'SUBMITTED')).toBe('IN_PROGRESS');
    expect(await set('OM_APPROVED', 'MOVED_TO_FT')).toBe('COMPLETED');
    expect(await set('CLOSED_NOT_DONE', 'OM_APPROVED')).toBe('COMPLETED');
  });
});
