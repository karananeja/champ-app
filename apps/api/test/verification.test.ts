import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';
import type { FitmentAction, FitmentVerificationDto, Paginated, TaskDto, TaskListItemDto } from '@champ/shared';
import { MemoryStorage } from '../src/lib/storage';
import { prisma, type User } from '../src/lib/prisma';
import { bearer, createLookup, createTaskWorld, createUser, fakeGoogle, testApi, fillSubmitReady } from './helpers';

const storage = new MemoryStorage();
const api = () => testApi(fakeGoogle(null), { storage, devSimulator: true });
const GPS = { lat: 12.97, lng: 77.59 };

/** A task (OE = world OE) with `count` fitments assigned to technician A. */
async function setup(count = 1) {
  const w = await createTaskWorld();
  const res = await api()
    .post('/api/tasks')
    .set(bearer(w.om))
    .send(w.taskBody({ technicianId: w.techA.id, vehicles: { entry: 'COUNT', count } }));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const task = res.body as TaskDto;
  const transition = async (actor: User, fid: string, action: FitmentAction, payload?: unknown) => {
    if (action === 'SUBMIT') await fillSubmitReady(fid);
    return api().post(`/api/fitments/${fid}/transitions`).set(bearer(actor)).send(payload === undefined ? { action } : { action, payload });
  };
  const step = async (actor: User, fid: string, action: FitmentAction, payload?: unknown) => {
    const r = await transition(actor, fid, action, payload);
    expect(r.status, `${action}: ${JSON.stringify(r.body)}`).toBe(200);
  };
  const submit = async (fid: string) => {
    await step(w.techA, fid, 'START', GPS);
    await step(w.techA, fid, 'SUBMIT');
  };
  const save = (actor: User, fid: string, body: Record<string, unknown>) =>
    api().put(`/api/fitments/${fid}/verification`).set(bearer(actor)).send(body);
  return { ...w, task, fids: task.fitments.map((f) => f.id), transition, step, submit, save };
}

