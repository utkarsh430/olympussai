// @vitest-environment node
//
// The decision table of scripts/backfill-ops-supabase-links.mjs.
//
// This script binds a login identity to an operational role. A wrong link
// hands one person another person's dispatch authority, and the audit trail
// that would record what they did with it is append-only and cannot be
// corrected afterwards. So the interesting property is not "does it link" -
// it is that every case it cannot resolve with certainty is REPORTED rather
// than guessed, and that nothing is ever silently dropped.
//
// The planner is pure by construction (two lists in, decisions out), which is
// what lets this run with no Supabase project and no database. The write path
// is proved separately, against real Postgres, in
// opsSupabaseBackfillApplyDb.test.ts.
import { describe, it, expect } from 'vitest';
// Plain ESM operational script, deliberately not TypeScript (same as
// scripts/migrate-ops.mjs). Its exports carry JSDoc types, so this import is
// fully checked.
import {
  normalizeEmail,
  indexSupabaseUsers,
  describeClaim,
  planBackfill,
  summarize,
  parseArgs,
  fetchSupabaseUsers,
  formatDecision,
} from '../../../scripts/backfill-ops-supabase-links.mjs';

type OpsRow = {
  id: string;
  email: string;
  name?: string;
  role: string;
  status: string;
  supabaseUserId: string | null;
};

function opsRow(overrides: Partial<OpsRow> & { email: string }): OpsRow {
  return {
    id: `ops-${overrides.email}`,
    name: 'Fixture',
    role: 'dispatcher',
    status: 'active',
    supabaseUserId: null,
    ...overrides,
  };
}

type SupabaseUser = {
  id: string;
  email?: string | null;
  app_metadata?: Record<string, unknown>;
  email_confirmed_at?: string | null;
  confirmed_at?: string | null;
  banned_until?: string | null;
};

function supabaseUser(overrides: SupabaseUser): SupabaseUser {
  return {
    app_metadata: { provider: 'email', providers: ['email'] },
    email_confirmed_at: '2026-01-01T00:00:00Z',
    banned_until: null,
    ...overrides,
  };
}

type Decision = {
  kind: string;
  opsUserId: string;
  email: string;
  role: string;
  status: string;
  claim?: string;
  targetSupabaseUserId?: string;
  caseMismatch?: boolean;
  emailUnconfirmed?: boolean;
  banned?: boolean;
  note?: string;
};

const kinds = (decisions: Decision[]) => decisions.map((d) => d.kind);

/** The decision at `index`. Absent is a test failure, not an undefined that
 * makes every assertion after it vacuous. */
function at(decisions: Decision[], index = 0): Decision {
  const found = decisions[index];
  if (!found) throw new Error(`no decision at index ${index} (got ${decisions.length})`);
  return found;
}

/** The one decision for this address. Absent is a test failure, not a
 * silently-undefined object that makes every later assertion vacuous. */
function forEmail(decisions: Decision[], email: string): Decision {
  const found = decisions.find((d) => d.email === email);
  if (!found) throw new Error(`no decision for ${email}; got ${decisions.map((d) => d.email).join(', ')}`);
  return found;
}

describe('normalizeEmail', () => {
  it('lowercases and trims, so case is never a reason to miss a match', () => {
    expect(normalizeEmail('  Ops.Admin@Example.COM ')).toBe('ops.admin@example.com');
  });

  it('returns null for anything that cannot be a login identity', () => {
    // null is a REPORTABLE state, not a match failure - the caller must
    // surface it rather than treating it as "no Supabase user found".
    for (const value of ['', '   ', 'not-an-email', 'two@at@signs', 'has space@example.com', null, 42]) {
      expect(normalizeEmail(value as string)).toBeNull();
    }
  });
});

