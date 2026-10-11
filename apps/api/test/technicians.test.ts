import { describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma';
import { bearer, createLocation, createOrg, createUser, testApi, tokenFromLink } from './helpers';

const api = () => testApi();

const techBody = (overrides: Record<string, unknown> = {}) => ({
  name: 'Ravi Kumar',
  phone: '+91 90000 00001',
  email: 'ravi@intellicar.in',
  technicianType: 'THIRD_PARTY',
  ...overrides,
});

describe('POST /api/technicians', () => {
  it('creates an OT invite with type, base location, contact and manager; accepting copies them to the user', async () => {
    const { om, oe } = await createOrg();
    const location = await createLocation({ city: 'Bengaluru' });

    const res = await api()
      .post('/api/technicians')
      .set(bearer(om))
      .send(techBody({ baseLocationId: location.id, managerId: oe.id }));
    expect(res.status).toBe(201);
    expect(res.body.invite).toMatchObject({
      email: 'ravi@intellicar.in',
      role: 'OT',
      status: 'PENDING',
      name: 'Ravi Kumar',
      phone: '+91 90000 00001',
      technicianType: 'THIRD_PARTY',
      baseLocationId: location.id,
      manager: { id: oe.id, name: oe.name },
      invitedBy: { id: om.id, name: om.name },
    });
    const token = tokenFromLink(res.body.link);

    // The accept page gets the prefill values.
    const lookup = await api().get('/api/invites/lookup').query({ token });
    expect(lookup.body).toMatchObject({ name: 'Ravi Kumar', phone: '+91 90000 00001', role: 'OT' });

    const accepted = await api()
      .post('/api/invites/accept')
      .send({ token, name: 'Ravi K', phone: '+91 90000 00009', password: 'secret123' });
    expect(accepted.status).toBe(201);
    expect(accepted.body.user).toMatchObject({
      role: 'OT',
      name: 'Ravi K',
      managerId: oe.id,
      technicianType: 'THIRD_PARTY',
      baseLocationId: location.id,
    });

    const list = await api().get('/api/technicians').set(bearer(om));
    const tech = list.body.items.find((t: { email: string }) => t.email === 'ravi@intellicar.in');
    expect(tech).toMatchObject({
      technicianType: 'THIRD_PARTY',
      baseLocation: { id: location.id, city: 'Bengaluru', state: expect.any(String) },
      manager: { id: oe.id, name: oe.name },
    });
  });

  it('SA and OM must choose the reporting OE', async () => {
    const { sa, om } = await createOrg();
    const location = await createLocation();
    const missing = await api().post('/api/technicians').set(bearer(sa)).send(techBody({ baseLocationId: location.id }));
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('MANAGER_REQUIRED');
    const notOe = await api()
      .post('/api/technicians')
      .set(bearer(sa))
      .send(techBody({ baseLocationId: location.id, managerId: om.id }));
    expect(notOe.body.error.code).toBe('MANAGER_INVALID');
  });

  it('an OE is always the manager of the technicians they add', async () => {
    const { oe, om } = await createOrg();
    const otherOe = await createUser({ role: 'OE', managerId: om.id });
    const location = await createLocation();
    const res = await api()
      .post('/api/technicians')
      .set(bearer(oe))
      .send(techBody({ baseLocationId: location.id, managerId: otherOe.id }));
    expect(res.status).toBe(201);
    expect(res.body.invite.manager.id).toBe(oe.id);
  });

  it('validates the body, the base location and the email', async () => {
    const { om, oe } = await createOrg();
    const empty = await api().post('/api/technicians').set(bearer(om)).send({});
    expect(empty.status).toBe(400);
    expect(Object.keys(empty.body.error.details.fieldErrors).sort()).toEqual(
      ['baseLocationId', 'email', 'name', 'phone', 'technicianType'].sort(),
    );

    const inactive = await createLocation({ active: false });
    const res = await api()
      .post('/api/technicians')
      .set(bearer(om))
      .send(techBody({ baseLocationId: inactive.id, managerId: oe.id }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INACTIVE_REFERENCE');

    const unknown = await api()
      .post('/api/technicians')
      .set(bearer(om))
      .send(techBody({ baseLocationId: 'nope', managerId: oe.id }));
    expect(unknown.body.error.code).toBe('INVALID_REFERENCE');

    const location = await createLocation();
    const taken = await api()
      .post('/api/technicians')
      .set(bearer(om))
      .send(techBody({ email: oe.email, baseLocationId: location.id, managerId: oe.id }));
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('EMAIL_EXISTS');
  });

  it('RO and OT cannot add technicians', async () => {
    const { ro, ot, oe } = await createOrg();
    const location = await createLocation();
    for (const actor of [ro, ot]) {
      const res = await api()
        .post('/api/technicians')
        .set(bearer(actor))
        .send(techBody({ baseLocationId: location.id, managerId: oe.id }));
      expect(res.status).toBe(403);
    }
  });
});

describe('GET /api/technicians', () => {
  async function setup() {
    const org = await createOrg();
    const otherOe = await createUser({ role: 'OE', managerId: org.om.id, name: 'Other OE' });
    const blr = await createLocation({ city: 'Bengaluru' });
    const pune = await createLocation({ city: 'Pune' });
    // org.ot (from createOrg) has no profile; give it one.
    await prisma.user.update({
      where: { id: org.ot.id },
      data: { technicianType: 'PAYROLL', baseLocationId: blr.id, name: 'Asha Tech' },
    });
    const mine2 = await createUser({
      role: 'OT',
      name: 'Bala Tech',
      managerId: org.oe.id,
      technicianType: 'CONTRACTUAL',
      baseLocationId: pune.id,
      status: 'INACTIVE',
    });
    const theirs = await createUser({
      role: 'OT',
      name: 'Chitra Tech',
      managerId: otherOe.id,
      technicianType: 'THIRD_PARTY',
      baseLocationId: blr.id,
    });
    return { ...org, otherOe, blr, pune, mine2, theirs };
  }

  const names = (body: { items: { name: string }[] }) => body.items.map((t) => t.name);

  it('SA, OM and RO see every technician (and only OTs)', async () => {
    const { sa, om, ro } = await setup();
    for (const actor of [sa, om, ro]) {
      const res = await api().get('/api/technicians').set(bearer(actor));
      expect(res.status).toBe(200);
      expect(names(res.body)).toEqual(['Asha Tech', 'Bala Tech', 'Chitra Tech']);
      expect(res.body.total).toBe(3);
    }
  });

  it('an OE sees only their own technicians', async () => {
    const { oe, otherOe } = await setup();
    expect(names((await api().get('/api/technicians').set(bearer(oe))).body)).toEqual(['Asha Tech', 'Bala Tech']);
    expect(names((await api().get('/api/technicians').set(bearer(otherOe))).body)).toEqual(['Chitra Tech']);
    // Filtering by another OE doesn't widen the scope.
    const other = await api().get('/api/technicians').query({ managerId: otherOe.id }).set(bearer(oe));
    expect(other.body.items).toHaveLength(0);
  });

  it('an OT cannot list technicians', async () => {
    const { ot } = await setup();
    expect((await api().get('/api/technicians').set(bearer(ot))).status).toBe(403);
  });

  it('filters by type, base location, manager, status and search', async () => {
    const { om, pune, otherOe, blr } = await setup();
    const q = async (query: Record<string, string>) =>
      names((await api().get('/api/technicians').query(query).set(bearer(om))).body);
    expect(await q({ type: 'CONTRACTUAL' })).toEqual(['Bala Tech']);
    expect(await q({ baseLocationId: pune.id })).toEqual(['Bala Tech']);
    expect(await q({ baseLocationId: blr.id })).toEqual(['Asha Tech', 'Chitra Tech']);
    expect(await q({ managerId: otherOe.id })).toEqual(['Chitra Tech']);
    expect(await q({ status: 'INACTIVE' })).toEqual(['Bala Tech']);
    expect(await q({ q: 'chit' })).toEqual(['Chitra Tech']);
    expect(await q({ pageSize: '2', page: '2' })).toEqual(['Chitra Tech']);
    expect((await api().get('/api/technicians').query({ type: 'NOPE' }).set(bearer(om))).status).toBe(400);
  });
});

describe('PATCH /api/technicians/:id', () => {
  it('OM edits type, base location and contact details', async () => {
    const { om, ot } = await createOrg();
    const location = await createLocation({ city: 'Chennai' });
    const res = await api()
      .patch(`/api/technicians/${ot.id}`)
      .set(bearer(om))
      .send({ name: 'Renamed Tech', phone: '+91 99999 11111', technicianType: 'CONTRACTUAL', baseLocationId: location.id });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Renamed Tech',
      phone: '+91 99999 11111',
      technicianType: 'CONTRACTUAL',
      baseLocation: { id: location.id, city: 'Chennai' },
    });
  });

  it('an OE edits only their own technicians', async () => {
    const { om, oe, ot } = await createOrg();
    const otherOe = await createUser({ role: 'OE', managerId: om.id });
    const theirs = await createUser({ role: 'OT', managerId: otherOe.id });
    expect((await api().patch(`/api/technicians/${ot.id}`).set(bearer(oe)).send({ technicianType: 'PAYROLL' })).status).toBe(200);
    const res = await api().patch(`/api/technicians/${theirs.id}`).set(bearer(oe)).send({ technicianType: 'PAYROLL' });
    expect(res.status).toBe(403);
  });

  it('RO and OT cannot edit technicians', async () => {
    const { ro, ot } = await createOrg();
    for (const actor of [ro, ot]) {
      expect((await api().patch(`/api/technicians/${ot.id}`).set(bearer(actor)).send({ name: 'X' })).status).toBe(403);
    }
  });

  it('only OTs are technicians (404 otherwise)', async () => {
    const { sa, oe } = await createOrg();
    expect((await api().patch(`/api/technicians/${oe.id}`).set(bearer(sa)).send({ name: 'X' })).status).toBe(404);
  });

  it('a new base location must be active; an existing inactive one is kept', async () => {
    const { om, ot } = await createOrg();
    const old = await createLocation();
    await prisma.user.update({ where: { id: ot.id }, data: { baseLocationId: old.id, technicianType: 'PAYROLL' } });
    await prisma.location.update({ where: { id: old.id }, data: { active: false } });

    const keep = await api().patch(`/api/technicians/${ot.id}`).set(bearer(om)).send({ name: 'Still here' });
    expect(keep.status).toBe(200);
    expect(keep.body.baseLocation.id).toBe(old.id);

    const inactive = await createLocation({ active: false });
    const res = await api().patch(`/api/technicians/${ot.id}`).set(bearer(om)).send({ baseLocationId: inactive.id });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INACTIVE_REFERENCE');
  });

  it('changing an OT to another role clears the technician profile', async () => {
    const { sa, ot } = await createOrg();
    const location = await createLocation();
    await prisma.user.update({ where: { id: ot.id }, data: { baseLocationId: location.id, technicianType: 'PAYROLL' } });
    const res = await api().patch(`/api/users/${ot.id}`).set(bearer(sa)).send({ role: 'RO', managerId: null });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ role: 'RO', technicianType: null, baseLocationId: null });
  });
});
