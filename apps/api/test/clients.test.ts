import { describe, expect, it } from 'vitest';
import type { Role } from '@champ/shared';
import { prisma, type User } from '../src/lib/prisma';
import { bearer, createLocation, createOrg, testApi } from './helpers';

const api = () => testApi();

async function siteBody(overrides: Record<string, unknown> = {}) {
  const locationId = (overrides.locationId as string | undefined) ?? (await createLocation({ city: 'Bengaluru' })).id;
  return {
    name: 'Bengaluru depot',
    address: '12 MG Road, Bengaluru',
    lat: 12.9716,
    lng: 77.5946,
    locationId,
    ...overrides,
  };
}

async function clientBody(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Zoomcar',
    code: 'zoom',
    contactName: 'Priya Rao',
    contactPhone: '+91 98765 43210',
    contactEmail: 'Priya@Zoom.example',
    billingEmail: '',
    notes: 'Monthly billing',
    sites: [await siteBody()],
    ...overrides,
  };
}

async function createClient(actor: User, overrides: Record<string, unknown> = {}) {
  const res = await api().post('/api/clients').set(bearer(actor)).send(await clientBody(overrides));
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; sites: { id: string; name: string }[] };
}

describe('clients — CRUD with nested sites', () => {
  it('OM creates a client with its sites in one request, then reads it back', async () => {
    const { om } = await createOrg();
    const pune = await createLocation({ city: 'Pune' });
    const body = await clientBody({
      sites: [
        await siteBody({ contactName: 'Ravi', contactPhone: '+91 90000 00001' }),
        await siteBody({ name: 'Pune yard', address: 'Hinjewadi, Pune', lat: 18.59, lng: 73.73, locationId: pune.id }),
      ],
    });
    const res = await api().post('/api/clients').set(bearer(om)).send(body);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      name: 'Zoomcar',
      code: 'ZOOM',
      contactName: 'Priya Rao',
      contactEmail: 'priya@zoom.example',
      billingEmail: null,
      notes: 'Monthly billing',
      active: true,
      siteCount: 2,
      activeSiteCount: 2,
      createdBy: { id: om.id, name: om.name },
    });
    expect(res.body.sites).toEqual([
      expect.objectContaining({
        name: 'Bengaluru depot',
        lat: 12.9716,
        lng: 77.5946,
        contactName: 'Ravi',
        location: expect.objectContaining({ city: 'Bengaluru', active: true }),
      }),
      expect.objectContaining({ name: 'Pune yard', locationId: pune.id, contactName: null, contactPhone: null }),
    ]);

    const detail = await api().get(`/api/clients/${res.body.id}`).set(bearer(om));
    expect(detail.status).toBe(200);
    expect(detail.body.sites).toHaveLength(2);
    expect(detail.body.sites[0].location).toMatchObject({ city: 'Bengaluru', state: expect.any(String) });
  });

  it('rolls back the client when a site fails (single transaction)', async () => {
    const { om } = await createOrg();
    const res = await api()
      .post('/api/clients')
      .set(bearer(om))
      .send(await clientBody({ sites: [await siteBody(), await siteBody({ name: 'Bad', locationId: 'nope' })] }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_REFERENCE');
    expect(res.body.error.details.fieldErrors['sites.1.locationId']).toBeDefined();
    expect(await prisma.client.count()).toBe(0);
    expect(await prisma.clientSite.count()).toBe(0);
  });

  it('requires at least one site', async () => {
    const { om } = await createOrg();
    const res = await api().post('/api/clients').set(bearer(om)).send(await clientBody({ sites: [] }));
    expect(res.status).toBe(400);
    expect(res.body.error.details.fieldErrors.sites).toEqual(['Add at least one site']);
  });

  it('validates the body (phone, lat/lng bounds, code format)', async () => {
    const { om } = await createOrg();
    const res = await api()
      .post('/api/clients')
      .set(bearer(om))
      .send(await clientBody({ contactPhone: 'x', code: 'Z' }));
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.details.fieldErrors).sort()).toEqual(['code', 'contactPhone']);

    const badSite = await api()
      .post('/api/clients')
      .set(bearer(om))
      .send(await clientBody({ sites: [await siteBody({ lat: 95 })] }));
    expect(badSite.status).toBe(400);
  });

  it('PATCH edits client fields, clears optional ones, deactivates and reactivates', async () => {
    const { om } = await createOrg();
    const client = await createClient(om);
    const res = await api()
      .patch(`/api/clients/${client.id}`)
      .set(bearer(om))
      .send({ name: 'Zoomcar India', code: null, billingEmail: 'billing@zoom.example', notes: '' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'Zoomcar India', code: null, billingEmail: 'billing@zoom.example', notes: null });

    const off = await api().patch(`/api/clients/${client.id}`).set(bearer(om)).send({ active: false });
    expect(off.body.active).toBe(false);
    // Deactivating a client leaves its sites as they are.
    expect(off.body.sites[0].active).toBe(true);
    const on = await api().patch(`/api/clients/${client.id}`).set(bearer(om)).send({ active: true });
    expect(on.body.active).toBe(true);
  });

  it('lists with search, active filter, site counts and pagination', async () => {
    const { oe, om } = await createOrg();
    const zoom = await createClient(om);
    await api()
      .post(`/api/clients/${zoom.id}/sites`)
      .set(bearer(om))
      .send(await siteBody({ name: 'Second' }))
      .expect(201);
    await api()
      .patch(`/api/clients/${zoom.id}/sites/${zoom.sites[0]!.id}`)
      .set(bearer(om))
      .send({ active: false })
      .expect(200);
    const acme = await createClient(om, { name: 'Acme Logistics', code: 'ACME', contactName: 'Kiran', contactEmail: '' });
    await api().patch(`/api/clients/${acme.id}`).set(bearer(om)).send({ active: false }).expect(200);

    const all = await api().get('/api/clients').set(bearer(oe));
    expect(all.status).toBe(200);
    expect(all.body).toMatchObject({ total: 2, page: 1, pageSize: 20 });
    expect(all.body.items.map((c: { name: string }) => c.name)).toEqual(['Acme Logistics', 'Zoomcar']);
    expect(all.body.items[1]).toMatchObject({ siteCount: 2, activeSiteCount: 1 });

    const byCode = await api().get('/api/clients').query({ q: 'acm' }).set(bearer(oe));
    expect(byCode.body.items.map((c: { name: string }) => c.name)).toEqual(['Acme Logistics']);
    const byContact = await api().get('/api/clients').query({ q: 'priya' }).set(bearer(oe));
    expect(byContact.body.items.map((c: { name: string }) => c.name)).toEqual(['Zoomcar']);
    const active = await api().get('/api/clients').query({ active: 'true' }).set(bearer(oe));
    expect(active.body.items.map((c: { name: string }) => c.name)).toEqual(['Zoomcar']);
    const inactive = await api().get('/api/clients').query({ active: 'false' }).set(bearer(oe));
    expect(inactive.body.items.map((c: { name: string }) => c.name)).toEqual(['Acme Logistics']);
    const page2 = await api().get('/api/clients').query({ page: 2, pageSize: 1 }).set(bearer(oe));
    expect(page2.body.items.map((c: { name: string }) => c.name)).toEqual(['Zoomcar']);
  });

  it('unknown client or site is 404', async () => {
    const { om } = await createOrg();
    expect((await api().get('/api/clients/nope').set(bearer(om))).status).toBe(404);
    expect((await api().patch('/api/clients/nope').set(bearer(om)).send({ active: false })).status).toBe(404);
    expect((await api().post('/api/clients/nope/sites').set(bearer(om)).send(await siteBody())).status).toBe(404);
    const a = await createClient(om);
    const b = await createClient(om, { name: 'Other', code: 'OTHER' });
    // A site of another client is not reachable through this client.
    const res = await api().patch(`/api/clients/${a.id}/sites/${b.sites[0]!.id}`).set(bearer(om)).send({ name: 'X' });
    expect(res.status).toBe(404);
  });
});

