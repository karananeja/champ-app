import { describe, expect, it } from 'vitest';
import type { DashboardSummaryDto, FitmentAction, Paginated, TaskDto } from '@champ/shared';
import { prisma, type User } from '../src/lib/prisma';
import { bearer, createTaskWorld, createUser, testApi } from './helpers';

// CR-03: GET /tasks/summary, the role-aware dashboard counts. Each count must equal its list's total.
const api = () => testApi();
const GPS = { lat: 12.97, lng: 77.59 };

async function world() {
  const w = await createTaskWorld();
  const otherOe = await createUser({ role: 'OE', managerId: w.om.id, name: 'Other OE' });
  const createTask = async (overrides: Record<string, unknown> = {}) => {
    const res = await api()
      .post('/api/tasks')
      .set(bearer(w.om))
      .send(w.taskBody({ technicianId: w.techA.id, vehicles: { entry: 'COUNT', count: 2 }, ...overrides }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as TaskDto;
  };
  const step = async (actor: User, fid: string, action: FitmentAction, payload?: unknown) => {
    const res = await api().post(`/api/fitments/${fid}/transitions`).set(bearer(actor)).send({ action, payload });
    expect(res.status, `${action}: ${JSON.stringify(res.body)}`).toBe(200);
  };
  const summary = async (actor: User) => {
    const res = await api().get('/api/tasks/summary').set(bearer(actor));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as DashboardSummaryDto;
  };
  const total = async (actor: User, url: string, query: Record<string, string> = {}) => {
    const res = await api().get(url).query(query).set(bearer(actor));
    expect(res.status, `${url}: ${JSON.stringify(res.body)}`).toBe(200);
    return (res.body as Paginated<unknown>).total;
  };
  return { ...w, otherOe, createTask, step, summary, total };
}

describe('GET /tasks/summary (CR-03 dashboard)', () => {
  it('gives each role its counts, each equal to the total of the list its card links to', async () => {
    const w = await world();
    // Mine (OE = w.oe): fitment 1 submitted, fitment 2 OE verified -> awaiting approval.
    const mine = await w.createTask();
    const [m1, m2] = mine.fitments.map((f) => f.id) as [string, string];
    for (const fid of [m1, m2]) {
      await w.step(w.techA, fid, 'START', GPS);
      await w.step(w.techA, fid, 'SUBMIT');
    }
    await w.step(w.oe, m2, 'VERIFY', w.verification);
    // Theirs (OE = otherOe): one fitment reopened, one moved to FT.
    const theirs = await w.createTask({ oeId: w.otherOe.id });
    const [t1, t2] = theirs.fitments.map((f) => f.id) as [string, string];
    await w.step(w.techA, t1, 'START', GPS);
    await w.step(w.techA, t1, 'SUBMIT');
    await w.step(w.otherOe, t1, 'REOPEN', { reason: 'Photos missing' });
    await w.step(w.techA, t2, 'START', GPS);
    await w.step(w.techA, t2, 'MARK_FAULTY', { reason: 'Dead device' });
    // A completed one-fitment task (OE = w.oe) and a deleted task that must not count.
    const done = await w.createTask({ vehicles: { entry: 'COUNT', count: 1 } });
    const d1 = done.fitments[0]!.id;
    await w.step(w.techA, d1, 'START', GPS);
    await w.step(w.techA, d1, 'SUBMIT');
    await w.step(w.oe, d1, 'VERIFY', w.verification);
    await w.step(w.om, d1, 'APPROVE');
    const gone = await w.createTask();
    expect((await api().delete(`/api/tasks/${gone.id}`).set(bearer(w.om))).status).toBe(204);

    for (const manager of [w.sa, w.om]) {
      const s = await w.summary(manager);
      expect(s, manager.role).toEqual({ openTasks: 2, completedTasks: 1, awaitingApproval: 1, reopened: 1, faulty: 1 });
      expect(s.openTasks).toBe(await w.total(manager, '/api/tasks', { view: 'open' }));
      expect(s.completedTasks).toBe(await w.total(manager, '/api/tasks', { view: 'completed' }));
      expect(s.awaitingApproval).toBe(await w.total(manager, '/api/fitments/awaiting-approval'));
      expect(s.reopened).toBe(await w.total(manager, '/api/fitments/reopened'));
      expect(s.faulty).toBe(await w.total(manager, '/api/fitments/faulty'));
    }

    // OE: own tasks for the Assigned view and the fitment lists; one fitment waits for their verification.
    const oe = await w.summary(w.oe);
    expect(oe).toEqual({ openTasks: 2, completedTasks: 1, reopened: 0, faulty: 0, assignedToMe: 2, awaitingMyVerification: 1 });
    expect(oe.assignedToMe).toBe(await w.total(w.oe, '/api/tasks', { view: 'assigned' }));
    expect(oe.reopened).toBe(await w.total(w.oe, '/api/fitments/reopened'));
    const other = await w.summary(w.otherOe);
    expect(other).toMatchObject({ reopened: 1, faulty: 1, assignedToMe: 1, awaitingMyVerification: 0 });

    // RO: open and completed only.
    expect(await w.summary(w.ro)).toEqual({ openTasks: 2, completedTasks: 1 });
  });

  it('OT gets 403; without a token 401', async () => {
    const w = await world();
    expect((await api().get('/api/tasks/summary').set(bearer(w.techA))).status).toBe(403);
    expect((await api().get('/api/tasks/summary')).status).toBe(401);
  });

  it('an empty system gives zeros', async () => {
    const w = await world();
    expect(await prisma.task.count()).toBe(0);
    expect(await w.summary(w.om)).toEqual({ openTasks: 0, completedTasks: 0, awaitingApproval: 0, reopened: 0, faulty: 0 });
  });
});
