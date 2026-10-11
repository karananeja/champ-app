import { describe, expect, it } from 'vitest';
import type { UserDto } from '@champ/shared';
import { prisma } from '../src/lib/prisma';
import { PASSWORD, bearer, createOrg, createUser, refreshCookie, testApi } from './helpers';

const emails = (body: { items: UserDto[] }) => body.items.map((u) => u.email).sort();

describe('GET /api/users — scope per role', () => {
  it('SA, OM and RO see all users', async () => {
    const org = await createOrg();
    for (const actor of [org.sa, org.om, org.ro]) {
      const res = await testApi().get('/api/users').set(bearer(actor));
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(5);
    }
  });

  it('an OE sees only self and own reportees', async () => {
    const org = await createOrg();
    const otherOe = await createUser({ role: 'OE', managerId: org.om.id });
    await createUser({ role: 'OT', managerId: otherOe.id });
    const res = await testApi().get('/api/users').set(bearer(org.oe));
    expect(emails(res.body)).toEqual([org.oe.email, org.ot.email].sort());
  });

  it('an OT cannot list users', async () => {
    const { ot } = await createOrg();
    const res = await testApi().get('/api/users').set(bearer(ot));
    expect(res.status).toBe(403);
  });

  it('filters by role, status and search, and paginates', async () => {
    const org = await createOrg();
    await createUser({ role: 'RO', name: 'Zara Viewer', status: 'INACTIVE' });
    const api = testApi();

    const byRole = await api.get('/api/users').query({ role: 'RO' }).set(bearer(org.sa));
    expect(byRole.body.total).toBe(2);
    const byStatus = await api.get('/api/users').query({ status: 'INACTIVE' }).set(bearer(org.sa));
    expect(byStatus.body.items.map((u: UserDto) => u.name)).toEqual(['Zara Viewer']);
    const bySearch = await api.get('/api/users').query({ q: 'zara' }).set(bearer(org.sa));
    expect(bySearch.body.total).toBe(1);
    const byEmail = await api.get('/api/users').query({ q: org.om.email.toUpperCase() }).set(bearer(org.sa));
    expect(byEmail.body.items[0].id).toBe(org.om.id);

    const page = await api.get('/api/users').query({ page: 2, pageSize: 4 }).set(bearer(org.sa));
    expect(page.body).toMatchObject({ total: 6, page: 2, pageSize: 4 });
    expect(page.body.items).toHaveLength(2);
  });

  it('includes the manager in each row', async () => {
    const org = await createOrg();
    const res = await testApi().get('/api/users').query({ role: 'OT' }).set(bearer(org.sa));
    expect(res.body.items[0].manager).toMatchObject({ id: org.oe.id, name: org.oe.name });
  });

  it('rejects invalid query params', async () => {
    const { sa } = await createOrg();
    const res = await testApi().get('/api/users').query({ role: 'KING', pageSize: 1000 }).set(bearer(sa));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/users/:id', () => {
  it('follows the same scope', async () => {
    const org = await createOrg();
    const api = testApi();
    expect((await api.get(`/api/users/${org.ot.id}`).set(bearer(org.oe))).status).toBe(200);
    expect((await api.get(`/api/users/${org.om.id}`).set(bearer(org.oe))).status).toBe(404);
    expect((await api.get(`/api/users/${org.om.id}`).set(bearer(org.ro))).status).toBe(200);
    expect((await api.get(`/api/users/${org.om.id}`).set(bearer(org.ot))).status).toBe(403);
    expect((await api.get('/api/users/missing').set(bearer(org.sa))).status).toBe(404);
  });
});

describe('PATCH /api/users/:id', () => {
  it('SA can change role and manager', async () => {
    const org = await createOrg();
    const otherOm = await createUser({ role: 'OM' });
    const res = await testApi()
      .patch(`/api/users/${org.oe.id}`)
      .set(bearer(org.sa))
      .send({ managerId: otherOm.id, jobTitle: 'Senior OE' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ managerId: otherOm.id, jobTitle: 'Senior OE' });

    const ro = await testApi()
      .patch(`/api/users/${org.ro.id}`)
      .set(bearer(org.sa))
      .send({ role: 'OT', managerId: org.oe.id });
    expect(ro.body).toMatchObject({ role: 'OT', managerId: org.oe.id });
  });

  it('enforces manager rules on role change', async () => {
    const org = await createOrg();
    const res = await testApi().patch(`/api/users/${org.ro.id}`).set(bearer(org.sa)).send({ role: 'OT' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MANAGER_REQUIRED');

    const toOm = await testApi().patch(`/api/users/${org.ot.id}`).set(bearer(org.sa)).send({ role: 'OM' });
    expect(toOm.status).toBe(200);
    expect(toOm.body.managerId).toBeNull();
  });

  it('refuses a role change while the user has reportees', async () => {
    const org = await createOrg();
    const res = await testApi().patch(`/api/users/${org.oe.id}`).set(bearer(org.sa)).send({ role: 'RO' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('HAS_REPORTEES');
  });

  it('deactivating a user revokes their sessions and blocks login; reactivating restores access', async () => {
    const org = await createOrg();
    const api = testApi();
    const cookie = refreshCookie(await api.post('/api/auth/login').send({ email: org.oe.email, password: PASSWORD }));

    const res = await api.patch(`/api/users/${org.oe.id}`).set(bearer(org.sa)).send({ status: 'INACTIVE' });
    expect(res.body.status).toBe('INACTIVE');
    expect((await api.post('/api/auth/refresh').set('Cookie', `champ_rt=${cookie}`)).status).toBe(401);
    expect((await api.post('/api/auth/login').send({ email: org.oe.email, password: PASSWORD })).status).toBe(403);

    await api.patch(`/api/users/${org.oe.id}`).set(bearer(org.sa)).send({ status: 'ACTIVE' });
    expect((await api.post('/api/auth/login').send({ email: org.oe.email, password: PASSWORD })).status).toBe(200);
  });

  it('a user cannot change their own role or status', async () => {
    const { sa } = await createOrg();
    const res = await testApi().patch(`/api/users/${sa.id}`).set(bearer(sa)).send({ status: 'INACTIVE' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CANNOT_MODIFY_SELF');
  });

  it('returns 404 for an unknown user', async () => {
    const { sa } = await createOrg();
    expect((await testApi().patch('/api/users/missing').set(bearer(sa)).send({ status: 'ACTIVE' })).status).toBe(404);
  });
});

describe('OM delegation', () => {
  it('an OM without delegation cannot edit users', async () => {
    const org = await createOrg();
    const res = await testApi().patch(`/api/users/${org.ot.id}`).set(bearer(org.om)).send({ status: 'INACTIVE' });
    expect(res.status).toBe(403);
  });

  it('an OM with delegation can edit OE/OT/RO users', async () => {
    const org = await createOrg();
    await prisma.user.update({ where: { id: org.om.id }, data: { canManageUsers: true } });
    const res = await testApi().patch(`/api/users/${org.ot.id}`).set(bearer(org.om)).send({ status: 'INACTIVE' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('INACTIVE');
  });

  it('a delegated OM cannot touch SA/OM users or grant SA/OM', async () => {
    const org = await createOrg();
    await prisma.user.update({ where: { id: org.om.id }, data: { canManageUsers: true } });
    const otherOm = await createUser({ role: 'OM' });
    const api = testApi();
    expect((await api.patch(`/api/users/${org.sa.id}`).set(bearer(org.om)).send({ name: 'X' })).status).toBe(403);
    expect((await api.patch(`/api/users/${otherOm.id}`).set(bearer(org.om)).send({ name: 'X' })).status).toBe(403);
    expect((await api.patch(`/api/users/${org.ro.id}`).set(bearer(org.om)).send({ role: 'OM' })).status).toBe(403);
    expect((await api.patch(`/api/users/${org.ro.id}`).set(bearer(org.om)).send({ role: 'SUPER_ADMIN' })).status).toBe(403);
  });

  it('SA toggles delegation on and off; it takes effect immediately', async () => {
    const org = await createOrg();
    const api = testApi();
    const on = await api.patch(`/api/users/${org.om.id}/delegation`).set(bearer(org.sa)).send({ canManageUsers: true });
    expect(on.status).toBe(200);
    expect(on.body).toMatchObject({ canManageUsers: true, canManageTaskTypes: false });
    expect((await api.patch(`/api/users/${org.ro.id}`).set(bearer(org.om)).send({ name: 'Renamed' })).status).toBe(200);

    const off = await api.patch(`/api/users/${org.om.id}/delegation`).set(bearer(org.sa)).send({ canManageUsers: false });
    expect(off.body.canManageUsers).toBe(false);
    expect((await api.patch(`/api/users/${org.ro.id}`).set(bearer(org.om)).send({ name: 'Again' })).status).toBe(403);

    const tt = await api.patch(`/api/users/${org.om.id}/delegation`).set(bearer(org.sa)).send({ canManageTaskTypes: true });
    expect(tt.body).toMatchObject({ canManageUsers: false, canManageTaskTypes: true });
  });

  it('delegation is SA-only and only applies to OMs', async () => {
    const org = await createOrg();
    const api = testApi();
    const notOm = await api.patch(`/api/users/${org.oe.id}/delegation`).set(bearer(org.sa)).send({ canManageUsers: true });
    expect(notOm.status).toBe(400);
    expect(notOm.body.error.code).toBe('TARGET_NOT_OM');
    const byOm = await api.patch(`/api/users/${org.om.id}/delegation`).set(bearer(org.om)).send({ canManageUsers: true });
    expect(byOm.status).toBe(403);
  });

  it('changing an OM to another role clears delegation flags', async () => {
    const om = await createUser({ role: 'OM', canManageUsers: true, canManageTaskTypes: true });
    const { sa } = await createOrg();
    const res = await testApi().patch(`/api/users/${om.id}`).set(bearer(sa)).send({ role: 'RO' });
    expect(res.body).toMatchObject({ role: 'RO', canManageUsers: false, canManageTaskTypes: false });
  });
});

describe('RO is forbidden on all mutations', () => {
  it('cannot invite, edit, delegate or revoke', async () => {
    const org = await createOrg();
    const api = testApi();
    const checks = [
      api.post('/api/invites').set(bearer(org.ro)).send({ email: 'x@intellicar.in', role: 'OT', managerId: org.oe.id }),
      api.patch(`/api/users/${org.ot.id}`).set(bearer(org.ro)).send({ status: 'INACTIVE' }),
      api.patch(`/api/users/${org.om.id}/delegation`).set(bearer(org.ro)).send({ canManageUsers: true }),
      api.post('/api/invites/any/revoke').set(bearer(org.ro)),
      api.get('/api/users/managers').query({ role: 'OT' }).set(bearer(org.ro)),
    ];
    for (const res of await Promise.all(checks)) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    }
  });
});

describe('GET /api/users/managers', () => {
  it('lists active OEs for an OT and OMs for an OE', async () => {
    const org = await createOrg();
    await createUser({ role: 'OE', managerId: org.om.id, status: 'INACTIVE' });
    const api = testApi();
    const forOt = await api.get('/api/users/managers').query({ role: 'OT' }).set(bearer(org.sa));
    expect(forOt.body.items).toEqual([{ id: org.oe.id, name: org.oe.name }]);
    const forOe = await api.get('/api/users/managers').query({ role: 'OE' }).set(bearer(org.om));
    expect(forOe.body.items).toEqual([{ id: org.om.id, name: org.om.name }]);
  });

  it('an OE only gets themselves', async () => {
    const org = await createOrg();
    await createUser({ role: 'OE', managerId: org.om.id });
    const res = await testApi().get('/api/users/managers').query({ role: 'OT' }).set(bearer(org.oe));
    expect(res.body.items).toEqual([{ id: org.oe.id, name: org.oe.name }]);
  });
});
