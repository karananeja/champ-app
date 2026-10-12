import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import {
  istTodayDay,
  type DashboardSummaryDto,
  type FitmentLookupItemDto,
  type Paginated,
  type TaskDto,
  type TravelTaskDto,
  type TravelTaskListItemDto,
} from '@champ/shared';
import { MemoryStorage } from '../src/lib/storage';
import { prisma, type User } from '../src/lib/prisma';
import { bearer, createLocation, createTaskWorld, createUser, fakeGoogle, testApi } from './helpers';

// F08: travel tasks (spec §5 API tests).
const storage = new MemoryStorage();
const api = () => testApi(fakeGoogle(null), { storage });
const JPEG = fs.readFileSync(path.resolve(import.meta.dirname, '../src/modules/dev/sample-photos/sample-before.jpg'));
const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');
const TODAY = istTodayDay();
const dayOffset = (days: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

async function world() {
  const w = await createTaskWorld();
  // A second OE (reports to the OM) with their own technician.
  const otherOe = await createUser({ role: 'OE', managerId: w.om.id, name: 'Other OE' });
  const techC = await createUser({ role: 'OT', managerId: otherOe.id, name: 'Chetan Tech', technicianType: 'CONTRACTUAL', baseLocationId: w.pune.id });
  const body = (overrides: Record<string, unknown> = {}) => ({
    technicianId: w.techA.id,
    locationId: w.location.id,
    clientId: w.client.id,
    purpose: 'Pick up a faulty device from the depot',
    travelDate: TODAY,
    distanceKm: 42.5,
    ...overrides,
  });
  const raise = async (actor: User, overrides: Record<string, unknown> = {}) => {
    const res = await api().post('/api/travel-tasks').set(bearer(actor)).send(body(overrides));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as TravelTaskDto;
  };
  const get = (actor: User, id: string) => api().get(`/api/travel-tasks/${id}`).set(bearer(actor));
  const list = (actor: User, query: Record<string, string> = {}) => api().get('/api/travel-tasks').query(query).set(bearer(actor));
  const ids = async (actor: User, query: Record<string, string> = {}) => {
    const res = await list(actor, query);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return (res.body as Paginated<TravelTaskListItemDto>).items.map((t) => t.ttId);
  };
  const transition = (actor: User, id: string, payload: Record<string, unknown>) =>
    api().post(`/api/travel-tasks/${id}/transitions`).set(bearer(actor)).send(payload);
  const patch = (actor: User, id: string, payload: Record<string, unknown>) => api().patch(`/api/travel-tasks/${id}`).set(bearer(actor)).send(payload);
  const upload = (actor: User, id: string, file: Buffer, name: string) =>
    api().post(`/api/travel-tasks/${id}/attachments`).set(bearer(actor)).attach('file', file, name);
  const remove = (actor: User, id: string, aid: string, reason?: string) =>
    api().post(`/api/travel-tasks/${id}/attachments/${aid}/remove`).set(bearer(actor)).send(reason === undefined ? {} : { reason });
  return { ...w, otherOe, techC, body, raise, get, list, ids, transition, patch, upload, remove };
}

/** A task with one fitment (TK-00001), for the related-task link. */
async function createFitment(w: Awaited<ReturnType<typeof world>>, count = 1) {
  const res = await api().post('/api/tasks').set(bearer(w.om)).send(w.taskBody({ vehicles: { entry: 'COUNT', count } }));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as TaskDto;
}

describe('raise a travel task (spec §3 POST)', () => {
  it('an OE raises for their own technician: TT-00001, Raised, source WEB, with names and a TT_RAISED event', async () => {
    const w = await world();
    const task = await createFitment(w);
    const tt = await w.raise(w.oe, { relatedFitmentId: task.fitments[0]!.id });
    expect(tt).toMatchObject({
      ttId: 'TT-00001',
      status: 'RAISED',
      source: 'WEB',
      travelDate: TODAY,
      technician: { id: w.techA.id, name: 'Arjun Tech', technicianType: 'PAYROLL' },
      oe: { id: w.oe.id },
      location: { id: w.location.id, city: 'Bengaluru', active: true },
      client: { id: w.client.id, name: 'Zoomcar' },
      purpose: 'Pick up a faulty device from the depot',
      distanceKm: 42.5,
      relatedFitment: { tkId: 'TK-00001', omId: 'OM-00001', client: 'Zoomcar' },
      raisedBy: { id: w.oe.id },
      attachmentCount: 0,
      attachments: [],
      canEdit: true,
      canVerify: true,
      availableActions: ['VERIFY', 'REJECT'],
    });
    expect(tt.events).toEqual([
      expect.objectContaining({ type: 'TT_RAISED', actor: { id: w.oe.id, name: w.oe.name }, toStatus: 'RAISED', data: { ttId: 'TT-00001' } }),
    ]);
    expect((await w.raise(w.oe, { technicianId: w.techB.id })).ttId).toBe('TT-00002');
  });

  it('OM and SA raise for any technician; an OT only for themselves (MOBILE); an OE not for another OE\'s technician; RO never', async () => {
    const w = await world();
    expect((await w.raise(w.om, { technicianId: w.techC.id })).source).toBe('WEB');
    expect((await w.raise(w.sa, { technicianId: w.techC.id })).raisedBy.id).toBe(w.sa.id);
    const own = await w.raise(w.techA, { clientId: null, distanceKm: null });
    expect(own).toMatchObject({ source: 'MOBILE', technician: { id: w.techA.id }, client: null, distanceKm: null });

    let res = await api().post('/api/travel-tasks').set(bearer(w.oe)).send(w.body({ technicianId: w.techC.id }));
    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe('An operation executive can only raise travel tasks for their own technicians');
    res = await api().post('/api/travel-tasks').set(bearer(w.techA)).send(w.body({ technicianId: w.techB.id }));
    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe('A technician can only raise their own travel tasks');
    res = await api().post('/api/travel-tasks').set(bearer(w.ro)).send(w.body());
    expect(res.status).toBe(403);
    expect(await prisma.travelTask.count()).toBe(3);
  });

  it('validates: future date, purpose, inactive references, the related fitment and the distance bounds', async () => {
    const w = await world();
    const post = (overrides: Record<string, unknown>) => api().post('/api/travel-tasks').set(bearer(w.om)).send(w.body(overrides));
    const fieldError = async (overrides: Record<string, unknown>, field: string) => {
      const res = await post(overrides);
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      return { code: res.body.error.code as string, message: (res.body.error.details.fieldErrors[field] as string[])[0] };
    };

    expect(await fieldError({ travelDate: dayOffset(1) }, 'travelDate')).toEqual({ code: 'VALIDATION_ERROR', message: "The travel date can't be in the future" });
    expect((await fieldError({ travelDate: '2026-02-30' }, 'travelDate')).message).toBe('Choose a valid travel date');
    expect((await fieldError({ purpose: undefined }, 'purpose')).message).toBe('Describe the purpose of travel');
    expect((await fieldError({ purpose: ' a ' }, 'purpose')).message).toBe('Describe the purpose of travel (at least 3 characters)');
    expect((await fieldError({ technicianId: '' }, 'technicianId')).message).toBe('Choose a technician');
    expect((await fieldError({ distanceKm: 0 }, 'distanceKm')).message).toBe('The distance must be more than 0 km');
    expect((await fieldError({ distanceKm: 5000.5 }, 'distanceKm')).message).toBe('The distance must be at most 5,000 km');
    expect((await post({ distanceKm: 5000 })).status).toBe(201);
    expect((await post({ distanceKm: 12.34 })).body.distanceKm).toBe(12.3);
    expect((await post({ travelDate: dayOffset(-30), clientId: '', relatedFitmentId: '' })).body).toMatchObject({ client: null, relatedFitment: null });

    const inactiveLocation = await createLocation({ city: 'Closed city', active: false });
    expect(await fieldError({ locationId: inactiveLocation.id }, 'locationId')).toEqual({ code: 'INACTIVE_REFERENCE', message: "Closed city is inactive and can't be chosen" });
    expect((await fieldError({ locationId: 'missing' }, 'locationId')).code).toBe('INVALID_REFERENCE');
    await prisma.client.update({ where: { id: w.otherClient.id }, data: { active: false } });
    expect((await fieldError({ clientId: w.otherClient.id }, 'clientId')).code).toBe('INACTIVE_REFERENCE');
    expect((await fieldError({ technicianId: w.oe.id }, 'technicianId')).code).toBe('INVALID_REFERENCE');
    const gone = await createUser({ role: 'OT', managerId: w.oe.id, status: 'INACTIVE', name: 'Gone Tech' });
    expect((await fieldError({ technicianId: gone.id }, 'technicianId')).code).toBe('INACTIVE_REFERENCE');

    expect(await fieldError({ relatedFitmentId: 'missing' }, 'relatedFitmentId')).toEqual({ code: 'INVALID_REFERENCE', message: 'Choose an existing TK id' });
    const task = await createFitment(w);
    await prisma.task.update({ where: { id: task.id }, data: { deletedAt: new Date() } });
    expect((await fieldError({ relatedFitmentId: task.fitments[0]!.id }, 'relatedFitmentId')).code).toBe('INVALID_REFERENCE');
  });

  it('options: the technicians the caller may raise for', async () => {
    const w = await world();
    const names = async (actor: User) => {
      const res = await api().get('/api/travel-tasks/options').set(bearer(actor));
      expect(res.status).toBe(200);
      return (res.body.technicians as { name: string }[]).map((t) => t.name);
    };
    expect(await names(w.om)).toEqual(['Arjun Tech', 'Bhavna Tech', 'Chetan Tech', expect.stringMatching(/^OT User/)]);
    expect(await names(w.oe)).toEqual(['Arjun Tech', 'Bhavna Tech', expect.stringMatching(/^OT User/)]);
    expect(await names(w.otherOe)).toEqual(['Chetan Tech']);
    expect(await names(w.techA)).toEqual(['Arjun Tech']);
    expect((await api().get('/api/travel-tasks/options').set(bearer(w.ro))).status).toBe(403);
  });
});

describe('list and detail (scope and filters)', () => {
  it('scopes per role: OE their technicians, OT their own, RO/SA/OM everything; detail out of scope is 404', async () => {
    const w = await world();
    const a = await w.raise(w.oe); // TT-1 techA
    await w.raise(w.om, { technicianId: w.techB.id }); // TT-2
    const c = await w.raise(w.otherOe, { technicianId: w.techC.id }); // TT-3
    expect(await w.ids(w.oe)).toEqual(['TT-00002', 'TT-00001']);
    expect(await w.ids(w.otherOe)).toEqual(['TT-00003']);
    expect(await w.ids(w.techA)).toEqual(['TT-00001']);
    for (const actor of [w.ro, w.sa, w.om]) expect(await w.ids(actor), actor.role).toEqual(['TT-00003', 'TT-00002', 'TT-00001']);

    expect((await w.get(w.oe, c.id)).status).toBe(404);
    expect((await w.get(w.techA, c.id)).status).toBe(404);
    expect((await w.get(w.techA, a.id)).status).toBe(200);
    const ro = (await w.get(w.ro, a.id)).body as TravelTaskDto;
    expect(ro).toMatchObject({ canEdit: false, canVerify: false, canManageAttachments: false, availableActions: [] });
    expect((await w.get(w.sa, a.id)).body).toMatchObject({ canVerify: false, availableActions: [] });
    expect((await w.get(w.om, 'missing')).status).toBe(404);
  });

  it('filters by technician, OE, customer, location, status and travel date range; searches TT ids; sorts', async () => {
    const w = await world();
    await w.raise(w.oe, { travelDate: dayOffset(-10) }); // TT-1 techA, Bengaluru, Zoomcar
    await w.raise(w.oe, { technicianId: w.techB.id, locationId: w.pune.id, clientId: null, travelDate: dayOffset(-5) }); // TT-2
    const third = await w.raise(w.om, { technicianId: w.techC.id, clientId: w.otherClient.id, travelDate: dayOffset(-1) }); // TT-3
    await w.transition(w.om, third.id, { action: 'VERIFY' });

    expect(await w.ids(w.om, { technicianId: w.techB.id })).toEqual(['TT-00002']);
    expect(await w.ids(w.om, { oeId: w.otherOe.id })).toEqual(['TT-00003']);
    expect(await w.ids(w.om, { clientId: w.client.id })).toEqual(['TT-00001']);
    expect(await w.ids(w.om, { locationId: w.pune.id })).toEqual(['TT-00002']);
    expect(await w.ids(w.om, { status: 'VERIFIED' })).toEqual(['TT-00003']);
    expect(await w.ids(w.om, { status: 'RAISED' })).toEqual(['TT-00002', 'TT-00001']);
    expect(await w.ids(w.om, { from: dayOffset(-5), to: dayOffset(-1) })).toEqual(['TT-00003', 'TT-00002']);
    expect(await w.ids(w.om, { to: dayOffset(-10) })).toEqual(['TT-00001']);
    for (const q of ['TT-00002', 'tt-2', 'TT2', '2']) expect(await w.ids(w.om, { q }), q).toEqual(['TT-00002']);
    expect(await w.ids(w.om, { q: 'Zoomcar' })).toEqual([]);
    expect(await w.ids(w.om, { sort: 'travelDate:asc' })).toEqual(['TT-00001', 'TT-00002', 'TT-00003']);
    expect(await w.ids(w.om, { sort: 'createdAt:desc' })).toEqual(['TT-00003', 'TT-00002', 'TT-00001']);
    // An OE's filters stay inside their scope.
    expect(await w.ids(w.oe, { technicianId: w.techC.id })).toEqual([]);

    const row = ((await w.list(w.om, { q: '1' })).body as Paginated<TravelTaskListItemDto>).items[0]!;
    expect(row).toMatchObject({ ttId: 'TT-00001', oe: { id: w.oe.id }, location: { city: 'Bengaluru' }, client: { name: 'Zoomcar' }, attachmentCount: 0, relatedFitment: null });
    expect((await w.list(w.om, { status: 'DONE' })).status).toBe(400);
  });
});

describe('verify, reject, resubmit, reopen (D-120, D-121)', () => {
  it('the OE verifies (locked), an OM reopens with a reason, then the OE verifies again', async () => {
    const w = await world();
    const tt = await w.raise(w.oe);
    for (const actor of [w.sa, w.ro, w.techA, w.otherOe]) {
      const res = await w.transition(actor, tt.id, { action: 'VERIFY' });
      expect(res.status, actor.role).toBe(403);
    }
    let res = await w.transition(w.oe, tt.id, { action: 'VERIFY' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ status: 'VERIFIED', verifiedBy: { id: w.oe.id }, canEdit: false, availableActions: [] });
    expect((await w.get(w.om, tt.id)).body.availableActions).toEqual(['REOPEN']);

    res = await w.transition(w.oe, tt.id, { action: 'VERIFY' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'INVALID_TRANSITION', message: 'TT-00001 is Verified; only Raised travel tasks can be verified' });

    res = await w.patch(w.oe, tt.id, { purpose: 'Changed after verification' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'TRAVEL_LOCKED', message: 'TT-00001 is Verified, so it can no longer be changed; an operations manager can reopen it' });
    expect((await w.patch(w.ro, tt.id, { purpose: 'Nope' })).status).toBe(403);
    expect((await w.patch(w.otherOe, tt.id, { purpose: 'Nope' })).status).toBe(403);

    res = await w.transition(w.oe, tt.id, { action: 'REOPEN', reason: 'Wrong distance' });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe('Only an operations manager can reopen a verified travel task');
    expect((await w.transition(w.om, tt.id, { action: 'REOPEN' })).status).toBe(400);
    res = await w.transition(w.om, tt.id, { action: 'REOPEN', reason: 'Wrong distance' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'RAISED', verifiedAt: null, verifiedBy: null, reopenReason: 'Wrong distance', reopenedBy: { id: w.om.id } });
    expect((await w.patch(w.oe, tt.id, { distanceKm: 40 })).status).toBe(200);
    expect((await w.transition(w.om, tt.id, { action: 'VERIFY' })).body.status).toBe('VERIFIED');
  });

  it('reject needs a reason; the raiser or an OM resubmits (with changes); others get 403; the rejection stays in history', async () => {
    const w = await world();
    const tt = await w.raise(w.oe);
    let res = await w.transition(w.oe, tt.id, { action: 'REJECT' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.fieldErrors.reason).toEqual(['Give a reason']);
    res = await w.transition(w.oe, tt.id, { action: 'REJECT', reason: 'no' });
    expect(res.status).toBe(400);
    res = await w.transition(w.oe, tt.id, { action: 'REJECT', reason: 'Receipt missing' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'REJECTED', rejectionReason: 'Receipt missing', rejectedBy: { id: w.oe.id }, canEdit: true, availableActions: ['RESUBMIT'] });
    expect((await w.get(w.techA, tt.id)).body.availableActions).toEqual([]);

    for (const actor of [w.techA, w.otherOe, w.sa, w.ro]) {
      expect((await w.transition(actor, tt.id, { action: 'RESUBMIT' })).status, actor.role).toBe(403);
    }
    res = await w.transition(w.oe, tt.id, { action: 'RESUBMIT', changes: { distanceKm: 38, purpose: 'Pick up the faulty device, receipt attached' } });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ status: 'RAISED', distanceKm: 38, purpose: 'Pick up the faulty device, receipt attached' });
    const events = (res.body as TravelTaskDto).events.map((e) => [e.type, e.fromStatus, e.toStatus]);
    expect(events).toEqual([
      ['TT_RAISED', null, 'RAISED'],
      ['TT_REJECTED', 'RAISED', 'REJECTED'],
      ['TT_RESUBMITTED', 'REJECTED', 'RAISED'],
    ]);
    expect((res.body as TravelTaskDto).events[1]!.data).toEqual({ ttId: 'TT-00001', reason: 'Receipt missing' });
    expect((res.body as TravelTaskDto).events[2]!.data).toEqual({
      ttId: 'TT-00001',
      purpose: ['Pick up a faulty device from the depot', 'Pick up the faulty device, receipt attached'],
      distanceKm: [42.5, 38],
    });

    // The OM may resubmit too, and the changes are validated.
    await w.transition(w.oe, tt.id, { action: 'REJECT', reason: 'Still wrong date' });
    res = await w.transition(w.om, tt.id, { action: 'RESUBMIT', changes: { travelDate: dayOffset(2) } });
    expect(res.status).toBe(400);
    res = await w.transition(w.om, tt.id, { action: 'RESUBMIT', changes: { travelDate: dayOffset(-2) } });
    expect(res.body).toMatchObject({ status: 'RAISED', travelDate: dayOffset(-2) });
    expect((await w.transition(w.om, tt.id, { action: 'RESUBMIT' })).status).toBe(409);
  });

  it('two concurrent verifies: one wins, the other gets 409', async () => {
    const w = await world();
    const tt = await w.raise(w.oe);
    const results = await Promise.all([w.transition(w.oe, tt.id, { action: 'VERIFY' }), w.transition(w.om, tt.id, { action: 'VERIFY' })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.travelTaskEvent.count({ where: { travelTaskId: tt.id, type: 'TT_VERIFIED' } })).toBe(1);
  });

  it('PATCH writes a TT_UPDATED event with readable diffs; an OE cannot hand the TT to another OE\'s technician', async () => {
    const w = await world();
    const task = await createFitment(w);
    const tt = await w.raise(w.oe);
    let res = await w.patch(w.oe, tt.id, {
      locationId: w.pune.id,
      technicianId: w.techB.id,
      clientId: null,
      relatedFitmentId: task.fitments[0]!.id,
      travelDate: dayOffset(-1),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const updated = (res.body as TravelTaskDto).events.at(-1)!;
    expect(updated).toMatchObject({ type: 'TT_UPDATED', actor: { id: w.oe.id, name: w.oe.name } });
    expect(updated.data).toEqual({
      ttId: 'TT-00001',
      technician: ['Arjun Tech', 'Bhavna Tech'],
      location: ['Bengaluru', 'Pune'],
      customer: ['Zoomcar', null],
      travelDate: [TODAY, dayOffset(-1)],
      relatedTask: [null, 'TK-00001'],
    });
    // Nothing changed: no event.
    res = await w.patch(w.oe, tt.id, { locationId: w.pune.id });
    expect((res.body as TravelTaskDto).events).toHaveLength(2);
    // An unchanged location that was deactivated since is still accepted.
    await prisma.location.update({ where: { id: w.pune.id }, data: { active: false } });
    expect((await w.patch(w.oe, tt.id, { purpose: 'Still in Pune' })).status).toBe(200);

    res = await w.patch(w.oe, tt.id, { technicianId: w.techC.id });
    expect(res.status).toBe(403);
    expect((await w.patch(w.om, tt.id, { technicianId: w.techC.id })).status).toBe(200);
    // The OE no longer sees it (techC reports to the other OE).
    expect((await w.get(w.oe, tt.id)).status).toBe(404);
    expect((await w.patch(w.oe, tt.id, {})).status).toBe(400);
  });
});

describe('receipts (spec §3 attachments)', () => {
  it('accepts images and PDFs (magic bytes), refuses other files, oversize and an 11th receipt; remove keeps the row', async () => {
    const w = await world();
    const tt = await w.raise(w.oe);
    let res = await w.upload(w.oe, tt.id, JPEG, 'ticket.jpg');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const image = res.body.attachment;
    expect(image).toMatchObject({ contentType: 'image/jpeg', width: 800, height: 600, originalName: 'ticket.jpg', status: 'ACTIVE', uploadedBy: { id: w.oe.id } });
    expect(image.url).toBe(`http://storage.test/travel/${tt.id}/${image.id}.jpg?expires=600`);
    expect(await storage.exists(`travel/${tt.id}/${image.id}.jpg`)).toBe(true);

    res = await w.upload(w.oe, tt.id, PDF, 'bill.pdf');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.attachment).toMatchObject({ contentType: 'application/pdf', width: null, height: null, originalName: 'bill.pdf' });
    expect(res.body.attachment.url).toMatch(new RegExp(`/travel/${tt.id}/.+\\.pdf\\?expires=600$`));

    res = await w.upload(w.oe, tt.id, Buffer.from('just some text\n'), 'notes.pdf');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'UNSUPPORTED_FILE', message: 'Only JPEG, PNG or WebP images or PDF files can be uploaded' });
    res = await w.upload(w.oe, tt.id, Buffer.concat([JPEG, Buffer.alloc(10 * 1024 * 1024)]), 'huge.jpg');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'FILE_TOO_LARGE', message: 'The file must be 10 MB or smaller' });
    res = await api().post(`/api/travel-tasks/${tt.id}/attachments`).set(bearer(w.oe)).field('note', 'x');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('Choose an image or PDF to upload');

    const detail = (await w.get(w.oe, tt.id)).body as TravelTaskDto;
    expect(detail.attachments.map((a) => a.contentType)).toEqual(['image/jpeg', 'application/pdf']);
    expect(detail.attachmentCount).toBe(2);

    for (let i = 0; i < 8; i++) expect((await w.upload(w.om, tt.id, PDF, `r${i}.pdf`)).status).toBe(201);
    res = await w.upload(w.oe, tt.id, PDF, 'eleven.pdf');
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe('TT-00001 already has 10 receipts; remove one before adding another');

    res = await w.remove(w.oe, tt.id, image.id, 'Duplicate');
    expect(res.status).toBe(204);
    const row = await prisma.travelAttachment.findUniqueOrThrow({ where: { id: image.id } });
    expect(row).toMatchObject({ status: 'REMOVED', removedById: w.oe.id, removeReason: 'Duplicate' });
    expect(await storage.exists(row.objectKey)).toBe(true);
    expect((await w.remove(w.oe, tt.id, image.id)).status).toBe(409);
    expect((await w.remove(w.oe, tt.id, 'missing')).status).toBe(404);
    expect((await w.upload(w.oe, tt.id, PDF, 'tenth.pdf')).status).toBe(201);

    const events = await prisma.travelTaskEvent.findMany({ where: { travelTaskId: tt.id, type: { startsWith: 'TT_ATTACHMENT' } }, orderBy: { createdAt: 'asc' } });
    expect(events).toHaveLength(12);
    expect(events[0]!.data).toEqual({ ttId: 'TT-00001', attachmentId: image.id, name: 'ticket.jpg', contentType: 'image/jpeg' });
    expect(events.find((e) => e.type === 'TT_ATTACHMENT_REMOVED')!.data).toEqual({ ttId: 'TT-00001', attachmentId: image.id, name: 'ticket.jpg', reason: 'Duplicate' });
  });

  it('checks the role and the TT rule before reading the file: RO, an OT for another technician, others\' OEs; locked once verified', async () => {
    const w = await world();
    const tt = await w.raise(w.oe);
    let res = await w.upload(w.ro, tt.id, JPEG, 'x.jpg');
    expect(res.status).toBe(403);
    res = await w.upload(w.techB, tt.id, JPEG, 'x.jpg');
    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe('You can only change your own travel tasks');
    expect((await w.upload(w.otherOe, tt.id, JPEG, 'x.jpg')).status).toBe(403);
    // Not the raiser, but in scope and not the verifier: the technician of this TT may not add receipts on the web flow.
    expect((await w.upload(w.techA, tt.id, JPEG, 'x.jpg')).status).toBe(403);
    expect((await w.upload(w.sa, tt.id, JPEG, 'x.jpg')).status).toBe(403);
    expect((await w.upload(w.om, 'missing', JPEG, 'x.jpg')).status).toBe(404);
    // An OT's own TT: they raised it, so they manage its receipts.
    const own = await w.raise(w.techA);
    expect((await w.upload(w.techA, own.id, PDF, 'bus.pdf')).status).toBe(201);
    expect(await prisma.travelAttachment.count()).toBe(1);

    await w.transition(w.oe, tt.id, { action: 'VERIFY' });
    res = await w.upload(w.oe, tt.id, JPEG, 'late.jpg');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TRAVEL_LOCKED');
  });
});

