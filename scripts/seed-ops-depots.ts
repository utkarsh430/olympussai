/**
 * Seed the depot registry (ops_depots) from the live UPSRTC feed.
 *
 *   OPS_DATABASE_URL=postgres://... pnpm seed-ops-depots
 *   OPS_DATABASE_URL=postgres://... pnpm seed-ops-depots --dry-run
 *   pnpm seed-ops-depots --dry-run --from-file ./snapshot.json
 *
 * WHY A SCRIPT AND NOT A MIGRATION. The depot list is upstream data that
 * changes on someone else's schedule, so baking today's depots into a
 * migration would freeze a moving fact into a file that must never be edited
 * once applied. The migration creates the table; this refreshes its contents,
 * and an admin re-runs it when the feed gains a depot.
 *
 * WHY TYPESCRIPT, UNLIKE scripts/migrate-ops.mjs AND seed-ops-admin.mjs. Those
 * are deliberately plain Node ESM because they share no logic with the app.
 * This one must derive a depot code EXACTLY as the request path does, and the
 * cheapest way to guarantee that forever is to import the same function
 * instead of copying it — a copy that drifted would seed depots under one
 * code and match vehicles under another, silently emptying the roster of
 * every affected operator. Run through `tsx`, same as
 * scripts/inspect-upsrtc-api.ts.
 *
 * WHY IT NEVER DELETES. ops_users.depot_id is a foreign key with `on delete
 * restrict`, and a depot vanishing from one poll of a live feed is not
 * evidence that it closed — it is far more likely that none of its buses had
 * their ignition on. Removing a row here would either fail against a real
 * assignment or silently strip an operator's scope. Retiring a depot is a
 * deliberate admin act, not a side effect of a quiet night.
 *
 * SAFETY: read-only against the upstream. Against the database it only ever
 * inserts or refreshes ops_depots rows — it touches no other table, and in
 * particular never reads, writes or reassigns an ops_users row.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { normalizeDepotCode } from '../src/lib/ops/depotScope';

const LIVE_URL =
  process.env.UPSRTC_LIVE_URL ?? 'https://margdarshi.upsrtcvlt.com/php/getGpsLiveData.php';
const FETCH_TIMEOUT_MS = 60_000;

type Row = Record<string, unknown>;

/** The feed has been seen as a bare array and as an object wrapping one. */
function extractRows(payload: unknown): Row[] {
  if (Array.isArray(payload)) return payload as Row[];
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    for (const key of ['data', 'records', 'result', 'rows']) {
      if (Array.isArray(record[key])) return record[key] as Row[];
    }
    const firstArray = Object.values(record).find(Array.isArray);
    if (firstArray) return firstArray as Row[];
  }
  throw new Error('Upstream payload did not contain an array of vehicle records.');
}

async function loadRows(): Promise<Row[]> {
  const fileFlagIndex = process.argv.indexOf('--from-file');
  if (fileFlagIndex !== -1) {
    const filePath = process.argv[fileFlagIndex + 1];
    if (!filePath) throw new Error('--from-file requires a path.');
    return extractRows(JSON.parse(await readFile(filePath, 'utf8')));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(LIVE_URL, { signal: controller.signal });
    if (!response.ok) throw new Error(`Upstream responded ${response.status}`);
    return extractRows(await response.json());
  } finally {
    clearTimeout(timer);
  }
}

interface CollapsedDepot {
  code: string;
  name: string;
  upstreamIds: Set<string>;
  spellings: Set<string>;
  vehicles: number;
}

export interface CollapseResult {
  depots: CollapsedDepot[];
  unattributed: number;
  spellingVariants: { code: string; spellings: string[] }[];
  idConflicts: (
    | { kind: 'code-has-many-ids'; code: string; ids: string[] }
    | { kind: 'id-has-many-codes'; id: string; codes: string[] }
  )[];
}

/**
 * Collapse the feed's rows into one entry per canonical depot code.
 *
 * Reports rather than resolves ambiguity. Two things are worth an operator's
 * attention and neither is guessed at:
 *   * `spellingVariants` — one code reached from more than one raw spelling.
 *     Normalization already merged them, so this is a notice, not a problem.
 *   * `idConflicts` — one code carrying more than one upstream home_depot id,
 *     or one id appearing under more than one code. That is the upstream
 *     vocabulary genuinely disagreeing with itself, and a human should look,
 *     because it may mean two real depots share a name. The seed still runs:
 *     upstream_depot_id is provenance only and is never used for matching
 *     (see the column comment in the migration), so a conflict there cannot
 *     mis-scope anyone.
 */
