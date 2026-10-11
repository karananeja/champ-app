import { describe, expect, it } from 'vitest';
import { ROLES, canInvite, type Role } from '@champ/shared';
import { prisma } from '../src/lib/prisma';
import { hashToken } from '../src/lib/tokens';
import {
  bearer,
  createOrg,
  createUser,
  fakeGoogle,
  insertInvite,
  refreshCookie,
  technicianFields,
  testApi,
  tokenFromLink,
} from './helpers';

type Org = Awaited<ReturnType<typeof createOrg>>;

/** A body that is valid for `target` regardless of who invites. OT invites carry the F02 technician fields. */
async function inviteBody(org: Org, target: Role, email: string) {
  const managerId = target === 'OT' ? org.oe.id : target === 'OE' ? org.om.id : undefined;
  return { email, role: target, managerId, ...(target === 'OT' ? await technicianFields() : {}) };
}

describe('POST /api/invites — invite matrix (every actor × target role)', () => {
  for (const actor of ROLES) {
    for (const target of ROLES) {
      const allowed = canInvite(actor, target);
      it(`${actor} → ${target}: ${allowed ? '201' : '403'}`, async () => {
        const org = await createOrg();
        const res = await testApi()
          .post('/api/invites')
          .set(bearer(org[actor]))
          .send(await inviteBody(org, target, `new-${target.toLowerCase()}@intellicar.in`));
        expect(res.status).toBe(allowed ? 201 : 403);
        if (allowed) {
          expect(res.body.invite).toMatchObject({ role: target, status: 'PENDING' });
          expect(res.body.link).toMatch(/^http:\/\/localhost:5173\/accept-invite\?token=/);
        } else if (actor === 'OT' || actor === 'RO') {
          expect(res.body.error.code).toBe('FORBIDDEN');
        } else {
          expect(res.body.error.code).toBe('ROLE_NOT_INVITABLE');
        }
      });
    }
  }
});

