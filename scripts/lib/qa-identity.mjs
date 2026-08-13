/**
 * The QA identity namespace, and every Supabase Auth write that automation is
 * allowed to make.
 *
 * ─── WHY THIS MODULE EXISTS ──────────────────────────────────────────────
 *
 * CI now authenticates against the project's REAL Supabase directory, because
 * that is the only place the single front door can be exercised end to end.
 * That directory holds real people's accounts. And the ops end-to-end suite
 * deliberately DISABLES accounts mid-render — it has to, that race is the
 * defect it was written for.
 *
 * So the failure being designed against is not "a test fails". It is "a CI
 * run, triggered by any pull request from anyone, deletes or bans a real
 * person's login". A convention written in a comment does not prevent that; a
 * regex someone remembers to apply does not prevent it either, because the
 * one place it gets forgotten is the one that matters. What prevents it is
 * having no reachable code path that can name an identity outside the
 * namespace.
 *
 * ─── THE RULE ────────────────────────────────────────────────────────────
 *
 *   <anything>.qa@example.test
 *
 * `.test` is reserved by RFC 2606 and can never be delegated, so no address
 * in this namespace can belong to a real mailbox, be registered by anyone, or
 * receive mail — a QA identity is structurally incapable of being somebody's
 * account. The `.qa` local-part suffix narrows it further so a stray
 * `someone@example.test` used for an unrelated fixture is still refused.
 *
 * ─── THE ENFORCEMENT ─────────────────────────────────────────────────────
 *
 * 1. Every export below that touches Supabase Auth calls `assertQaIdentity`
 *    on the address IMMEDIATELY BEFORE the call, not when arguments were
 *    parsed. Validation that happens early is validation something can be
 *    added after.
 * 2. `removeQaIdentities` accepts NO address, id, or filter from its caller.
 *    It lists the directory, keeps only what the namespace predicate admits,
 *    and re-asserts each surviving record before deleting it. There is no
 *    signature through which a caller could hand it the captain's account.
 * 3. Deletion re-reads the record it is about to delete by id and checks the
 *    address again, so a list/delete race cannot land on a different user.
 * 4. `assertQaIdentity` refuses rather than sanitising. Trimming, unwrapping
 *    or otherwise repairing a rejected address is how `admin.qa@example.test
 *    <captain@real.com>` becomes a delete.
 *
 * src/tests/unit/qaIdentityNamespace.test.ts is the proof that it refuses.
 */

/** The only mail domain a QA identity may live in. RFC 2606 reserved. */
export const QA_IDENTITY_DOMAIN = 'example.test';

/** The local-part suffix that marks an address as automation-owned. */
export const QA_IDENTITY_LOCAL_SUFFIX = '.qa';

/**
 * Deliberately strict, and anchored at both ends.
 *
 * Only lowercase letters, digits and `. _ + -` in the local part, which must
 * start and end with an alphanumeric and end with `.qa`. No quoted strings,
 * no display names, no angle brackets, no whitespace anywhere, no second `@`.
 * Every one of those is a way to write an address that reads as in-namespace
 * to a human and resolves elsewhere to a mail parser.
 */
const QA_IDENTITY_PATTERN = /^[a-z0-9](?:[a-z0-9._+-]*[a-z0-9])?\.qa@example\.test$/;

/** Refused by RFC 5321 anyway, but stated here so length is our rule too. */
const MAX_EMAIL_LENGTH = 254;

/**
 * Thrown instead of returning a value, so a caller that ignores results still
 * cannot proceed. Its own class so a test can assert the refusal came from
 * here rather than from Supabase rejecting something later.
 */
export class QaNamespaceViolation extends Error {
  constructor(email, action) {
    super(
      `Refusing to ${action}: "${email}" is outside the QA identity namespace ` +
        `(*${QA_IDENTITY_LOCAL_SUFFIX}@${QA_IDENTITY_DOMAIN}). Automation may only ` +
        'create, change or remove identities inside it. Real accounts are provisioned ' +
        'by an admin invite, never by a script.',
    );
    this.name = 'QaNamespaceViolation';
    this.email = email;
    this.action = action;
  }
}

