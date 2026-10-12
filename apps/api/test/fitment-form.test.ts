import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FitmentAction, FitmentPhotoDto, MyFitmentDto, TaskDto } from '@champ/shared';
import { MemoryStorage } from '../src/lib/storage';
import { prisma, type User } from '../src/lib/prisma';
import { bearer, createTaskWorld, createUser, fakeGoogle, testApi } from './helpers';

// F10B: the technician's form, photos, the SUBMIT check and the simulator (spec §7).
const storage = new MemoryStorage();
const api = () => testApi(fakeGoogle(null), { storage, devSimulator: true });
const JPEG = fs.readFileSync(path.resolve(import.meta.dirname, '../src/modules/dev/sample-photos/sample-before.jpg'));
const GPS = { lat: 12.97, lng: 77.59 };
const CHECKS = { assetCondition: 'OK', accessories: 'NOT_OK', batteryCondition: 'OK', clusterMeter: 'NA', canVoltage: 'OK' };

async function setup(opts: { vehicle?: boolean; technician?: 'OT' | 'OE' } = {}) {
  const w = await createTaskWorld();
  const tech = opts.technician === 'OE' ? w.oe : w.techA;
  const body = w.taskBody({
    vehicles: { entry: 'COUNT', count: 1 },
    ...(opts.vehicle === false && { assetTypeId: w.battery.id, activityId: w.batteryInstall.id, makeModelId: null }),
  });
  const created = await api().post('/api/tasks').set(bearer(w.om)).send(body);
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const fid = (created.body as TaskDto).fitments[0]!.id;
  await prisma.fitment.update({ where: { id: fid }, data: { technicianId: tech.id, status: 'ASSIGNED' } });
  const transition = (actor: User, action: FitmentAction, payload?: unknown) =>
    api().post(`/api/fitments/${fid}/transitions`).set(bearer(actor)).send(payload === undefined ? { action } : { action, payload });
  const put = (actor: User, form: object) => api().put(`/api/mobile/fitments/${fid}/form`).set(bearer(actor)).send(form);
  const upload = (actor: User, kind: string, fields: Record<string, string> = {}, file: Buffer = JPEG) => {
    let req = api().post(`/api/mobile/fitments/${fid}/photos`).set(bearer(actor)).field('kind', kind);
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return req.attach('file', file, 'photo.jpg');
  };
  const get = (actor: User) => api().get(`/api/mobile/fitments/${fid}`).set(bearer(actor));
  const start = async () => expect((await transition(tech, 'START', GPS)).status).toBe(200);
  const events = (type: string) => prisma.taskEvent.findMany({ where: { fitmentId: fid, type }, orderBy: { createdAt: 'asc' } });
  /** A complete form and the required photos (vehicle: with the cluster photo). */
  const complete = async (kinds = ['BEFORE', 'ASSET', 'CLUSTER', 'AFTER']) => {
    expect((await put(tech, { checks: CHECKS, deviceReplacement: 'NONE', deviceId: 'dev-1', vehicleRegNo: 'KA01AB1234', clusterReadingKm: 5 })).status).toBe(200);
    for (const k of kinds) expect((await upload(tech, k)).status).toBe(201);
  };
  return { ...w, tech, fid, transition, put, upload, get, start, events, complete };
}