export function collapseDepots(rows: Row[]): CollapseResult {
  const byCode = new Map<string, CollapsedDepot>();
  let unattributed = 0;

  for (const row of rows) {
    const rawName = (row?.depot_name ?? row?.depotName ?? row?.depot ?? null) as string | null;
    const code = normalizeDepotCode(rawName);
    // "None" is the feed's own null (src/lib/upsrtc/normalizer.ts maps it to a
    // null depotName), so it must never become a registry row an operator
    // could be assigned to.
    if (code === null || code === 'NONE') {
      unattributed += 1;
      continue;
    }

    const rawUpstream = row?.home_depot;
    const upstreamId =
      rawUpstream === null || rawUpstream === undefined || String(rawUpstream).trim() === ''
        ? null
        : String(rawUpstream).trim();

    const existing = byCode.get(code);
    if (!existing) {
      byCode.set(code, {
        code,
        name: String(rawName).trim().replace(/\s+/g, ' '),
        upstreamIds: new Set(upstreamId ? [upstreamId] : []),
        spellings: new Set([String(rawName)]),
        vehicles: 1,
      });
      continue;
    }
    if (upstreamId) existing.upstreamIds.add(upstreamId);
    existing.spellings.add(String(rawName));
    existing.vehicles += 1;
  }

  const depots = [...byCode.values()].sort((a, b) =>
    a.code < b.code ? -1 : a.code > b.code ? 1 : 0,
  );

  const spellingVariants = depots
    .filter((d) => d.spellings.size > 1)
    .map((d) => ({ code: d.code, spellings: [...d.spellings] }));

  const idConflicts: CollapseResult['idConflicts'] = [];
  for (const depot of depots) {
    if (depot.upstreamIds.size > 1) {
      idConflicts.push({ kind: 'code-has-many-ids', code: depot.code, ids: [...depot.upstreamIds] });
    }
  }
  const idToCodes = new Map<string, Set<string>>();
  for (const depot of depots) {
    for (const id of depot.upstreamIds) {
      const codes = idToCodes.get(id) ?? new Set<string>();
      codes.add(depot.code);
      idToCodes.set(id, codes);
    }
  }
  for (const [id, codes] of idToCodes) {
    if (codes.size > 1) idConflicts.push({ kind: 'id-has-many-codes', id, codes: [...codes] });
  }

  return { depots, unattributed, spellingVariants, idConflicts };
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const connectionString = process.env.OPS_DATABASE_URL;
  if (!connectionString && !dryRun) {
    process.stderr.write('OPS_DATABASE_URL is not set.\n');
    process.exit(1);
  }

  const rows = await loadRows();
  const { depots, unattributed, spellingVariants, idConflicts } = collapseDepots(rows);

  process.stdout.write(`vehicles read: ${rows.length}\n`);
  process.stdout.write(`distinct depots: ${depots.length}\n`);
  process.stdout.write(`vehicles with no usable depot (null/empty/"None"): ${unattributed}\n`);

  if (spellingVariants.length > 0) {
    process.stdout.write(
      `\nnotice: ${spellingVariants.length} depot(s) reached from more than one spelling (normalization merged them):\n`,
    );
    for (const variant of spellingVariants) {
      process.stdout.write(
        `  ${variant.code}: ${variant.spellings.map((s) => JSON.stringify(s)).join(', ')}\n`,
      );
    }
  }

  if (idConflicts.length > 0) {
    process.stdout.write(
      `\nWARNING: ${idConflicts.length} upstream depot-id conflict(s). Not resolved automatically - a human should confirm these are not two real depots sharing a name:\n`,
    );
    for (const conflict of idConflicts) {
      process.stdout.write(`  ${JSON.stringify(conflict)}\n`);
    }
  }

  if (dryRun) {
    process.stdout.write('\n--dry-run: no rows written.\n');
    return;
  }

  const pool = new pg.Pool({ connectionString });
  try {
    let written = 0;
    for (const depot of depots) {
      const upstreamId = depot.upstreamIds.size === 1 ? [...depot.upstreamIds][0] : null;
      await pool.query(
        `insert into ops_depots (code, name, upstream_depot_id)
         values ($1, $2, $3)
         on conflict (code) do update
            set name = excluded.name,
                upstream_depot_id = coalesce(excluded.upstream_depot_id, ops_depots.upstream_depot_id)`,
        [depot.code, depot.name, upstreamId],
      );
      written += 1;
    }
    const { rows: countRows } = await pool.query<{ n: number }>(
      'select count(*)::int as n from ops_depots',
    );
    process.stdout.write(`\nseeded ${written} depot(s); registry now holds ${countRows[0]?.n ?? 0}.\n`);
  } finally {
    await pool.end();
  }
}

// CLI entrypoint guard — true only when this file is the process entry, never
// when something imports it (collapseDepots is unit-tested). Same idiom as
// scripts/migrate-ops.mjs; without it, importing this module would fire a
// live upstream fetch.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    const err = error as { stack?: string; message?: string };
    process.stderr.write(`${err?.stack ?? err?.message ?? String(error)}\n`);
    process.exit(1);
  });
}