describe('clients — duplicates', () => {
  it('rejects a duplicate name case-insensitively, with a clear message on the field', async () => {
    const { om } = await createOrg();
    await createClient(om);
    const res = await api()
      .post('/api/clients')
      .set(bearer(om))
      .send(await clientBody({ name: '  ZOOMCAR ', code: 'OTHER' }));
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'DUPLICATE', message: 'A client named "Zoomcar" already exists' });
    expect(res.body.error.details.fieldErrors.name).toEqual(['A client named "Zoomcar" already exists']);
  });

  it('rejects a duplicate code after normalising it to uppercase', async () => {
    const { om } = await createOrg();
    await createClient(om);
    const res = await api()
      .post('/api/clients')
      .set(bearer(om))
      .send(await clientBody({ name: 'Another', code: ' Zoom ' }));
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'DUPLICATE', message: 'Code ZOOM is already used by Zoomcar' });
    expect(res.body.error.details.fieldErrors.code).toBeDefined();
  });

  it('rename and code change on PATCH are checked against other clients only', async () => {
    const { om } = await createOrg();
    const zoom = await createClient(om);
    await createClient(om, { name: 'Acme', code: 'ACME' });
    const clash = await api().patch(`/api/clients/${zoom.id}`).set(bearer(om)).send({ name: 'acme' });
    expect(clash.status).toBe(409);
    const codeClash = await api().patch(`/api/clients/${zoom.id}`).set(bearer(om)).send({ code: 'acme' });
    expect(codeClash.status).toBe(409);
    // Its own name and code (different case) are fine.
    const self = await api().patch(`/api/clients/${zoom.id}`).set(bearer(om)).send({ name: 'ZoomCar', code: 'zoom' });
    expect(self.status).toBe(200);
    expect(self.body).toMatchObject({ name: 'ZoomCar', code: 'ZOOM' });
  });

  it('several clients may have no code', async () => {
    const { om } = await createOrg();
    await createClient(om, { code: '' });
    await createClient(om, { name: 'No code 2', code: undefined });
    expect(await prisma.client.count({ where: { code: null } })).toBe(2);
  });

  it('rejects duplicate site names within a client (in the create body, on add and on rename)', async () => {
    const { om } = await createOrg();
    const inBody = await api()
      .post('/api/clients')
      .set(bearer(om))
      .send(await clientBody({ sites: [await siteBody(), await siteBody({ name: 'BENGALURU depot ' })] }));
    expect(inBody.status).toBe(409);
    expect(inBody.body.error.code).toBe('DUPLICATE');
    expect(inBody.body.error.details.fieldErrors['sites.1.name']).toEqual(['"Bengaluru depot" already exists for this client']);

    const client = await createClient(om);
    const add = await api()
      .post(`/api/clients/${client.id}/sites`)
      .set(bearer(om))
      .send(await siteBody({ name: 'bengaluru DEPOT' }));
    expect(add.status).toBe(409);
    expect(add.body.error.message).toBe('"Bengaluru depot" already exists for this client');

    const second = await api().post(`/api/clients/${client.id}/sites`).set(bearer(om)).send(await siteBody({ name: 'Yard' }));
    expect(second.status).toBe(201);
    const rename = await api()
      .patch(`/api/clients/${client.id}/sites/${second.body.id}`)
      .set(bearer(om))
      .send({ name: 'Bengaluru Depot' });
    expect(rename.status).toBe(409);

    // The same site name under another client is fine.
    const other = await createClient(om, { name: 'Other', code: 'OTHER' });
    expect(other.sites[0]!.name).toBe('Bengaluru depot');
  });
});

