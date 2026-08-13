#!/usr/bin/env node
/**
 * Link existing `ops_users` rows to their Supabase Auth identities
 * (`ops_users.supabase_user_id`, added by
 * db/migrations/20260812094500__ops_users_supabase_link.sql).
 *
 * This is the data half of collapsing the app's two auth systems onto one
 * front door. The migration added the column; nothing populates it. Until a
 * row is linked, a Supabase session resolves to NO ops profile and gets no
 * ops access at all (`findUserBySupabaseId` in src/lib/auth/rbac/repo.ts) -
 * which is exactly why the legacy `/ops/login` password path must stay open
 * until this has run and been verified. The full ordering is
 * docs/olympuss/AUTH_CUTOVER_RUNBOOK.md; read it before running this against
 * anything you care about.
 *
 *   OPS_DATABASE_URL=postgres://... \
 *   SUPABASE_URL=https://xyz.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=... \
 *     pnpm backfill-ops-links                      # DRY RUN - reports only
 *     pnpm backfill-ops-links -- --apply --actor-email admin@example.com
 *
 * DRY RUN IS THE DEFAULT, and not as a courtesy. This script binds a login
 * identity to an operational role: a wrong link hands one person another
 * person's dispatch authority, and the audit trail that would record what
 * they did with it is append-only and cannot be corrected afterwards. So the
 * default run reads both systems, prints the exact decision it would make for
 * every single row, and writes nothing. `--apply` is required to write, and
 * what it writes is precisely what the dry run printed.
 *
 * MATCHING IS BY EMAIL, CASE-INSENSITIVELY, AND BY NOTHING ELSE. Supabase
 * treats an address case-insensitively as one login identity, and
 * `ops_users_email_lower_uq` (same migration) now enforces the same on this
 * side, so the match is one-to-one or it is refused. There is deliberately no
 * fuzzy matching, no name matching and no "closest" match: every case this
 * script cannot resolve with certainty is REPORTED for a human, never
 * guessed. Nothing is ever silently skipped.
 *
 * AN EMAIL MATCH IS NOT PROOF OF CONTROL, WHICH IS WHY UNCONFIRMED AND
 * BANNED IDENTITIES ARE REFUSED. The match above answers "does an identity
 * carry this address"; it does not answer "does the person holding this
 * identity control that mailbox". Those come apart in exactly one way, and
 * it is reachable:
 *
 *   The Supabase project accepts public self-signup with mailer
 *   auto-confirm OFF. Anyone may register ANY address, including an
 *   administrator's, and the account exists immediately - just UNCONFIRMED,
 *   because confirming it needs the real mailbox. Register the admin's
 *   address before this script runs and it becomes the sole email match.
 *   Linking it hands that attacker the admin ops profile, and
 *   `resolveIdentity` (src/lib/auth/rbac/server.ts) then trusts the binding
 *   absolutely: it resolves by `supabase_user_id` and re-checks nothing.
 *
 * The unconfirmed flag is the ONLY signal that separates that account from a
 * real one, and it used to be attached as a cosmetic note next to a `link`
 * decision that proceeded anyway. It is now a REFUSAL. Banned identities are
 * refused on the same principle: an account an administrator has already
 * revoked must not be handed an operational role by a batch job.
 *
 * Both refusals are overridable, loudly and separately (`--include-unconfirmed`,
 * `--include-banned`), because there are legitimate cases - a pre-existing
 * directory where nobody ever confirmed, a temporary ban being lifted. An
 * override is an operator asserting out-of-band knowledge, which is a
 * different act from a script inferring it, and the report says so on every
 * affected line. Accounts created by `scripts/create-project-user.mjs` and by
 * the invite flow both set `email_confirm: true`, so the normal path is
 * unaffected by any of this.
 *
 * IT NEVER CREATES, MODIFIES OR DELETES A SUPABASE USER. Its only Supabase
 * call is `listUsers` (read). An ops account with no Supabase identity is
 * reported, not conjured: creating one means choosing a password, and that
 * belongs to `scripts/create-project-user.mjs` and a human who can deliver it
 * to the right person.
 *
 * IT DOES NOT WRITE `app_metadata.ops_role`. That claim is the edge-runtime
 * CEILING (src/lib/auth/rbac/supabaseClaims.ts) and is owned by the
 * role-assignment path (POST /api/ops/admin/users/:id/role), which writes it
 * alongside the authoritative `ops_users.role` in one transaction. Linking and role-claim push are separate steps on purpose
 * - see the runbook. This script does REPORT the claim state it observes for
 * every row, because a linked account with no claim cannot pass the edge gate
 * and a linked account whose claim DISAGREES with the database is refused
 * outright (`SESSION_STALE`, src/lib/auth/rbac/server.ts). Both are things
 * you want to see before you close the old door, not after.
 *
 * SAFE TO RE-RUN. Linking is idempotent: an already-correctly-linked row is a
 * no-op, and the write is guarded (`where supabase_user_id is null`) so two
 * concurrent runs cannot fight. It is additive only - it never clears a link,
 * never re-points one, and never touches `password_hash`, which remains the
 * rollback mechanism.
 *
 * NEVER PRINTS A SECRET. Not the service-role key, not a password, not a
 * hash, not a session token. The Supabase project host is printed (it is
 * public - it ships in the browser bundle as NEXT_PUBLIC_SUPABASE_URL); the
 * database URL is not, because it carries a password.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

/** Supabase's `listUsers` page size. 200 keeps the round-trip count low. */
const SUPABASE_PAGE_SIZE = 200;

