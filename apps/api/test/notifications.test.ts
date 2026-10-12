import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { describe, expect, it } from 'vitest';
import {
  NOTIFICATION_EVENT,
  NOTIFICATION_SOCKET_PATH,
  istTodayDay,
  type FitmentAction,
  type NotificationDto,
  type NotificationListResponse,
  type TaskDto,
  type TravelTaskDto,
} from '@champ/shared';
import { createApp } from '../src/app';
import { signAccessToken } from '../src/lib/jwt';
import { prisma, type User } from '../src/lib/prisma';
import { startNotificationHub } from '../src/modules/notifications/hub';
import { deleteExpiredNotifications } from '../src/modules/notifications/service';
import { writeEvent } from '../src/modules/tasks/events';
import { bearer, createTaskWorld, createUser, fillSubmitReady, testApi } from './helpers';

// F13: in-app notifications (spec §8).
const api = () => testApi();
const GPS = { lat: 12.97, lng: 77.59 };

async function setup(count = 3, technicianId?: string | null) {
  const w = await createTaskWorld();
  const createTask = async (n = count, tech: string | null = technicianId === undefined ? w.techA.id : technicianId) => {
    const res = await api()
      .post('/api/tasks')
      .set(bearer(w.om))
      .send(w.taskBody({ technicianId: tech, vehicles: { entry: 'COUNT', count: n } }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const task = res.body as TaskDto;
    return { task, fids: task.fitments.map((f) => f.id) };
  };
  const { task, fids } = await createTask();
  return { ...w, task, fids, createTask };
}

const transition = async (actor: User, fid: string, action: FitmentAction, payload?: unknown) => {
  if (action === 'SUBMIT') await fillSubmitReady(fid);
  return api().post(`/api/fitments/${fid}/transitions`).set(bearer(actor)).send(payload === undefined ? { action } : { action, payload });
};
async function run(...steps: [User, string, FitmentAction, unknown?][]) {
  for (const [actor, fid, action, payload] of steps) {
    const res = await transition(actor, fid, action, payload);
    expect(res.status, `${action}: ${JSON.stringify(res.body)}`).toBe(200);
  }
}

const inbox = (user: User) => prisma.notification.findMany({ where: { userId: user.id }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }] });
const typesOf = async (user: User) => (await inbox(user)).map((n) => n.type);
const clear = () => prisma.notification.deleteMany();

