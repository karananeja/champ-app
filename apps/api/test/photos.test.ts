import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FitmentAction, FitmentPhotoDto, FitmentPhotosResponse, TaskDto } from '@champ/shared';
import { MemoryStorage } from '../src/lib/storage';
import { prisma, type User } from '../src/lib/prisma';
import { bearer, createTaskWorld, createUser, fakeGoogle, testApi } from './helpers';

const storage = new MemoryStorage();
const api = () => testApi(fakeGoogle(null), { storage, devSimulator: true });
const SAMPLES = path.resolve(import.meta.dirname, '../src/modules/dev/sample-photos');
const JPEG = fs.readFileSync(path.join(SAMPLES, 'sample-before.jpg'));
/** A 1×1 PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

/** A task (OE = world OE) with one fitment assigned to technician A, submitted through the simulator (5 sample photos). */
async function setup() {
  const w = await createTaskWorld();
  const created = await api()
    .post('/api/tasks')
    .set(bearer(w.om))
    .send(w.taskBody({ technicianId: w.techA.id, vehicles: { entry: 'COUNT', count: 1 } }));
  const task = created.body as TaskDto;
  const fid = task.fitments[0]!.id;
  const simulate = (action: 'START' | 'SUBMIT') => api().post(`/api/dev/fitments/${fid}/simulate`).set(bearer(w.oe)).send({ action });
  expect((await simulate('START')).status).toBe(200);
  const submitted = await simulate('SUBMIT');
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
  const step = async (actor: User, action: FitmentAction, payload?: unknown) => {
    const r = await api().post(`/api/fitments/${fid}/transitions`).set(bearer(actor)).send({ action, payload });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
  };
  const list = (actor: User, history = false) =>
    api().get(`/api/fitments/${fid}/photos`).query(history ? { history: 'true' } : {}).set(bearer(actor));
  const upload = (actor: User, file: Buffer, name: string, fields: Record<string, string> = {}) => {
    let req = api().post(`/api/fitments/${fid}/photos`).set(bearer(actor));
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return req.attach('file', file, name);
  };
  const replace = (actor: User, pid: string, file: Buffer, reason: string) =>
    api().post(`/api/fitments/${fid}/photos/${pid}/replace`).set(bearer(actor)).field('reason', reason).attach('file', file, 'fixed.jpg');
  const remove = (actor: User, pid: string, reason: unknown) =>
    api().post(`/api/fitments/${fid}/photos/${pid}/remove`).set(bearer(actor)).send({ reason });
  return { ...w, task, fid, submitted: submitted.body, step, list, upload, replace, remove };
}

const items = (res: { body: unknown }) => (res.body as FitmentPhotosResponse).items;

describe('simulator submit (spec §5)', () => {
  it('attaches the 5 sample photos and OT remarks, as the technician, with the site location', async () => {
    const w = await setup();
    expect(w.submitted.fitment).toMatchObject({
      status: 'SUBMITTED',
      photoCounts: { active: 5, byKind: { BEFORE: 1, AFTER: 1, ASSET: 1, CLUSTER: 1, PLACEMENT: 1 } },
      verification: { otRemarks: expect.stringContaining('Sample remarks') },
    });
    const photos = await prisma.fitmentPhoto.findMany({ where: { fitmentId: w.fid } });
    expect(photos).toHaveLength(5);
    for (const p of photos) {
      expect(p).toMatchObject({ source: 'SIMULATOR', uploadedById: w.techA.id, status: 'ACTIVE', lat: 12.97, lng: 77.59, contentType: 'image/jpeg', width: 800, height: 600 });
      expect(p.takenAt).toBeInstanceOf(Date);
      expect(p.objectKey).toBe(`fitments/${w.fid}/${p.id}.jpg`);
      expect(await storage.exists(p.objectKey)).toBe(true);
    }
    const event = await prisma.taskEvent.findFirstOrThrow({ where: { fitmentId: w.fid, type: 'PHOTO_ADDED' } });
    expect(event).toMatchObject({ actorId: w.techA.id, data: { tkId: 'TK-00001', simulated: true, kinds: ['BEFORE', 'AFTER', 'ASSET', 'CLUSTER', 'PLACEMENT'] } });
  });
});

