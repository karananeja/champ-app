import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ROLES,
  canEditClients,
  canViewClients,
  clientCodeSchema,
  createClientSchema,
  geoReverseQuerySchema,
  geoSearchQuerySchema,
  listClientsQuerySchema,
  siteInputSchema,
  updateClientSchema,
  updateSiteSchema,
  type Role,
} from '../src';

const fieldErrors = (result: { error?: z.ZodError }) => (result.error ? z.flattenError(result.error).fieldErrors : {});

const site = {
  name: 'Bengaluru depot',
  address: '12 MG Road, Bengaluru',
  lat: 12.9716,
  lng: 77.5946,
  locationId: 'loc-blr',
};

const client = {
  name: 'Zoomcar',
  contactName: 'Priya',
  contactPhone: '+91 98765 43210',
  sites: [site],
};

describe('client permissions', () => {
  const expected: Record<Role, { view: boolean; edit: boolean }> = {
    SUPER_ADMIN: { view: true, edit: true },
    OM: { view: true, edit: true },
    OE: { view: true, edit: false },
    RO: { view: true, edit: false },
    OT: { view: false, edit: false },
  };

  it.each(ROLES)('%s', (role) => {
    expect(canViewClients({ role })).toBe(expected[role].view);
    expect(canEditClients({ role })).toBe(expected[role].edit);
  });
});

describe('clientCodeSchema', () => {
  it('trims and uppercases', () => {
    expect(clientCodeSchema.parse('  zoom-1 ')).toBe('ZOOM-1');
  });

  it.each(['Z', 'ABCDEFGHIJKLM', 'ZO OM', 'ZOOM!', 'zoom_1'])('rejects %j', (code) => {
    expect(clientCodeSchema.safeParse(code).success).toBe(false);
  });

  it.each(['ZO', 'ABCDEFGHIJKL', '123', 'A-1'])('accepts %j', (code) => {
    expect(clientCodeSchema.safeParse(code).success).toBe(true);
  });
});

describe('siteInputSchema', () => {
  it('accepts a valid site and normalises blanks', () => {
    const parsed = siteInputSchema.parse({ ...site, name: '  Main   yard ', contactName: '  ', contactPhone: '' });
    expect(parsed).toMatchObject({ name: 'Main yard', contactName: null, contactPhone: null });
  });

  it.each([
    [-90.0001, 0, 'lat'],
    [90.0001, 0, 'lat'],
    [0, -180.0001, 'lng'],
    [0, 180.0001, 'lng'],
  ])('rejects lat %d, lng %d', (lat, lng, field) => {
    const result = siteInputSchema.safeParse({ ...site, lat, lng });
    expect(Object.keys(fieldErrors(result))).toEqual([field]);
  });

  it('accepts the bounds', () => {
    expect(siteInputSchema.safeParse({ ...site, lat: -90, lng: 180 }).success).toBe(true);
    expect(siteInputSchema.safeParse({ ...site, lat: 90, lng: -180 }).success).toBe(true);
  });

  it('requires name, address, pin and city with friendly messages', () => {
    const result = siteInputSchema.safeParse({ name: '', address: ' ' });
    expect(fieldErrors(result)).toMatchObject({
      name: ['Site name is required'],
      address: ['Address is required'],
      lat: ['Place the pin on the map'],
      lng: ['Place the pin on the map'],
      locationId: ['Choose a city'],
    });
  });

  it('validates the site contact phone with the shared phone rule', () => {
    expect(fieldErrors(siteInputSchema.safeParse({ ...site, contactPhone: 'abc' }))).toEqual({
      contactPhone: ['Enter a valid phone number'],
    });
  });
});

describe('createClientSchema', () => {
  it('accepts a client with one site; code is uppercased and blanks become null', () => {
    const parsed = createClientSchema.parse({ ...client, code: ' zoom ', contactEmail: '', billingEmail: ' ', notes: '' });
    expect(parsed).toMatchObject({ name: 'Zoomcar', code: 'ZOOM', contactEmail: null, billingEmail: null, notes: null });
  });

  it('requires at least one site', () => {
    expect(fieldErrors(createClientSchema.safeParse({ ...client, sites: [] }))).toEqual({
      sites: ['Add at least one site'],
    });
    expect(fieldErrors(createClientSchema.safeParse({ ...client, sites: undefined }))).toEqual({
      sites: ['Add at least one site'],
    });
  });

  it('requires name, contact name and a valid contact phone; validates emails', () => {
    const result = createClientSchema.safeParse({
      ...client,
      name: ' ',
      contactName: '',
      contactPhone: '12',
      contactEmail: 'nope',
      billingEmail: 'also-nope',
    });
    expect(fieldErrors(result)).toEqual({
      name: ['Client name is required'],
      contactName: ['Contact name is required'],
      contactPhone: ['Enter a valid phone number'],
      contactEmail: ['Enter a valid email address'],
      billingEmail: ['Enter a valid email address'],
    });
  });

  it('rejects a bad code', () => {
    expect(fieldErrors(createClientSchema.safeParse({ ...client, code: 'Z' }))).toEqual({
      code: ['Code must be 2–12 letters, digits or dashes (e.g. ZOOM)'],
    });
  });
});

describe('update schemas', () => {
  it('a client update needs at least one field; null clears optional fields', () => {
    expect(updateClientSchema.safeParse({}).success).toBe(false);
    expect(updateClientSchema.parse({ code: null, notes: '' })).toEqual({ code: null, notes: null });
    expect(updateClientSchema.parse({ active: false })).toEqual({ active: false });
  });

  it('a site update needs at least one field and lat/lng together', () => {
    expect(updateSiteSchema.safeParse({}).success).toBe(false);
    expect(updateSiteSchema.safeParse({ lat: 12 }).success).toBe(false);
    expect(updateSiteSchema.parse({ lat: 12, lng: 77 })).toEqual({ lat: 12, lng: 77 });
    expect(updateSiteSchema.parse({ active: false })).toEqual({ active: false });
  });
});

describe('query schemas', () => {
  it('client list: defaults and the active filter', () => {
    expect(listClientsQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(listClientsQuerySchema.parse({ active: 'false', q: ' zoom ' })).toMatchObject({ active: false, q: 'zoom' });
  });

  it('geo search needs at least 3 characters', () => {
    expect(fieldErrors(geoSearchQuerySchema.safeParse({ q: ' ab ' }))).toEqual({ q: ['Type at least 3 characters'] });
    expect(geoSearchQuerySchema.parse({ q: ' MG Road ' })).toEqual({ q: 'MG Road' });
  });

  it('geo reverse coerces and bounds lat/lng', () => {
    expect(geoReverseQuerySchema.parse({ lat: '12.5', lng: '77.25' })).toEqual({ lat: 12.5, lng: 77.25 });
    expect(geoReverseQuerySchema.safeParse({ lat: '91', lng: '0' }).success).toBe(false);
    expect(geoReverseQuerySchema.safeParse({ lat: '0', lng: '-181' }).success).toBe(false);
    expect(geoReverseQuerySchema.safeParse({ lat: 'abc', lng: '0' }).success).toBe(false);
  });
});