describe('client sites', () => {
  it('adds a site and edits its pin, address, city and contact', async () => {
    const { om } = await createOrg();
    const client = await createClient(om);
    const pune = await createLocation({ city: 'Pune' });
    const added = await api()
      .post(`/api/clients/${client.id}/sites`)
      .set(bearer(om))
      .send(await siteBody({ name: 'Pune yard', locationId: pune.id }));
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ clientId: client.id, name: 'Pune yard', active: true });

    const edit = await api()
      .patch(`/api/clients/${client.id}/sites/${added.body.id}`)
      .set(bearer(om))
      .send({ address: 'Chakan, Pune', lat: 18.76, lng: 73.86, contactName: 'Sunil', contactPhone: '+91 90000 00009' });
    expect(edit.status).toBe(200);
    expect(edit.body).toMatchObject({ address: 'Chakan, Pune', lat: 18.76, lng: 73.86, contactName: 'Sunil' });

    const clear = await api()
      .patch(`/api/clients/${client.id}/sites/${added.body.id}`)
      .set(bearer(om))
      .send({ contactName: '', contactPhone: null });
    expect(clear.body).toMatchObject({ contactName: null, contactPhone: null });
  });

  it('a client always keeps one active site: deactivating the last one is 409 LAST_ACTIVE_SITE', async () => {
    const { om } = await createOrg();
    const client = await createClient(om);
    const only = client.sites[0]!;
    const blocked = await api().patch(`/api/clients/${client.id}/sites/${only.id}`).set(bearer(om)).send({ active: false });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('LAST_ACTIVE_SITE');

    const second = await api().post(`/api/clients/${client.id}/sites`).set(bearer(om)).send(await siteBody({ name: 'Yard' }));
    const ok = await api().patch(`/api/clients/${client.id}/sites/${only.id}`).set(bearer(om)).send({ active: false });
    expect(ok.status).toBe(200);
    expect(ok.body.active).toBe(false);

    const blockedAgain = await api()
      .patch(`/api/clients/${client.id}/sites/${second.body.id}`)
      .set(bearer(om))
      .send({ active: false });
    expect(blockedAgain.status).toBe(409);

    // Re-saving an inactive site as inactive, or editing it, is fine.
    const noop = await api().patch(`/api/clients/${client.id}/sites/${only.id}`).set(bearer(om)).send({ active: false, name: 'Old depot' });
    expect(noop.status).toBe(200);
    const reactivate = await api().patch(`/api/clients/${client.id}/sites/${only.id}`).set(bearer(om)).send({ active: true });
    expect(reactivate.body.active).toBe(true);
  });

  it('rejects an inactive or unknown location for new and changed sites, but keeps an existing one', async () => {
    const { om } = await createOrg();
    const closed = await createLocation({ city: 'Closed city', active: false });

    const onCreate = await api()
      .post('/api/clients')
      .set(bearer(om))
      .send(await clientBody({ sites: [await siteBody({ locationId: closed.id })] }));
    expect(onCreate.status).toBe(400);
    expect(onCreate.body.error.code).toBe('INACTIVE_REFERENCE');
    expect(onCreate.body.error.details.fieldErrors['sites.0.locationId']).toEqual(['Closed city is inactive and can\'t be chosen']);

    const client = await createClient(om);
    const onAdd = await api()
      .post(`/api/clients/${client.id}/sites`)
      .set(bearer(om))
      .send(await siteBody({ name: 'X', locationId: closed.id }));
    expect(onAdd.status).toBe(400);
    expect(onAdd.body.error.code).toBe('INACTIVE_REFERENCE');

    const site = client.sites[0]!;
    const onChange = await api().patch(`/api/clients/${client.id}/sites/${site.id}`).set(bearer(om)).send({ locationId: closed.id });
    expect(onChange.status).toBe(400);
    expect(onChange.body.error.code).toBe('INACTIVE_REFERENCE');
    const unknown = await api().patch(`/api/clients/${client.id}/sites/${site.id}`).set(bearer(om)).send({ locationId: 'nope' });
    expect(unknown.body.error.code).toBe('INVALID_REFERENCE');

    // The site's own location is deactivated later: the site can still be edited.
    const detail = await api().get(`/api/clients/${client.id}`).set(bearer(om));
    await prisma.location.update({ where: { id: detail.body.sites[0].locationId }, data: { active: false } });
    const rename = await api().patch(`/api/clients/${client.id}/sites/${site.id}`).set(bearer(om)).send({ name: 'Renamed' });
    expect(rename.status).toBe(200);
    expect(rename.body.location.active).toBe(false);
  });
});