/**
 * Hard ceiling on directory pages. A truncated read is SAFE in the sense that
 * a missing identity reports as "no Supabase identity" (a report, not a
 * write), but it is not safe to let that pass as a clean report - the
 * operator would resolve a phantom problem by creating a duplicate account.
 * So a directory bigger than this aborts loudly instead.
 */
const MAX_SUPABASE_PAGES = 500;

/** `app_metadata` key the ops role rides in. Mirrors OPS_ROLE_CLAIM. */
const OPS_ROLE_CLAIM = 'ops_role';

/** ops_audit_log.action for a link. Matches the existing `admin.user.*` family. */
const AUDIT_ACTION = 'admin.user.supabase_link';

const USAGE = `Link ops_users rows to their Supabase Auth identities.

  OPS_DATABASE_URL=postgres://...  the app's own Postgres (ops_users)
  SUPABASE_URL=https://xyz.supabase.co   (or NEXT_PUBLIC_SUPABASE_URL)
  SUPABASE_SERVICE_ROLE_KEY=...    server-only, never printed

Usage:
  node scripts/backfill-ops-supabase-links.mjs [options]

Options:
  --apply                 Perform the writes. WITHOUT THIS NOTHING IS WRITTEN.
  --email <address>       Operate on this one ops account only (case-insensitive).
                          Use this to link your OWN account first and prove the
                          new front door before touching anyone else's.
  --include-disabled      Also link rows whose status is 'disabled'. Off by
                          default; disabled rows are reported either way.
  --include-unconfirmed   Link even when the matched Supabase identity has
                          never confirmed its email. REFUSED by default: an
                          unconfirmed account proves an address was typed,
                          not that the mailbox is controlled, and public
                          self-signup makes typing someone else's address
                          free. Only pass this if you know out-of-band who
                          holds every affected account.
  --include-banned        Link even when the matched Supabase identity is
                          banned. REFUSED by default: an account an admin has
                          revoked should not be handed an operational role by
                          a batch job.
  --actor-email <address> Active ops admin to attribute each link to in
                          ops_audit_log. Required with --apply.
  --no-audit              Apply links WITHOUT an audit row. Explicit
                          acknowledgement, required instead of --actor-email,
                          because ops_audit_log.actor_user_id is NOT NULL and
                          there is therefore no such thing as an unattributed
                          audit row to fall back to.
  --help                  Show this.

Read docs/olympuss/AUTH_CUTOVER_RUNBOOK.md first. The order of operations is
what keeps a working login at every step.
`;

/* ------------------------------------------------------------------ *
 * Shapes. Declared as JSDoc rather than left to inference so the two
 * TypeScript test files that import this module get real checking, and so a
 * reader can see what a "decision" is without executing the planner.
 * ------------------------------------------------------------------ */

/**
 * The subset of an `ops_users` row this script reads.
 * @typedef {{ id: string, email: string, name?: string, role: string, status: string, supabaseUserId: string | null }} OpsUserRow
 */

/**
 * The subset of a Supabase Auth user this script reads. Everything is
 * optional because it comes off the wire.
 * @typedef {{ id: string, email?: string | null, app_metadata?: Record<string, unknown>, email_confirmed_at?: string | null, confirmed_at?: string | null, banned_until?: string | null }} SupabaseAuthUser
 */

/**
 * One row's outcome. `kind` is the decision; everything after it is evidence
 * for the report.
 * @typedef {{ kind: string, opsUserId: string, email: string, role: string, status: string, supabaseUserId?: string | null, claim?: string, targetSupabaseUserId?: string, caseMismatch?: boolean, emailUnconfirmed?: boolean, banned?: boolean, note?: string }} Decision
 */

/** @typedef {{ id: string, role: string }} AuditActor */

/* ------------------------------------------------------------------ *
 * Pure planning core. No I/O - every decision this script makes is a
 * function of two lists, which is what makes it testable without a
 * Supabase project and reviewable without running it.
 * ------------------------------------------------------------------ */