describe('notifications — recipients (D-228)', () => {
  it('assignment notifies the technician (grouped per task), reassignment the previous one; never the actor', async () => {
    const w = await setup(2);
    let [n] = await inbox(w.techA);
    expect(n).toMatchObject({ type: 'FITMENT_ASSIGNED', title: '2 fitments of OM-00001 assigned to you', count: 2, actorId: w.om.id });
    expect(n!.body).toBe('Zoomcar · Bengaluru depot · 21 Oct, 10:30 am');
    expect(await inbox(w.om)).toHaveLength(0);

    await clear();
    const res = await api().post(`/api/tasks/${w.task.id}/assign`).set(bearer(w.om)).send({ fitmentIds: [w.fids[0]], technicianId: w.techB.id });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    [n] = await inbox(w.techB);
    expect(n).toMatchObject({ type: 'FITMENT_ASSIGNED', title: 'TK-00001 assigned to you', count: 1, fitmentIds: [w.fids[0]] });
    [n] = await inbox(w.techA);
    expect(n).toMatchObject({ type: 'FITMENT_UNASSIGNED', title: 'TK-00001 was reassigned' });

    // Unassigning notifies the previous technician only.
    await clear();
    await api().post(`/api/tasks/${w.task.id}/assign`).set(bearer(w.om)).send({ fitmentIds: [w.fids[0]], technicianId: null });
    expect(await typesOf(w.techB)).toEqual(['FITMENT_UNASSIGNED']);
    expect(await prisma.notification.count()).toBe(1);
  });

  it('submit → the OE; verify → the OE’s OM; approve → technician and OE; nobody gets their own action', async () => {
    const w = await setup(1);
    const [f] = w.fids as [string];
    await clear();
    await run([w.techA, f, 'START', GPS]);
    expect(await prisma.notification.count()).toBe(0);
    await run([w.techA, f, 'SUBMIT']);
    expect(await inbox(w.oe)).toMatchObject([{ type: 'FITMENT_SUBMITTED', title: 'TK-00001 submitted by Arjun Tech · ready to verify', body: 'Zoomcar · Bengaluru depot' }]);
    const otherOm = await createUser({ role: 'OM' });
    await run([w.oe, f, 'VERIFY', w.verification]);
    expect(await inbox(w.om)).toMatchObject([{ type: 'FITMENT_VERIFIED', title: `TK-00001 verified by ${w.oe.name} · ready for final approval` }]);
    expect(await inbox(otherOm)).toHaveLength(0);
    await run([w.om, f, 'APPROVE']);
    expect(await typesOf(w.techA)).toEqual(['FITMENT_APPROVED']);
    expect((await typesOf(w.oe))[0]).toBe('FITMENT_APPROVED');
    expect(await typesOf(w.om)).toEqual(['FITMENT_VERIFIED']);
    expect((await inbox(w.techA))[0]!.title).toBe('TK-00001 approved');
    // The same approval tells the app who is reading: the technician opens the fitment, the OE Approve visit.
    const forTech = async (user: User) =>
      ((await api().get('/api/notifications').set(bearer(user))).body as { items: { type: string; forTechnician: boolean }[] }).items.find(
        (n) => n.type === 'FITMENT_APPROVED',
      )!.forTechnician;
    expect(await forTech(w.techA)).toBe(true);
    expect(await forTech(w.oe)).toBe(false);
  });

  it('verify by an OE without an active OM manager → every active OM (inactive skipped)', async () => {
    const w = await setup(1);
    const [f] = w.fids as [string];
    const om2 = await createUser({ role: 'OM' });
    const inactiveOm = await createUser({ role: 'OM', status: 'INACTIVE' });
    await prisma.user.update({ where: { id: w.om.id }, data: { status: 'INACTIVE' } });
    await run([w.techA, f, 'START', GPS], [w.techA, f, 'SUBMIT']);
    await clear();
    await run([w.oe, f, 'VERIFY', w.verification]);
    expect(await typesOf(om2)).toEqual(['FITMENT_VERIFIED']);
    expect(await inbox(inactiveOm)).toHaveLength(0);
    expect(await inbox(w.om)).toHaveLength(0);
  });

  it('reopen → the technician; an OM reopen also the OE, with the reason as the body', async () => {
    const w = await setup(2);
    const [f1, f2] = w.fids as [string, string];
    await run([w.techA, f1, 'START', GPS], [w.techA, f1, 'SUBMIT'], [w.techA, f2, 'START', GPS], [w.techA, f2, 'SUBMIT']);
    await clear();
    await run([w.oe, f1, 'REOPEN', { reason: 'Photos are blurred' }]);
    expect(await inbox(w.techA)).toMatchObject([{ type: 'FITMENT_REOPENED', title: `TK-00001 reopened by ${w.oe.name}`, body: 'Photos are blurred' }]);
    expect(await prisma.notification.count()).toBe(1);

    await clear();
    await run([w.om, f2, 'REOPEN', { reason: 'Wrong device id' }]);
    expect(await typesOf(w.techA)).toEqual(['FITMENT_REOPENED']);
    expect(await inbox(w.oe)).toMatchObject([{ type: 'FITMENT_REOPENED', body: 'Wrong device id' }]);
  });

  it('moved to FT → the OE, with the replacement TK id; inactive recipients are skipped', async () => {
    const w = await setup(2);
    const [f1, f2] = w.fids as [string, string];
    await clear();
    await run([w.techA, f1, 'MARK_FAULTY', { reason: 'Battery dead' }]);
    expect(await inbox(w.oe)).toMatchObject([
      { type: 'FITMENT_MOVED_TO_FT', title: 'TK-00001 moved to FT by Arjun Tech', body: 'Replacement TK-00003 created' },
    ]);
    await prisma.user.update({ where: { id: w.oe.id }, data: { status: 'INACTIVE' } });
    await clear();
    await run([w.techA, f2, 'MARK_FAULTY', { reason: 'Battery dead' }]);
    expect(await prisma.notification.count()).toBe(0);
  });

  it('undo faulty: the fitment\'s technician, with the reason; never the actor (CR-11)', async () => {
    const w = await setup(2);
    const [f1] = w.fids as [string, string];
    await run([w.techA, f1, 'MARK_FAULTY', { reason: 'Battery dead' }]);
    await clear();
    await run([w.oe, f1, 'UNDO_FAULTY', { reason: 'Tapped by mistake' }]);
    expect(await inbox(w.techA)).toMatchObject([
      { type: 'FITMENT_FAULT_UNDONE', title: `TK-00001 is back with you · fault marking undone by ${w.oe.name}`, body: 'Tapped by mistake', fitmentIds: [f1] },
    ]);
    expect(await prisma.notification.count()).toBe(1);
    const res = await api().get('/api/notifications').set(bearer(w.techA));
    expect(res.body.items[0]).toMatchObject({ type: 'FITMENT_FAULT_UNDONE', forTechnician: true, target: { kind: 'FITMENT', fitmentId: f1 } });
  });

  it('other events notify nobody', async () => {
    const w = await setup(1);
    await clear();
    await run([w.techA, w.fids[0]!, 'START', GPS]);
    await api().patch(`/api/tasks/${w.task.id}`).set(bearer(w.om)).send({ comments: 'Changed' });
    expect(await prisma.notification.count()).toBe(0);
  });
});

