import {
  SEARCH_MIN_CHARS,
  SEARCH_TEXT_IDENTIFIERS,
  formatOeId,
  formatOmId,
  formatTkId,
  formatTtId,
  normalizeIdentifier,
  parseSearchId,
  type FitmentStatus,
  type GlobalSearchQuery,
  type GlobalSearchResponse,
  type SearchHit,
  type SearchIdentifier,
  type SearchMatch,
  type SearchTaskHit,
  type TaskStatus,
} from '@champ/shared';
import { Prisma } from '../../generated/prisma/client';
import { prisma, type User } from '../../lib/prisma';
import { travelScopeWhere } from '../travel/filters';
import { getSearchIdentifiers } from './settings';

/** The Fitment column behind each text identifier (fixed; never user input). */
const TEXT_COLUMNS: Partial<Record<SearchIdentifier, string>> = {
  DEVICE_ID: 'deviceId',
  SECONDARY_DEVICE_ID: 'secondaryDeviceId',
  OLD_DEVICE_ID: 'oldDeviceId',
  CHASSIS_NO: 'chassisNo',
  ASSET_NO: 'assetNumber',
  VEHICLE_REG_NO: 'vehicleRegNo',
};

/** The normalized form of a column, written exactly as the migration's trigram indexes so they are used. */
const normalized = (column: string) => Prisma.raw(`regexp_replace(lower(f."${column}"), '[\\s-]', '', 'g')`);

/** `\`, `%` and `_` in the query are literal (LIKE's default escape character is `\`). */
const likeEscape = (text: string) => text.replace(/[\\%_]/g, '\\$&');

/** Ranking key: exact id first, then the identifier's sortOrder, then exact equality before contains. */
type RankKey = [number, number, number];
const compareKeys = (a: RankKey, b: RankKey) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
const minKey = (keys: RankKey[]): RankKey => keys.reduce((best, k) => (compareKeys(k, best) < 0 ? k : best));

interface RankedMatch extends SearchMatch {
  key: RankKey;
}

/** A unit the limit counts: a fitment row, a task matched only on its own ids, or a travel task. */
interface Unit {
  kind: 'FITMENT' | 'TASK' | 'TRAVEL';
  id: string;
  taskId?: string;
  matches: RankedMatch[];
  createdAt: Date;
}

interface ContainsRow {
  fitmentId: string;
  taskId: string;
  createdAt: Date;
  matches: { identifier: SearchIdentifier; value: string; exact: boolean }[];
  total: number;
}

/**
 * "Contains" on the enabled text identifiers (D-245), one query: every match row, grouped per fitment, with the
 * fitment count before any cut. Returns the best `limit` fitments plus every fitment in `forcedTaskIds` or
 * `forcedFitmentIds` (exact id hits rank above everything, so their fitments must be complete).
 */
async function containsSearch(
  norm: string,
  identifiers: { identifier: SearchIdentifier; sortOrder: number }[],
  limit: number,
  forcedTaskIds: string[],
  forcedFitmentIds: string[],
): Promise<ContainsRow[]> {
  const pattern = `%${likeEscape(norm)}%`;
  const branches = identifiers.map(({ identifier, sortOrder }) => {
    const column = TEXT_COLUMNS[identifier]!;
    return Prisma.sql`
      SELECT f.id AS "fitmentId", f."taskId", t."createdAt", ${identifier}::text AS identifier,
        f.${Prisma.raw(`"${column}"`)} AS value, (${normalized(column)} = ${norm}) AS exact,
        ${sortOrder * 2}::int + CASE WHEN ${normalized(column)} = ${norm} THEN 0 ELSE 1 END AS rank
      FROM "Fitment" f JOIN "Task" t ON t.id = f."taskId"
      WHERE t."deletedAt" IS NULL AND ${normalized(column)} LIKE ${pattern}`;
  });
  return prisma.$queryRaw<ContainsRow[]>`
    WITH m AS (${Prisma.join(branches, ' UNION ALL ')}),
    g AS (
      SELECT "fitmentId", "taskId", max("createdAt") AS "createdAt", min(rank) AS best,
        json_agg(json_build_object('identifier', identifier, 'value', value, 'exact', exact) ORDER BY rank) AS matches
      FROM m GROUP BY "fitmentId", "taskId"
    ),
    r AS (
      SELECT g.*, (count(*) OVER ())::int AS total,
        row_number() OVER (ORDER BY best, "createdAt" DESC, "fitmentId") AS rn
      FROM g
    )
    SELECT "fitmentId", "taskId", "createdAt", matches, total FROM r
    WHERE rn <= ${limit}
      OR "taskId" = ANY(${forcedTaskIds}::text[]) OR "fitmentId" = ANY(${forcedFitmentIds}::text[])`;
}