/**
 * Normalize an address for matching. `null` means "not usable as a login
 * identity" - the caller must report that, never treat it as a miss.
 */
export function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  // Deliberately minimal: exactly one `@`, something either side, no
  // whitespace. This is a matching key, not an RFC validator - the point is
  // to refuse to match on a value that cannot be a login identity.
  if (!/^[^\s@]+@[^\s@]+$/.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

/**
 * Index the Supabase directory by normalized email.
 *
 * Two identities normalizing to the same key make that key AMBIGUOUS: the
 * script must not pick one. Supabase normally prevents this, but a project
 * that predates that behaviour (or one holding a soft-deleted row) can carry
 * it, and picking wrong here is the single worst outcome this script has.
 *
 * @param {SupabaseAuthUser[]} users
 * @returns {{ byEmail: Map<string, SupabaseAuthUser>, byId: Map<string, SupabaseAuthUser>, ambiguous: Set<string>, withoutEmail: number }}
 */
export function indexSupabaseUsers(users) {
  const byEmail = new Map();
  const byId = new Map();
  const ambiguous = new Set();
  let withoutEmail = 0;

  for (const user of users) {
    byId.set(user.id, user);
    const key = normalizeEmail(user.email);
    if (key === null) {
      withoutEmail += 1;
      continue;
    }
    if (byEmail.has(key)) {
      ambiguous.add(key);
      continue;
    }
    byEmail.set(key, user);
  }

  return { byEmail, byId, ambiguous, withoutEmail };
}

function claimOf(supabaseUser) {
  const value = supabaseUser?.app_metadata?.[OPS_ROLE_CLAIM];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Describe the role-claim state of a row. Reported, never acted on: this
 * script does not write claims (see the header).
 *
 *   absent   - no claim yet. Correct before the role-claim push; after it,
 *              this account cannot pass the Edge gate.
 *   ok       - claim agrees with ops_users.role.
 *   mismatch - claim DISAGREES. The guard refuses this session outright
 *              (SESSION_STALE) until the user signs in again against a
 *              re-pushed claim. This is the one that locks people out.
 */
export function describeClaim(opsRole, supabaseUser) {
  if (!supabaseUser) return 'unknown';
  const claim = claimOf(supabaseUser);
  if (claim === null) return 'absent';
  return claim === opsRole ? 'ok' : `mismatch(${claim})`;
}

/**
 * Decide, for every ops row, exactly what would happen.
 *
 * `kind` is one of:
 *   link                          - will be linked by --apply
 *   already-linked                - correct link already present; no-op
 *   skipped-disabled              - status 'disabled' (use --include-disabled)
 *   skipped-filtered              - excluded by --email
 *   attention:no-email            - ops row has no usable email address
 *   attention:no-identity         - no Supabase user with that email
 *   attention:ambiguous-identity  - >1 Supabase user with that email
 *   attention:identity-taken      - that identity is linked to another ops row
 *   attention:linked-elsewhere    - this row is linked to a DIFFERENT identity
 *   attention:linked-email-differs- linked, but the identity's email differs
 *   attention:linked-unknown      - linked to an id absent from this project
 *   attention:duplicate-ops-email - >1 ops row with that email
 *   attention:identity-banned     - matched identity is banned (--include-banned)
 *   attention:identity-unconfirmed- matched identity never confirmed its email
 *                                   (--include-unconfirmed)
 *
 * Every `attention:*` is a human's call. None of them is written, and none of
 * them is silent.
 *
 * @param {{ opsUsers: OpsUserRow[], supabaseUsers: SupabaseAuthUser[], onlyEmail?: string | null, includeDisabled?: boolean, includeUnconfirmed?: boolean, includeBanned?: boolean }} input
 * @returns {{ decisions: Decision[], directory: ReturnType<typeof indexSupabaseUsers> }}
 */
export function planBackfill({
  opsUsers,
  supabaseUsers,
  onlyEmail = null,
  includeDisabled = false,
  includeUnconfirmed = false,
  includeBanned = false,
}) {
  const directory = indexSupabaseUsers(supabaseUsers);
  const filterKey = onlyEmail === null ? null : normalizeEmail(onlyEmail);
  if (onlyEmail !== null && filterKey === null) {
    throw new Error(`--email "${onlyEmail}" is not a usable email address.`);
  }

  // Which ops emails collide with each other. Post-migration this set is
  // always empty (ops_users_email_lower_uq), but a database that somehow
  // carries a collision must be refused rather than half-linked.
  const opsEmailCounts = new Map();
  for (const row of opsUsers) {
    const key = normalizeEmail(row.email);
    if (key === null) continue;
    opsEmailCounts.set(key, (opsEmailCounts.get(key) ?? 0) + 1);
  }

  // Identities already spoken for, so a second row cannot be planned onto one
  // (the partial unique index would reject it at write time; catching it here
  // means the dry run shows the truth).
  const claimedIdentities = new Map();
  for (const row of opsUsers) {
    if (row.supabaseUserId) claimedIdentities.set(row.supabaseUserId, row);
  }
  const plannedIdentities = new Set();

  const decisions = [];

  for (const row of opsUsers) {
    const key = normalizeEmail(row.email);
    const match = key === null ? undefined : directory.byEmail.get(key);
    const decide = (kind, extra = {}) =>
      decisions.push({
        kind,
        opsUserId: row.id,
        email: row.email,
        role: row.role,
        status: row.status,
        supabaseUserId: row.supabaseUserId,
        claim: describeClaim(row.role, match ?? (row.supabaseUserId ? directory.byId.get(row.supabaseUserId) : null)),
        ...extra,
      });

    if (filterKey !== null && key !== filterKey) {
      decide('skipped-filtered');
      continue;
    }

    // Already linked. Establish WHAT it is linked to before anything else:
    // an existing link is never overwritten, so this branch is terminal.
    if (row.supabaseUserId) {
      const linked = directory.byId.get(row.supabaseUserId);
      if (!linked) {
        // The strongest signal available that these credentials point at the
        // WRONG Supabase project (or that the identity was deleted).
        decide('attention:linked-unknown', { note: 'linked identity is not in this Supabase project' });
      } else if (match && match.id !== row.supabaseUserId) {
        decide('attention:linked-elsewhere', {
          note: `linked to ${row.supabaseUserId}, but ${linked.email ?? 'that identity'} is not the ${row.email} identity (${match.id})`,
          targetSupabaseUserId: match.id,
        });
      } else if (normalizeEmail(linked.email) !== key) {
        // Linked, and the identity exists, but it signs in under a different
        // address than the ops row records. Someone changed their email in
        // one system only. The link still WORKS (resolution is by id), so
        // this is not urgent - but it makes every email-based check here and
        // in the invite flow lie, so it must not pass as "ok".
        decide('attention:linked-email-differs', {
          targetSupabaseUserId: row.supabaseUserId,
          note: `ops row says "${row.email}", the linked identity signs in as "${linked.email ?? '(none)'}"`,
        });
      } else {
        // Correctly linked - but say so about WHAT. A link made before the
        // unconfirmed/banned refusals existed is exactly the binding they
        // were added to prevent, and nothing downstream will ever question
        // it again (`resolveIdentity` resolves by id and re-checks nothing).
        // This report is the only place it can still be noticed.
        const lockedOut = Boolean(linked.banned_until);
        const unconfirmed = !linked.email_confirmed_at && !linked.confirmed_at;
        decide('already-linked', {
          targetSupabaseUserId: row.supabaseUserId,
          banned: lockedOut,
          emailUnconfirmed: unconfirmed,
          note:
            lockedOut || unconfirmed
              ? `REVIEW: this ops row is already linked to a Supabase identity that is ${
                  [lockedOut ? 'BANNED' : null, unconfirmed ? 'UNCONFIRMED' : null]
                    .filter(Boolean)
                    .join(' and ')
                }. This script never re-points a link; unlink it by hand if that binding is wrong (see the runbook's rollback).`
              : undefined,
        });
      }
      continue;
    }

    if (key === null) {
      decide('attention:no-email', { note: 'ops_users.email is not a usable login address' });
      continue;
    }

    if ((opsEmailCounts.get(key) ?? 0) > 1) {
      decide('attention:duplicate-ops-email', { note: 'more than one ops_users row carries this address' });
      continue;
    }

    if (directory.ambiguous.has(key)) {
      decide('attention:ambiguous-identity', { note: 'more than one Supabase user carries this address' });
      continue;
    }

    if (!match) {
      decide('attention:no-identity', { note: 'no Supabase user with this email - create one first' });
      continue;
    }

    const takenBy = claimedIdentities.get(match.id);
    if (takenBy) {
      decide('attention:identity-taken', {
        targetSupabaseUserId: match.id,
        note: `Supabase identity already linked to ops row ${takenBy.id} (${takenBy.email})`,
      });
      continue;
    }
    if (plannedIdentities.has(match.id)) {
      decide('attention:identity-taken', {
        targetSupabaseUserId: match.id,
        note: 'another row in this same run is already planned onto this identity',
      });
      continue;
    }

    // TRUSTWORTHINESS OF THE MATCHED IDENTITY, checked before the disabled
    // skip. A banned or unconfirmed identity is a security refusal, not a
    // routine skip, and "[skip] (..., disabled)" is a line an operator reads
    // past. Surfacing the stronger fact first means re-enabling the ops row
    // cannot silently promote a refusal into a link.
    const banned = Boolean(match.banned_until);
    const emailUnconfirmed = !match.email_confirmed_at && !match.confirmed_at;

    if (banned && !includeBanned) {
      decide('attention:identity-banned', {
        targetSupabaseUserId: match.id,
        banned: true,
        emailUnconfirmed,
        note:
          'REFUSED: the matched Supabase identity is banned. An account an administrator has ' +
          'already revoked must not be handed an ops role. Pass --include-banned to link it anyway.',
      });
      continue;
    }

    if (emailUnconfirmed && !includeUnconfirmed) {
      decide('attention:identity-unconfirmed', {
        targetSupabaseUserId: match.id,
        emailUnconfirmed: true,
        note:
          'REFUSED: the matched Supabase identity has never confirmed its email, so this match ' +
          'proves the address was typed, not that the mailbox is controlled - which is exactly ' +
          'what a self-signup registered against someone else\'s address looks like. Confirm the ' +
          'account, or pass --include-unconfirmed if you know out-of-band who holds it.',
      });
      continue;
    }

    // Disabled rows are checked LAST, so the report still says whether a
    // disabled account would otherwise have linked cleanly. Skipping earlier
    // would hide a duplicate or an ambiguous identity behind the word
    // "disabled" and the problem would surface on the day it is re-enabled.
    if (row.status !== 'active' && !includeDisabled) {
      decide('skipped-disabled', {
        targetSupabaseUserId: match.id,
        note: 'status is not active; pass --include-disabled to link it anyway',
      });
      continue;
    }

    plannedIdentities.add(match.id);
    const caseMismatch = row.email.trim() !== (match.email ?? '').trim();
    const notes = [];
    if (caseMismatch) notes.push(`email case differs (ops "${row.email}" vs Supabase "${match.email}")`);
    // Reaching here with either flag set means an override was passed. Say so
    // on the row itself: the summary block is easy to scroll past, and this is
    // the line an operator will paste into an incident review later.
    if (banned) notes.push('OVERRIDDEN by --include-banned: linking a BANNED Supabase identity');
    if (emailUnconfirmed) {
      notes.push('OVERRIDDEN by --include-unconfirmed: linking an UNCONFIRMED Supabase identity');
    }
    decide('link', {
      targetSupabaseUserId: match.id,
      caseMismatch,
      note: notes.length > 0 ? notes.join('; ') : undefined,
      emailUnconfirmed,
      banned,
    });
  }

  return { decisions, directory };
}

/**
 * @param {Decision[]} decisions
 * @returns {{ counts: Map<string, number>, toLink: Decision[], attention: Decision[] }}
 */
export function summarize(decisions) {
  const counts = new Map();
  for (const decision of decisions) counts.set(decision.kind, (counts.get(decision.kind) ?? 0) + 1);
  return {
    counts,
    toLink: decisions.filter((d) => d.kind === 'link'),
    attention: decisions.filter((d) => d.kind.startsWith('attention:')),
  };
}

/* ------------------------------------------------------------------ *
 * I/O
 * ------------------------------------------------------------------ */

/**
 * @param {string[]} argv
 * @returns {{ apply: boolean, includeDisabled: boolean, includeUnconfirmed: boolean, includeBanned: boolean, noAudit: boolean, help: boolean, email: string | null, actorEmail: string | null }}
 */
export function parseArgs(argv) {
  const args = {
    apply: false,
    includeDisabled: false,
    includeUnconfirmed: false,
    includeBanned: false,
    noAudit: false,
    help: false,
    email: null,
    actorEmail: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') args.apply = true;
    else if (arg === '--include-disabled') args.includeDisabled = true;
    else if (arg === '--include-unconfirmed') args.includeUnconfirmed = true;
    else if (arg === '--include-banned') args.includeBanned = true;
    else if (arg === '--no-audit') args.noAudit = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--email') args.email = argv[++i];
    else if (arg === '--actor-email') args.actorEmail = argv[++i];
    else throw new Error(`Unknown argument "${arg}". Run with --help.`);
  }
  return args;
}

/**
 * Page the whole Supabase directory. Injectable admin client so the paging
 * loop is testable without a project.
 *
 * @param {{ listUsers: (params: { page: number, perPage: number }) => Promise<{ data: { users?: SupabaseAuthUser[] } | null, error: { message: string } | null }> }} admin
 * @param {number} [pageSize]
 * @returns {Promise<SupabaseAuthUser[]>}
 */
export async function fetchSupabaseUsers(admin, pageSize = SUPABASE_PAGE_SIZE) {
  const users = [];
  for (let page = 1; page <= MAX_SUPABASE_PAGES; page += 1) {
    const { data, error } = await admin.listUsers({ page, perPage: pageSize });
    if (error) throw new Error(`Supabase listUsers failed on page ${page}: ${error.message}`);
    const batch = data?.users ?? [];
    users.push(...batch);
    if (batch.length < pageSize) return users;
  }
  throw new Error(
    `Supabase directory exceeds ${MAX_SUPABASE_PAGES * pageSize} users; refusing to plan against a ` +
      'possibly truncated read. Raise MAX_SUPABASE_PAGES only if that number is genuinely correct.',
  );
}

async function loadOpsUsers(pool) {
  const { rows } = await pool.query(
    `select id, email, name, role, status, supabase_user_id
       from ops_users
      order by lower(email)`,
  );
  return rows.map((row) => ({
    id: String(row.id),
    email: row.email,
    name: row.name,
    role: row.role,
    status: row.status,
    supabaseUserId: row.supabase_user_id == null ? null : String(row.supabase_user_id),
  }));
}

async function assertMigrationApplied(pool) {
  const { rows } = await pool.query(
    `select column_name from information_schema.columns
      where table_name = 'ops_users' and column_name = 'supabase_user_id'`,
  );
  if (rows.length === 0) {
    throw new Error(
      'ops_users.supabase_user_id does not exist. Apply the migration first:\n' +
        '  OPS_DATABASE_URL=... pnpm migrate:ops',
    );
  }
}

/**
 * Resolve the ops admin each link is attributed to.
 *
 * ops_audit_log.actor_user_id is `not null references ops_users (id)`, so an
 * audited link needs a real, active admin row. Requiring `admin` rather than
 * any row keeps the trail honest: this action grants access, and the log
 * should name someone who is allowed to grant it.
 *
 * @param {import('pg').Pool} pool
 * @param {string} actorEmail
 * @returns {Promise<AuditActor>}
 */
export async function resolveActor(pool, actorEmail) {
  const { rows } = await pool.query(
    'select id, email, role, status from ops_users where lower(email) = lower($1) limit 1',
    [actorEmail],
  );
  const actor = rows[0];
  if (!actor) throw new Error(`No ops_users row for --actor-email "${actorEmail}".`);
  if (actor.status !== 'active') throw new Error(`Actor "${actorEmail}" is ${actor.status}, not active.`);
  if (actor.role !== 'admin') {
    throw new Error(`Actor "${actorEmail}" has role "${actor.role}"; --actor-email must be an admin.`);
  }
  return { id: String(actor.id), role: actor.role };
}

/**
 * Write the planned links.
 *
 * ONE TRANSACTION PER ROW, each carrying its own audit insert, so the link
 * and its record commit together and one bad row cannot roll back the good
 * ones. The update is guarded on `supabase_user_id is null`: a row linked by
 * a concurrent run since the plan was built is reported as raced, never
 * overwritten. A unique violation (23505) means the identity was claimed in
 * between - also reported, never retried onto a different target.
 *
 * @param {import('pg').Pool} pool
 * @param {Decision[]} decisions
 * @param {{ actor?: AuditActor | null }} [options]
 * @returns {Promise<Array<Decision & { outcome: string, detail?: string }>>}
 */
export async function applyLinks(pool, decisions, { actor = null } = {}) {
  const results = [];

  for (const decision of decisions) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const updated = await client.query(
        `update ops_users
            set supabase_user_id = $2
          where id = $1 and supabase_user_id is null
        returning id`,
        [decision.opsUserId, decision.targetSupabaseUserId],
      );

      if (updated.rowCount === 0) {
        await client.query('rollback');
        results.push({ ...decision, outcome: 'raced', detail: 'row was linked by someone else since the plan was built' });
        continue;
      }

      if (actor) {
        await client.query(
          `insert into ops_audit_log (actor_user_id, actor_role, action, resource_type, resource_id, metadata)
           values ($1, $2, $3, 'ops_user', $4, $5::jsonb)`,
          [
            actor.id,
            actor.role,
            AUDIT_ACTION,
            decision.opsUserId,
            JSON.stringify({
              supabase_user_id: decision.targetSupabaseUserId,
              ops_email: decision.email,
              matched_by: decision.caseMismatch ? 'email_case_insensitive' : 'email',
              source: 'scripts/backfill-ops-supabase-links.mjs',
            }),
          ],
        );
      }

      await client.query('commit');
      results.push({ ...decision, outcome: 'linked' });
    } catch (error) {
      await client.query('rollback').catch(() => {});
      const detail =
        error?.code === '23505'
          ? 'that Supabase identity was linked to another ops row concurrently'
          : (error?.message ?? String(error));
      results.push({ ...decision, outcome: 'failed', detail });
    } finally {
      client.release();
    }
  }

  return results;
}