/**
 * Whether `value` is an address automation owns.
 *
 * TOTAL AND SILENT: any input at all, including null, numbers and objects,
 * answers false rather than throwing. Callers that need a refusal use
 * `assertQaIdentity`; callers filtering a directory listing need a predicate
 * that cannot blow up on a malformed row.
 *
 * Case is folded because Supabase stores addresses lowercased and a listing
 * could still return mixed case; nothing else is normalised, on purpose —
 * see this module's header on why repair is not a kindness here.
 */
export function isQaIdentityEmail(value) {
  if (typeof value !== 'string') return false;
  if (value.length === 0 || value.length > MAX_EMAIL_LENGTH) return false;
  return QA_IDENTITY_PATTERN.test(value.toLowerCase());
}

/**
 * Refuse unless `email` is in the namespace. Returns the lowercased address
 * so callers use the checked value rather than the one they were handed.
 *
 * @param {unknown} email
 * @param {string} action Named in the error, e.g. 'create a sign-in identity'.
 */
export function assertQaIdentity(email, action) {
  if (!isQaIdentityEmail(email)) {
    throw new QaNamespaceViolation(typeof email === 'string' ? email : String(email), action);
  }
  return email.toLowerCase();
}

/**
 * Build a QA address for one role in one CI run.
 *
 * RUN-SCOPED ON PURPOSE. Two pull requests can run this workflow at the same
 * time against the same Supabase project. Sharing one fixed address between
 * them means the second run's `createUser` collides with the first's, and the
 * first run's teardown deletes the second run's account out from under it —
 * so a green change goes red for reasons that have nothing to do with it.
 * The run scope keeps concurrent runs from ever naming the same identity.
 *
 * Asserts its own output, so a scope containing something unexpected fails
 * here rather than producing an address that quietly escapes the namespace.
 *
 * @param {string} label Role or purpose, e.g. 'dispatcher'.
 * @param {string} scope Run-unique token, e.g. `${run_id}-${run_attempt}`.
 */
export function qaIdentityEmail(label, scope) {
  const clean = (part) =>
    String(part ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  const local = `${clean(label)}.${clean(scope)}`;
  return assertQaIdentity(
    `${local}${QA_IDENTITY_LOCAL_SUFFIX}@${QA_IDENTITY_DOMAIN}`,
    'build a QA identity address',
  );
}

/** Reads the ops role claim off a Supabase user record. */
function opsRoleClaimOf(user) {
  const value = user?.app_metadata?.ops_role;
  return typeof value === 'string' ? value : null;
}

function describe(error) {
  const message = error?.message;
  return typeof message === 'string' && message.length > 0 ? message : 'Supabase Auth error.';
}

/**
 * Create — or bring into line — the sign-in identity for one QA account, and
 * return its Supabase user id.
 *
 * Idempotent by address, because a re-run against a warm directory has to
 * behave the same as a run against a cold one. An existing QA identity has
 * its password and role claim rewritten; that is a MODIFICATION of an
 * identity, so it goes through the same assertion as a creation.
 *
 * The role claim is written at creation rather than pushed afterwards, so the
 * very first access token the account is issued already carries the ceiling
 * Edge middleware checks. Read back off the response, because
 * `updateUserById` merges server-side and a merge that silently did nothing
 * is indistinguishable from one that worked if only the error is checked.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} admin Service-role client.
 */
export async function upsertQaIdentity(admin, { email, password, opsRole }) {
  const address = assertQaIdentity(email, 'create a sign-in identity');

  const created = await admin.auth.admin.createUser({
    email: address,
    password,
    email_confirm: true,
    app_metadata: { ops_role: opsRole },
  });

  if (!created.error) {
    const user = created.data?.user;
    if (!user?.id) throw new Error('Supabase Auth created no user.');
    if (opsRoleClaimOf(user) !== opsRole) {
      throw new Error(`Created ${address} but its ops_role claim did not stick.`);
    }
    return { supabaseUserId: user.id, created: true };
  }

  if (!isAlreadyRegistered(created.error)) {
    throw new Error(`Supabase Auth refused to create ${address}: ${describe(created.error)}`);
  }

  // Already there from an earlier run. Find it — again by listing and
  // filtering rather than by trusting a lookup we could mistype.
  const existing = await findQaIdentityByEmail(admin, address);
  if (!existing) {
    throw new Error(
      `Supabase Auth says ${address} already exists but it is not in the directory listing.`,
    );
  }

  // Second assertion, on the address as the DIRECTORY reports it rather than
  // as we asked for it. Anything else is trusting our own input twice.
  assertQaIdentity(existing.email, 'update a sign-in identity');

  const updated = await admin.auth.admin.updateUserById(existing.id, {
    password,
    email_confirm: true,
    app_metadata: { ...(existing.app_metadata ?? {}), ops_role: opsRole },
    ban_duration: 'none',
  });
  if (updated.error) {
    throw new Error(`Supabase Auth refused to update ${address}: ${describe(updated.error)}`);
  }
  if (opsRoleClaimOf(updated.data?.user) !== opsRole) {
    throw new Error(`Updated ${address} but its ops_role claim did not stick.`);
  }
  return { supabaseUserId: existing.id, created: false };
}

function isAlreadyRegistered(error) {
  if (error?.code === 'email_exists' || error?.code === 'user_already_exists') return true;
  const message = typeof error?.message === 'string' ? error.message.toLowerCase() : '';
  return error?.status === 422 && message.includes('already');
}

/**
 * Every identity in the directory that the namespace admits.
 *
 * This is the ONLY way anything here obtains a user id, and it is why no
 * export takes one as a parameter. Pages the full listing; Supabase caps
 * `perPage`, and a directory larger than one page is exactly where a naive
 * first-page-only sweep would leave QA identities behind forever.
 */
export async function listQaIdentities(admin) {
  const found = [];
  const perPage = 200;
  for (let page = 1; page <= 200; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`Could not list Supabase identities: ${describe(error)}`);
    const users = data?.users ?? [];
    for (const user of users) {
      if (isQaIdentityEmail(user.email)) found.push(user);
    }
    if (users.length < perPage) return found;
  }
  throw new Error('Supabase directory listing did not terminate; refusing to guess.');
}