const fitmentRow = (id: string) => prisma.fitment.findUniqueOrThrow({ where: { id }, include: { accessories: true } });
const eventsOf = (fitmentId: string, type?: string) =>
  prisma.taskEvent.findMany({ where: { fitmentId, ...(type && { type }) }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
const getTask = async (actor: User, id: string) => (await api().get(`/api/tasks/${id}`).set(bearer(actor))).body as TaskDto;

describe('verification draft save (PUT /fitments/:fid/verification)', () => {
  it('saves partial fields and nulls, replaces accessories, and writes a readable diff', async () => {
    const w = await setup();
    const fid = w.fids[0]!;
    await w.submit(fid);

    let res = await w.save(w.oe, fid, { issueObservedId: w.observed.id, accessoryIds: [w.relay.id, w.buzzer.id], oeRemarks: '  Checked  ' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const dto = res.body as FitmentVerificationDto;
    expect(dto).toMatchObject({
      issueObserved: { id: w.observed.id, name: 'Loose wiring', active: true },
      actionTaken: null,
      accessories: [{ name: 'Buzzer' }, { name: 'Relay' }],
      oeRemarks: 'Checked',
      finalIssue: null,
      billable: null,
      updatedBy: { id: w.oe.id },
    });
    expect(dto.updatedAt).toEqual(expect.any(String));

    res = await w.save(w.oe, fid, { issueObservedId: null, accessoryIds: [w.relay.id], oeRemarks: '' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ issueObserved: null, accessories: [{ name: 'Relay' }], oeRemarks: null });
    expect((await fitmentRow(fid)).accessories.map((a) => a.accessoryId)).toEqual([w.relay.id]);

    // Nothing changed: no new event.
    expect((await w.save(w.oe, fid, { accessoryIds: [w.relay.id] })).status).toBe(200);
    const events = await eventsOf(fid, 'FITMENT_VERIFICATION_SAVED');
    expect(events.map((e) => e.data)).toEqual([
      { tkId: 'TK-00001', issueObserved: [null, 'Loose wiring'], accessories: [null, 'Buzzer, Relay'], oeRemarks: [null, 'Checked'] },
      { tkId: 'TK-00001', issueObserved: ['Loose wiring', null], accessories: ['Buzzer, Relay', 'Relay'], oeRemarks: ['Checked', null] },
    ]);
    expect(events.every((e) => e.actorId === w.oe.id)).toBe(true);
  });

  it('rejects references of the wrong kind or inactive ones (changed), keeps an unchanged inactive one', async () => {
    const w = await setup();
    const fid = w.fids[0]!;
    await w.submit(fid);
    const wrongKind = await w.save(w.oe, fid, { issueObservedId: w.actionTaken.id });
    expect(wrongKind.status).toBe(400);
    expect(wrongKind.body.error).toMatchObject({ code: 'INVALID_REFERENCE', details: { fieldErrors: { issueObservedId: [expect.any(String)] } } });
    expect((await w.save(w.oe, fid, { accessoryIds: [w.observed.id] })).body.error.code).toBe('INVALID_REFERENCE');
    expect((await w.save(w.oe, fid, { finalIssueId: 'nope' })).body.error.code).toBe('INVALID_REFERENCE');

    const old = await createLookup('ACTION_TAKEN', 'Old action', { active: false });
    const inactive = await w.save(w.oe, fid, { actionTakenId: old.id });
    expect(inactive.status).toBe(400);
    expect(inactive.body.error.code).toBe('INACTIVE_REFERENCE');

    expect((await w.save(w.oe, fid, { actionTakenId: w.actionTaken.id })).status).toBe(200);
    await prisma.lookupItem.update({ where: { id: w.actionTaken.id }, data: { active: false } });
    const unchanged = await w.save(w.oe, fid, { actionTakenId: w.actionTaken.id, oeRemarks: 'ok' });
    expect(unchanged.status).toBe(200);
    expect(unchanged.body.actionTaken).toMatchObject({ name: 'Rewired power supply', active: false });

    expect((await w.save(w.oe, fid, { oeRemarks: 'x'.repeat(1001) })).body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('VERIFY with the verification (D-098, D-101)', () => {
  it('refuses an incomplete verification with the missing fields, then verifies with inline fields', async () => {
    const w = await setup();
    const fid = w.fids[0]!;
    await w.submit(fid);
    await w.save(w.oe, fid, { issueObservedId: w.observed.id });

    const incomplete = await w.transition(w.oe, fid, 'VERIFY');
    expect(incomplete.status).toBe(400);
    expect(incomplete.body.error).toEqual({
      code: 'VERIFICATION_INCOMPLETE',
      message: 'Fill in Action taken, Final issue before verifying',
      details: {
        missing: [
          { field: 'actionTakenId', label: 'Action taken' },
          { field: 'finalIssueId', label: 'Final issue' },
        ],
        fieldErrors: { actionTakenId: ['Choose the action taken'], finalIssueId: ['Choose the final issue'] },
      },
    });
    // Inline fields that leave a gap: nothing is saved (one transaction).
    const partial = await w.transition(w.oe, fid, 'VERIFY', { actionTakenId: w.actionTaken.id });
    expect(partial.body.error.code).toBe('VERIFICATION_INCOMPLETE');
    expect((await fitmentRow(fid)).actionTakenId).toBeNull();

    const ok = await w.transition(w.oe, fid, 'VERIFY', { actionTakenId: w.actionTaken.id, finalIssueId: w.billableIssue.id, note: 'Fine' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.fitment).toMatchObject({
      status: 'OE_VERIFIED',
      verification: { actionTaken: { name: 'Rewired power supply' }, finalIssue: { name: 'Wiring issue', billable: true }, billable: true },
    });
    const events = await eventsOf(fid);
    expect(events.slice(-2).map((e) => [e.type, e.data])).toEqual([
      ['FITMENT_VERIFICATION_SAVED', { tkId: 'TK-00001', actionTaken: [null, 'Rewired power supply'], finalIssue: [null, 'Wiring issue'] }],
      ['FITMENT_VERIFIED', { tkId: 'TK-00001', note: 'Fine', finalIssue: 'Wiring issue', billable: true }],
    ]);
  });

  it('billable is a snapshot: a master flag flip keeps it; a new final issue after verify recomputes it; reopen clears it', async () => {
    const w = await setup(2);
    const [f1, f2] = w.fids as [string, string];
    await w.submit(f1);
    await w.submit(f2);
    await w.step(w.oe, f1, 'VERIFY', w.verification);
    await w.step(w.oe, f2, 'VERIFY', { ...w.verification, finalIssueId: w.freeIssue.id });
    expect((await fitmentRow(f1)).billable).toBe(true);
    expect((await fitmentRow(f2)).billable).toBe(false);

    await prisma.lookupItem.update({ where: { id: w.billableIssue.id }, data: { billable: false } });
    expect((await fitmentRow(f1)).billable).toBe(true);
    const om = await getTask(w.om, w.task.id);
    expect(om.fitments[0]!.verification).toMatchObject({ billable: true, finalIssue: { billable: false } });

    // Changing the final issue after verification re-snapshots from the new issue's current flag.
    const vehicle = await createLookup('FINAL_ISSUE', 'Vehicle-side issue', { billable: true });
    let res = await w.save(w.oe, f2, { finalIssueId: vehicle.id });
    expect(res.body).toMatchObject({ finalIssue: { name: 'Vehicle-side issue' }, billable: true });
    expect((await eventsOf(f2, 'FITMENT_VERIFICATION_SAVED')).at(-1)!.data).toEqual({
      tkId: 'TK-00002',
      finalIssue: ['Device fault', 'Vehicle-side issue'],
      billable: [false, true],
    });
    // Required fields can't be cleared on a verified fitment.
    res = await w.save(w.oe, f2, { finalIssueId: null });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'VERIFICATION_INCOMPLETE', message: "TK-00002 is verified, so Final issue can't be left empty" });

    // List counts: 2 verified, 2 billable.
    const list = (await api().get('/api/tasks').query({ view: 'all' }).set(bearer(w.om))).body as Paginated<TaskListItemDto>;
    expect(list.items[0]).toMatchObject({ verifiedCount: 2, billableCount: 2 });

    await w.step(w.oe, f2, 'REOPEN', { reason: 'Redo the wiring' });
    const reopened = await fitmentRow(f2);
    expect(reopened).toMatchObject({ billable: null, finalIssueId: vehicle.id }); // fields kept
    const after = (await api().get('/api/tasks').query({ view: 'all' }).set(bearer(w.om))).body as Paginated<TaskListItemDto>;
    expect(after.items[0]).toMatchObject({ verifiedCount: 1, billableCount: 1 });
  });
});

describe('verification edit locks (spec §3)', () => {
  it('OE until OM approval, OM always (post-approval flagged); SA, RO, other OE and OT never', async () => {
    const w = await setup();
    const fid = w.fids[0]!;
    const otherOe = await createUser({ role: 'OE', managerId: w.om.id });
    // Before submission nobody edits it.
    expect((await w.save(w.oe, fid, { oeRemarks: 'early' })).status).toBe(409);
    await w.submit(fid);

    for (const actor of [w.sa, w.ro, otherOe, w.techA]) {
      const res = await w.save(actor, fid, { oeRemarks: 'nope' });
      expect(res.status, actor.role).toBe(403);
    }
    expect((await w.save(w.om, fid, { oeRemarks: 'OM note' })).status).toBe(200); // OM: Submitted too
    await w.step(w.oe, fid, 'VERIFY', w.verification);
    expect((await w.save(w.oe, fid, { oeRemarks: 'OE after verify' })).status).toBe(200);
    await w.step(w.om, fid, 'APPROVE');

    const locked = await w.save(w.oe, fid, { oeRemarks: 'too late' });
    expect(locked.status).toBe(409);
    expect(locked.body.error).toEqual({ code: 'FITMENT_LOCKED', message: 'TK-00001 is OM approved, so you can no longer change its verification.' });
    const post = await w.save(w.om, fid, { finalIssueId: w.freeIssue.id });
    expect(post.status).toBe(200);
    expect(post.body.billable).toBe(false);
    expect((await eventsOf(fid, 'FITMENT_VERIFICATION_SAVED')).at(-1)!.data).toMatchObject({ postApproval: true, billable: [true, false] });
    expect((await w.save(w.oe, 'missing', {})).status).toBe(404);
  });

  it('task detail flags per role and status, with verification and photo counts', async () => {
    const w = await setup();
    const fid = w.fids[0]!;
    await w.submit(fid);
    await w.step(w.oe, fid, 'VERIFY', { ...w.verification, accessoryIds: [w.relay.id] });
    const flags = async (actor: User) => {
      const f = (await getTask(actor, w.task.id)).fitments[0]!;
      return [f.canEditVerification, f.canManagePhotos];
    };
    expect(await flags(w.oe)).toEqual([true, true]);
    expect(await flags(w.om)).toEqual([true, true]);
    expect(await flags(w.sa)).toEqual([false, false]);
    expect(await flags(w.ro)).toEqual([false, false]);
    const ro = (await getTask(w.ro, w.task.id)).fitments[0]!;
    expect(ro.verification).toMatchObject({
      issueObserved: { name: 'Loose wiring' },
      actionTaken: { name: 'Rewired power supply' },
      accessories: [{ name: 'Relay' }],
      finalIssue: { name: 'Wiring issue' },
      billable: true,
      otRemarks: null,
    });
    // F10B: the photos added by fillSubmitReady before SUBMIT.
    expect(ro.photoCounts).toEqual({ active: 4, byKind: { BEFORE: 1, ASSET: 1, CLUSTER: 1, AFTER: 1 } });
    await w.step(w.om, fid, 'APPROVE');
    expect(await flags(w.oe)).toEqual([false, false]);
    expect(await flags(w.om)).toEqual([true, true]);
  });
});

describe('fitment-level export (spec §4)', () => {
  const parse = (text: string) => Papa.parse<Record<string, string>>(text.replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: true });

  it('one row per fitment with the verification columns, as CSV and xlsx', async () => {
    const w = await setup(2);
    const [f1] = w.fids as [string, string];
    await prisma.fitment.update({ where: { id: f1 }, data: { vehicleRegNo: 'KA01AB1000' } });
    await w.submit(f1);
    await w.step(w.oe, f1, 'VERIFY', { ...w.verification, accessoryIds: [w.relay.id, w.buzzer.id] });
    await w.step(w.om, f1, 'APPROVE');

    const res = await api().get('/api/tasks/export').query({ view: 'all', level: 'fitment' }).set(bearer(w.ro));
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename=champ-fitments-\d{8}-\d{4}\.csv$/);
    const { data, meta } = parse(res.text);
    expect(meta.fields).toEqual([
      'TK id', 'OM task ID', 'OE task ID', 'Customer', 'Site', 'Technician', 'Status', 'Registration number', 'Chassis number',
      'Asset number', 'Old device id', 'Issue observed', 'Action taken', 'Accessories', 'Final issue', 'Billable', 'Verified at (IST)',
      'Approved at (IST)',
    ]);
    expect(data).toHaveLength(2);
    expect(data[0]).toMatchObject({
      'TK id': 'TK-00001',
      'OM task ID': 'OM-00001',
      Customer: 'Zoomcar',
      Technician: 'Arjun Tech',
      Status: 'OM approved',
      'Registration number': 'KA01AB1000',
      'Issue observed': 'Loose wiring',
      'Action taken': 'Rewired power supply',
      Accessories: 'Buzzer; Relay',
      'Final issue': 'Wiring issue',
      Billable: 'Yes',
    });
    expect(data[0]!['Verified at (IST)']).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(data[1]).toMatchObject({ 'TK id': 'TK-00002', Status: 'Assigned', 'Final issue': '', Billable: '', 'Approved at (IST)': '' });

    // Task level keeps one row per task, now with verified and billable counts.
    const tasks = parse((await api().get('/api/tasks/export').query({ view: 'all' }).set(bearer(w.om))).text).data;
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ 'Verified fitments': '1', 'Billable fitments': '1' });

    const xlsx = await api()
      .get('/api/tasks/export')
      .query({ view: 'all', level: 'fitment', format: 'xlsx' })
      .set(bearer(w.om))
      .buffer(true)
      .parse((r, done) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => done(null, Buffer.concat(chunks)));
      });
    expect(xlsx.headers['content-disposition']).toMatch(/filename=champ-fitments-\d{8}-\d{4}\.xlsx$/);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(xlsx.body as Parameters<typeof workbook.xlsx.load>[0]);
    const sheet = workbook.getWorksheet('Fitments')!;
    expect(sheet.getRow(1).getCell(1).value).toBe('TK id');
    expect(sheet.getRow(1).getCell(16).value).toBe('Billable');
    expect(sheet.getRow(2).getCell(16).value).toBe('Yes');
    expect(sheet.getRow(2).getCell(15).value).toBe('Wiring issue');
  });
});