describe('POST /api/invites — rules', () => {
  it('stores only a hash of the token and expires after 72 hours', async () => {
    const { sa } = await createOrg();
    const before = Date.now();
    const res = await testApi().post('/api/invites').set(bearer(sa)).send({ email: 'x@intellicar.in', role: 'RO' });
    const token = tokenFromLink(res.body.link);
    const stored = await prisma.invite.findUniqueOrThrow({ where: { id: res.body.invite.id } });
    expect(stored.tokenHash).toBe(hashToken(token));
    expect(stored.tokenHash).not.toContain(token);
    const hours = (stored.expiresAt.getTime() - before) / 3_600_000;
    expect(hours).toBeGreaterThan(71.99);
    expect(hours).toBeLessThan(72.01);
  });

  it('the link is not returned by the list endpoint', async () => {
    const { sa } = await createOrg();
    await testApi().post('/api/invites').set(bearer(sa)).send({ email: 'x@intellicar.in', role: 'RO' });
    const list = await testApi().get('/api/invites').set(bearer(sa));
    expect(list.body.items).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain('token');
  });

  it('rejects an email that already belongs to a user (409)', async () => {
    const { sa, om } = await createOrg();
    const res = await testApi()
      .post('/api/invites')
      .set(bearer(sa))
      .send({ email: om.email.toUpperCase(), role: 'RO' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_EXISTS');
  });

  it('a new invite for the same email revokes the pending one', async () => {
    const { sa } = await createOrg();
    const api = testApi();
    const first = await api.post('/api/invites').set(bearer(sa)).send({ email: 'dup@intellicar.in', role: 'RO' });
    const second = await api.post('/api/invites').set(bearer(sa)).send({ email: 'dup@intellicar.in', role: 'OM' });
    expect(second.status).toBe(201);

    const old = await api.get('/api/invites/lookup').query({ token: tokenFromLink(first.body.link) });
    expect(old.status).toBe(410);
    expect(old.body.error.code).toBe('INVITE_INVALID');
    const pending = await prisma.invite.count({ where: { email: 'dup@intellicar.in', revokedAt: null } });
    expect(pending).toBe(1);
  });

  it('validates the request body', async () => {
    const { sa } = await createOrg();
    const res = await testApi().post('/api/invites').set(bearer(sa)).send({ email: 'nope', role: 'KING' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.fieldErrors).toHaveProperty('email');
    expect(res.body.error.details.fieldErrors).toHaveProperty('role');
  });
});

describe('POST /api/invites — technician fields (F02)', () => {
  it('an OT invite requires a technician type and base location', async () => {
    const { sa, oe } = await createOrg();
    const res = await testApi()
      .post('/api/invites')
      .set(bearer(sa))
      .send({ email: 'tech@intellicar.in', role: 'OT', managerId: oe.id });
    expect(res.status).toBe(400);
    expect(res.body.error.details.fieldErrors).toEqual({
      technicianType: ['Choose a technician type'],
      baseLocationId: ['Choose a base location'],
    });
  });

  it('stores the technician fields on an OT invite and copies them to the user on accept', async () => {
    const { sa, oe } = await createOrg();
    const tech = await technicianFields('CONTRACTUAL');
    const res = await testApi()
      .post('/api/invites')
      .set(bearer(sa))
      .send({ email: 'tech@intellicar.in', role: 'OT', managerId: oe.id, ...tech });
    expect(res.status).toBe(201);
    expect(res.body.invite).toMatchObject({ technicianType: 'CONTRACTUAL', baseLocationId: tech.baseLocationId });

    const accepted = await testApi()
      .post('/api/invites/accept')
      .send({ token: tokenFromLink(res.body.link), name: 'Tia Tech', phone: '+91 98765 43210', password: 'secret123' });
    expect(accepted.body.user).toMatchObject({ role: 'OT', technicianType: 'CONTRACTUAL', baseLocationId: tech.baseLocationId });
  });

  it('an inactive base location is rejected', async () => {
    const { sa, oe } = await createOrg();
    const tech = await technicianFields();
    await prisma.location.update({ where: { id: tech.baseLocationId }, data: { active: false } });
    const res = await testApi()
      .post('/api/invites')
      .set(bearer(sa))
      .send({ email: 'tech@intellicar.in', role: 'OT', managerId: oe.id, ...tech });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INACTIVE_REFERENCE');
  });

  it('technician fields are ignored for other roles', async () => {
    const { sa } = await createOrg();
    const res = await testApi()
      .post('/api/invites')
      .set(bearer(sa))
      .send({ email: 'ro@intellicar.in', role: 'RO', ...(await technicianFields()) });
    expect(res.status).toBe(201);
    expect(res.body.invite).toMatchObject({ technicianType: null, baseLocationId: null });
  });
});

describe('POST /api/invites — manager rules', () => {
  const post = (actor: Parameters<typeof bearer>[0], body: object) =>
    testApi().post('/api/invites').set(bearer(actor)).send(body);

  it('an OT needs an OE manager', async () => {
    const { sa, om, oe } = await createOrg();
    const tech = await technicianFields();
    expect((await post(sa, { email: 'a@intellicar.in', role: 'OT', ...tech })).body.error.code).toBe(
      'MANAGER_REQUIRED',
    );
    expect((await post(sa, { email: 'a@intellicar.in', role: 'OT', managerId: om.id, ...tech })).body.error.code).toBe(
      'MANAGER_INVALID',
    );
    const ok = await post(sa, { email: 'a@intellicar.in', role: 'OT', managerId: oe.id, ...tech });
    expect(ok.status).toBe(201);
    expect(ok.body.invite.manager).toEqual({ id: oe.id, name: oe.name });
  });

  it('an OE needs an OM manager', async () => {
    const { sa, om, oe } = await createOrg();
    expect((await post(sa, { email: 'a@intellicar.in', role: 'OE' })).body.error.code).toBe('MANAGER_REQUIRED');
    expect((await post(sa, { email: 'a@intellicar.in', role: 'OE', managerId: oe.id })).status).toBe(400);
    expect((await post(sa, { email: 'a@intellicar.in', role: 'OE', managerId: om.id })).status).toBe(201);
  });

  it('an OM inviting an OE defaults the manager to themselves', async () => {
    const { om } = await createOrg();
    const res = await post(om, { email: 'a@intellicar.in', role: 'OE' });
    expect(res.status).toBe(201);
    expect(res.body.invite.manager.id).toBe(om.id);
  });

  it('SA and OM invites cannot have a manager', async () => {
    const { sa, om } = await createOrg();
    const res = await post(sa, { email: 'a@intellicar.in', role: 'OM', managerId: om.id });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MANAGER_NOT_ALLOWED');
  });

  it('an RO manager is optional but must be an OM', async () => {
    const { sa, om, oe } = await createOrg();
    expect((await post(sa, { email: 'a@intellicar.in', role: 'RO' })).status).toBe(201);
    expect((await post(sa, { email: 'b@intellicar.in', role: 'RO', managerId: om.id })).status).toBe(201);
    expect((await post(sa, { email: 'c@intellicar.in', role: 'RO', managerId: oe.id })).status).toBe(400);
  });

  it('an OE inviting an OT is forced to be the manager', async () => {
    const { oe, om } = await createOrg();
    const otherOe = await createUser({ role: 'OE', managerId: om.id });
    const res = await post(oe, { email: 'a@intellicar.in', role: 'OT', managerId: otherOe.id, ...(await technicianFields()) });
    expect(res.status).toBe(201);
    expect(res.body.invite.manager.id).toBe(oe.id);
  });

  it('an inactive manager is rejected', async () => {
    const { sa, om } = await createOrg();
    const inactiveOe = await createUser({ role: 'OE', managerId: om.id, status: 'INACTIVE' });
    const res = await post(sa, {
      email: 'a@intellicar.in',
      role: 'OT',
      managerId: inactiveOe.id,
      ...(await technicianFields()),
    });
    expect(res.body.error.code).toBe('MANAGER_INVALID');
  });
});

describe('GET /api/invites and revoke', () => {
  it('SA sees all invites; others see only their own', async () => {
    const { sa, om, oe } = await createOrg();
    const api = testApi();
    await api.post('/api/invites').set(bearer(om)).send({ email: 'a@intellicar.in', role: 'RO' });
    await api
      .post('/api/invites')
      .set(bearer(oe))
      .send({ email: 'b@intellicar.in', role: 'OT', ...(await technicianFields()) });
    await api.post('/api/invites').set(bearer(sa)).send({ email: 'c@intellicar.in', role: 'OM' });

    expect((await api.get('/api/invites').set(bearer(sa))).body.items).toHaveLength(3);
    const omList = (await api.get('/api/invites').set(bearer(om))).body.items;
    expect(omList.map((i: { email: string }) => i.email)).toEqual(['a@intellicar.in']);
    expect((await api.get('/api/invites').set(bearer(oe))).body.items).toHaveLength(1);
  });

  it('RO and OT cannot list invites', async () => {
    const { ro, ot } = await createOrg();
    expect((await testApi().get('/api/invites').set(bearer(ro))).status).toBe(403);
    expect((await testApi().get('/api/invites').set(bearer(ot))).status).toBe(403);
  });

  it('derives statuses', async () => {
    const { sa } = await createOrg();
    await insertInvite({ invitedById: sa.id, email: 'p@intellicar.in' });
    await insertInvite({ invitedById: sa.id, email: 'u@intellicar.in', usedAt: new Date() });
    await insertInvite({ invitedById: sa.id, email: 'e@intellicar.in', expiresAt: new Date(Date.now() - 1000) });
    await insertInvite({ invitedById: sa.id, email: 'r@intellicar.in', revokedAt: new Date() });
    const items = (await testApi().get('/api/invites').set(bearer(sa))).body.items as { email: string; status: string }[];
    const byEmail = Object.fromEntries(items.map((i) => [i.email, i.status]));
    expect(byEmail).toEqual({
      'p@intellicar.in': 'PENDING',
      'u@intellicar.in': 'USED',
      'e@intellicar.in': 'EXPIRED',
      'r@intellicar.in': 'REVOKED',
    });
  });

  it('the inviter or SA can revoke a pending invite; others cannot', async () => {
    const { sa, om } = await createOrg();
    const otherOm = await createUser({ role: 'OM' });
    const { invite, token } = await insertInvite({ invitedById: om.id });
    const api = testApi();

    expect((await api.post(`/api/invites/${invite.id}/revoke`).set(bearer(otherOm))).status).toBe(403);
    const res = await api.post(`/api/invites/${invite.id}/revoke`).set(bearer(om));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('REVOKED');
    expect((await api.get('/api/invites/lookup').query({ token })).status).toBe(410);

    const again = await api.post(`/api/invites/${invite.id}/revoke`).set(bearer(sa));
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('INVITE_NOT_PENDING');
    expect((await api.post('/api/invites/missing/revoke').set(bearer(sa))).status).toBe(404);
  });
});

describe('invite lookup and accept', () => {
  const acceptBody = (token: string) => ({ token, name: 'New Person', phone: '+91 98765 43210', password: 'secret123' });

  it('lookup returns email, role, inviter name and the prefill fields', async () => {
    const { sa } = await createOrg();
    const { token } = await insertInvite({ invitedById: sa.id, email: 'n@intellicar.in', role: 'OM' });
    const res = await testApi().get('/api/invites/lookup').query({ token });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ email: 'n@intellicar.in', role: 'OM', inviterName: sa.name, name: null, phone: null });
  });

  it('happy path: creates the user, marks the invite used and logs in', async () => {
    const { sa, om } = await createOrg();
    const api = testApi();
    const created = await api
      .post('/api/invites')
      .set(bearer(sa))
      .send({ email: 'new.oe@intellicar.in', role: 'OE', managerId: om.id, jobTitle: 'Field lead' });
    const token = tokenFromLink(created.body.link);

    const res = await api.post('/api/invites/accept').send(acceptBody(token));
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({
      email: 'new.oe@intellicar.in',
      name: 'New Person',
      phone: '+91 98765 43210',
      role: 'OE',
      jobTitle: 'Field lead',
      managerId: om.id,
      authProvider: 'PASSWORD',
      status: 'ACTIVE',
    });
    expect(refreshCookie(res)).toBeDefined();

    const invite = await prisma.invite.findUniqueOrThrow({ where: { id: created.body.invite.id } });
    expect(invite.usedAt).not.toBeNull();

    // The new user can log in with the chosen password.
    const login = await api.post('/api/auth/login').send({ email: 'new.oe@intellicar.in', password: 'secret123' });
    expect(login.status).toBe(200);
  });

  it('a used link returns 410 INVITE_USED (lookup and accept)', async () => {
    const { sa } = await createOrg();
    const api = testApi();
    const { token } = await insertInvite({ invitedById: sa.id });
    expect((await api.post('/api/invites/accept').send(acceptBody(token))).status).toBe(201);

    const lookup = await api.get('/api/invites/lookup').query({ token });
    expect(lookup.status).toBe(410);
    expect(lookup.body.error.code).toBe('INVITE_USED');
    const again = await api.post('/api/invites/accept').send(acceptBody(token));
    expect(again.status).toBe(410);
    expect(again.body.error.code).toBe('INVITE_USED');
  });

  it('an expired link returns 410 INVITE_EXPIRED', async () => {
    const { sa } = await createOrg();
    const { token } = await insertInvite({ invitedById: sa.id, expiresAt: new Date(Date.now() - 1000) });
    const lookup = await testApi().get('/api/invites/lookup').query({ token });
    expect(lookup.status).toBe(410);
    expect(lookup.body.error.code).toBe('INVITE_EXPIRED');
    const accept = await testApi().post('/api/invites/accept').send(acceptBody(token));
    expect(accept.body.error.code).toBe('INVITE_EXPIRED');
  });

  it('an unknown token returns 410 INVITE_INVALID', async () => {
    const lookup = await testApi().get('/api/invites/lookup').query({ token: 'does-not-exist' });
    expect(lookup.status).toBe(410);
    expect(lookup.body.error.code).toBe('INVITE_INVALID');
    const accept = await testApi().post('/api/invites/accept').send(acceptBody('does-not-exist'));
    expect(accept.body.error.code).toBe('INVITE_INVALID');
  });

  it('enforces the password policy', async () => {
    const { sa } = await createOrg();
    const { token } = await insertInvite({ invitedById: sa.id });
    const res = await testApi()
      .post('/api/invites/accept')
      .send({ ...acceptBody(token), password: 'lettersonly' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.fieldErrors.password[0]).toMatch(/number/);
  });

  it('rejects accepting when the email was registered in the meantime (409)', async () => {
    const { sa } = await createOrg();
    const { token } = await insertInvite({ invitedById: sa.id, email: 'taken@intellicar.in' });
    await createUser({ role: 'RO', email: 'taken@intellicar.in' });
    const res = await testApi().post('/api/invites/accept').send(acceptBody(token));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_EXISTS');
  });
});

describe('POST /api/invites/accept/google (verifier mocked)', () => {
  it('creates a Google user when the email matches the invite', async () => {
    const { sa } = await createOrg();
    const google = fakeGoogle();
    const { token } = await insertInvite({ invitedById: sa.id, email: 'g@intellicar.in', role: 'RO' });
    google.identity = { email: 'g@intellicar.in', email_verified: true, hd: 'intellicar.in', name: 'Gita G' };
    const res = await testApi(google).post('/api/invites/accept/google').send({ token, idToken: 'x' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'g@intellicar.in', name: 'Gita G', authProvider: 'GOOGLE' });
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'g@intellicar.in' } });
    expect(user.passwordHash).toBeNull();
  });

  it('rejects a different Google email', async () => {
    const { sa } = await createOrg();
    const google = fakeGoogle();
    const { token } = await insertInvite({ invitedById: sa.id, email: 'g@intellicar.in' });
    google.identity = { email: 'other@intellicar.in', email_verified: true, hd: 'intellicar.in' };
    const res = await testApi(google).post('/api/invites/accept/google').send({ token, idToken: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('GOOGLE_EMAIL_MISMATCH');
  });

  it('rejects a Google account outside the company domain', async () => {
    const { sa } = await createOrg();
    const google = fakeGoogle();
    const { token } = await insertInvite({ invitedById: sa.id, email: 'contractor@gmail.com' });
    google.identity = { email: 'contractor@gmail.com', email_verified: true };
    const res = await testApi(google).post('/api/invites/accept/google').send({ token, idToken: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('GOOGLE_DOMAIN_NOT_ALLOWED');
    expect((await prisma.invite.findFirstOrThrow({ where: { email: 'contractor@gmail.com' } })).usedAt).toBeNull();
  });
});
