/**
 * Builds a small org for the F02 specs through the API (one SA login, so the login rate limit is not hit):
 * an OM, two OEs, one technician (OT) per OE, (F03) one client, (F04) a task OM/OE/RO plus one task per
 * viewport and (F05) a workflow OM/OE with two technicians and, per viewport, the tasks of the workflow spec
 * (one already OE-verified for bulk approve), CR-03/04 accounts and tasks, and (F06) a verification OM/OE with
 * one task per viewport, (F07) board OMs and tasks, (F08) travel OM/OE/technician per viewport and an RO, and (F10) an OM/OE and a task per viewport. Credentials go to e2e/.data/org.json.
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
  // F06: VERIFY needs the required verification fields (D-098); a billable final issue.
  const verification = {
    issueObservedId: lookups.issuesObserved[0]!.id,
    actionTakenId: lookups.actionsTaken[0]!.id,
    finalIssueId: lookups.finalIssues.find((f) => f.billable)!.id,
  };
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
      await post(request, `/api/fitments/${f.id}/transitions`, { action: 'VERIFY', payload: verification }, wfOeSession.accessToken);
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
    await post(request, `/api/fitments/${fid}/transitions`, { action: 'VERIFY', payload: verification }, crOeSession.accessToken);
    await post(request, `/api/fitments/${fid}/transitions`, { action: 'APPROVE' }, crOmSession.accessToken);
    const march = await crTask(`CR-04 march ${project}`, { requestedAt: '2027-03-14T04:30:00.000Z', fitmentAt: '2027-03-15T04:30:00.000Z' });
    crTasks[project] = { completed: completed.omId, march: march.omId };
  }

  // F06: own OM and OE accounts, and per viewport one task with a fitment for technician wfTechs[0].
  const f06Om = { email: `f06.om.${run}@intellicar.in`, name: `Gita Verify OM ${run}`, password };
  const f06OmSession = await accept((await post<CreateInviteResponse>(request, '/api/invites', { email: f06Om.email, role: 'OM' }, sa.accessToken)).link, f06Om.name);
  const f06Oe = { email: `f06.oe.${run}@intellicar.in`, name: `Hari Verify OE ${run}`, password };
  const f06OeSession = await accept(
    (await post<CreateInviteResponse>(request, '/api/invites', { email: f06Oe.email, role: 'OE' }, f06OmSession.accessToken)).link,
    f06Oe.name,
  );
  const f06Tasks: E2eOrg['f06']['tasks'] = {};
  for (const project of ['desktop', 'mobile-360']) {
    const task = await post<TaskDto>(
      request,
      '/api/tasks',
      { ...taskBody, oeId: f06OeSession.user.id, technicianId: wfTechs[0]!.id, vehicles: { entry: 'COUNT', count: 1 }, comments: `F06 ${project}` },
      f06OmSession.accessToken,
    );
    f06Tasks[project] = { id: task.id, omId: task.omId, tkIds: task.fitments.map((f) => f.tkId) };
  }

  // F07: one board OM per viewport (each logs in a handful of times), an OE for the 403 check and as the tasks'
  // OE, and per viewport one task per board scenario (filtered on the board by its OM id): Open fitments to
  // assign (by drag and by keyboard), two OE-verified fitments to approve together, a Submitted one to reopen,
  // an Assigned one for the refused drop and one the simulator starts while the board is open.
  const f07Oms: E2eOrg['f07']['oms'] = {};
  const f07OmTokens: Record<string, string> = {};
  for (const project of ['desktop', 'mobile-360']) {
    const account = { email: `f07.om.${project}.${run}@intellicar.in`, name: `Kanban OM ${project} ${run}`, password };
    const session = await accept((await post<CreateInviteResponse>(request, '/api/invites', { email: account.email, role: 'OM' }, sa.accessToken)).link, account.name);
    f07Oms[project] = account;
    f07OmTokens[project] = session.accessToken;
  }
  const f07Oe = { email: `f07.oe.${run}@intellicar.in`, name: `Kanban OE ${run}`, password };
  const f07OeSession = await accept(
    (await post<CreateInviteResponse>(request, '/api/invites', { email: f07Oe.email, role: 'OE' }, f07OmTokens.desktop!)).link,
    f07Oe.name,
  );
  const f07Tasks: E2eOrg['f07']['tasks'] = {};
  for (const project of ['desktop', 'mobile-360']) {
    const omToken = f07OmTokens[project]!;
    const boardTask = async (comments: string, count: number, technician: boolean) => {
      const task = await post<TaskDto>(
        request,
        '/api/tasks',
        {
          ...taskBody,
          oeId: f07OeSession.user.id,
          technicianId: technician ? wfTechs[0]!.id : undefined,
          vehicles: { entry: 'COUNT', count },
          comments: `F07 ${comments} ${project}`,
        },
        omToken,
      );
      return { id: task.id, omId: task.omId, tkIds: task.fitments.map((f) => f.tkId), fitmentIds: task.fitments.map((f) => f.id) };
    };
    const simulateAs = (fid: string, action: string) => post(request, `/api/dev/fitments/${fid}/simulate`, { action }, omToken);
    const assign = await boardTask('assign', 1, false);
    const keyboard = await boardTask('keyboard', 1, false);
    const approve = await boardTask('approve', 2, true);
    for (const fid of approve.fitmentIds) {
      await simulateAs(fid, 'START');
      await simulateAs(fid, 'SUBMIT');
      await post(request, `/api/fitments/${fid}/transitions`, { action: 'VERIFY', payload: verification }, f07OeSession.accessToken);
    }
    const reopen = await boardTask('reopen', 1, true);
    await simulateAs(reopen.fitmentIds[0]!, 'START');
    await simulateAs(reopen.fitmentIds[0]!, 'SUBMIT');
    const forbidden = await boardTask('forbidden', 1, true);
    const refetch = await boardTask('refetch', 1, true);
    f07Tasks[project] = { assign, keyboard, approve, reopen, forbidden, refetch };
  }

  // F08: per viewport a travel OM, an OE reporting to them and one technician of that OE (so the raise dialog
  // presets the technician), and one RO for the read-only check.
  const f08: E2eOrg['f08'] = { projects: {}, ro: { email: `f08.ro.${run}@intellicar.in`, name: `Rita Travel RO ${run}`, password } };
  await accept((await post<CreateInviteResponse>(request, '/api/invites', { email: f08.ro.email, role: 'RO' }, sa.accessToken)).link, f08.ro.name);
  for (const project of ['desktop', 'mobile-360']) {
    const tom = { email: `f08.om.${project}.${run}@intellicar.in`, name: `Travel OM ${project} ${run}`, password };
    const tomSession = await accept((await post<CreateInviteResponse>(request, '/api/invites', { email: tom.email, role: 'OM' }, sa.accessToken)).link, tom.name);
    const toe = { email: `f08.oe.${project}.${run}@intellicar.in`, name: `Travel OE ${project} ${run}`, password };
    const toeSession = await accept((await post<CreateInviteResponse>(request, '/api/invites', { email: toe.email, role: 'OE' }, tomSession.accessToken)).link, toe.name);
    const technician = `Tara Traveller ${project} ${run}`;
    const invite = await post<CreateInviteResponse>(
      request,
      '/api/technicians',
      { name: technician, phone: '+91 90000 00008', email: `f08.ot.${project}.${run}@intellicar.in`, technicianType: 'PAYROLL', baseLocationId: location.id },
      toeSession.accessToken,
    );
    await accept(invite.link, technician);
    f08.projects[project] = { om: tom, oe: toe, technician };
  }

  // F10 (D-158): per viewport an OM and an OE reporting to them, and one task of that OE with two Open fitments
  // (one the OE assigns to themselves, the other the OM assigns to the OE).
  const f10: E2eOrg['f10'] = {};
  for (const project of ['desktop', 'mobile-360']) {
    const fom = { email: `f10.om.${project}.${run}@intellicar.in`, name: `Route OM ${project} ${run}`, password };
    const fomSession = await accept((await post<CreateInviteResponse>(request, '/api/invites', { email: fom.email, role: 'OM' }, sa.accessToken)).link, fom.name);
    const foe = { email: `f10.oe.${project}.${run}@intellicar.in`, name: `Route OE ${project} ${run}`, password };
    const foeSession = await accept((await post<CreateInviteResponse>(request, '/api/invites', { email: foe.email, role: 'OE' }, fomSession.accessToken)).link, foe.name);
    const task = await post<TaskDto>(
      request,
      '/api/tasks',
      { ...taskBody, oeId: foeSession.user.id, technicianId: null, vehicles: { entry: 'COUNT', count: 2 }, comments: `F10 ${project}` },
      fomSession.accessToken,
    );
    f10[project] = { om: fom, oe: foe, task: { id: task.id, omId: task.omId, tkIds: task.fitments.map((f) => f.tkId) } };
  }

  // F13: per viewport an OM, an OE reporting to them, the OE's technician and one Open fitment of that OE.
  const f13: E2eOrg['f13'] = {};
  for (const project of ['desktop', 'mobile-360']) {
    const nom = { email: `f13.om.${project}.${run}@intellicar.in`, name: `Bell OM ${project} ${run}`, password };
    const nomSession = await accept((await post<CreateInviteResponse>(request, '/api/invites', { email: nom.email, role: 'OM' }, sa.accessToken)).link, nom.name);
    const noe = { email: `f13.oe.${project}.${run}@intellicar.in`, name: `Bell OE ${project} ${run}`, password };
    const noeSession = await accept((await post<CreateInviteResponse>(request, '/api/invites', { email: noe.email, role: 'OE' }, nomSession.accessToken)).link, noe.name);
    const technician = `Nina Notify ${project} ${run}`;
    const invite = await post<CreateInviteResponse>(
      request,
      '/api/technicians',
      { name: technician, phone: '+91 90000 00013', email: `f13.ot.${project}.${run}@intellicar.in`, technicianType: 'PAYROLL', baseLocationId: location.id },
      noeSession.accessToken,
    );
    await accept(invite.link, technician);
    const task = await post<TaskDto>(
      request,
      '/api/tasks',
      { ...taskBody, oeId: noeSession.user.id, technicianId: null, vehicles: { entry: 'COUNT', count: 1 }, comments: `F13 ${project}` },
      nomSession.accessToken,
    );
    f13[project] = { om: nom, oe: noe, technician, task: { id: task.id, omId: task.omId, tkIds: task.fitments.map((f) => f.tkId) } };
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
    f06: { om: f06Om, oe: f06Oe, tasks: f06Tasks },
    f07: { oms: f07Oms, oe: f07Oe, tasks: f07Tasks },
    f08,
    f10,
    f13,
  };
  fs.mkdirSync(path.dirname(ORG_FILE), { recursive: true });
  fs.writeFileSync(ORG_FILE, JSON.stringify(org, null, 2));
});