describe('notifications — grouping (D-229) and transactions', () => {
  it('3 submits on one task within the window → one notification with count 3', async () => {
    const w = await setup(4);
    const [f1, f2, f3, f4] = w.fids as [string, string, string, string];
    for (const f of [f1, f2, f3, f4]) await run([w.techA, f, 'START', GPS]);
    await clear();
    for (const f of [f1, f2, f3]) await run([w.techA, f, 'SUBMIT']);
    let rows = await inbox(w.oe);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ count: 3, title: '3 fitments of OM-00001 submitted by Arjun Tech' });
    expect(rows[0]!.fitmentIds.sort()).toEqual([f1, f2, f3].sort());

    // Read → the next one is new.
    await prisma.notification.updateMany({ data: { readAt: new Date() } });
    await run([w.techA, f4, 'SUBMIT']);
    rows = await inbox(w.oe);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ count: 1, title: 'TK-00004 submitted by Arjun Tech · ready to verify', readAt: null });
  });

  it('a different task, or after the window, starts a new notification', async () => {
    const w = await setup(2);
    const other = await w.createTask(1);
    const [f1, f2] = w.fids as [string, string];
    const g = other.fids[0]!;
    for (const f of [f1, f2, g]) await run([w.techA, f, 'START', GPS]);
    await clear();
    await run([w.techA, f1, 'SUBMIT'], [w.techA, g, 'SUBMIT']);
    expect(await inbox(w.oe)).toHaveLength(2);
    await prisma.$executeRaw`UPDATE "Notification" SET "updatedAt" = now() - interval '3 minutes'`;
    await run([w.techA, f2, 'SUBMIT']);
    const rows = await inbox(w.oe);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.count === 1)).toBe(true);
  });

  it('a refused transition, or a rolled-back transaction, notifies nobody', async () => {
    const w = await setup(1);
    const [f] = w.fids as [string];
    await clear();
    expect((await transition(w.oe, f, 'VERIFY', w.verification)).status).toBe(409);
    await expect(
      prisma.$transaction(async (tx) => {
        await writeEvent(tx, w.techA, { taskId: w.task.id, fitmentId: f, type: 'FITMENT_SUBMITTED' });
        expect(await tx.notification.count()).toBe(1);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await prisma.notification.count()).toBe(0);
  });
});

describe('notifications — travel', () => {
  it('raised → the technician’s OE (else the OMs); verified → the raiser', async () => {
    const w = await setup(1);
    const body = { technicianId: w.techA.id, locationId: w.location.id, purpose: 'Pick up a device', travelDate: istTodayDay(), distanceKm: 10 };
    let res = await api().post('/api/travel-tasks').set(bearer(w.techA)).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const tt = res.body as TravelTaskDto;
    expect(await inbox(w.oe)).toMatchObject([{ type: 'TRAVEL_RAISED', title: 'Travel task TT-00001 raised by Arjun Tech', travelTaskId: tt.id }]);

    res = await api().post(`/api/travel-tasks/${tt.id}/transitions`).set(bearer(w.oe)).send({ action: 'VERIFY' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await inbox(w.techA)).map((n) => [n.type, n.title])).toContainEqual(['TRAVEL_VERIFIED', `Travel task TT-00001 verified by ${w.oe.name}`]);

    // A technician without an OE → the OMs.
    const loner = await createUser({ role: 'OT', managerId: null, technicianType: 'PAYROLL', baseLocationId: w.location.id, name: 'Lone Tech' });
    res = await api().post('/api/travel-tasks').set(bearer(loner)).send({ ...body, technicianId: loner.id });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await typesOf(w.om)).toContain('TRAVEL_RAISED');
  });
});