describe('indexSupabaseUsers', () => {
  it('treats two identities sharing an address as ambiguous rather than picking one', () => {
    const index = indexSupabaseUsers([
      supabaseUser({ id: 'a', email: 'dup@example.com' }),
      supabaseUser({ id: 'b', email: 'DUP@example.com' }),
    ]);

    expect(index.ambiguous.has('dup@example.com')).toBe(true);
  });

  it('counts identities with no email instead of dropping them', () => {
    const index = indexSupabaseUsers([supabaseUser({ id: 'phone-only', email: null })]);

    expect(index.withoutEmail).toBe(1);
    expect(index.byEmail.size).toBe(0);
    expect(index.byId.get('phone-only')).toBeTruthy();
  });
});

describe('describeClaim', () => {
  it('reports absent, ok and mismatch distinctly', () => {
    expect(describeClaim('dispatcher', supabaseUser({ id: 'x', email: 'a@b.com' }))).toBe('absent');
    expect(
      describeClaim('dispatcher', supabaseUser({ id: 'x', email: 'a@b.com', app_metadata: { ops_role: 'dispatcher' } })),
    ).toBe('ok');
    // A mismatch is the case that LOCKS SOMEONE OUT after cutover (the guard
    // refuses the session outright), so it must not read like "absent".
    expect(
      describeClaim('dispatcher', supabaseUser({ id: 'x', email: 'a@b.com', app_metadata: { ops_role: 'driver' } })),
    ).toBe('mismatch(driver)');
  });
});

describe('planBackfill - the happy path', () => {
  it('links an active row to the Supabase identity with the same email', () => {
    const { decisions } = planBackfill({
      opsUsers: [opsRow({ email: 'ops@example.com' })],
      supabaseUsers: [supabaseUser({ id: 'sb-1', email: 'ops@example.com' })],
    });

    expect(decisions).toHaveLength(1);
    expect(at(decisions)).toMatchObject({ kind: 'link', targetSupabaseUserId: 'sb-1', caseMismatch: false });
  });

  it('links across an email-case difference, and says so', () => {
    const { decisions } = planBackfill({
      opsUsers: [opsRow({ email: 'Ops.Admin@Example.COM' })],
      supabaseUsers: [supabaseUser({ id: 'sb-1', email: 'ops.admin@example.com' })],
    });

    expect(at(decisions).kind).toBe('link');
    expect(at(decisions).caseMismatch).toBe(true);
    // Reported, not swallowed: the operator needs to know which spelling is
    // the real login identity.
    expect(at(decisions).note).toContain('case differs');
  });

  it('is a no-op on a row that is already correctly linked', () => {
    const { decisions } = planBackfill({
      opsUsers: [opsRow({ email: 'ops@example.com', supabaseUserId: 'sb-1' })],
      supabaseUsers: [supabaseUser({ id: 'sb-1', email: 'ops@example.com' })],
    });

    expect(at(decisions).kind).toBe('already-linked');
    expect(summarize(decisions).toLink).toHaveLength(0);
  });

  it('accounts for every ops row exactly once', () => {
    const rows = [
      opsRow({ email: 'a@example.com' }),
      opsRow({ email: 'b@example.com', status: 'disabled' }),
      opsRow({ email: 'c@example.com' }),
      opsRow({ email: 'not-an-email' }),
      opsRow({ email: 'd@example.com', supabaseUserId: 'sb-d' }),
    ];
    const { decisions } = planBackfill({
      opsUsers: rows,
      supabaseUsers: [
        supabaseUser({ id: 'sb-a', email: 'a@example.com' }),
        supabaseUser({ id: 'sb-b', email: 'b@example.com' }),
        supabaseUser({ id: 'sb-d', email: 'd@example.com' }),
      ],
    });

    expect(decisions).toHaveLength(rows.length);
    expect(new Set(decisions.map((d: { opsUserId: string }) => d.opsUserId)).size).toBe(rows.length);
  });
});