describe('photos (spec §4)', () => {
  it('lists active photos for every task viewer, ordered by kind, with presigned URLs and uploader names; OT gets 403', async () => {
    const w = await setup();
    for (const actor of [w.sa, w.om, w.oe, w.ro]) {
      const res = await w.list(actor);
      expect(res.status, actor.role).toBe(200);
      expect(items(res).map((p) => p.kind)).toEqual(['BEFORE', 'ASSET', 'CLUSTER', 'PLACEMENT', 'AFTER']);
    }
    const first = items(await w.list(w.ro))[0]!;
    expect(first).toMatchObject({ uploadedBy: { id: w.techA.id, name: 'Arjun Tech' }, source: 'SIMULATOR', status: 'ACTIVE', changedBy: null });
    expect(first.url).toBe(`http://storage.test/fitments/${w.fid}/${first.id}.jpg?expires=600`);
    expect((await w.list(w.techA)).status).toBe(403);
    expect((await api().get('/api/fitments/missing/photos').set(bearer(w.om))).status).toBe(404);
    expect((await w.list(w.ro)).body).toMatchObject({ canViewHistory: false, canManage: false });
    expect((await w.list(w.oe)).body).toMatchObject({ canViewHistory: true, canManage: true });
  });

  it('debug upload (JPEG, PNG) by the OE; technician kinds, oversize and fake images are refused', async () => {
    const w = await setup();
    let res = await w.upload(w.oe, JPEG, 'debug.jpg', { kind: 'DEBUG' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const photo = res.body.photo as FitmentPhotoDto;
    expect(photo).toMatchObject({ kind: 'DEBUG', source: 'OE', contentType: 'image/jpeg', width: 800, height: 600, originalName: 'debug.jpg', uploadedBy: { id: w.oe.id } });
    expect(await storage.exists(`fitments/${w.fid}/${photo.id}.jpg`)).toBe(true);
    // A PNG named .jpg is stored as what it really is.
    res = await w.upload(w.om, PNG, 'screenshot.jpg');
    expect(res.status).toBe(201);
    expect(res.body.photo).toMatchObject({ contentType: 'image/png', width: 1, height: 1, source: 'OM' });
    expect(items(await w.list(w.oe)).map((p) => p.kind).slice(-2)).toEqual(['DEBUG', 'DEBUG']);

    res = await w.upload(w.oe, JPEG, 'before.jpg', { kind: 'BEFORE' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.fieldErrors.kind[0]).toMatch(/only debug images can be uploaded here/);

    const big = Buffer.concat([JPEG, Buffer.alloc(10 * 1024 * 1024)]);
    res = await w.upload(w.oe, big, 'huge.jpg');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'FILE_TOO_LARGE', message: 'The image must be 10 MB or smaller' });

    res = await w.upload(w.oe, Buffer.from('this is not really a jpeg\n'), 'fake.jpg');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({ code: 'UNSUPPORTED_FILE', message: 'Only JPEG, PNG or WebP images can be uploaded' });

    res = await api().post(`/api/fitments/${w.fid}/photos`).set(bearer(w.oe)).field('kind', 'DEBUG');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('Choose an image to upload');

    for (const actor of [w.sa, w.ro]) expect((await w.upload(actor, JPEG, 'x.jpg')).status, actor.role).toBe(403);
    expect(await prisma.fitmentPhoto.count({ where: { fitmentId: w.fid } })).toBe(7);
    const added = await prisma.taskEvent.findMany({ where: { fitmentId: w.fid, type: 'PHOTO_ADDED', actorId: w.oe.id } });
    expect(added.map((e) => e.data)).toEqual([{ tkId: 'TK-00001', photoId: photo.id, kind: 'DEBUG' }]);
  });

  it('replace keeps the original as REPLACED and links it; remove needs a reason; history per role', async () => {
    const w = await setup();
    const [before, asset] = items(await w.list(w.oe));
    const otherOe = await createUser({ role: 'OE', managerId: w.om.id });

    expect((await w.replace(w.oe, before!.id, JPEG, 'ab')).status).toBe(400); // reason too short
    const res = await w.replace(w.oe, before!.id, JPEG, 'Blurry, retaken from the depot camera');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const fresh = res.body.photo as FitmentPhotoDto;
    expect(fresh).toMatchObject({ kind: 'BEFORE', status: 'ACTIVE', source: 'OE' });
    const old = await prisma.fitmentPhoto.findUniqueOrThrow({ where: { id: before!.id } });
    expect(old).toMatchObject({ status: 'REPLACED', replacedById: fresh.id, changeReason: 'Blurry, retaken from the depot camera', changedById: w.oe.id });
    expect(await storage.exists(old.objectKey)).toBe(true); // never deleted (D-100)
    expect((await w.replace(w.oe, before!.id, JPEG, 'again please')).status).toBe(409);

    expect((await w.remove(w.oe, asset!.id, '')).status).toBe(400);
    expect((await w.remove(w.ro, asset!.id, 'Wrong vehicle')).status).toBe(403);
    expect((await w.remove(w.oe, asset!.id, 'Wrong vehicle')).status).toBe(204);
    expect(await prisma.fitmentPhoto.findUniqueOrThrow({ where: { id: asset!.id } })).toMatchObject({ status: 'REMOVED', changeReason: 'Wrong vehicle', changedById: w.oe.id });

    // Active list: the new BEFORE replaces the old one; the removed asset is gone.
    expect(items(await w.list(w.ro)).map((p) => p.id)).toEqual(expect.not.arrayContaining([before!.id, asset!.id]));
    expect(items(await w.list(w.ro))).toHaveLength(4);
    // History: SA, OM and the task's OE; RO and other OEs get 403.
    for (const actor of [w.sa, w.om, w.oe]) {
      const history = items(await w.list(actor, true));
      expect(history, actor.role).toHaveLength(6);
      expect(history.find((p) => p.id === before!.id)).toMatchObject({ status: 'REPLACED', replacedById: fresh.id, changedBy: { id: w.oe.id }, changeReason: 'Blurry, retaken from the depot camera' });
    }
    expect((await w.list(w.ro, true)).status).toBe(403);
    expect((await w.list(otherOe, true)).status).toBe(403);

    const events = await prisma.taskEvent.findMany({ where: { fitmentId: w.fid, type: { in: ['PHOTO_REPLACED', 'PHOTO_REMOVED'] } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    expect(events.map((e) => [e.type, e.data])).toEqual([
      ['PHOTO_REPLACED', { tkId: 'TK-00001', photoId: before!.id, replacementId: fresh.id, kind: 'BEFORE', reason: 'Blurry, retaken from the depot camera' }],
      ['PHOTO_REMOVED', { tkId: 'TK-00001', photoId: asset!.id, kind: 'ASSET', reason: 'Wrong vehicle' }],
    ]);
  });

  it('after OM approval the OE can no longer change photos (409); the OM can, flagged post-approval', async () => {
    const w = await setup();
    await w.step(w.oe, 'VERIFY', w.verification);
    const [first, second] = items(await w.list(w.oe));
    expect((await w.replace(w.oe, first!.id, JPEG, 'Retaken after verify')).status).toBe(201); // still OE verified
    await w.step(w.om, 'APPROVE');

    let res = await w.replace(w.oe, second!.id, JPEG, 'Too late');
    expect(res.status).toBe(409);
    expect(res.body.error).toEqual({ code: 'FITMENT_LOCKED', message: 'TK-00001 is OM approved, so you can no longer change its photos.' });
    expect((await w.upload(w.oe, JPEG, 'late.jpg')).status).toBe(409);
    expect((await w.remove(w.oe, second!.id, 'Too late')).status).toBe(409);
    expect((await w.list(w.oe)).body).toMatchObject({ canManage: false, canViewHistory: true });

    res = await w.remove(w.om, second!.id, 'Duplicate photo');
    expect(res.status).toBe(204);
    const event = await prisma.taskEvent.findFirstOrThrow({ where: { fitmentId: w.fid, type: 'PHOTO_REMOVED' } });
    expect(event.data).toMatchObject({ postApproval: true, reason: 'Duplicate photo' });
    expect(event.actorId).toBe(w.om.id);
  });

  it('cleans up the stored object when the database write fails', async () => {
    const w = await setup();
    const before = new Set(storage.objects.keys());
    // A photo id that doesn't belong to the fitment makes the transaction fail after the upload.
    const other = await prisma.fitmentPhoto.findFirstOrThrow({ where: { fitmentId: w.fid } });
    await prisma.fitmentPhoto.update({ where: { id: other.id }, data: { status: 'REMOVED' } });
    const res = await w.replace(w.oe, other.id, JPEG, 'Should fail');
    expect(res.status).toBe(409);
    expect(new Set(storage.objects.keys())).toEqual(before);
  });
});
