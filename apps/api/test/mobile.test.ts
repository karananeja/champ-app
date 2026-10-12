import { describe, expect, it, vi } from 'vitest';
import {
  istDayStart,
  mobileDateOptions,
  type FitmentStatus,
  type MobileAuthResponse,
  type MobileHomeResponse,
  type MyFitmentsResponse,
  type Paginated,
  type TaskDto,
  type TechnicianDto,
  type UserDto,
} from '@champ/shared';
import type { Geocoder } from '../src/lib/geocoder';
import { prisma, type User } from '../src/lib/prisma';
import { PASSWORD, bearer, createOrg, createTaskWorld, createUser, fakeGoogle, refreshCookie, testApi } from './helpers';

// F09: field-app sign-in, home location, home counts and my fitments (spec §7).
const api = () => testApi(fakeGoogle(null));
const DAY_MS = 86_400_000;
const [TODAY, YESTERDAY] = mobileDateOptions(new Date()) as [string, string];
const OLDEST = mobileDateOptions(new Date()).at(-1)!;
const dayBefore = (day: string) => new Date(istDayStart(day)!.getTime() - DAY_MS).toISOString().slice(0, 10);

const mobileLogin = (agent: ReturnType<typeof api>, email: string, password = PASSWORD) =>
  agent.post('/api/mobile/auth/login').send({ email, password });