/* ------------------------------------------------------------------ *
 * Reporting
 * ------------------------------------------------------------------ */

const KIND_LABEL = {
  link: 'LINK',
  'already-linked': 'ok',
  'skipped-disabled': 'skip',
  'skipped-filtered': 'skip',
};

/**
 * @param {Decision} decision
 * @returns {string}
 */
export function formatDecision(decision) {
  const label = KIND_LABEL[decision.kind] ?? decision.kind.replace('attention:', 'ATTENTION ');
  const parts = [`  [${label}] ${decision.email} (${decision.role}${decision.status === 'active' ? '' : `, ${decision.status}`})`];
  if (decision.targetSupabaseUserId) parts.push(`-> ${decision.targetSupabaseUserId}`);
  parts.push(`claim: ${decision.claim}`);
  const line = parts.join('  ');
  // ONE note source, built by the planner. `emailUnconfirmed` and `banned`
  // used to be re-rendered here as standalone asides ("Supabase user is
  // banned") beside a decision that linked anyway - which read as colour
  // commentary rather than as the refusal it should have been. The planner
  // now says what it DID about each flag, and this only prints it.
  return decision.note ? `${line}\n        note: ${decision.note}` : line;
}

function report(out, decisions, { apply }) {
  const { counts, toLink, attention } = summarize(decisions);

  const ordered = [...decisions].sort((a, b) => {
    const rank = (d) => (d.kind.startsWith('attention:') ? 0 : d.kind === 'link' ? 1 : 2);
    return rank(a) - rank(b) || a.email.localeCompare(b.email);
  });

  out(apply ? 'APPLYING - these writes are being performed:' : 'DRY RUN - nothing will be written. Re-run with --apply to perform these:');
  out('');
  for (const decision of ordered) {
    if (decision.kind === 'skipped-filtered') continue;
    out(formatDecision(decision));
  }
  out('');

  const filtered = counts.get('skipped-filtered') ?? 0;

  out(
    `RESULT: to-link=${toLink.length} already-linked=${counts.get('already-linked') ?? 0} ` +
      `skipped-disabled=${counts.get('skipped-disabled') ?? 0} needs-attention=${attention.length}` +
      // Said on the RESULT line itself, not only above it: "needs-attention=0"
      // from a filtered run means "none in the one account you asked about",
      // and must never be read as "the fleet is clean".
      (filtered > 0 ? ` (--email limited this to 1 account; ${filtered} row(s) were NOT evaluated)` : ''),
  );

  if (attention.length > 0) {
    out('');
    out(`${attention.length} row(s) need a human. Nothing was written for them, by design.`);
    out('Resolve them per docs/olympuss/AUTH_CUTOVER_RUNBOOK.md - do not close /ops/login while any remain.');
  }

  // Said separately from the generic attention block, and in these words,
  // because these two are the ones an operator is most likely to wave through
  // as noise. They are the refusals that stop an email match alone from
  // binding an ops role to an identity nobody has proven control of.
  const refusedIdentities = decisions.filter(
    (d) => d.kind === 'attention:identity-banned' || d.kind === 'attention:identity-unconfirmed',
  );
  if (refusedIdentities.length > 0) {
    out('');
    out(
      `REFUSED ${refusedIdentities.length} link(s): the matched Supabase identity is banned or has ` +
        'never confirmed its email. An email match proves an address was typed, not that the ' +
        'mailbox is controlled, and this project accepts public self-signup - so an unconfirmed ' +
        "match on an administrator's address is indistinguishable from an attacker who registered it.",
    );
    for (const d of refusedIdentities) {
      out(`  refused: ${d.email} -> ${d.targetSupabaseUserId} (${d.kind.replace('attention:', '')})`);
    }
    out(
      'Confirm or unban the account, or re-run with --include-unconfirmed / --include-banned to ' +
        'link it deliberately.',
    );
  }

  // The mirror image: an override was passed and rows ARE being linked on a
  // signal the script would otherwise have refused. Loud in the dry run too,
  // so the decision is visible before the write rather than after it.
  const overridden = decisions.filter((d) => d.kind === 'link' && (d.banned || d.emailUnconfirmed));
  if (overridden.length > 0) {
    out('');
    out(
      `OVERRIDE IN EFFECT - ${overridden.length} link(s) to a banned or unconfirmed Supabase ` +
        'identity are being made anyway. Each one binds an ops role to an account whose control ' +
        'this script could not verify:',
    );
    for (const d of overridden) {
      const flags = [d.banned ? 'banned' : null, d.emailUnconfirmed ? 'unconfirmed' : null]
        .filter(Boolean)
        .join(', ');
      out(`  override: ${d.email} -> ${d.targetSupabaseUserId} (${flags})`);
    }
  }

  const reviewLinked = decisions.filter(
    (d) => d.kind === 'already-linked' && (d.banned || d.emailUnconfirmed),
  );
  if (reviewLinked.length > 0) {
    out('');
    out(
      `${reviewLinked.length} row(s) are ALREADY linked to a banned or unconfirmed Supabase ` +
        'identity. This script never re-points a link, so nothing here was changed - but these ' +
        'are the bindings the refusals above exist to prevent, and they resolve to a real ops ' +
        'role on every request. Check each one and unlink by hand if it is wrong.',
    );
    for (const d of reviewLinked) {
      out(`  review: ${d.email} -> ${d.targetSupabaseUserId}`);
    }
  }

  const claimGaps = decisions.filter(
    (d) => (d.kind === 'link' || d.kind === 'already-linked') && d.claim !== 'ok',
  );
  if (claimGaps.length > 0) {
    out('');
    out(
      `${claimGaps.length} linked row(s) do not yet carry a matching app_metadata.${OPS_ROLE_CLAIM} claim. ` +
        'That is expected before the role-claim push and fatal after it: without the claim these accounts ' +
        'cannot pass the Edge gate, and a MISMATCHED claim is refused outright. This script does not write ' +
        'claims. GET /api/ops/admin/role-drift lists them; re-assigning the role the database already holds ' +
        '(POST /api/ops/admin/users/:id/role) re-pushes each claim. Then re-run this to confirm every row ' +
        'reads "claim: ok".',
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(USAGE);
    return;
  }

  const connectionString = process.env.OPS_DATABASE_URL;
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!connectionString) throw new Error('OPS_DATABASE_URL is not set.');
  if (!supabaseUrl) throw new Error('SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) is not set.');
  if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set.');

  if (args.apply) {
    if (!args.actorEmail && !args.noAudit) {
      throw new Error(
        '--apply needs --actor-email <active ops admin> so each link is attributable in ops_audit_log ' +
          '(actor_user_id is NOT NULL, so there is no unattributed audit row to write). ' +
          'Pass --no-audit to link without an audit trail, deliberately.',
      );
    }
    if (args.actorEmail && args.noAudit) {
      throw new Error('--actor-email and --no-audit contradict each other. Pass one.');
    }
  }

  const out = (line) => process.stdout.write(`${line}\n`);
  // The host is public (it ships in the browser bundle). The key never is,
  // and OPS_DATABASE_URL carries a password, so neither is printed.
  out(`Supabase project: ${new URL(supabaseUrl).host}`);

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const pool = new pg.Pool({ connectionString });

  try {
    await assertMigrationApplied(pool);

    const actor = args.apply && args.actorEmail ? await resolveActor(pool, args.actorEmail) : null;
    if (args.apply && !actor) out('WARNING: --no-audit - these links will NOT appear in ops_audit_log.');
    // Announced before anything is read, not only where the affected rows
    // print: an override changes what the whole run is willing to do, and an
    // operator who passed one by copy-paste should see it at the top.
    if (args.includeUnconfirmed) {
      out(
        'WARNING: --include-unconfirmed - identities that never confirmed their email are eligible ' +
          'for linking in this run.',
      );
    }
    if (args.includeBanned) {
      out('WARNING: --include-banned - banned identities are eligible for linking in this run.');
    }

    const [opsUsers, supabaseUsers] = await Promise.all([loadOpsUsers(pool), fetchSupabaseUsers(supabase.auth.admin)]);
    out(`ops_users rows: ${opsUsers.length}   Supabase identities: ${supabaseUsers.length}`);

    const { decisions, directory } = planBackfill({
      opsUsers,
      supabaseUsers,
      onlyEmail: args.email,
      includeDisabled: args.includeDisabled,
      includeUnconfirmed: args.includeUnconfirmed,
      includeBanned: args.includeBanned,
    });
    if (directory.withoutEmail > 0) {
      out(`(${directory.withoutEmail} Supabase identit(ies) have no email address and cannot be matched)`);
    }
    out('');

    report(out, decisions, { apply: args.apply });

    if (!args.apply) return;

    const { toLink } = summarize(decisions);
    if (toLink.length === 0) {
      out('');
      out('Nothing to link.');
      return;
    }

    out('');
    const results = await applyLinks(pool, toLink, { actor });
    for (const result of results) {
      out(`  ${result.outcome}: ${result.email} -> ${result.targetSupabaseUserId}${result.detail ? ` (${result.detail})` : ''}`);
    }
    const linked = results.filter((r) => r.outcome === 'linked').length;
    const failed = results.length - linked;
    out('');
    out(`APPLIED: linked=${linked} not-linked=${failed}`);
    if (failed > 0) {
      throw new Error(`${failed} link(s) did not complete - see above. Re-run the dry run to see current state.`);
    }
  } finally {
    await pool.end();
  }
}

// CLI entrypoint guard - main() runs only when this file IS the process
// entry, never when a test imports the pure planning functions above. Same
// form as scripts/migrate-ops.mjs.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error?.message ?? error}\n`);
    process.exit(1);
  });
}