describe('export (spec §3)', () => {
  it('CSV and Excel with every column, the list filters and the caller\'s scope', async () => {
    const w = await world();
    const task = await createFitment(w);
    const tt = await w.raise(w.oe, { relatedFitmentId: task.fitments[0]!.id, purpose: '=HYPERLINK("x")' });
    await w.upload(w.oe, tt.id, PDF, 'bill.pdf');
    await w.transition(w.oe, tt.id, { action: 'REJECT', reason: 'Receipt unreadable' });
    await w.raise(w.otherOe, { technicianId: w.techC.id, clientId: null, distanceKm: null });

    let res = await api().get('/api/travel-tasks/export').query({ format: 'csv' }).set(bearer(w.om)).buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(/champ-travel-tasks-\d{8}-\d{4}\.csv/);
    const lines = res.text.replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(lines[0]).toBe(
      'TT id,Travel date,Technician,Technician type,OE,Location,Customer,Purpose,Related TK,Distance (km),Status,Raised by,Raised at (IST),Verified by,Verified at (IST),Rejected by,Rejected at (IST),Rejection reason,Attachments',
    );
    expect(lines).toHaveLength(3);
    expect(lines[2]).toContain(`TT-00001,${TODAY},Arjun Tech,Payroll,${w.oe.name},Bengaluru,Zoomcar,"'=HYPERLINK(""x"")",TK-00001,42.5,Rejected,${w.oe.name},`);
    expect(lines[2]).toMatch(/,Receipt unreadable,1$/);

    res = await api().get('/api/travel-tasks/export').query({ format: 'csv' }).set(bearer(w.otherOe)).buffer(true);
    expect(res.text.trim().split('\r\n')).toHaveLength(2);
    res = await api().get('/api/travel-tasks/export').query({ format: 'csv', status: 'RAISED' }).set(bearer(w.ro)).buffer(true);
    expect(res.text.trim().split('\r\n').slice(1).map((l) => l.split(',')[0])).toEqual(['TT-00002']);

    res = await api()
      .get('/api/travel-tasks/export')
      .query({ format: 'xlsx' })
      .set(bearer(w.om))
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(res.body as Buffer);
    const sheet = book.getWorksheet('Travel tasks')!;
    expect(sheet.getRow(1).values).toEqual([undefined, ...lines[0]!.split(',')]);
    expect(sheet.rowCount).toBe(3);
    expect(sheet.getRow(3).getCell(1).value).toBe('TT-00001');
    expect(sheet.getRow(3).getCell(11).value).toBe('Rejected');
  });
});

