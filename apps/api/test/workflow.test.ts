import { describe, expect, it } from 'vitest';
import type { FitmentAction, TaskDto, TransitionResponse } from '@champ/shared';
import { prisma, type User } from '../src/lib/prisma';
import { bearer, createLookup, createTaskWorld, createUser, testApi } from './helpers';

const api = () => testApi();

/** A task world plus a task (OE = world OE) whose fitments are all assigned to technician A, and a close reason. */
async function setup(count = 2, overrides: Record<string, unknown> = {}) {
  const w = await createTaskWorld();
  const closeReason = await createLookup('CLOSE_REASON', 'Client not available');
  const res = await api()
    .post('/api/tasks')
    .set(bearer(w.om))
    .send(w.taskBody({ technicianId: w.techA.id, vehicles: { entry: 'CSV', rows: Array.from({ length: count }, (_, i) => ({ vehicleRegNo: `KA01AB${1000 + i}` })) }, ...overrides }));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const task = res.body as TaskDto;
  return { ...w, closeReason, task, fids: task.fitments.map((f) => f.id) };
}

const GPS = { lat: 12.97, lng: 77.59 };

const transition = (actor: User, fid: string, action: FitmentAction, payload?: unknown) =>
  api().post(`/api/fitments/${fid}/transitions`).set(bearer(actor)).send(payload === undefined ? { action } : { action, payload });

/** Runs transitions that must succeed. */
async function run(...steps: [User, string, FitmentAction, unknown?][]) {
  let last: TransitionResponse | undefined;
  for (const [actor, fid, action, payload] of steps) {
    const res = await transition(actor, fid, action, payload);
    expect(res.status, `${action}: ${JSON.stringify(res.body)}`).toBe(200);
    last = res.body as TransitionResponse;
  }
  return last!;
}

/** Drives a fitment (assigned to tech A) to a status through the real transitions. */
async function driveTo(w: Awaited<ReturnType<typeof setup>>, fid: string, status: 'IN_PROGRESS' | 'SUBMITTED' | 'OE_VERIFIED' | 'OM_APPROVED') {
  const steps: [User, string, FitmentAction, unknown?][] = [[w.techA, fid, 'START', GPS]];
  if (status !== 'IN_PROGRESS') steps.push([w.techA, fid, 'SUBMIT']);
  if (status === 'OE_VERIFIED' || status === 'OM_APPROVED') steps.push([w.oe, fid, 'VERIFY', w.verification]);
  if (status === 'OM_APPROVED') steps.push([w.om, fid, 'APPROVE']);
  return run(...steps);
}