/**
 * `GET /search` (spec §3): exact OM/OE/TK/TT ids and "contains" on the text identifiers, only those the SA
 * switched on. Fitments are grouped under their task; deleted tasks never show; travel tasks follow the travel
 * list scope.
 */
export async function globalSearch(actor: User, query: GlobalSearchQuery): Promise<GlobalSearchResponse> {
  const { q, limit } = query;
  const settings = (await getSearchIdentifiers()).filter((s) => s.enabled);
  const order = new Map(settings.map((s) => [s.identifier, s.sortOrder]));
  const on = (identifier: SearchIdentifier) => order.has(identifier);
  const idKey = (identifier: SearchIdentifier): RankKey => [0, order.get(identifier)!, 0];

  const taskMatches = new Map<string, { matches: RankedMatch[]; createdAt: Date }>();
  const fitments = new Map<string, Unit>();
  const travel: Unit[] = [];

  // Exact ids (bare number → OM, OE and TK; TT only with its prefix).
  const id = parseSearchId(q);
  if (id) {
    const n = id.number;
    const wants = (prefix: 'OM' | 'OE' | 'TK' | 'TT', identifier: SearchIdentifier) =>
      on(identifier) && (id.prefix === prefix || (!id.prefix && prefix !== 'TT'));
    const [byOm, byOe, byTk, byTt] = await Promise.all([
      wants('OM', 'OM_ID') ? prisma.task.findFirst({ where: { omNo: n, deletedAt: null }, select: { id: true, createdAt: true } }) : null,
      wants('OE', 'OE_TASK_ID') ? prisma.task.findFirst({ where: { oeNo: n, deletedAt: null }, select: { id: true, createdAt: true } }) : null,
      wants('TK', 'TK_ID')
        ? prisma.fitment.findFirst({
            where: { tkNo: n, task: { deletedAt: null } },
            select: { id: true, taskId: true, task: { select: { createdAt: true } } },
          })
        : null,
      wants('TT', 'TT_ID')
        ? prisma.travelTask.findFirst({ where: { AND: [{ ttNo: n }, travelScopeWhere(actor)] }, select: { id: true, createdAt: true } })
        : null,
    ]);
    const addTask = (task: { id: string; createdAt: Date }, identifier: SearchIdentifier, value: string) => {
      const entry = taskMatches.get(task.id) ?? { matches: [], createdAt: task.createdAt };
      entry.matches.push({ identifier, value, key: idKey(identifier) });
      taskMatches.set(task.id, entry);
    };
    if (byOm) addTask(byOm, 'OM_ID', formatOmId(n));
    if (byOe) addTask(byOe, 'OE_TASK_ID', formatOeId(n));
    if (byTk) {
      fitments.set(byTk.id, {
        kind: 'FITMENT',
        id: byTk.id,
        taskId: byTk.taskId,
        createdAt: byTk.task.createdAt,
        matches: [{ identifier: 'TK_ID', value: formatTkId(n), key: idKey('TK_ID') }],
      });
    }
    if (byTt) travel.push({ kind: 'TRAVEL', id: byTt.id, createdAt: byTt.createdAt, matches: [{ identifier: 'TT_ID', value: formatTtId(n), key: idKey('TT_ID') }] });
  }

  // "Contains" on the text identifiers (a query can be both an id and a substring, e.g. `112`).
  const norm = normalizeIdentifier(q);
  const textIds = settings.filter((s) => SEARCH_TEXT_IDENTIFIERS.includes(s.identifier));
  let containsTotal = 0;
  const tkOnly = new Set(fitments.keys());
  if (norm.length >= SEARCH_MIN_CHARS && textIds.length > 0) {
    const rows = await containsSearch(norm, textIds, limit, [...taskMatches.keys()], [...fitments.keys()]);
    containsTotal = rows[0]?.total ?? 0;
    for (const row of rows) {
      tkOnly.delete(row.fitmentId);
      const unit = fitments.get(row.fitmentId) ?? { kind: 'FITMENT', id: row.fitmentId, taskId: row.taskId, createdAt: new Date(row.createdAt), matches: [] };
      for (const m of row.matches) {
        unit.matches.push({ identifier: m.identifier, value: m.value, key: [1, order.get(m.identifier)!, m.exact ? 0 : 1] });
      }
      fitments.set(row.fitmentId, unit);
    }
  }

  // Units: fitments (a task's own exact id lifts its fitments), tasks matched only on their ids, travel tasks.
  const fitmentTasks = new Set([...fitments.values()].map((f) => f.taskId!));
  const taskOnly: Unit[] = [...taskMatches]
    .filter(([taskId]) => !fitmentTasks.has(taskId))
    .map(([taskId, t]) => ({ kind: 'TASK', id: taskId, taskId, matches: t.matches, createdAt: t.createdAt }));
  const keyOf = (unit: Unit): RankKey =>
    minKey([...unit.matches, ...(unit.taskId ? (taskMatches.get(unit.taskId)?.matches ?? []) : [])].map((m) => m.key));
  const units = [...fitments.values(), ...taskOnly, ...travel]
    .map((unit) => ({ unit, key: keyOf(unit) }))
    .sort((a, b) => compareKeys(a.key, b.key) || b.unit.createdAt.getTime() - a.unit.createdAt.getTime() || a.unit.id.localeCompare(b.unit.id))
    .map((u) => u.unit);
  const total = containsTotal + tkOnly.size + taskOnly.length + travel.length;
  const shown = units.slice(0, limit);

  // Display fields, one query per kind.
  const taskIds = [...new Set(shown.flatMap((u) => (u.taskId ? [u.taskId] : [])))];
  const fitmentIds = shown.filter((u) => u.kind === 'FITMENT').map((u) => u.id);
  const travelIds = shown.filter((u) => u.kind === 'TRAVEL').map((u) => u.id);
  const [taskRows, fitmentRows, travelRows] = await Promise.all([
    taskIds.length
      ? prisma.task.findMany({
          where: { id: { in: taskIds } },
          select: { id: true, omNo: true, oeNo: true, status: true, client: { select: { name: true } }, site: { select: { name: true } } },
        })
      : [],
    fitmentIds.length
      ? prisma.fitment.findMany({ where: { id: { in: fitmentIds } }, select: { id: true, tkNo: true, status: true, vehicleRegNo: true } })
      : [],
    travelIds.length
      ? prisma.travelTask.findMany({ where: { id: { in: travelIds } }, select: { id: true, ttNo: true, status: true, technician: { select: { name: true } } } })
      : [],
  ]);
  const taskById = new Map(taskRows.map((t) => [t.id, t]));
  const fitmentById = new Map(fitmentRows.map((f) => [f.id, f]));
  const travelById = new Map(travelRows.map((t) => [t.id, t]));
  const strip = (matches: RankedMatch[]): SearchMatch[] =>
    [...matches].sort((a, b) => compareKeys(a.key, b.key)).map(({ identifier, value }) => ({ identifier, value }));

  const hits: SearchHit[] = [];
  const taskHits = new Map<string, SearchTaskHit>();
  for (const unit of shown) {
    if (unit.kind === 'TRAVEL') {
      const tt = travelById.get(unit.id)!;
      hits.push({ kind: 'TRAVEL', travelTaskId: tt.id, ttId: formatTtId(tt.ttNo), technician: tt.technician.name, status: tt.status, matches: strip(unit.matches) });
      continue;
    }
    let hit = taskHits.get(unit.taskId!);
    if (!hit) {
      const task = taskById.get(unit.taskId!)!;
      hit = {
        kind: 'TASK',
        taskId: task.id,
        omId: formatOmId(task.omNo),
        oeTaskId: formatOeId(task.oeNo),
        customer: task.client.name,
        site: task.site.name,
        status: task.status as TaskStatus,
        matches: strip(taskMatches.get(task.id)?.matches ?? []),
        fitments: [],
      };
      taskHits.set(task.id, hit);
      hits.push(hit);
    }
    if (unit.kind === 'FITMENT') {
      const f = fitmentById.get(unit.id)!;
      hit.fitments.push({ fitmentId: f.id, tkId: formatTkId(f.tkNo), status: f.status as FitmentStatus, vehicleRegNo: f.vehicleRegNo, matches: strip(unit.matches) });
    }
  }
  return { q, hits, total, truncated: total > shown.length };
}
