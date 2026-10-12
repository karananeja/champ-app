import { readFileSync } from 'node:fs';
import path from 'node:path';
import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';
import type { FitmentAction, Paginated, TaskDto, TaskListItemDto } from '@champ/shared';
import { prisma, type User } from '../src/lib/prisma';
import { bearer, createTaskWorld, testApi, fillSubmitReady } from './helpers';

// CR-04 / D-087: view=completed, Task.completedAt and its default sort.
const api = () => testApi();
const GPS = { lat: 12.97, lng: 77.59 };

async function world() {
  const w = await createTaskWorld();
  const createTask = async (overrides: Record<string, unknown> = {}) => {
    const res = await api()
      .post('/api/tasks')
      .set(bearer(w.om))
      .send(w.taskBody({ technicianId: w.techA.id, vehicles: { entry: 'COUNT', count: 1 }, ...overrides }));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body as TaskDto;
  };
  const step = async (actor: User, fid: string, action: FitmentAction, payload?: unknown) => {
    if (action === 'SUBMIT') await fillSubmitReady(fid);
    const res = await api().post(`/api/fitments/${fid}/transitions`).set(bearer(actor)).send({ action, payload });
    expect(res.status, `${action}: ${JSON.stringify(res.body)}`).toBe(200);
  };
  /** Start → submit → verify → final approve: the one-fitment task becomes Completed. */
  const complete = async (task: TaskDto) => {
    const fid = task.fitments[0]!.id;
    await step(w.techA, fid, 'START', GPS);
    await step(w.techA, fid, 'SUBMIT');
    await step(w.oe, fid, 'VERIFY', w.verification);
    await step(w.om, fid, 'APPROVE');
  };
  const list = async (actor: User, query: Record<string, string>) => {
    const res = await api().get('/api/tasks').query(query).set(bearer(actor));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return res.body as Paginated<TaskListItemDto>;
  };
  return { ...w, createTask, step, complete, list };
}

const omIds = (page: Paginated<TaskListItemDto>) => page.items.map((t) => t.omId);