describe('planBackfill - cases that must be reported, never guessed', () => {
  it('reports an ops row with no usable email instead of matching on anything else', () => {
    const { decisions } = planBackfill({
      opsUsers: [opsRow({ id: 'ops-blank', email: '   ', name: 'Anil Kumar' })],
      // A Supabase user with the same NAME exists. Name matching would be a
      // plausible-looking guess and is exactly what this must not do.
      supabaseUsers: [supabaseUser({ id: 'sb-1', email: 'anil.kumar@example.com' })],
    });

    expect(kinds(decisions)).toEqual(['attention:no-email']);
    expect(at(decisions).targetSupabaseUserId).toBeUndefined();
  });

  it('reports an active row with no Supabase identity rather than creating one', () => {
    const { decisions } = planBackfill({
      opsUsers: [opsRow({ email: 'orphan@example.com' })],
      supabaseUsers: [supabaseUser({ id: 'sb-1', email: 'someone.else@example.com' })],
    });

    expect(kinds(decisions)).toEqual(['attention:no-identity']);
    expect(at(decisions).note).toContain('create one first');
  });

  it('refuses an ambiguous Supabase address', () => {
    const { decisions } = planBackfill({
      opsUsers: [opsRow({ email: 'dup@example.com' })],
      supabaseUsers: [
        supabaseUser({ id: 'sb-1', email: 'dup@example.com' }),
        supabaseUser({ id: 'sb-2', email: 'DUP@example.com' }),
      ],
    });

    expect(kinds(decisions)).toEqual(['attention:ambiguous-identity']);
  });

  it('refuses two ops rows sharing one address', () => {
    // ops_users_email_lower_uq makes this impossible post-migration; a
    // database that somehow carries it must be refused, not half-linked.
    const { decisions } = planBackfill({
      opsUsers: [
        opsRow({ id: 'ops-1', email: 'dup@example.com' }),
        opsRow({ id: 'ops-2', email: 'DUP@example.com' }),
      ],
      supabaseUsers: [supabaseUser({ id: 'sb-1', email: 'dup@example.com' })],
    });

    expect(kinds(decisions)).toEqual(['attention:duplicate-ops-email', 'attention:duplicate-ops-email']);
  });

  it('refuses to point a second ops row at an identity another row already holds', () => {
    // A pre-existing WRONG link: ops row "old" was bound to sb-1 at some
    // point, but sb-1 is really the identity for real@example.com. Writing
    // the correct-looking link would hit the partial unique index; the DRY
    // RUN must say so instead of failing halfway through an --apply.
    const { decisions } = planBackfill({
      opsUsers: [
        opsRow({ id: 'ops-old', email: 'old@example.com', supabaseUserId: 'sb-1' }),
        opsRow({ id: 'ops-real', email: 'real@example.com' }),
      ],
      supabaseUsers: [supabaseUser({ id: 'sb-1', email: 'real@example.com' })],
    });

    expect(forEmail(decisions, 'real@example.com')).toMatchObject({
      kind: 'attention:identity-taken',
      targetSupabaseUserId: 'sb-1',
    });
    expect(forEmail(decisions, 'real@example.com').note).toContain('ops-old');
    // And the row holding it is itself reported, not passed off as fine.
    expect(forEmail(decisions, 'old@example.com').kind).toBe('attention:linked-email-differs');
    expect(summarize(decisions).toLink).toHaveLength(0);
  });

  it('flags a linked row whose identity signs in under a different address', () => {
    // Someone changed their email in one system only. Resolution is by id so
    // the link still works, but every email-based check now lies.
    const { decisions } = planBackfill({
      opsUsers: [opsRow({ email: 'old.name@example.com', supabaseUserId: 'sb-1' })],
      supabaseUsers: [supabaseUser({ id: 'sb-1', email: 'new.name@example.com' })],
    });

    expect(kinds(decisions)).toEqual(['attention:linked-email-differs']);
    expect(at(decisions).note).toContain('new.name@example.com');
  });

  it('refuses when two ops rows resolve to the same identity within one run', () => {
    // Anomalous input by construction - one Supabase id under two addresses
    // is not something the API returns. The guard exists because the cost of
    // being wrong (an --apply that fails partway on a unique violation) is
    // higher than the cost of a cheap check, and this proves it holds.
    const { decisions } = planBackfill({
      opsUsers: [opsRow({ id: 'ops-1', email: 'first@example.com' }), opsRow({ id: 'ops-2', email: 'second@example.com' })],
      supabaseUsers: [
        supabaseUser({ id: 'sb-shared', email: 'first@example.com' }),
        supabaseUser({ id: 'sb-shared', email: 'second@example.com' }),
      ],
    });

    expect(kinds(decisions)).toEqual(['link', 'attention:identity-taken']);
    expect(forEmail(decisions, 'second@example.com').note).toContain('same run');
  });

  it('never re-points a row that is already linked to a different identity', () => {
    const { decisions } = planBackfill({
      opsUsers: [opsRow({ email: 'moved@example.com', supabaseUserId: 'sb-old' })],
      supabaseUsers: [
        supabaseUser({ id: 'sb-old', email: 'old-address@example.com' }),
        supabaseUser({ id: 'sb-new', email: 'moved@example.com' }),
      ],
    });

    expect(kinds(decisions)).toEqual(['attention:linked-elsewhere']);
    expect(summarize(decisions).toLink).toHaveLength(0);
  });

  it('flags a link pointing at an identity this Supabase project does not have', () => {
    // The strongest available signal that the credentials point at the WRONG
    // Supabase project - which would otherwise present as "everyone needs a
    // new account", and get 17 duplicate accounts created.
    const { decisions } = planBackfill({
      opsUsers: [opsRow({ email: 'ops@example.com', supabaseUserId: 'sb-from-another-project' })],
      supabaseUsers: [supabaseUser({ id: 'sb-1', email: 'ops@example.com' })],
    });

    expect(kinds(decisions)).toEqual(['attention:linked-unknown']);
  });
});