const getTask = async (actor: User, id: string) => (await api().get(`/api/tasks/${id}`).set(bearer(actor))).body as TaskDto;
const fitmentRow = (id: string) => prisma.fitment.findUniqueOrThrow({ where: { id } });
const eventsOf = (taskId: string) => prisma.taskEvent.findMany({ where: { taskId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });

describe('workflow — happy path', () => {
  it('Assigned → In progress → Submitted → OE verified → OM approved; the task becomes Completed', async () => {
    const w = await setup(2);
    const [f1, f2] = w.fids as [string, string];

    let res = await run([w.techA, f1, 'START', GPS]);
    expect(res.fitment).toMatchObject({ status: 'IN_PROGRESS', startLat: 12.97, startLng: 77.59, tkId: 'TK-00001' });
    expect(res.fitment.startedAt).toEqual(expect.any(String));
    expect(res.task).toMatchObject({ id: w.task.id, omId: 'OM-00001', status: 'IN_PROGRESS' });

    res = await run([w.techA, f1, 'SUBMIT', { note: 'All good' }]);
    expect(res.fitment.status).toBe('SUBMITTED');
    expect(res.fitment.submittedAt).toEqual(expect.any(String));
    // The OT's own view: once submitted they can still edit the data, but have no more actions.
    expect(res.fitment.availableActions).toEqual([]);
    expect(res.fitment.canEditData).toBe(true);

    // The OE sees Verify and Reopen on the task page.
    const oeView = await getTask(w.oe, w.task.id);
    expect(oeView.fitments[0]!.availableActions).toEqual(['VERIFY', 'REOPEN']);
    expect((await getTask(w.om, w.task.id)).fitments[0]!.availableActions).toEqual(['REOPEN']);

    res = await run([w.oe, f1, 'VERIFY', w.verification]);
    expect(res.fitment).toMatchObject({ status: 'OE_VERIFIED', verifiedBy: { id: w.oe.id } });
    expect(res.fitment.canEditData).toBe(true); // the OE until OM approval
    expect((await getTask(w.om, w.task.id)).fitments[0]!.availableActions).toEqual(['APPROVE', 'REOPEN']);

    res = await run([w.om, f1, 'APPROVE']);
    expect(res.fitment).toMatchObject({ status: 'OM_APPROVED', approvedBy: { id: w.om.id } });
    expect(res.fitment.approvedAt).toEqual(expect.any(String));
    expect(res.task.status).toBe('IN_PROGRESS'); // f2 still Assigned

    res = await run([w.techA, f2, 'CLOSE_NOT_DONE', { closeReasonId: w.closeReason.id, comments: 'Gate locked' }]);
    expect(res.fitment).toMatchObject({ status: 'CLOSED_NOT_DONE', closeReason: { name: 'Client not available' }, closeComments: 'Gate locked' });
    expect(res.task.status).toBe('COMPLETED');
    expect((await prisma.task.findUniqueOrThrow({ where: { id: w.task.id } })).status).toBe('COMPLETED');

    const events = (await eventsOf(w.task.id)).filter((e) => e.fitmentId === f1);
    expect(events.map((e) => [e.type, e.fromStatus, e.toStatus, e.actorId])).toEqual([
      ['FITMENT_STARTED', 'ASSIGNED', 'IN_PROGRESS', w.techA.id],
      ['FITMENT_SUBMITTED', 'IN_PROGRESS', 'SUBMITTED', w.techA.id],
      ['FITMENT_VERIFICATION_SAVED', null, null, w.oe.id], // F06: VERIFY's inline fields
      ['FITMENT_VERIFIED', 'SUBMITTED', 'OE_VERIFIED', w.oe.id],
      ['FITMENT_APPROVED', 'OE_VERIFIED', 'OM_APPROVED', w.om.id],
    ]);
    expect(events[0]!.data).toEqual({ tkId: 'TK-00001', ...GPS });
    expect(events[1]!.data).toEqual({ tkId: 'TK-00001', note: 'All good' });
  });

  it('an OT acts on their own fitment through /fitments, though /tasks stays closed to them', async () => {
    const w = await setup(1);
    expect((await transition(w.techA, w.fids[0]!, 'START', GPS)).status).toBe(200);
    expect((await api().get(`/api/tasks/${w.task.id}`).set(bearer(w.techA))).status).toBe(403);
  });
});

describe('workflow — refusals', () => {
  it('steps out of order give 409 INVALID_TRANSITION with a clear message', async () => {
    const w = await setup(1);
    const fid = w.fids[0]!;
    const refuse = async (actor: User, action: FitmentAction, message: string, payload?: unknown) => {
      const res = await transition(actor, fid, action, payload);
      expect(res.status, action).toBe(409);
      expect(res.body.error).toEqual({ code: 'INVALID_TRANSITION', message });
    };
    await refuse(w.techA, 'SUBMIT', 'This fitment is Assigned; only In-progress fitments can be submitted');
    await refuse(w.oe, 'REOPEN', 'This fitment is Assigned; only Submitted, OE-verified or Closed – not done fitments can be reopened', { reason: 'Redo' });
    await driveTo(w, fid, 'SUBMITTED');
    await refuse(w.om, 'APPROVE', 'This fitment is Submitted; only OE-verified fitments can be final-approved');
    await refuse(w.techA, 'START', 'This fitment is Submitted; only Assigned or Reopened fitments can be started', GPS);
    await refuse(w.techA, 'MARK_FAULTY', 'This fitment is Submitted; only Assigned, In-progress or Reopened fitments can be marked faulty', { reason: 'x' });
    await run([w.oe, fid, 'VERIFY', w.verification]);
    await refuse(w.oe, 'VERIFY', 'This fitment is OE verified; only Submitted fitments can be verified');
    await run([w.om, fid, 'APPROVE']);
    await refuse(w.om, 'REOPEN', 'This fitment is OM approved; only Submitted, OE-verified or Closed – not done fitments can be reopened', { reason: 'Too late' });
    expect((await fitmentRow(fid)).status).toBe('OM_APPROVED');
  });

  it('the wrong actor gets 403: other OE, other technician, OE approving, OM verifying, RO, unassigned fitment', async () => {
    const w = await setup(1, { vehicles: { entry: 'COUNT', count: 2 } });
    const [fid, unassigned] = w.fids as [string, string];
    await api().post(`/api/tasks/${w.task.id}/assign`).set(bearer(w.om)).send({ fitmentIds: [unassigned], technicianId: null });
    const otherOe = await createUser({ role: 'OE', managerId: w.om.id });
    const expect403 = async (actor: User, id: string, action: FitmentAction, payload?: unknown) => {
      const res = await transition(actor, id, action, payload);
      expect(res.status, `${actor.role} ${action}`).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    };
    await expect403(w.techB, fid, 'START', GPS); // someone else's fitment
    await expect403(w.oe, fid, 'START', GPS); // an OE doing the fitment comes later (D-078)
    await expect403(w.om, fid, 'START', GPS);
    await expect403(w.techA, unassigned, 'START', GPS);
    await driveTo(w, fid, 'SUBMITTED');
    await expect403(otherOe, fid, 'VERIFY'); // OE of another task
    await expect403(w.om, fid, 'VERIFY');
    await expect403(w.sa, fid, 'VERIFY');
    await expect403(w.techA, fid, 'VERIFY');
    await expect403(w.ro, fid, 'REOPEN', { reason: 'Nope' });
    await expect403(otherOe, fid, 'REOPEN', { reason: 'Nope' });
    await run([w.oe, fid, 'VERIFY', w.verification]);
    await expect403(w.oe, fid, 'APPROVE');
    await expect403(w.techA, fid, 'APPROVE');
    await expect403(w.ro, fid, 'APPROVE');
    const forbidden = await transition(w.oe, fid, 'APPROVE');
    expect(forbidden.body.error.message).toBe('Only an operations manager can final-approve fitments');
    expect((await fitmentRow(fid)).status).toBe('OE_VERIFIED');
  });

  it('404 for unknown fitments and fitments of deleted tasks; 401 without a token', async () => {
    const w = await setup(1);
    expect((await transition(w.om, 'nope', 'APPROVE')).status).toBe(404);
    await prisma.task.update({ where: { id: w.task.id }, data: { deletedAt: new Date() } });
    expect((await transition(w.techA, w.fids[0]!, 'START', GPS)).status).toBe(404);
    expect((await api().post(`/api/fitments/${w.fids[0]}/transitions`).send({ action: 'START', payload: GPS })).status).toBe(401);
  });

  it('START needs the GPS location; CLOSE_NOT_DONE needs an active close reason and comments; unknown actions are 400', async () => {
    const w = await setup(1);
    const fid = w.fids[0]!;
    for (const payload of [undefined, {}, { lat: 12.9 }, { lat: 'x', lng: 77 }, { lat: 120, lng: 77 }]) {
      const res = await transition(w.techA, fid, 'START', payload);
      expect(res.status, JSON.stringify(payload)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect((await api().post(`/api/fitments/${fid}/transitions`).set(bearer(w.techA)).send({ action: 'DANCE' })).status).toBe(400);
    expect((await transition(w.techA, fid, 'CLOSE_NOT_DONE', { comments: 'x' })).status).toBe(400);
    expect((await transition(w.techA, fid, 'CLOSE_NOT_DONE', { closeReasonId: w.closeReason.id, comments: ' ' })).status).toBe(400);
    const wrongKind = await transition(w.techA, fid, 'CLOSE_NOT_DONE', { closeReasonId: w.issue.id, comments: 'x' });
    expect(wrongKind.body.error.code).toBe('INVALID_REFERENCE');
    await prisma.lookupItem.update({ where: { id: w.closeReason.id }, data: { active: false } });
    const inactive = await transition(w.techA, fid, 'CLOSE_NOT_DONE', { closeReasonId: w.closeReason.id, comments: 'x' });
    expect(inactive.status).toBe(400);
    expect(inactive.body.error.code).toBe('INACTIVE_REFERENCE');
    expect((await fitmentRow(fid)).status).toBe('ASSIGNED');
    expect((await transition(w.techA, fid, 'MARK_FAULTY', {})).status).toBe(400);
    expect((await transition(w.techA, fid, 'SUBMIT', { note: 'x'.repeat(501) })).status).toBe(400);
  });
});

describe('workflow — faulty device (D-012)', () => {
  it('MARK_FAULTY moves the fitment to FT and creates an Open replacement (new TK, linked); the task becomes Open', async () => {
    const w = await setup(2);
    const [f1] = w.fids as [string, string];
    await run([w.techA, f1, 'START', GPS]);
    const res = await run([w.techA, f1, 'MARK_FAULTY', { reason: 'Device dead on arrival' }]);
    expect(res.fitment).toMatchObject({
      status: 'MOVED_TO_FT',
      faultReason: 'Device dead on arrival',
      replacement: { tkId: 'TK-00003', status: 'OPEN' },
    });
    expect(res.task.status).toBe('OPEN');
    expect(res.task.counts).toEqual({ total: 3, assigned: 2, open: 1 });

    const replacement = await prisma.fitment.findUniqueOrThrow({ where: { replacementOfId: f1 } });
    expect(replacement).toMatchObject({ tkNo: 3, seq: 3, status: 'OPEN', technicianId: null, vehicleRegNo: 'KA01AB1000', taskId: w.task.id });
    const detail = await getTask(w.oe, w.task.id);
    expect(detail.fitments[2]).toMatchObject({ tkId: 'TK-00003', replacementOf: { id: f1, tkId: 'TK-00001' }, availableActions: [] });

    const events = (await eventsOf(w.task.id)).filter((e) => ['FITMENT_MARKED_FAULTY', 'FITMENT_REPLACEMENT_CREATED'].includes(e.type));
    expect(events.map((e) => [e.type, e.fitmentId, e.data])).toEqual([
      ['FITMENT_MARKED_FAULTY', f1, { tkId: 'TK-00001', reason: 'Device dead on arrival', replacementTkId: 'TK-00003' }],
      ['FITMENT_REPLACEMENT_CREATED', replacement.id, { tkId: 'TK-00003', replacementOf: 'TK-00001', reason: 'Device dead on arrival' }],
    ]);

    // The OE assigns the replacement; the faulty fitment can't be reassigned.
    const assign = await api().post(`/api/tasks/${w.task.id}/assign`).set(bearer(w.oe)).send({ fitmentIds: [replacement.id], technicianId: w.techB.id });
    expect(assign.status).toBe(200);
    expect(assign.body.fitments[2]).toMatchObject({ status: 'ASSIGNED', technician: { id: w.techB.id } });
    expect(assign.body.status).toBe('IN_PROGRESS');
    const locked = await api().post(`/api/tasks/${w.task.id}/assign`).set(bearer(w.oe)).send({ fitmentIds: [f1], technicianId: w.techB.id });
    expect(locked.status).toBe(409);
  });
});

describe('workflow — reopen (D-027, D-074, D-075)', () => {
  const attributionsOf = (fitmentId: string) =>
    prisma.reopenAttribution.findMany({ where: { fitmentId }, orderBy: { role: 'asc' }, select: { userId: true, role: true } });

  it('an OE reopen of a Submitted fitment counts against the technician; the fitment goes back to them', async () => {
    const w = await setup(1);
    const fid = w.fids[0]!;
    await driveTo(w, fid, 'SUBMITTED');
    const noReason = await transition(w.oe, fid, 'REOPEN');
    expect(noReason.status).toBe(400);
    expect((await transition(w.oe, fid, 'REOPEN', { reason: 'ab' })).status).toBe(400);

    const res = await run([w.oe, fid, 'REOPEN', { reason: 'Photos missing' }]);
    expect(res.fitment).toMatchObject({ status: 'REOPENED', reopenCount: 1, lastReopenReason: 'Photos missing', technician: { id: w.techA.id } });
    expect(res.task.status).toBe('IN_PROGRESS');
    expect(await attributionsOf(fid)).toEqual([{ userId: w.techA.id, role: 'OT' }]);
    const row = await fitmentRow(fid);
    expect(row).toMatchObject({ lastReopenedById: w.oe.id, reopenCount: 1 });
    expect(row.submittedAt).not.toBeNull(); // kept until the next start
    const event = (await eventsOf(w.task.id)).find((e) => e.type === 'FITMENT_REOPENED')!;
    expect(event).toMatchObject({ fromStatus: 'SUBMITTED', toStatus: 'REOPENED', actorId: w.oe.id });
    expect(event.data).toEqual({ tkId: 'TK-00001', reason: 'Photos missing', attributions: [{ userId: w.techA.id, role: 'OT' }] });

    // The same technician redoes it.
    await run([w.techA, fid, 'START', GPS], [w.techA, fid, 'SUBMIT'], [w.oe, fid, 'VERIFY', w.verification], [w.om, fid, 'APPROVE']);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: w.task.id } })).status).toBe('COMPLETED');
  });

  it('an OM reopen of an OE-verified fitment counts against the OE and the technician, and clears the verification', async () => {
    const w = await setup(1);
    const fid = w.fids[0]!;
    await driveTo(w, fid, 'OE_VERIFIED');
    const res = await run([w.om, fid, 'REOPEN', { reason: 'Wrong device id' }]);
    expect(res.fitment).toMatchObject({ status: 'REOPENED', verifiedAt: null, verifiedBy: null, reopenCount: 1 });
    expect(await attributionsOf(fid)).toEqual([
      { userId: w.oe.id, role: 'OE' },
      { userId: w.techA.id, role: 'OT' },
    ]);
    // History keeps the verification.
    expect((await eventsOf(w.task.id)).some((e) => e.type === 'FITMENT_VERIFIED')).toBe(true);
  });

  it('an OM reopen of a Closed – not done fitment counts against the technician; SA can reopen too', async () => {
    const w = await setup(2);
    const [f1, f2] = w.fids as [string, string];
    await run([w.techA, f1, 'CLOSE_NOT_DONE', { closeReasonId: w.closeReason.id, comments: 'Locked' }]);
    await run([w.om, f1, 'REOPEN', { reason: 'Client is available now' }]);
    expect(await attributionsOf(f1)).toEqual([{ userId: w.techA.id, role: 'OT' }]);
    await driveTo(w, f2, 'SUBMITTED');
    await run([w.sa, f2, 'REOPEN', { reason: 'Check again' }]);
    expect(await attributionsOf(f2)).toEqual([{ userId: w.techA.id, role: 'OT' }]);
    // A second reopen of the same fitment counts again.
    await run([w.techA, f2, 'START', GPS], [w.techA, f2, 'SUBMIT'], [w.oe, f2, 'REOPEN', { reason: 'Still wrong' }]);
    expect((await fitmentRow(f2)).reopenCount).toBe(2);
    expect(await prisma.reopenAttribution.count({ where: { userId: w.techA.id } })).toBe(3);
  });

  it('a reopened fitment can be reassigned (stays Reopened) and started by the new technician; unassigning makes it Open', async () => {
    const w = await setup(1);
    const fid = w.fids[0]!;
    await driveTo(w, fid, 'SUBMITTED');
    await run([w.oe, fid, 'REOPEN', { reason: 'Redo please' }]);
    const assign = (technicianId: string | null) =>
      api().post(`/api/tasks/${w.task.id}/assign`).set(bearer(w.oe)).send({ fitmentIds: [fid], technicianId });
    let res = await assign(w.techB.id);
    expect(res.status).toBe(200);
    expect(res.body.fitments[0]).toMatchObject({ status: 'REOPENED', technician: { id: w.techB.id } });
    expect((await transition(w.techA, fid, 'START', GPS)).status).toBe(403);
    res = await assign(null);
    expect(res.body.fitments[0]).toMatchObject({ status: 'OPEN', technician: null, reopenCount: 1 });
    expect(res.body.status).toBe('OPEN');
    res = await assign(w.techB.id);
    expect(res.body.fitments[0].status).toBe('ASSIGNED');
    await run([w.techB, fid, 'START', GPS]);
    const assignEvents = (await eventsOf(w.task.id)).filter((e) => e.type.startsWith('FITMENT_') && e.type.includes('ASSIGN')).slice(-3);
    expect(assignEvents.map((e) => [e.type, e.fromStatus, e.toStatus])).toEqual([
      ['FITMENT_ASSIGNED', 'REOPENED', 'REOPENED'],
      ['FITMENT_UNASSIGNED', 'REOPENED', 'OPEN'],
      ['FITMENT_ASSIGNED', 'OPEN', 'ASSIGNED'],
    ]);
  });
});

