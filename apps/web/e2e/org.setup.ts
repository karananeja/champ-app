/**
 * Builds a small org for the F02 specs through the API (one SA login, so the login rate limit is not hit):
 * an OM, two OEs, and one technician (OT) per OE. Credentials go to e2e/.data/org.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, test as setup, type APIRequestContext } from '@playwright/test';
import type { AuthResponse, CreateInviteResponse, LookupsResponse } from '@champ/shared';
import { ADMIN_EMAIL, ADMIN_PASSWORD, ORG_FILE, type E2eOrg } from './helpers';

async function post<T>(request: APIRequestContext, url: string, data: unknown, token?: string): Promise<T> {
  const res = await request.post(url, { data, headers: token ? { Authorization: `Bearer ${token}` } : {} });
  expect(res.ok(), `${url}: ${res.status()} ${await res.text()}`).toBeTruthy();
  return (await res.json()) as T;
}

const tokenOf = (link: string) => new URL(link).searchParams.get('token')!;

setup('create the F02 test org', async ({ request }) => {
  const run = Date.now();
  const password = 'Passw0rd1';
  const accept = (link: string, name: string) =>
    post<AuthResponse>(request, '/api/invites/accept', {
      token: tokenOf(link),
      name,
      phone: '+91 98765 43210',
      password,
    });

  const sa = await post<AuthResponse>(request, '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const om = { email: `f02.om.${run}@intellicar.in`, name: `Maya Manager ${run}`, password };
  const omInvite = await post<CreateInviteResponse>(request, '/api/invites', { email: om.email, role: 'OM' }, sa.accessToken);
  const omSession = await accept(omInvite.link, om.name);

  const oes = [
    { email: `f02.oe.a.${run}@intellicar.in`, name: `Esha Exec A ${run}`, password },
    { email: `f02.oe.b.${run}@intellicar.in`, name: `Farah Exec B ${run}`, password },
  ];
  const oeSessions: AuthResponse[] = [];
  for (const oe of oes) {
    const invite = await post<CreateInviteResponse>(request, '/api/invites', { email: oe.email, role: 'OE' }, omSession.accessToken);
    oeSessions.push(await accept(invite.link, oe.name));
  }

  const lookupsRes = await request.get('/api/lookups', { headers: { Authorization: `Bearer ${sa.accessToken}` } });
  const lookups = (await lookupsRes.json()) as LookupsResponse;
  const location = lookups.locations.find((l) => l.city === 'Bengaluru')!;

  const technicians = [`Arjun Tech A ${run}`, `Bhavna Tech B ${run}`];
  for (const [i, name] of technicians.entries()) {
    const invite = await post<CreateInviteResponse>(
      request,
      '/api/technicians',
      {
        name,
        phone: '+91 90000 00001',
        email: `f02.ot.${i}.${run}@intellicar.in`,
        technicianType: 'PAYROLL',
        baseLocationId: location.id,
      },
      oeSessions[i]!.accessToken,
    );
    await accept(invite.link, name);
  }

  const org: E2eOrg = { om, oeA: oes[0]!, oeB: oes[1]!, techA: technicians[0]!, techB: technicians[1]! };
  fs.mkdirSync(path.dirname(ORG_FILE), { recursive: true });
  fs.writeFileSync(ORG_FILE, JSON.stringify(org, null, 2));
});