describe('planBackfill - disabled rows', () => {
  it('skips a disabled row by default but still names the identity it matched', () => {
    const { decisions } = planBackfill({
      opsUsers: [opsRow({ email: 'gone@example.com', status: 'disabled' })],
      supabaseUsers: [supabaseUser({ id: 'sb-1', email: 'gone@example.com' })],
    });

    expect(at(decisions).kind).toBe('skipped-disabled');
    expect(at(decisions).targetSupabaseUserId).toBe('sb-1');
    expect(at(decisions).note).toContain('--include-disabled');
  });

  it('links a disabled row when --include-disabled is passed', () => {
    const { decisions } = planBackfill({
      opsUsers: [opsRow({ email: 'gone@example.com', status: 'disabled' })],
      supabaseUsers: [supabaseUser({ id: 'sb-1', email: 'gone@example.com' })],
      includeDisabled: true,
    });

    expect(at(decisions).kind).toBe('link');
  });

  it('reports the BLOCKING problem on a disabled row rather than hiding it behind "disabled"', () => {
    // Otherwise the ambiguity surfaces on the day the account is re-enabled,
    // with nobody around who remembers this migration.
    const { decisions } = planBackfill({
      opsUsers: [opsRow({ email: 'dup@example.com', status: 'disabled' })],
      supabaseUsers: [
        supabaseUser({ id: 'sb-1', email: 'dup@example.com' }),
        supabaseUser({ id: 'sb-2', email: 'Dup@example.com' }),
      ],
    });

    expect(at(decisions).kind).toBe('attention:ambiguous-identity');
  });
});

describe('planBackfill - the --email canary', () => {
  it('plans only the named account and marks the rest excluded, not resolved', () => {
    const { decisions } = planBackfill({
      opsUsers: [opsRow({ email: 'captain@example.com', role: 'admin' }), opsRow({ email: 'other@example.com' })],
      supabaseUsers: [
        supabaseUser({ id: 'sb-cap', email: 'captain@example.com' }),
        supabaseUser({ id: 'sb-other', email: 'other@example.com' }),
      ],
      onlyEmail: 'CAPTAIN@example.com',
    });

    expect(forEmail(decisions, 'captain@example.com').kind).toBe('link');
    // Not "already-linked", not "ok" - excluded. The report must never imply
    // an untouched row was checked and found fine.
    expect(forEmail(decisions, 'other@example.com').kind).toBe('skipped-filtered');
    expect(summarize(decisions).toLink).toHaveLength(1);
  });

  it('refuses an unusable --email rather than matching nothing and reporting success', () => {
    expect(() =>
      planBackfill({ opsUsers: [], supabaseUsers: [], onlyEmail: 'not-an-email' }),
    ).toThrow(/not a usable email/);
  });
});