describe('workflow — approvals', () => {
  it('two simultaneous APPROVE calls: exactly one succeeds', async () => {
    const w = await setup(1);
    const fid = w.fids[0]!;
    await driveTo(w, fid, 'OE_VERIFIED');
    const results = await Promise.all([transition(w.om, fid, 'APPROVE'), transition(w.sa, fid, 'APPROVE')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.taskEvent.count({ where: { fitmentId: fid, type: 'FITMENT_APPROVED' } })).toBe(1);
  });

  it('concurrent approvals of the last two fitments of a task still complete it', async () => {
    const w = await setup(2);
    const [f1, f2] = w.fids as [string, string];
    await driveTo(w, f1, 'OE_VERIFIED');
    await driveTo(w, f2, 'OE_VERIFIED');
    const results = await Promise.all([transition(w.om, f1, 'APPROVE'), transition(w.om, f2, 'APPROVE')]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: w.task.id } })).status).toBe('COMPLETED');
  });

  it('bulk approve: per-fitment results with mixed outcomes; OM/SA only; at most 200', async () => {
    const w = await setup(3);
    const [f1, f2, f3] = w.fids as [string, string, string];
    await driveTo(w, f1, 'OE_VERIFIED');
    await driveTo(w, f2, 'OE_VERIFIED');
    await driveTo(w, f3, 'SUBMITTED');
    const approve = (actor: User, fitmentIds: string[]) => api().post('/api/fitments/approve').set(bearer(actor)).send({ fitmentIds });
    expect((await approve(w.oe, [f1])).status).toBe(403);
    expect((await approve(w.ro, [f1])).status).toBe(403);
    expect((await approve(w.om, [])).status).toBe(400);
    expect((await approve(w.om, Array.from({ length: 201 }, (_, i) => `id-${i}`))).status).toBe(400);

    const res = await approve(w.om, [f1, f2, f3, 'missing', f1]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      approved: ['TK-00001', 'TK-00002'],
      failed: [
        { tkId: 'TK-00003', code: 'INVALID_TRANSITION', message: 'This fitment is Submitted; only OE-verified fitments can be final-approved' },
        { tkId: 'missing', code: 'NOT_FOUND', message: 'Fitment not found' },
      ],
    });
    expect((await fitmentRow(f2)).status).toBe('OM_APPROVED');
  });
});

describe('workflow — edit locks in the task detail', () => {
  it('canEditData follows the shared rule per role and status', async () => {
    const w = await setup(1);
    const fid = w.fids[0]!;
    const canEdit = async (actor: User) => (await getTask(actor, w.task.id)).fitments[0]!.canEditData;
    expect([await canEdit(w.om), await canEdit(w.oe), await canEdit(w.ro)]).toEqual([true, true, false]);
    await driveTo(w, fid, 'OM_APPROVED');
    expect([await canEdit(w.om), await canEdit(w.sa), await canEdit(w.oe), await canEdit(w.ro)]).toEqual([true, true, false, false]);
  });
});