describe('clients — permissions', () => {
  const editors: Role[] = ['SUPER_ADMIN', 'OM'];
  const readers: Role[] = ['OE', 'RO'];

  it.each(editors)('%s can read and write', async (role) => {
    const org = await createOrg();
    const actor = org[role];
    const client = await createClient(actor);
    expect((await api().get('/api/clients').set(bearer(actor))).status).toBe(200);
    expect((await api().patch(`/api/clients/${client.id}`).set(bearer(actor)).send({ notes: 'x' })).status).toBe(200);
    const site = await api().post(`/api/clients/${client.id}/sites`).set(bearer(actor)).send(await siteBody({ name: 'Two' }));
    expect(site.status).toBe(201);
    const patch = await api().patch(`/api/clients/${client.id}/sites/${site.body.id}`).set(bearer(actor)).send({ name: 'Three' });
    expect(patch.status).toBe(200);
  });

  it.each(readers)('%s can read but not write (403 before validation)', async (role) => {
    const org = await createOrg();
    const client = await createClient(org.om);
    const actor = org[role];
    expect((await api().get('/api/clients').set(bearer(actor))).status).toBe(200);
    expect((await api().get(`/api/clients/${client.id}`).set(bearer(actor))).status).toBe(200);
    expect((await api().post('/api/clients').set(bearer(actor)).send({})).status).toBe(403);
    expect((await api().patch(`/api/clients/${client.id}`).set(bearer(actor)).send({ active: false })).status).toBe(403);
    expect((await api().post(`/api/clients/${client.id}/sites`).set(bearer(actor)).send({})).status).toBe(403);
    const site = client.sites[0]!.id;
    expect((await api().patch(`/api/clients/${client.id}/sites/${site}`).set(bearer(actor)).send({ name: 'X' })).status).toBe(403);
  });

  it('OT gets 403 on reads and writes', async () => {
    const org = await createOrg();
    const client = await createClient(org.om);
    expect((await api().get('/api/clients').set(bearer(org.ot))).status).toBe(403);
    expect((await api().get(`/api/clients/${client.id}`).set(bearer(org.ot))).status).toBe(403);
    expect((await api().post('/api/clients').set(bearer(org.ot)).send(await clientBody({ name: 'X' }))).status).toBe(403);
  });

  it('requires authentication', async () => {
    expect((await api().get('/api/clients')).status).toBe(401);
  });
});

describe('GET /api/lookups — clients', () => {
  it('includes only active clients with their active sites', async () => {
    const { om, ot } = await createOrg();
    const zoom = await createClient(om);
    const yard = await api().post(`/api/clients/${zoom.id}/sites`).set(bearer(om)).send(await siteBody({ name: 'Yard', lat: 13, lng: 77.5 }));
    await api().patch(`/api/clients/${zoom.id}/sites/${zoom.sites[0]!.id}`).set(bearer(om)).send({ active: false }).expect(200);
    const gone = await createClient(om, { name: 'Gone Ltd', code: 'GONE' });
    await api().patch(`/api/clients/${gone.id}`).set(bearer(om)).send({ active: false }).expect(200);

    const res = await api().get('/api/lookups').set(bearer(ot));
    expect(res.status).toBe(200);
    expect(res.body.clients).toEqual([
      {
        id: zoom.id,
        name: 'Zoomcar',
        code: 'ZOOM',
        sites: [{ id: yard.body.id, name: 'Yard', locationId: yard.body.locationId, lat: 13, lng: 77.5 }],
      },
    ]);
  });
});