describe('planBackfill - role-claim reporting', () => {
  it('reports the claim state of each linked row without writing it', () => {
    const { decisions } = planBackfill({
      opsUsers: [
        opsRow({ email: 'ok@example.com', role: 'depot' }),
        opsRow({ email: 'absent@example.com', role: 'depot' }),
        opsRow({ email: 'stale@example.com', role: 'depot' }),
      ],
      supabaseUsers: [
        supabaseUser({ id: 'sb-ok', email: 'ok@example.com', app_metadata: { ops_role: 'depot' } }),
        supabaseUser({ id: 'sb-absent', email: 'absent@example.com' }),
        supabaseUser({ id: 'sb-stale', email: 'stale@example.com', app_metadata: { ops_role: 'admin' } }),
      ],
    });

    expect(forEmail(decisions, 'ok@example.com').claim).toBe('ok');
    expect(forEmail(decisions, 'absent@example.com').claim).toBe('absent');
    expect(forEmail(decisions, 'stale@example.com').claim).toBe('mismatch(admin)');
  });

  // --------------------------------------------------------------------
  // An email match proves an address was typed. It does not prove the
  // mailbox is controlled, and these are the two cases where those come
  // apart. Every test below would FAIL against the previous implementation,
  // which emitted `link` for both and attached the facts as cosmetic notes.
  // --------------------------------------------------------------------

  it('refuses to link an ops row to a Supabase identity that never confirmed its email', () => {
    const { decisions } = planBackfill({
      opsUsers: [opsRow({ email: 'new@example.com' })],
      supabaseUsers: [
        supabaseUser({ id: 'sb-new', email: 'new@example.com', email_confirmed_at: null, confirmed_at: null }),
      ],
    });

    expect(forEmail(decisions, 'new@example.com')).toMatchObject({
      kind: 'attention:identity-unconfirmed',
      emailUnconfirmed: true,
      targetSupabaseUserId: 'sb-new',
    });
    expect(summarize(decisions).toLink).toHaveLength(0);
  });

  it('refuses to link an ops row to a banned Supabase identity', () => {
    const { decisions } = planBackfill({
      opsUsers: [opsRow({ email: 'banned@example.com' })],
      supabaseUsers: [
        supabaseUser({ id: 'sb-ban', email: 'banned@example.com', banned_until: '2030-01-01T00:00:00Z' }),
      ],
    });

    expect(forEmail(decisions, 'banned@example.com')).toMatchObject({
      kind: 'attention:identity-banned',
      banned: true,
      targetSupabaseUserId: 'sb-ban',
    });
    expect(summarize(decisions).toLink).toHaveLength(0);
  });

  // The attack this refusal exists for, stated as a test so it cannot be
  // undone by someone who reads the refusal as over-caution. The project
  // accepts public self-signup with auto-confirm off: registering someone
  // else's address is free and produces an UNCONFIRMED account, which is the
  // only thing separating it from theirs.
  it('refuses the admin ops profile to a self-signup that squatted the admin address', () => {
    const { decisions } = planBackfill({
      opsUsers: [opsRow({ email: 'admin@example.com', role: 'admin' })],
      supabaseUsers: [
        supabaseUser({
          id: 'sb-squatter',
          email: 'admin@example.com',
          email_confirmed_at: null,
          confirmed_at: null,
        }),
      ],
    });

    const decision = forEmail(decisions, 'admin@example.com');
    expect(decision.kind).toBe('attention:identity-unconfirmed');
    expect(decision.note).toMatch(/REFUSED/);
    expect(summarize(decisions).toLink).toHaveLength(0);
  });

  it('refuses on the ban before the disabled skip, so re-enabling the row cannot silently link it', () => {
    const { decisions } = planBackfill({
      opsUsers: [opsRow({ email: 'banned@example.com', status: 'disabled' })],
      supabaseUsers: [
        supabaseUser({ id: 'sb-ban', email: 'banned@example.com', banned_until: '2030-01-01T00:00:00Z' }),
      ],
    });

    // Not `skipped-disabled`: that line reads as routine and would hide the
    // stronger fact until the day someone re-enables the account.
    expect(forEmail(decisions, 'banned@example.com').kind).toBe('attention:identity-banned');
  });

  it('links an unconfirmed identity only under --include-unconfirmed, and says so on the row', () => {
    const input = {
      opsUsers: [opsRow({ email: 'new@example.com' })],
      supabaseUsers: [
        supabaseUser({ id: 'sb-new', email: 'new@example.com', email_confirmed_at: null, confirmed_at: null }),
      ],
    };

    const overridden = forEmail(planBackfill({ ...input, includeUnconfirmed: true }).decisions, 'new@example.com');
    expect(overridden).toMatchObject({ kind: 'link', emailUnconfirmed: true, targetSupabaseUserId: 'sb-new' });
    expect(overridden.note).toMatch(/OVERRIDDEN by --include-unconfirmed/);

    // The flags are independent: the banned override must not unlock this one.
    expect(forEmail(planBackfill({ ...input, includeBanned: true }).decisions, 'new@example.com').kind).toBe(
      'attention:identity-unconfirmed',
    );
  });

  it('links a banned identity only under --include-banned, and says so on the row', () => {
    const input = {
      opsUsers: [opsRow({ email: 'banned@example.com' })],
      supabaseUsers: [
        supabaseUser({ id: 'sb-ban', email: 'banned@example.com', banned_until: '2030-01-01T00:00:00Z' }),
      ],
    };

    const overridden = forEmail(planBackfill({ ...input, includeBanned: true }).decisions, 'banned@example.com');
    expect(overridden).toMatchObject({ kind: 'link', banned: true, targetSupabaseUserId: 'sb-ban' });
    expect(overridden.note).toMatch(/OVERRIDDEN by --include-banned/);

    expect(forEmail(planBackfill({ ...input, includeUnconfirmed: true }).decisions, 'banned@example.com').kind).toBe(
      'attention:identity-banned',
    );
  });

  it('a confirmed, unbanned identity still links with no override at all', () => {
    // The guard against over-correcting: `create-project-user.mjs` and the
    // invite flow both set email_confirm: true, so the ordinary path must
    // stay a plain one-flag-free link.
    const { decisions } = planBackfill({
      opsUsers: [opsRow({ email: 'ordinary@example.com' })],
      supabaseUsers: [supabaseUser({ id: 'sb-ok', email: 'ordinary@example.com' })],
    });

    expect(forEmail(decisions, 'ordinary@example.com')).toMatchObject({
      kind: 'link',
      emailUnconfirmed: false,
      banned: false,
    });
  });

  it('flags an EXISTING link to a banned or unconfirmed identity for review, without re-pointing it', () => {
    // A link made before these refusals existed is exactly the binding they
    // prevent, and nothing downstream ever questions it again. The report is
    // the only place it can still be caught.
    const { decisions } = planBackfill({
      opsUsers: [opsRow({ email: 'legacy@example.com', supabaseUserId: 'sb-legacy' })],
      supabaseUsers: [
        supabaseUser({
          id: 'sb-legacy',
          email: 'legacy@example.com',
          email_confirmed_at: null,
          confirmed_at: null,
        }),
      ],
    });

    const decision = forEmail(decisions, 'legacy@example.com');
    expect(decision.kind).toBe('already-linked');
    expect(decision.note).toMatch(/REVIEW/);
    expect(decision.note).toMatch(/UNCONFIRMED/);
  });
});