async function findQaIdentityByEmail(admin, address) {
  const all = await listQaIdentities(admin);
  return all.find((user) => (user.email ?? '').toLowerCase() === address) ?? null;
}

/**
 * Delete QA identities, and verify afterwards that they are gone.
 *
 * TAKES NO ADDRESSES. The caller may narrow what gets deleted, never widen
 * it: `scope` keeps a run to identities it created, and `olderThanMs` sweeps
 * leftovers from runs that were cancelled before their own teardown ran. Both
 * filters apply INSIDE the namespace, so the worst a wrong filter can do is
 * delete another QA account.
 *
 * Verification is not decoration. A teardown that reports success while
 * leaving accounts behind is how a shared directory silently fills with stale
 * logins, and the next run's `createUser` then collides with a ghost.
 *
 * @returns {Promise<{deleted: string[], failed: {email: string, reason: string}[], remaining: string[]}>}
 */
export async function removeQaIdentities(admin, { scope, olderThanMs } = {}) {
  const scopeToken = scope
    ? String(scope)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
    : null;
  const cutoff = typeof olderThanMs === 'number' ? Date.now() - olderThanMs : null;

  const candidates = (await listQaIdentities(admin)).filter((user) => {
    const local = (user.email ?? '').toLowerCase().split('@')[0] ?? '';
    if (scopeToken && !local.includes(scopeToken)) return false;
    if (cutoff !== null) {
      const createdAt = Date.parse(user.created_at ?? '');
      // An unreadable timestamp is not evidence of age. Keep it.
      if (!Number.isFinite(createdAt) || createdAt > cutoff) return false;
    }
    return true;
  });

  const deleted = [];
  const failed = [];

  for (const candidate of candidates) {
    try {
      // Re-read by id and assert again. Between the listing and this call the
      // id could, in principle, name a different account; deleting on the
      // strength of a stale listing is the one shape this module exists to
      // make impossible.
      const fresh = await admin.auth.admin.getUserById(candidate.id);
      if (fresh.error) throw new Error(describe(fresh.error));
      const address = assertQaIdentity(fresh.data?.user?.email, 'delete a sign-in identity');

      const { error } = await admin.auth.admin.deleteUser(candidate.id);
      if (error) throw new Error(describe(error));
      deleted.push(address);
    } catch (error) {
      failed.push({ email: candidate.email ?? '(unknown)', reason: describe(error) });
    }
  }

  // Confirm from the directory itself, not from the absence of errors above.
  const stillThere = (await listQaIdentities(admin)).filter((user) =>
    candidates.some((candidate) => candidate.id === user.id),
  );

  return {
    deleted,
    failed,
    remaining: stillThere.map((user) => user.email ?? '(unknown)'),
  };
}
