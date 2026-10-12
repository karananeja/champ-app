import { describe, expect, it } from 'vitest';
import type { FitmentAction, Paginated, TaskDto, TaskEventDto, TaskHistoryResponse, WorkflowFitmentItemDto } from '@champ/shared';
import { devSimulatorEnabled } from '../src/config/env';
import { prisma, type User } from '../src/lib/prisma';
import { bearer, createLookup, createTaskWorld, createUser, fakeGoogle, testApi, fillSubmitReady } from './helpers';

const api = () => testApi();
const simApi = () => testApi(fakeGoogle(null), { devSimulator: true });
const GPS = { lat: 12.97, lng: 77.59 };

async function world() {
  const w = await createTaskWorld();
  const closeReason = await createLookup('CLOSE_REASON', 'Client not available');
  const otherOe = await createUser({ role: 'OE', managerId: w.om.id, name: 'Other OE' });
  const createTask = async (actor: User, overrides: Record<string, unknown> = {}) => {
    const res = await api()
      .post('/api/tasks')
      .set(bearer(actor))
      .send(w.taskBody({ technicianId: w.techA.id, vehicles: { entry: 'COUNT', count: 2 }, ...overrides }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as TaskDto;
  };
  return { ...w, closeReason, otherOe, createTask };
}

async function step(actor: User, fid: string, action: FitmentAction, payload?: unknown) {
  if (action === 'SUBMIT') await fillSubmitReady(fid);
    const res = await api().post(`/api/fitments/${fid}/transitions`).set(bearer(actor)).send({ action, payload });
  expect(res.status, `${action}: ${JSON.stringify(res.body)}`).toBe(200);
}

const list = async (actor: User, name: string, query: Record<string, string> = {}) => {
  const res = await api().get(`/api/fitments/${name}`).query(query).set(bearer(actor));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as Paginated<WorkflowFitmentItemDto>;
};
const tkIds = (page: Paginated<WorkflowFitmentItemDto>) => page.items.map((i) => i.tkId);

describe('workflow lists', () => {
  it('awaiting approval: OE-verified fitments for SA/OM, with filters; OE, RO and OT get 403', async () => {
    const w = await world();
    const a = await w.createTask(w.om);
    const b = await w.createTask(w.om, { oeId: w.otherOe.id, technicianId: w.techB.id, clientId: w.otherClient.id, siteId: w.otherClient.sites[0]!.id });
    for (const [oe, tech, fid] of [
      [w.oe, w.techA, a.fitments[0]!.id],
      [w.otherOe, w.techB, b.fitments[1]!.id],
    ] as const) {
      await step(tech, fid, 'START', GPS);
      await step(tech, fid, 'SUBMIT');
      await step(oe, fid, 'VERIFY', w.verification);
    }
    const all = await list(w.om, 'awaiting-approval');
    expect(all.total).toBe(2);
    expect(tkIds(all)).toEqual(['TK-00001', 'TK-00004']); // oldest verification first
    expect(all.items[0]).toMatchObject({
      status: 'OE_VERIFIED',
      task: { id: a.id, omId: 'OM-00001' },
      client: { name: 'Zoomcar' },
      technician: { id: w.techA.id },
      oe: { id: w.oe.id },
      verifiedBy: { id: w.oe.id },
    });
    expect(tkIds(await list(w.sa, 'awaiting-approval', { oeId: w.otherOe.id }))).toEqual(['TK-00004']);
    expect(tkIds(await list(w.om, 'awaiting-approval', { technicianId: w.techA.id }))).toEqual(['TK-00001']);
    expect(tkIds(await list(w.om, 'awaiting-approval', { clientId: w.otherClient.id }))).toEqual(['TK-00004']);
    expect((await list(w.om, 'awaiting-approval', { from: '2000-01-01', to: '2000-01-02' })).total).toBe(0);
    for (const actor of [w.oe, w.ro, w.techA]) {
      expect((await api().get('/api/fitments/awaiting-approval').set(bearer(actor))).status, actor.role).toBe(403);
    }
  });

  it('reopened: count, latest reason and who; OE sees own tasks only, RO reads, OT 403; current/filters', async () => {
    const w = await world();
    const mine = await w.createTask(w.om);
    const theirs = await w.createTask(w.om, { oeId: w.otherOe.id });
    const [m1, m2] = mine.fitments.map((f) => f.id) as [string, string];
    const t1 = theirs.fitments[0]!.id;
    await step(w.techA, m1, 'START', GPS);
    await step(w.techA, m1, 'SUBMIT');
    await step(w.oe, m1, 'REOPEN', { reason: 'Photos missing' });
    await step(w.techA, m1, 'START', GPS);
    await step(w.techA, m1, 'SUBMIT');
    await step(w.oe, m1, 'REOPEN', { reason: 'Still blurry' });
    await step(w.techA, m2, 'CLOSE_NOT_DONE', { closeReasonId: w.closeReason.id, comments: 'Locked' });
    await step(w.om, m2, 'REOPEN', { reason: 'Client available' });
    await step(w.techA, m2, 'START', GPS); // reopened before, now in progress again
    await step(w.techA, t1, 'START', GPS);
    await step(w.techA, t1, 'SUBMIT');
    await step(w.otherOe, t1, 'REOPEN', { reason: 'Other OE reopen' });

    const om = await list(w.om, 'reopened');
    expect(om.total).toBe(3);
    const first = om.items.find((i) => i.id === m1)!;
    expect(first).toMatchObject({
      reopenCount: 2,
      lastReopenReason: 'Still blurry',
      lastReopenedBy: { id: w.oe.id },
      status: 'REOPENED',
      technician: { id: w.techA.id },
      oe: { id: w.oe.id },
      task: { omId: 'OM-00001' },
    });
    expect(first.lastReopenedAt).toEqual(expect.any(String));
    expect(om.items.find((i) => i.id === m2)).toMatchObject({ reopenCount: 1, status: 'IN_PROGRESS' });

    expect((await list(w.om, 'reopened', { current: 'true' })).items.map((i) => i.id).sort()).toEqual([m1, t1].sort());
    expect((await list(w.oe, 'reopened')).items.map((i) => i.id).sort()).toEqual([m1, m2].sort());
    expect((await list(w.otherOe, 'reopened')).items.map((i) => i.id)).toEqual([t1]);
    expect((await list(w.ro, 'reopened')).total).toBe(3);
    expect((await list(w.om, 'reopened', { oeId: w.otherOe.id })).items.map((i) => i.id)).toEqual([t1]);
    expect((await list(w.om, 'reopened', { technicianId: w.techB.id })).total).toBe(0);
    expect((await list(w.om, 'reopened', { clientId: w.client.id })).total).toBe(3);
    expect((await list(w.om, 'reopened', { from: '2000-01-01', to: '2000-12-31' })).total).toBe(0);
    expect((await list(w.om, 'reopened', { pageSize: '2' })).items).toHaveLength(2);
    expect((await api().get('/api/fitments/reopened').set(bearer(w.techA))).status).toBe(403);
    expect((await api().get('/api/fitments/reopened').query({ from: 'yesterday' }).set(bearer(w.om))).status).toBe(400);
  });

  it('faulty: fitments moved to FT with the fault reason and the replacement; scoped like reopened', async () => {
    const w = await world();
    const mine = await w.createTask(w.om);
    const theirs = await w.createTask(w.om, { oeId: w.otherOe.id });
    await step(w.techA, mine.fitments[0]!.id, 'MARK_FAULTY', { reason: 'No power' });
    await step(w.techA, theirs.fitments[0]!.id, 'MARK_FAULTY', { reason: 'Broken antenna' });
    const replacement = await prisma.fitment.findUniqueOrThrow({ where: { replacementOfId: mine.fitments[0]!.id } });
    await api().post(`/api/tasks/${mine.id}/assign`).set(bearer(w.oe)).send({ fitmentIds: [replacement.id], technicianId: w.techB.id });

    const om = await list(w.om, 'faulty');
    expect(om.total).toBe(2);
    expect(om.items.find((i) => i.id === mine.fitments[0]!.id)).toMatchObject({
      status: 'MOVED_TO_FT',
      faultReason: 'No power',
      faultyAt: expect.any(String),
      replacement: { id: replacement.id, tkId: 'TK-00005', status: 'ASSIGNED', technician: { id: w.techB.id } },
    });
    expect((await list(w.oe, 'faulty')).items.map((i) => i.faultReason)).toEqual(['No power']);
    expect((await list(w.ro, 'faulty')).total).toBe(2);
    expect((await list(w.om, 'faulty', { oeId: w.otherOe.id })).items.map((i) => i.faultReason)).toEqual(['Broken antenna']);
    expect((await api().get('/api/fitments/faulty').set(bearer(w.techA))).status).toBe(403);
    // Deleted tasks never show.
    await prisma.task.update({ where: { id: theirs.id }, data: { deletedAt: new Date() } });
    expect((await list(w.om, 'faulty')).total).toBe(1);
  });
});

describe('history and raw events (SA/OM, D-033)', () => {
  it('stage timelines for the task and each fitment, with reopen loops and attributions', async () => {
    const w = await world();
    const task = await w.createTask(w.om);
    const [f1, f2] = task.fitments.map((f) => f.id) as [string, string];
    await step(w.techA, f1, 'START', GPS);
    await step(w.techA, f1, 'SUBMIT');
    await step(w.oe, f1, 'VERIFY', w.verification);
    await step(w.om, f1, 'REOPEN', { reason: 'Wrong device id' });
    await step(w.techA, f1, 'START', GPS);
    await step(w.techA, f1, 'SUBMIT');
    await step(w.oe, f1, 'VERIFY', w.verification);
    await step(w.om, f1, 'APPROVE');

    const res = await api().get(`/api/tasks/${task.id}/history`).set(bearer(w.om));
    expect(res.status).toBe(200);
    let history = res.body as TaskHistoryResponse;
    const h1 = history.fitments.find((f) => f.id === f1)!;
    expect(h1).toMatchObject({ tkId: 'TK-00001', status: 'OM_APPROVED', technician: { id: w.techA.id } });
    expect(h1.stages.first).toMatchObject({ by: { id: w.om.id }, completedBy: { id: w.om.id } });
    expect(h1.stages.second).toMatchObject({ by: { id: w.techA.id }, completedBy: { id: w.techA.id } });
    expect(h1.stages.verification).toMatchObject({ by: { id: w.oe.id } });
    expect(h1.stages.final).toMatchObject({ by: { id: w.om.id } });
    // The second stage is the current cycle: after the reopen.
    expect(h1.stages.second!.at > h1.reopenLoops[0]!.at).toBe(true);
    expect(h1.reopenLoops).toEqual([
      {
        at: expect.any(String),
        by: { id: w.om.id, name: w.om.name },
        fromStatus: 'OE_VERIFIED',
        reason: 'Wrong device id',
        attributions: expect.arrayContaining([
          { user: { id: w.oe.id, name: w.oe.name }, role: 'OE' },
          { user: { id: w.techA.id, name: 'Arjun Tech' }, role: 'OT' },
        ]),
      },
    ]);
    const h2 = history.fitments.find((f) => f.id === f2)!;
    expect(h2.stages).toMatchObject({ second: null, verification: null, final: null });
    // Task: first stage done (all assigned at creation); later stages started by f1 but not complete (f2 waits).
    expect(history.task.first).toMatchObject({ by: { id: w.om.id }, completedAt: expect.any(String) });
    expect(history.task.second).toMatchObject({ by: { id: w.techA.id }, completedAt: null });
    expect(history.task.final).toMatchObject({ by: { id: w.om.id }, completedAt: null });

    // Closing f2 as not done completes every later task stage.
    await step(w.techA, f2, 'CLOSE_NOT_DONE', { closeReasonId: w.closeReason.id, comments: 'Locked' });
    history = (await api().get(`/api/tasks/${task.id}/history`).set(bearer(w.sa))).body as TaskHistoryResponse;
    expect(history.task.final).toMatchObject({ completedAt: expect.any(String), completedBy: { id: w.om.id } });

    for (const actor of [w.oe, w.ro, w.techA]) {
      expect((await api().get(`/api/tasks/${task.id}/history`).set(bearer(actor))).status, actor.role).toBe(403);
      expect((await api().get(`/api/tasks/${task.id}/events`).set(bearer(actor))).status, actor.role).toBe(403);
    }
    expect((await api().get('/api/tasks/nope/history').set(bearer(w.om))).status).toBe(404);
  });

  it('raw events as JSON (with before/after diffs and flags) and as CSV', async () => {
    const w = await world();
    const task = await w.createTask(w.om, { vehicles: { entry: 'COUNT', count: 1 } });
    const fid = task.fitments[0]!.id;
    await step(w.techA, fid, 'START', GPS);
    await api().patch(`/api/tasks/${task.id}`).set(bearer(w.om)).send({ pocName: 'Anil' });
    await step(w.techA, fid, 'SUBMIT');
    await step(w.oe, fid, 'VERIFY', w.verification);
    await step(w.om, fid, 'APPROVE');
    await api().patch(`/api/tasks/${task.id}/fitments/${fid}`).set(bearer(w.om)).send({ chassisNo: 'CH-9' });

    const res = await api().get(`/api/tasks/${task.id}/events`).set(bearer(w.om));
    expect(res.status).toBe(200);
    const items = res.body.items as TaskEventDto[];
    expect(items.map((e) => e.type)).toEqual([
      'TASK_CREATED',
      'FITMENT_STARTED',
      'TASK_UPDATED',
      'FITMENT_SUBMITTED',
      'FITMENT_VERIFICATION_SAVED', // F06: the inline verification fields of VERIFY
      'FITMENT_VERIFIED',
      'FITMENT_APPROVED',
      'FITMENT_UPDATED',
    ]);
    expect(items[1]).toMatchObject({ actor: { id: w.techA.id, name: 'Arjun Tech' }, fitment: { id: fid, tkId: 'TK-00001' }, fromStatus: 'ASSIGNED', toStatus: 'IN_PROGRESS' });
    expect(items[2]).toMatchObject({ fitment: null, data: { pocName: ['Priya Rao', 'Anil'], postStart: true } });
    expect(items[7]!.data).toEqual({ chassisNo: [null, 'CH-9'], postApproval: true });

    const csv = await api().get(`/api/tasks/${task.id}/events`).query({ format: 'csv' }).set(bearer(w.om));
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toMatch(/^attachment; filename=champ-OM-00001-events-\d{8}-\d{4}\.csv$/);
    const lines = csv.text.replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(lines[0]).toBe('Time (IST),Actor,Fitment,Event,Type,From,To,Data');
    expect(lines).toHaveLength(9);
    expect(lines[2]).toContain(',Arjun Tech,TK-00001,Started,FITMENT_STARTED,ASSIGNED,IN_PROGRESS,');
    expect(lines[2]).toContain('"{""lat"":12.97,""lng"":77.59,""tkId"":""TK-00001""}"'); // jsonb key order
    expect((await api().get(`/api/tasks/${task.id}/events`).query({ format: 'xml' }).set(bearer(w.om))).status).toBe(400);
  });
});

describe('dev technician simulator (D-073)', () => {
  const simulate = (actor: User, fid: string, body: object) =>
    simApi().post(`/api/dev/fitments/${fid}/simulate`).set(bearer(actor)).send(body);

  it('is not mounted unless enabled, and never in production', async () => {
    const w = await world();
    const task = await w.createTask(w.om);
    const res = await api().post(`/api/dev/fitments/${task.fitments[0]!.id}/simulate`).set(bearer(w.om)).send({ action: 'START' });
    expect(res.status).toBe(404);
    expect(devSimulatorEnabled({ NODE_ENV: 'production', ENABLE_DEV_SIMULATOR: 'true' })).toBe(false);
    expect(devSimulatorEnabled({ NODE_ENV: 'development', ENABLE_DEV_SIMULATOR: undefined })).toBe(true);
    expect(devSimulatorEnabled({ NODE_ENV: 'development', ENABLE_DEV_SIMULATOR: 'false' })).toBe(false);
    expect(devSimulatorEnabled({ NODE_ENV: 'test', ENABLE_DEV_SIMULATOR: undefined })).toBe(false);
    expect(devSimulatorEnabled({ NODE_ENV: 'test', ENABLE_DEV_SIMULATOR: 'true' })).toBe(true);
  });

  it('acts as the assigned technician, defaults START to the site location, and flags events as simulated', async () => {
    const w = await world();
    const task = await w.createTask(w.oe);
    const [f1, f2] = task.fitments.map((f) => f.id) as [string, string];
    let res = await simulate(w.oe, f1, { action: 'START' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // Built for the caller: the OE sees no actions on an in-progress fitment.
    expect(res.body.fitment).toMatchObject({ status: 'IN_PROGRESS', startLat: 12.97, startLng: 77.59, availableActions: [] });
    res = await simulate(w.om, f1, { action: 'SUBMIT' });
    expect(res.body.fitment.status).toBe('SUBMITTED');
    res = await simulate(w.sa, f2, { action: 'MARK_FAULTY', payload: { reason: 'Dead' } });
    expect(res.body.fitment.status).toBe('MOVED_TO_FT');
    const events = await prisma.taskEvent.findMany({ where: { taskId: task.id, type: { startsWith: 'FITMENT_' } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    expect(events.map((e) => [e.type, e.actorId, (e.data as { simulated?: boolean }).simulated])).toEqual([
      ['FITMENT_STARTED', w.techA.id, true],
      ['FITMENT_SUBMITTED', w.techA.id, true],
      ['FITMENT_MARKED_FAULTY', w.techA.id, true],
      ['FITMENT_REPLACEMENT_CREATED', w.techA.id, true],
    ]);
    // A real transition isn't flagged.
    await step(w.oe, f1, 'VERIFY', w.verification);
    const verify = await prisma.taskEvent.findFirstOrThrow({ where: { type: 'FITMENT_VERIFIED' } });
    expect(verify.data).toEqual({ tkId: 'TK-00001', finalIssue: 'Wiring issue', billable: true }); // F06 snapshot
  });

  it('caller permissions, technician required, workflow rules and validation still apply', async () => {
    const w = await world();
    const task = await w.createTask(w.om, { technicianId: null });
    const fid = task.fitments[0]!.id;
    const noTech = await simulate(w.om, fid, { action: 'START' });
    expect(noTech.status).toBe(409);
    expect(noTech.body.error.message).toBe('Assign a technician to TK-00001 before simulating their steps');
    await api().post(`/api/tasks/${task.id}/assign`).set(bearer(w.om)).send({ fitmentIds: [fid], technicianId: w.techB.id });

    expect((await simulate(w.otherOe, fid, { action: 'START' })).status).toBe(403);
    expect((await simulate(w.ro, fid, { action: 'START' })).status).toBe(403);
    expect((await simulate(w.techB, fid, { action: 'START' })).status).toBe(403);
    expect((await simulate(w.om, fid, { action: 'VERIFY' })).status).toBe(400); // not a technician step
    expect((await simulate(w.om, fid, { action: 'CLOSE_NOT_DONE', payload: { comments: 'x' } })).status).toBe(400);
    expect((await simulate(w.om, 'nope', { action: 'START' })).status).toBe(404);
    const outOfOrder = await simulate(w.om, fid, { action: 'SUBMIT' });
    expect(outOfOrder.status).toBe(409);
    expect(outOfOrder.body.error.code).toBe('INVALID_TRANSITION');
    const ok = await simulate(w.om, fid, { action: 'START', payload: { lat: 18.5, lng: 73.8 } });
    expect(ok.body.fitment).toMatchObject({ startLat: 18.5, startLng: 73.8 });
    expect((await prisma.taskEvent.findFirstOrThrow({ where: { type: 'FITMENT_STARTED' } })).actorId).toBe(w.techB.id);
  });
});
