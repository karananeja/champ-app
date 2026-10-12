/**
 * Builds a small org for the F02 specs through the API (one SA login, so the login rate limit is not hit):
 * an OM, two OEs, one technician (OT) per OE, (F03) one client, (F04) a task OM/OE/RO plus one task per
 * viewport and (F05) a workflow OM/OE with two technicians and, per viewport, the tasks of the workflow spec
 * (one already OE-verified for bulk approve). Credentials go to e2e/.data/org.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, test as setup, type APIRequestContext } from '@playwright/test';
import type { AuthResponse, ClientDto, CreateInviteResponse, LookupsResponse, TaskDto } from '@champ/shared';
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

  // F03: a client with one site (created by the SA) for the read-only checks, and the location ids the
  // stubbed geocoder suggests.
  const pune = lookups.locations.find((l) => l.city === 'Pune')!;
  const client = `Acme Fleet ${run}`;
  const createdClient = await post<ClientDto>(
    request,
    '/api/clients',
    {
      name: client,
      contactName: 'Asha Rao',
      contactPhone: '+91 90000 22222',
      sites: [{ name: 'Whitefield depot', address: 'Whitefield, Bengaluru', lat: 12.9698, lng: 77.75, locationId: location.id }],
    },
    sa.accessToken,
  );

  // F04: a dedicated OM, OE and RO (keeps every account under the login rate limit), and one untouched task
  // per viewport for the delete / read-only spec.
  const taskOm = { email: `f04.om.${run}@intellicar.in`, name: `Tara Taskmanager ${run}`, password };
  const taskOmInvite = await post<CreateInviteResponse>(request, '/api/invites', { email: taskOm.email, role: 'OM' }, sa.accessToken);
  const taskOmSession = await accept(taskOmInvite.link, taskOm.name);
  const taskOe = { email: `f04.oe.${run}@intellicar.in`, name: `Uma Taskexec ${run}`, password };
  const taskOeInvite = await post<CreateInviteResponse>(request, '/api/invites', { email: taskOe.email, role: 'OE' }, taskOmSession.accessToken);
  const taskOeSession = await accept(taskOeInvite.link, taskOe.name);
  const ro = { email: `f04.ro.${run}@intellicar.in`, name: `Rhea Reader ${run}`, password };
  const roInvite = await post<CreateInviteResponse>(request, '/api/invites', { email: ro.email, role: 'RO' }, sa.accessToken);
  await accept(roInvite.link, ro.name);

  const byCode = (list: { id: string; code: string | null }[], code: string) => list.find((i) => i.code === code)!.id;
  const vehicle = byCode(lookups.assetTypes, 'VEHICLE');
  const taskBody = {
    clientId: createdClient.id,
    siteId: createdClient.sites[0]!.id,
    pocName: 'Asha Rao',
    pocPhone: '+91 90000 22222',
    oeId: taskOeSession.user.id,
    assetTypeId: vehicle,
    activityId: lookups.activities.find((a) => a.assetTypeId === vehicle)!.id,
    deviceTypeId: byCode(lookups.deviceTypes, 'LAF5'),
    makeModelId: lookups.makeModels[0]!.id,
    installationTypeId: lookups.installationTypes[0]!.id,
    requestedAt: '2026-11-02T04:30:00.000Z',
    fitmentAt: '2026-11-03T04:30:00.000Z',
    shiftTypeId: byCode(lookups.shiftTypes, 'DAY'),
    issueReportedId: lookups.issuesReported[0]!.id,
    vehicles: { entry: 'COUNT', count: 2 },
  };
  const tasks: Record<string, { id: string; omId: string }> = {};
  for (const project of ['desktop', 'mobile-360']) {
    const task = await post<TaskDto>(request, '/api/tasks', { ...taskBody, comments: `E2E ${project}` }, taskOmSession.accessToken);
    tasks[project] = { id: task.id, omId: task.omId };
  }

  // F05: a workflow OM and OE (their own accounts keep each login count low), two technicians of the OE, and
  // per viewport: a task for the full flow, one for reopen, one for faulty, and one with 2 fitments driven to
  // OE verified through the API (simulator as the OM, verify as the OE) for the bulk approve.
  const wfOm = { email: `f05.om.${run}@intellicar.in`, name: `Wanda Workflow OM ${run}`, password };
  const wfOmSession = await accept((await post<CreateInviteResponse>(request, '/api/invites', { email: wfOm.email, role: 'OM' }, sa.accessToken)).link, wfOm.name);
  const wfOe = { email: `f05.oe.${run}@intellicar.in`, name: `Vikram Workflow OE ${run}`, password };
  const wfOeSession = await accept(
    (await post<CreateInviteResponse>(request, '/api/invites', { email: wfOe.email, role: 'OE' }, wfOmSession.accessToken)).link,
    wfOe.name,
  );
  const wfTechs: { id: string; name: string }[] = [];
  for (const [i, name] of [`Kiran Fitter ${run}`, `Lata Fitter ${run}`].entries()) {
    const invite = await post<CreateInviteResponse>(
      request,
      '/api/technicians',
      { name, phone: '+91 90000 00009', email: `f05.ot.${i}.${run}@intellicar.in`, technicianType: 'PAYROLL', baseLocationId: location.id },
      wfOeSession.accessToken,
    );
    wfTechs.push({ id: (await accept(invite.link, name)).user.id, name });
  }
  const wfTask = (comments: string, count: number) =>
    post<TaskDto>(
      request,
      '/api/tasks',
      { ...taskBody, oeId: wfOeSession.user.id, technicianId: wfTechs[0]!.id, vehicles: { entry: 'COUNT', count }, comments },
      wfOmSession.accessToken,
    );
  const workflow: E2eOrg['workflow'] = {};
  for (const project of ['desktop', 'mobile-360']) {
    const [flow, reopen, faulty, bulk] = [
      await wfTask(`F05 flow ${project}`, 1),
      await wfTask(`F05 reopen ${project}`, 1),
      await wfTask(`F05 faulty ${project}`, 1),
      await wfTask(`F05 bulk ${project}`, 2),
    ];
    for (const f of bulk.fitments) {
      await post(request, `/api/dev/fitments/${f.id}/simulate`, { action: 'START' }, wfOmSession.accessToken);
      await post(request, `/api/dev/fitments/${f.id}/simulate`, { action: 'SUBMIT' }, wfOmSession.accessToken);
      await post(request, `/api/fitments/${f.id}/transitions`, { action: 'VERIFY' }, wfOeSession.accessToken);
    }
    const ref = (t: TaskDto) => ({ id: t.id, omId: t.omId, tkIds: t.fitments.map((f) => f.tkId) });
    workflow[project] = { flow: ref(flow), reopen: ref(reopen), faulty: ref(faulty), bulk: ref(bulk) };
  }

  // CR-03/CR-04: own OM, OE and RO accounts (each logs in a few times only) and, per viewport, one Completed task
  // (simulator as the OM, verify as the OE, final approve as the OM) and one Open task with a fitment date in
  // March 2027 (for the date-range filter).
  const crOm = { email: `cr.om.${run}@intellicar.in`, name: `Chitra CR OM ${run}`, password };
  const crOmSession = await accept((await post<CreateInviteResponse>(request, '/api/invites', { email: crOm.email, role: 'OM' }, sa.accessToken)).link, crOm.name);
  const crOe = { email: `cr.oe.${run}@intellicar.in`, name: `Dev CR OE ${run}`, password };
  const crOeSession = await accept(
    (await post<CreateInviteResponse>(request, '/api/invites', { email: crOe.email, role: 'OE' }, crOmSession.accessToken)).link,
    crOe.name,
  );
  const crRo = { email: `cr.ro.${run}@intellicar.in`, name: `Rhea CR RO ${run}`, password };
  await accept((await post<CreateInviteResponse>(request, '/api/invites', { email: crRo.email, role: 'RO' }, sa.accessToken)).link, crRo.name);
  const crTask = (comments: string, extra: Record<string, unknown> = {}) =>
    post<TaskDto>(
      request,
      '/api/tasks',
      { ...taskBody, oeId: crOeSession.user.id, technicianId: wfTechs[0]!.id, vehicles: { entry: 'COUNT', count: 1 }, comments, ...extra },
      crOmSession.accessToken,
    );
  const crTasks: E2eOrg['cr']['tasks'] = {};
  for (const project of ['desktop', 'mobile-360']) {
    const completed = await crTask(`CR-04 completed ${project}`);
    const fid = completed.fitments[0]!.id;
    await post(request, `/api/dev/fitments/${fid}/simulate`, { action: 'START' }, crOmSession.accessToken);
    await post(request, `/api/dev/fitments/${fid}/simulate`, { action: 'SUBMIT' }, crOmSession.accessToken);
    await post(request, `/api/fitments/${fid}/transitions`, { action: 'VERIFY' }, crOeSession.accessToken);
    await post(request, `/api/fitments/${fid}/transitions`, { action: 'APPROVE' }, crOmSession.accessToken);
    const march = await crTask(`CR-04 march ${project}`, { requestedAt: '2027-03-14T04:30:00.000Z', fitmentAt: '2027-03-15T04:30:00.000Z' });
    crTasks[project] = { completed: completed.omId, march: march.omId };
  }

  const org: E2eOrg = {
    om,
    oeA: oes[0]!,
    oeB: oes[1]!,
    techA: technicians[0]!,
    techB: technicians[1]!,
    client,
    locations: { bengaluru: location.id, pune: pune.id },
    taskOm,
    taskOe,
    ro,
    tasks,
    wfOm,
    wfOe,
    wfTechs: wfTechs.map((t) => t.name),
    workflow,
    cr: { om: crOm, oe: crOe, ro: crRo, tasks: crTasks },
  };
  fs.mkdirSync(path.dirname(ORG_FILE), { recursive: true });
  fs.writeFileSync(ORG_FILE, JSON.stringify(org, null, 2));
});