describe('parseArgs', () => {
  it('defaults to a dry run, and to refusing untrusted identities', () => {
    expect(parseArgs([])).toMatchObject({
      apply: false,
      includeDisabled: false,
      includeUnconfirmed: false,
      includeBanned: false,
      noAudit: false,
    });
  });

  it('parses each flag', () => {
    expect(
      parseArgs([
        '--apply',
        '--email',
        'a@b.com',
        '--actor-email',
        'admin@b.com',
        '--include-disabled',
        '--include-unconfirmed',
        '--include-banned',
      ]),
    ).toMatchObject({
      apply: true,
      email: 'a@b.com',
      actorEmail: 'admin@b.com',
      includeDisabled: true,
      includeUnconfirmed: true,
      includeBanned: true,
    });
  });

  it('refuses an unknown argument instead of ignoring it', () => {
    // A typo'd --apply must not read as a dry run that "found nothing to do".
    expect(() => parseArgs(['--aply'])).toThrow(/Unknown argument/);
  });
});

describe('fetchSupabaseUsers', () => {
  it('pages until a short page', async () => {
    const pages: Record<number, SupabaseUser[]> = {
      1: [supabaseUser({ id: 'a', email: 'a@x.com' }), supabaseUser({ id: 'b', email: 'b@x.com' })],
      2: [supabaseUser({ id: 'c', email: 'c@x.com' })],
    };
    const admin = {
      listUsers: async ({ page }: { page: number }) => ({ data: { users: pages[page] ?? [] }, error: null }),
    };

    const users = await fetchSupabaseUsers(admin, 2);

    expect(users.map((u: { id: string }) => u.id)).toEqual(['a', 'b', 'c']);
  });

  it('throws on a listUsers error rather than planning against a partial directory', async () => {
    // Silently planning against half a directory would report every missing
    // identity as "create an account", producing duplicates.
    const admin = { listUsers: async () => ({ data: null, error: { message: 'service unavailable' } }) };

    await expect(fetchSupabaseUsers(admin, 2)).rejects.toThrow(/service unavailable/);
  });

  it('refuses a directory it cannot prove it read to the end', async () => {
    const full = [supabaseUser({ id: 'a', email: 'a@x.com' }), supabaseUser({ id: 'b', email: 'b@x.com' })];
    const admin = { listUsers: async () => ({ data: { users: full }, error: null }) };

    await expect(fetchSupabaseUsers(admin, 2)).rejects.toThrow(/truncated/);
  });
});