describe('notifications — API', () => {
  it('lists own notifications newest first with cursor pages, counts, reads and reads all', async () => {
    const w = await setup(1);
    await clear();
    const base = Date.now();
    for (let i = 0; i < 5; i += 1) {
      await prisma.notification.create({
        data: { userId: w.oe.id, type: 'FITMENT_SUBMITTED', taskId: w.task.id, fitmentIds: [w.fids[0]!], actorId: w.techA.id, title: `N${i}`, updatedAt: new Date(base + i * 1000) },
      });
    }
    const theirs = await prisma.notification.create({ data: { userId: w.techA.id, type: 'FITMENT_APPROVED', taskId: w.task.id, title: 'Theirs' } });

    let res = await api().get('/api/notifications?limit=3').set(bearer(w.oe));
    expect(res.status).toBe(200);
    let page = res.body as NotificationListResponse;
    expect(page.items.map((n) => n.title)).toEqual(['N4', 'N3', 'N2']);
    expect(page.unreadCount).toBe(5);
    expect(page.items[0]).toMatchObject({
      type: 'FITMENT_SUBMITTED',
      target: { kind: 'FITMENT', taskId: w.task.id, fitmentId: w.fids[0]! },
      count: 1,
      actor: { id: w.techA.id, name: 'Arjun Tech' },
      read: false,
    } satisfies Partial<NotificationDto>);
    res = await api().get(`/api/notifications?limit=3&cursor=${page.nextCursor}`).set(bearer(w.oe));
    page = res.body as NotificationListResponse;
    expect(page.items.map((n) => n.title)).toEqual(['N1', 'N0']);
    expect(page.nextCursor).toBeNull();

    const n3 = (await prisma.notification.findFirstOrThrow({ where: { title: 'N3' } })).id;
    expect((await api().post(`/api/notifications/${n3}/read`).set(bearer(w.oe))).status).toBe(204);
    expect((await api().get('/api/notifications/unread-count').set(bearer(w.oe))).body).toEqual({ unreadCount: 4 });
    // Reading doesn't reorder.
    page = (await api().get('/api/notifications').set(bearer(w.oe))).body as NotificationListResponse;
    expect(page.items.map((n) => [n.title, n.read])).toEqual([['N4', false], ['N3', true], ['N2', false], ['N1', false], ['N0', false]]);

    expect((await api().post(`/api/notifications/${theirs.id}/read`).set(bearer(w.oe))).status).toBe(404);
    expect((await api().post('/api/notifications/nope/read').set(bearer(w.oe))).status).toBe(404);
    expect((await api().post('/api/notifications/read-all').set(bearer(w.oe))).status).toBe(204);
    expect((await api().get('/api/notifications/unread-count').set(bearer(w.oe))).body).toEqual({ unreadCount: 0 });
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: theirs.id } })).readAt).toBeNull();
    expect((await api().get('/api/notifications')).status).toBe(401);
    expect((await api().get('/api/notifications?cursor=bad').set(bearer(w.oe))).status).toBe(400);
  });

  it('retention deletes notifications older than 30 days', async () => {
    const user = await createUser({ role: 'OE' });
    const old = await prisma.notification.create({ data: { userId: user.id, type: 'FITMENT_SUBMITTED', title: 'Old', updatedAt: new Date(Date.now() - 31 * 86_400_000) } });
    const recent = await prisma.notification.create({ data: { userId: user.id, type: 'FITMENT_SUBMITTED', title: 'Recent', updatedAt: new Date(Date.now() - 29 * 86_400_000) } });
    expect(await deleteExpiredNotifications()).toBe(1);
    expect(await prisma.notification.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await prisma.notification.findUnique({ where: { id: recent.id } })).not.toBeNull();
  });
});

describe('notifications — Socket.IO hub', () => {
  it('a client with a valid token receives the event after a committed transition; a bad token is refused', async () => {
    const w = await setup(1);
    const [f] = w.fids as [string];
    await run([w.techA, f, 'START', GPS]);
    // Wait until it listens: under a loaded full run a client could otherwise connect too early ("websocket error").
    const server = createApp().listen(0, '127.0.0.1');
    await once(server, 'listening');
    const hub = await startNotificationHub(server);
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const sockets: Socket[] = [];
    const open = (token: string) => {
      const s = connect(url, { path: NOTIFICATION_SOCKET_PATH, auth: { token }, transports: ['websocket'], reconnection: false, timeout: 15_000 });
      sockets.push(s);
      return s;
    };
    try {
      const bad = open('not-a-token');
      await expect(new Promise((_, reject) => bad.on('connect_error', reject))).rejects.toThrow('UNAUTHORIZED');

      const s = open(signAccessToken({ sub: w.oe.id, role: w.oe.role }));
      await new Promise<void>((resolve, reject) => {
        s.on('connect', resolve);
        s.on('connect_error', reject);
      });
      const received = new Promise<{ notification: NotificationDto; unreadCount: number }>((resolve) => s.on(NOTIFICATION_EVENT, resolve));
      await run([w.techA, f, 'SUBMIT']);
      const payload = await received;
      expect(payload.unreadCount).toBe(1);
      expect(payload.notification).toMatchObject({ type: 'FITMENT_SUBMITTED', title: 'TK-00001 submitted by Arjun Tech · ready to verify', read: false });
    } finally {
      sockets.forEach((s) => s.close());
      await hub.stop();
    }
  });
});