describe('PUT /mobile/fitments/:fid/form', () => {
  it('merges a partial form, normalises it and returns the fitment; no event while In progress', async () => {
    const w = await setup();
    await w.start();
    let res = await w.put(w.tech, { deviceId: '  ab12 ', checks: { canVoltage: 'OK' }, comments: 'Fitted behind dash' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((res.body as MyFitmentDto).form).toMatchObject({ deviceId: 'AB12', checks: { canVoltage: 'OK' }, comments: 'Fitted behind dash' });
    res = await w.put(w.tech, { checks: { accessories: 'NOT_OK', canVoltage: null }, clusterReadingKm: 0, chassisNo: '' });
    const form = (res.body as MyFitmentDto).form;
    expect(form).toMatchObject({ deviceId: 'AB12', checks: { accessories: 'NOT_OK' }, clusterReadingKm: 0, chassisNo: null, comments: 'Fitted behind dash' });
    expect(form.updatedAt).not.toBeNull();
    const row = await prisma.fitment.findUniqueOrThrow({ where: { id: w.fid } });
    expect(row.otRemarks).toBe('Fitted behind dash');
    expect(await w.events('FITMENT_FORM_UPDATED')).toHaveLength(0);
  });

  it('validates the body', async () => {
    const w = await setup();
    await w.start();
    for (const body of [{ clusterReadingKm: -1 }, { deviceReplacement: 'X' }, { checks: { canVoltage: 'BAD' } }, { comments: 'x'.repeat(1001) }]) {
      const res = await w.put(w.tech, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('refuses another technician (403), web roles (403), and locks after verify or before start (409)', async () => {
    const w = await setup();
    const res0 = await w.put(w.tech, { deviceId: 'A' });
    expect(res0.status).toBe(409);
    expect(res0.body.error.code).toBe('FITMENT_LOCKED');
    await w.start();
    expect((await w.put(w.techB, { deviceId: 'A' })).status).toBe(403);
    expect((await w.put(w.om, { deviceId: 'A' })).status).toBe(403);
    const otherOe = await createUser({ role: 'OE', managerId: w.om.id });
    expect((await w.put(otherOe, { deviceId: 'A' })).status).toBe(403);
    await w.complete();
    expect((await w.transition(w.tech, 'SUBMIT')).status).toBe(200);
    expect((await w.transition(w.oe, 'VERIFY', w.verification)).status).toBe(200);
    const res = await w.put(w.tech, { deviceId: 'B' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'FITMENT_LOCKED', message: expect.stringContaining('OE verified') });
    expect((await w.upload(w.tech, 'AFTER')).status).toBe(409);
  });

  it('writes a readable diff event for changes while Submitted (none when nothing changed)', async () => {
    const w = await setup();
    await w.start();
    await w.complete();
    expect((await w.transition(w.tech, 'SUBMIT')).status).toBe(200);
    expect((await w.put(w.tech, { deviceId: 'DEV-2', checks: { accessories: 'OK' }, deviceReplacement: 'NONE' })).status).toBe(200);
    expect((await w.put(w.tech, { deviceId: 'dev-2' })).status).toBe(200); // same value after upper-casing
    const events = await w.events('FITMENT_FORM_UPDATED');
    expect(events).toHaveLength(1);
    expect(events[0]!.actorId).toBe(w.tech.id);
    expect(events[0]!.data).toEqual({ tkId: expect.stringMatching(/^TK-/), 'Device id': ['DEV-1', 'DEV-2'], Accessories: ['Not OK', 'OK'] });
  });

  it('works for an OE assigned as the technician (D-158)', async () => {
    const w = await setup({ technician: 'OE' });
    await w.start();
    expect((await w.put(w.oe, { deviceId: 'X1' })).status).toBe(200);
    expect((await w.upload(w.oe, 'BEFORE')).status).toBe(201);
  });
});

describe('POST /mobile/fitments/:fid/photos', () => {
  it('stores the photo with takenAt, lat and lng under the F06 key; a retake replaces it and keeps history', async () => {
    const w = await setup();
    await w.start();
    const takenAt = new Date(Date.now() - 60_000).toISOString();
    let res = await w.upload(w.tech, 'BEFORE', { lat: '12.5', lng: '77.25', takenAt });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const first = res.body as FitmentPhotoDto;
    expect(first).toMatchObject({ kind: 'BEFORE', status: 'ACTIVE', source: 'OT', lat: 12.5, lng: 77.25, takenAt, uploadedBy: { id: w.tech.id } });
    const row = await prisma.fitmentPhoto.findUniqueOrThrow({ where: { id: first.id } });
    expect(row.objectKey).toBe(`fitments/${w.fid}/${first.id}.jpg`);
    expect(await storage.exists(row.objectKey)).toBe(true);
    expect((await w.events('PHOTO_ADDED'))[0]!.data).toMatchObject({ photoId: first.id, kind: 'BEFORE' });

    res = await w.upload(w.tech, 'BEFORE');
    expect(res.status).toBe(201);
    const second = res.body as FitmentPhotoDto;
    expect(second.takenAt).toBeNull();
    const old = await prisma.fitmentPhoto.findUniqueOrThrow({ where: { id: first.id } });
    expect(old).toMatchObject({ status: 'REPLACED', replacedById: second.id, changedById: w.tech.id });
    expect((await w.events('PHOTO_REPLACED'))[0]!.data).toMatchObject({ photoId: first.id, replacementId: second.id, kind: 'BEFORE' });

    const mine = (await w.get(w.tech)).body as MyFitmentDto;
    expect(mine.photos.map((p) => p.id)).toEqual([second.id]);
  });

  it('accepts only technician kinds and valid fields', async () => {
    const w = await setup();
    await w.start();
    for (const fields of [{}, { kind: 'DEBUG' }, { kind: 'BEFORE', lat: '12' }, { kind: 'BEFORE', takenAt: new Date(Date.now() + 3_600_000).toISOString() }]) {
      let req = api().post(`/api/mobile/fitments/${w.fid}/photos`).set(bearer(w.tech));
      for (const [k, v] of Object.entries(fields)) req = req.field(k, v as string);
      const res = await req.attach('file', JPEG, 'p.jpg');
      expect(res.status, JSON.stringify(fields)).toBe(400);
    }
    const res = await w.upload(w.tech, 'AFTER', {}, Buffer.from('not an image'));
    expect(res.body.error.code).toBe('UNSUPPORTED_FILE');
  });

  it('refuses before reading the file: wrong role, other technician, locked status', async () => {
    const w = await setup();
    const big = Buffer.alloc(11 * 1024 * 1024, 1); // would be FILE_TOO_LARGE if it were read
    let res = await w.upload(w.tech, 'BEFORE', {}, big);
    expect(res.status).toBe(409); // Assigned: not started yet
    await w.start();
    res = await w.upload(w.techB, 'BEFORE', {}, big);
    expect(res.status).toBe(403);
    res = await w.upload(w.om, 'BEFORE', {}, big);
    expect(res.status).toBe(403);
    expect(await prisma.fitmentPhoto.count({ where: { fitmentId: w.fid } })).toBe(0);
  });
});

describe('SUBMIT form check (D-180–D-183)', () => {
  it('refuses with FORM_INCOMPLETE listing what is missing, then submits with a form snapshot', async () => {
    const w = await setup();
    await w.start();
    let res = await w.transition(w.tech, 'SUBMIT');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('FORM_INCOMPLETE');
    expect(res.body.error.details.missing).toEqual([
      'Before photo',
      'Asset photo',
      'Cluster reading photo',
      'Asset condition',
      'Accessories',
      'Vehicle battery condition',
      'Cluster meter reading',
      'CAN voltage',
      'Vehicle registration no.',
      'Cluster reading (km)',
      'Device replacement',
      'Device id',
      'After photo',
    ]);
    await w.complete(['BEFORE', 'ASSET', 'AFTER']);
    res = await w.transition(w.tech, 'SUBMIT');
    expect(res.body.error.details.missing).toEqual(['Cluster reading photo']);
    expect((await w.put(w.tech, { deviceReplacement: 'SIM' })).status).toBe(200);
    expect((await w.upload(w.tech, 'CLUSTER')).status).toBe(201);
    res = await w.transition(w.tech, 'SUBMIT');
    expect(res.body.error.details.missing).toEqual(['SIM placement photo']);
    expect((await w.upload(w.tech, 'PLACEMENT')).status).toBe(201);
    res = await w.transition(w.tech, 'SUBMIT');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const [event] = await w.events('FITMENT_SUBMITTED');
    expect((event!.data as { form: unknown }).form).toMatchObject({
      Accessories: 'Not OK',
      'Cluster meter reading': 'Not applicable',
      'Device replacement': 'SIM',
      'Device id': 'DEV-1',
      'Vehicle registration no.': 'KA01AB1234',
      'Cluster reading (km)': '5',
    });
    // Editable while Submitted (D-184).
    expect((await w.put(w.tech, { comments: 'Fixed typo' })).status).toBe(200);
  });

  it('a non-vehicle asset needs neither reg no., cluster reading nor the cluster photo', async () => {
    const w = await setup({ vehicle: false });
    await w.start();
    expect((await w.put(w.tech, { checks: CHECKS, deviceReplacement: 'NONE', deviceId: 'D1' })).status).toBe(200);
    for (const k of ['BEFORE', 'ASSET']) expect((await w.upload(w.tech, k)).status).toBe(201);
    let res = await w.transition(w.tech, 'SUBMIT');
    expect(res.body.error.details.missing).toEqual(['After photo']);
    expect((await w.upload(w.tech, 'AFTER')).status).toBe(201);
    res = await w.transition(w.tech, 'SUBMIT');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(((await w.get(w.tech)).body as MyFitmentDto).isVehicle).toBe(false);
  });

  it('the dev simulator still submits, filling the form and sample photos', async () => {
    const w = await setup();
    const sim = (action: string) => api().post(`/api/dev/fitments/${w.fid}/simulate`).set(bearer(w.oe)).send({ action });
    expect((await sim('START')).status).toBe(200);
    expect((await w.upload(w.tech, 'BEFORE')).status).toBe(201);
    expect((await w.put(w.tech, { deviceId: 'MINE' })).status).toBe(200);
    const res = await sim('SUBMIT');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.fitment.status).toBe('SUBMITTED');
    expect(res.body.fitment.photoCounts.byKind).toEqual({ BEFORE: 1, ASSET: 1, CLUSTER: 1, PLACEMENT: 1, AFTER: 1 });
    expect(res.body.fitment.technicianForm).toMatchObject({ deviceId: 'MINE', deviceReplacement: 'DEVICE', checks: { canVoltage: 'OK' } });
  });
});

describe('GET /mobile/fitments/:fid (F10B additions)', () => {
  it('includes the form, photos, isVehicle and the times', async () => {
    const w = await setup();
    await w.start();
    await w.complete();
    const body = (await w.get(w.tech)).body as MyFitmentDto;
    expect(body.isVehicle).toBe(true);
    expect(body.form).toMatchObject({ deviceId: 'DEV-1', checks: CHECKS, clusterReadingKm: 5 });
    expect(body.photos.map((p) => p.kind)).toEqual(['BEFORE', 'ASSET', 'CLUSTER', 'AFTER']);
    expect(body.photos[0]!.url).toContain('expires=600');
    expect(body.startedAt).not.toBeNull();
    expect(body.submittedAt).toBeNull();
  });
});