describe('formatDecision', () => {
  it('never prints anything but the account identity, target and claim state', () => {
    const line = formatDecision({
      kind: 'link',
      opsUserId: 'ops-1',
      email: 'ops@example.com',
      role: 'dispatcher',
      status: 'active',
      targetSupabaseUserId: 'sb-1',
      claim: 'absent',
    });

    expect(line).toContain('ops@example.com');
    expect(line).toContain('sb-1');
    expect(line).toContain('claim: absent');
    expect(line).not.toMatch(/password|hash|secret|key|token/i);
  });

  it('prints the planner s note verbatim rather than re-deriving one from the flags', () => {
    // The regression this holds: `banned` and `emailUnconfirmed` used to be
    // rendered here as standalone asides beside a decision that linked
    // anyway, which read as commentary rather than as a refusal. The planner
    // now says what it DID, and this only prints it.
    const line = formatDecision({
      kind: 'attention:identity-banned',
      opsUserId: 'ops-1',
      email: 'ops@example.com',
      role: 'dispatcher',
      status: 'active',
      targetSupabaseUserId: 'sb-1',
      claim: 'absent',
      banned: true,
      note: 'REFUSED: the matched Supabase identity is banned.',
    });

    expect(line).toContain('ATTENTION identity-banned');
    expect(line).toContain('REFUSED');
    expect(line).not.toContain('may not be able to sign in yet');
  });
});