describe('POST /api/mobile/auth/login', () => {
  it('OT and OE get a session with the refresh token in the body and no cookie', async () => {
    const { ot, oe } = await createOrg();
    for (const user of [ot, oe]) {
      const res = await mobileLogin(api(), user.email);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const body = res.body as MobileAuthResponse;
      expect(body.accessToken).toBeTruthy();
      expect(body.refreshToken).toBeTruthy();
      expect(body.user).toMatchObject({ id: user.id, role: user.role, homeLocation: null });
      expect(refreshCookie(res)).toBeUndefined();
      expect(res.headers['set-cookie']).toBeUndefined();
    }
    expect(await prisma.refreshToken.count()).toBe(2);
  });

  it('SA, OM and RO are refused with MOBILE_ROLE_NOT_ALLOWED and no token is created', async () => {
    const { sa, om, ro } = await createOrg();
    for (const user of [sa, om, ro]) {
      const res = await mobileLogin(api(), user.email);
      expect(res.status).toBe(403);
      expect(res.body.error).toEqual({ code: 'MOBILE_ROLE_NOT_ALLOWED', message: 'Use the Champ web console' });
    }
    expect(await prisma.refreshToken.count()).toBe(0);
  });

  it('a wrong password and an inactive user behave as on web', async () => {
    const { oe } = await createOrg();
    const wrong = await mobileLogin(api(), oe.email, 'wrong-pass1');
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    // An inactive OT is told about the account, not the role (same order as web).
    const inactive = await createUser({ role: 'OT', status: 'INACTIVE', managerId: oe.id });
    const res = await mobileLogin(api(), inactive.email);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_INACTIVE');
    expect(await prisma.refreshToken.count()).toBe(0);
  });

  it('validates the body', async () => {
    const res = await api().post('/api/mobile/auth/login').send({ email: 'nope' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('shares the login rate limit with the web login', async () => {
    const agent = testApi();
    for (let i = 0; i < 5; i++) {
      expect((await agent.post('/api/auth/login').send({ email: 'victim@intellicar.in', password: 'bad-pass1' })).status).toBe(401);
      expect((await mobileLogin(agent, 'victim@intellicar.in', 'bad-pass1')).status).toBe(401);
    }
    const blocked = await mobileLogin(agent, 'victim@intellicar.in', 'bad-pass1');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect((await agent.post('/api/auth/login').send({ email: 'victim@intellicar.in', password: 'bad-pass1' })).status).toBe(429);
  });
});

describe('POST /api/mobile/auth/refresh and logout', () => {
  it('rotates the token; reusing the old one fails', async () => {
    const { ot } = await createOrg();
    const login = (await mobileLogin(api(), ot.email)).body as MobileAuthResponse;
    const res = await api().post('/api/mobile/auth/refresh').send({ refreshToken: login.refreshToken });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rotated = res.body as MobileAuthResponse;
    expect(rotated.refreshToken).not.toBe(login.refreshToken);
    expect(rotated.user.id).toBe(ot.id);
    expect(res.headers['set-cookie']).toBeUndefined();

    const reused = await api().post('/api/mobile/auth/refresh').send({ refreshToken: login.refreshToken });
    expect(reused.status).toBe(401);
    expect(reused.body.error.code).toBe('REFRESH_REUSED');
    // Theft protection revoked the rotated token too.
    expect((await api().post('/api/mobile/auth/refresh').send({ refreshToken: rotated.refreshToken })).status).toBe(401);
  });

  it('a user whose role changed to OM gets 403 and no new token', async () => {
    const { oe } = await createOrg();
    const login = (await mobileLogin(api(), oe.email)).body as MobileAuthResponse;
    await prisma.user.update({ where: { id: oe.id }, data: { role: 'OM', managerId: null } });
    const res = await api().post('/api/mobile/auth/refresh').send({ refreshToken: login.refreshToken });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('MOBILE_ROLE_NOT_ALLOWED');
    expect(await prisma.refreshToken.count()).toBe(1);
    expect(await prisma.refreshToken.count({ where: { revokedAt: null } })).toBe(0);
  });

  it('requires a refresh token in the body', async () => {
    const res = await api().post('/api/mobile/auth/refresh').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('logout revokes the token; an unknown token still gets 204', async () => {
    const { ot } = await createOrg();
    const login = (await mobileLogin(api(), ot.email)).body as MobileAuthResponse;
    expect((await api().post('/api/mobile/auth/logout').send({ refreshToken: login.refreshToken })).status).toBe(204);
    expect((await api().post('/api/mobile/auth/refresh').send({ refreshToken: login.refreshToken })).status).toBe(401);
    expect((await api().post('/api/mobile/auth/logout').send({ refreshToken: 'unknown-token' })).status).toBe(204);
  });
});

describe('PUT /api/me/home-location', () => {
  const body = { lat: 12.9716, lng: 77.5946, address: '  12 MG Road, Bengaluru  ' };

  it('OT and OE set their own; /me and the technician DTOs show it', async () => {
    const { ot, oe, om } = await createOrg();
    for (const user of [ot, oe]) {
      const res = await api().put('/api/me/home-location').set(bearer(user)).send(body);
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const dto = res.body as UserDto;
      expect(dto.id).toBe(user.id);
      expect(dto.homeLocation).toMatchObject({ lat: 12.9716, lng: 77.5946, address: '12 MG Road, Bengaluru' });
      expect(Date.parse(dto.homeLocation!.updatedAt)).not.toBeNaN();
      const me = await api().get('/api/me').set(bearer(user));
      expect((me.body as UserDto).homeLocation).toEqual(dto.homeLocation);
    }
    const techs = await api().get('/api/technicians').set(bearer(om));
    expect(techs.status, JSON.stringify(techs.body)).toBe(200);
    const tech = (techs.body as Paginated<TechnicianDto>).items.find((t) => t.id === ot.id);
    expect(tech?.homeLocation?.address).toBe('12 MG Road, Bengaluru');
    const user = await api().get(`/api/users/${oe.id}`).set(bearer(om));
    expect((user.body as UserDto).homeLocation?.address).toBe('12 MG Road, Bengaluru');
  });

  it('SA, OM and RO are refused', async () => {
    const { sa, om, ro } = await createOrg();
    for (const user of [sa, om, ro]) {
      expect((await api().put('/api/me/home-location').set(bearer(user)).send(body)).status).toBe(403);
    }
    expect(await prisma.user.count({ where: { homeAddress: { not: null } } })).toBe(0);
  });

  it('validates the bounds and the address', async () => {
    const { ot } = await createOrg();
    for (const bad of [
      { ...body, lat: 90.1 },
      { ...body, lat: -91 },
      { ...body, lng: 180.5 },
      { ...body, lng: -181 },
      { ...body, address: ' ab ' },
      { ...body, address: 'x'.repeat(301) },
      { lat: 1, lng: 2 },
    ]) {
      const res = await api().put('/api/me/home-location').set(bearer(ot)).send(bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    const edge = await api().put('/api/me/home-location').set(bearer(ot)).send({ lat: -90, lng: 180, address: 'abc' });
    expect(edge.status).toBe(200);
  });

  it('requires authentication', async () => {
    expect((await api().put('/api/me/home-location').send(body)).status).toBe(401);
  });
});

async function fitmentWorld() {
  const w = await createTaskWorld();
  /** Creates a task with `count` fitments at `fitmentAt`, assigned to `technicianId` in `status`. */
  const fitments = async (fitmentAt: Date, opts: { technicianId?: string | null; status?: FitmentStatus; count?: number; oeId?: string; deleted?: boolean } = {}) => {
    const res = await api()
      .post('/api/tasks')
      .set(bearer(w.om))
      .send(w.taskBody({ vehicles: { entry: 'COUNT', count: opts.count ?? 1 }, ...(opts.oeId && { oeId: opts.oeId }) }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const task = res.body as TaskDto;
    await prisma.task.update({ where: { id: task.id }, data: { fitmentAt, ...(opts.deleted && { deletedAt: new Date() }) } });
    await prisma.fitment.updateMany({
      where: { taskId: task.id },
      data: { technicianId: opts.technicianId === undefined ? w.techA.id : opts.technicianId, status: opts.status ?? 'ASSIGNED' },
    });
    return prisma.fitment.findMany({ where: { taskId: task.id }, orderBy: { tkNo: 'asc' } });
  };
  const home = (user: User, date: string) => api().get('/api/mobile/home').query({ date }).set(bearer(user));
  const list = (user: User, date: string) => api().get('/api/mobile/fitments').query({ date }).set(bearer(user));
  return { ...w, fitments, home, list };
}

describe('GET /api/mobile/home and /api/mobile/fitments', () => {
  it('counts and lists my fitments on the IST day: boundaries, any status, ordering, no deleted tasks', async () => {
    const w = await fitmentWorld();
    const start = istDayStart(TODAY)!;
    const at = (minutes: number) => new Date(start.getTime() + minutes * 60_000);

    const late = await w.fitments(at(24 * 60 - 1), { status: 'OM_APPROVED' }); // 23:59 IST
    const early = await w.fitments(at(0), { status: 'SUBMITTED', count: 2 }); // 00:00 IST, two fitments
    const noon = await w.fitments(at(12 * 60), { status: 'CLOSED_NOT_DONE' });
    await w.fitments(at(-1)); // 23:59 IST the day before
    await w.fitments(at(24 * 60)); // 00:00 IST the next day
    await w.fitments(at(60), { deleted: true }); // deleted task
    await w.fitments(at(60), { technicianId: w.techB.id }); // someone else's
    await w.fitments(at(60), { technicianId: null, status: 'OPEN' }); // unassigned

    const home = await w.home(w.techA, TODAY);
    expect(home.status, JSON.stringify(home.body)).toBe(200);
    expect(home.body as MobileHomeResponse).toEqual({ date: TODAY, showTasks: 4, approveVisit: null });

    const res = await w.list(w.techA, TODAY);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = res.body as MyFitmentsResponse;
    expect(body.date).toBe(TODAY);
    expect(body.items.map((f) => f.id)).toEqual([early[0]!.id, early[1]!.id, noon[0]!.id, late[0]!.id]);
    expect(body.items.map((f) => f.status)).toEqual(['SUBMITTED', 'SUBMITTED', 'CLOSED_NOT_DONE', 'OM_APPROVED']);
    expect(body.items[0]).toEqual({
      id: early[0]!.id,
      tkId: `TK-${String(early[0]!.tkNo).padStart(5, '0')}`,
      status: 'SUBMITTED',
      fitmentAt: start.toISOString(),
      customer: 'Zoomcar',
      site: { name: 'Bengaluru depot', address: 'MG Road', lat: 12.97, lng: 77.59 },
      vehicleRegNo: null,
      activity: 'New installation',
      // F10 additions
      taskId: early[0]!.taskId,
      oe: { name: w.oe.name, phone: w.oe.phone },
      chassisNo: null,
      assetNumber: null,
      assetType: 'Vehicle',
      installationType: 'GPS',
      availableActions: [],
    });

    // The day before has only the 23:59 fitment.
    const yesterday = await w.list(w.techA, YESTERDAY);
    expect((yesterday.body as MyFitmentsResponse).items).toHaveLength(1);
    expect((await w.home(w.techB, TODAY)).body).toMatchObject({ showTasks: 1 });
  });

  it("an OE's approveVisit counts SUBMITTED fitments of their own tasks on the day (the verification queue)", async () => {
    const w = await fitmentWorld();
    const otherOe = await createUser({ role: 'OE', managerId: w.om.id });
    const at = (minutes: number) => new Date(istDayStart(TODAY)!.getTime() + minutes * 60_000);
    await w.fitments(at(60), { status: 'SUBMITTED', count: 2 }); // mine: counted
    await w.fitments(at(90), { status: 'OE_VERIFIED' }); // already verified
    await w.fitments(at(120), { status: 'SUBMITTED', oeId: otherOe.id }); // another OE's task
    await w.fitments(at(150), { status: 'SUBMITTED', deleted: true }); // deleted
    await w.fitments(at(-60), { status: 'SUBMITTED' }); // the day before

    const res = await w.home(w.oe, TODAY);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ date: TODAY, showTasks: 0, approveVisit: 2 });
    expect((await w.home(otherOe, TODAY)).body).toMatchObject({ approveVisit: 1 });
    expect((await w.home(w.oe, YESTERDAY)).body).toMatchObject({ approveVisit: 1 });
    // The dashboard's "Awaiting my verification" uses the same scope (all days).
    const summary = await api().get('/api/tasks/summary').set(bearer(w.oe));
    expect(summary.body.awaitingMyVerification).toBe(3);
  });

  it('refuses dates outside the window with 400', async () => {
    const w = await fitmentWorld();
    expect((await w.home(w.techA, OLDEST)).status).toBe(200);
    for (const date of [dayBefore(OLDEST), new Date(istDayStart(TODAY)!.getTime() + 2 * DAY_MS).toISOString().slice(0, 10), 'yesterday', '2026-13-01']) {
      for (const res of [await w.home(w.techA, date), await w.list(w.techA, date)]) {
        expect(res.status, date).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
      }
    }
    expect((await api().get('/api/mobile/home').set(bearer(w.techA))).status).toBe(400);
  });

  it('SA, OM and RO are refused with 403', async () => {
    const w = await fitmentWorld();
    for (const user of [w.sa, w.om, w.ro]) {
      expect((await w.home(user, TODAY)).status).toBe(403);
      expect((await w.list(user, TODAY)).status).toBe(403);
    }
    expect((await api().get('/api/mobile/home').query({ date: TODAY })).status).toBe(401);
  });
});

describe('/api/geo for the home-location picker', () => {
  it('OT and OE are allowed now; RO is still refused', async () => {
    const { ot, oe, ro } = await createOrg();
    const geocoder: Geocoder = { search: vi.fn(async () => []), reverse: vi.fn(async () => null) };
    const geo = () => testApi(fakeGoogle(null), { geocoder });
    for (const user of [ot, oe]) {
      expect((await geo().get('/api/geo/search').query({ q: 'MG Road' }).set(bearer(user))).status).toBe(200);
      expect((await geo().get('/api/geo/reverse').query({ lat: 12.97, lng: 77.59 }).set(bearer(user))).status).toBe(200);
    }
    expect((await geo().get('/api/geo/search').query({ q: 'MG Road' }).set(bearer(ro))).status).toBe(403);
  });
});