describe('dashboard summary (travelToVerify)', () => {
  it('OM counts every Raised TT, an OE those of their technicians; SA and RO get none', async () => {
    const w = await world();
    await w.raise(w.oe);
    const verified = await w.raise(w.oe, { technicianId: w.techB.id });
    await w.transition(w.oe, verified.id, { action: 'VERIFY' });
    await w.raise(w.otherOe, { technicianId: w.techC.id });
    const summary = async (actor: User) => (await api().get('/api/tasks/summary').set(bearer(actor))).body as DashboardSummaryDto;
    expect((await summary(w.om)).travelToVerify).toBe(2);
    expect((await summary(w.oe)).travelToVerify).toBe(1);
    expect((await summary(w.otherOe)).travelToVerify).toBe(1);
    expect(await summary(w.sa)).not.toHaveProperty('travelToVerify');
    expect(await summary(w.ro)).not.toHaveProperty('travelToVerify');
    // Each count equals the list its card links to.
    expect((await w.list(w.oe, { status: 'RAISED' })).body.total).toBe(1);
  });
});

describe('GET /fitments/lookup', () => {
  it('finds up to 10 fitments by TK id or number (prefix), skips deleted tasks; OT gets 403', async () => {
    const w = await world();
    await createFitment(w, 12); // TK-00001..12
    const deleted = await createFitment(w, 1); // TK-00013
    await prisma.task.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });
    const find = async (q: string, actor: User = w.oe) => {
      const res = await api().get('/api/fitments/lookup').query({ q }).set(bearer(actor));
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return (res.body.items as FitmentLookupItemDto[]).map((f) => f.tkId);
    };
    expect(await find('1')).toEqual(['TK-00001', 'TK-00010', 'TK-00011', 'TK-00012']);
    expect(await find('TK-00012')).toEqual(['TK-00012']);
    expect(await find('tk 2', w.ro)).toEqual(['TK-00002']);
    expect(await find('13')).toEqual([]);
    expect(await find('OM-1')).toEqual([]);
    expect(await find('device')).toEqual([]);
    const item = ((await api().get('/api/fitments/lookup').query({ q: 'TK-00002' }).set(bearer(w.om))).body.items as FitmentLookupItemDto[])[0];
    expect(item).toMatchObject({ tkId: 'TK-00002', omId: 'OM-00001', client: 'Zoomcar', status: 'OPEN', technician: null });
    expect((await api().get('/api/fitments/lookup').query({ q: '1' }).set(bearer(w.techA))).status).toBe(403);
    expect((await api().get('/api/fitments/lookup').set(bearer(w.om))).status).toBe(400);
  });
});