describe('Completed tasks view (CR-04)', () => {
  it('lists only completed tasks, latest completion first, with completedAt; open leaves them out; all has both', async () => {
    const w = await world();
    const first = await w.createTask();
    const second = await w.createTask();
    const open = await w.createTask();
    await w.complete(first);
    await w.complete(second);

    const completed = await w.list(w.om, { view: 'completed' });
    expect(omIds(completed)).toEqual([second.omId, first.omId]);
    expect(completed.items.every((t) => t.status === 'COMPLETED' && t.completedAt)).toBe(true);
    expect(Date.parse(completed.items[0]!.completedAt!)).toBeGreaterThanOrEqual(Date.parse(completed.items[1]!.completedAt!));

    expect(omIds(await w.list(w.om, { view: 'completed', sort: 'completedAt:asc' }))).toEqual([first.omId, second.omId]);
    expect(omIds(await w.list(w.om, { view: 'open' }))).toEqual([open.omId]);
    expect((await w.list(w.om, { view: 'open' })).items[0]!.completedAt).toBeNull();

    // All tasks: everything; by completion the not-completed task comes last either way.
    expect((await w.list(w.om, { view: 'all' })).total).toBe(3);
    expect(omIds(await w.list(w.om, { view: 'all', sort: 'completedAt:desc' }))).toEqual([second.omId, first.omId, open.omId]);
    expect(omIds(await w.list(w.om, { view: 'all', sort: 'completedAt:asc' }))).toEqual([first.omId, second.omId, open.omId]);
    expect(omIds(await w.list(w.om, { view: 'all', status: 'COMPLETED' }))).toEqual([first.omId, second.omId]);

    // Filters and search work in the completed view.
    expect(omIds(await w.list(w.om, { view: 'completed', q: first.omId }))).toEqual([first.omId]);
    expect((await w.list(w.om, { view: 'completed', from: '2000-01-01', to: '2000-01-02' })).total).toBe(0);
    expect((await w.list(w.om, { view: 'completed', clientId: w.otherClient.id })).total).toBe(0);
  });

  it('every task viewer can read it; OT gets 403; a bad view is 400', async () => {
    const w = await world();
    await w.complete(await w.createTask());
    for (const actor of [w.sa, w.om, w.oe, w.ro]) expect((await w.list(actor, { view: 'completed' })).total, actor.role).toBe(1);
    expect((await api().get('/api/tasks').query({ view: 'completed' }).set(bearer(w.techA))).status).toBe(403);
    expect((await api().get('/api/tasks').query({ view: 'done' }).set(bearer(w.om))).status).toBe(400);
    expect((await api().get('/api/tasks').query({ sort: 'completedAt:sideways' }).set(bearer(w.om))).status).toBe(400);
  });

  it('Closed – not done completes the task; a reopen clears completedAt; completing again sets a new time', async () => {
    const w = await world();
    const task = await w.createTask();
    const fid = task.fitments[0]!.id;
    await w.step(w.techA, fid, 'START', GPS);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: task.id } })).completedAt).toBeNull();
    const reason = await prisma.lookupItem.create({
      data: { kind: 'CLOSE_REASON', name: 'Vehicle not available', nameKey: 'vehicle not available' },
    });
    await w.step(w.techA, fid, 'CLOSE_NOT_DONE', { closeReasonId: reason.id, comments: 'Vehicle was out' });
    const closed = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(closed.status).toBe('COMPLETED');
    expect(closed.completedAt).toBeInstanceOf(Date);
    const detail = (await api().get(`/api/tasks/${task.id}`).set(bearer(w.om))).body as TaskDto;
    expect(detail.completedAt).toBe(closed.completedAt!.toISOString());

    await w.step(w.oe, fid, 'REOPEN', { reason: 'Vehicle is back' });
    const reopened = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(reopened.status).toBe('IN_PROGRESS');
    expect(reopened.completedAt).toBeNull();
    expect((await w.list(w.om, { view: 'completed' })).total).toBe(0);

    await w.step(w.techA, fid, 'START', GPS);
    await w.step(w.techA, fid, 'SUBMIT');
    await w.step(w.oe, fid, 'VERIFY', w.verification);
    await w.step(w.om, fid, 'APPROVE');
    const again = await prisma.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(again.status).toBe('COMPLETED');
    expect(again.completedAt!.getTime()).toBeGreaterThan(closed.completedAt!.getTime());
  });

  it('export: view=completed downloads only completed tasks, with a Completed at (IST) column', async () => {
    const w = await world();
    const done = await w.createTask();
    await w.createTask();
    await w.complete(done);
    const res = await api().get('/api/tasks/export').query({ view: 'completed' }).set(bearer(w.ro));
    expect(res.status).toBe(200);
    const rows = Papa.parse<Record<string, string>>(res.text.replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: true }).data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ 'OM task ID': done.omId, Status: 'Completed' });
    expect(rows[0]!['Completed at (IST)']).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);

    const all = await api().get('/api/tasks/export').query({ view: 'all' }).set(bearer(w.om));
    const allRows = Papa.parse<Record<string, string>>(all.text.replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: true }).data;
    expect(allRows).toHaveLength(2);
    expect(allRows.find((r) => r['OM task ID'] !== done.omId)!['Completed at (IST)']).toBe('');
  });
});

describe('completedAt backfill migration (CR-04)', () => {
  it('sets completedAt of completed tasks from the latest final fitment event and leaves the others null', async () => {
    const w = await world();
    const done = await w.createTask();
    const open = await w.createTask();
    await w.complete(done);
    // Simulate rows from before the migration: no completedAt yet.
    await prisma.task.updateMany({ data: { completedAt: null } });

    const sql = readFileSync(
      path.resolve(import.meta.dirname, '../prisma/migrations/20261012200000_task_completed_at/migration.sql'),
      'utf8',
    );
    const backfill = sql.slice(sql.indexOf('UPDATE "Task"'));
    expect(backfill).toMatch(/^UPDATE "Task" t[\s\S]+WHERE t\."status" = 'COMPLETED';\s*$/);
    await prisma.$executeRawUnsafe(backfill);

    const approved = await prisma.taskEvent.findFirstOrThrow({
      where: { taskId: done.id, toStatus: 'OM_APPROVED' },
      orderBy: { createdAt: 'desc' },
    });
    expect((await prisma.task.findUniqueOrThrow({ where: { id: done.id } })).completedAt).toEqual(approved.createdAt);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: open.id } })).completedAt).toBeNull();
  });
});
