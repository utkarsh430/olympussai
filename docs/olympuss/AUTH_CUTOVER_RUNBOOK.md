# Auth cutover runbook: one front door

Operator procedure for collapsing this app's two auth systems onto Supabase Auth, and for backing out of it.

The design, and why `ops_users.id` is never re-keyed, is in [`RBAC.md`](./RBAC.md) and in the header of `db/migrations/20260812094500__ops_users_supabase_link.sql`.
This file is only the order of operations.

**The single requirement this whole procedure exists to satisfy: at no point is there a moment where nobody can sign in.**
Every step below is reversible on its own, and the legacy `/ops/login` password path keeps working until the very last step deliberately closes it.
`ops_users.password_hash` is never touched by any of this - it is the rollback fuel, and it stays populated.

## What is actually being changed

|                            | before                                   | after                                          |
| -------------------------- | ---------------------------------------- | ---------------------------------------------- |
| Sign-in page for operators | `/ops/login`                             | `/login` (the Supabase one)                    |
| Credential                 | bcrypt in `ops_users.password_hash`      | Supabase Auth                                  |
| Session                    | `olympuss_ops_session` HS256 cookie      | Supabase session cookies                       |
| Who you are                | `ops_users` row, found by email at login | `ops_users` row, found by `supabase_user_id`   |
| Your role                  | claim inside the ops token               | `ops_users.role`, re-read on every request     |
| Fast Edge check            | role claim in the ops token              | `app_metadata.ops_role` in the Supabase token  |

`ops_users` survives, with the same primary key, the same 14 foreign keys pointing at it, and the same append-only audit trail.
The only new column is `supabase_user_id`.

## The three moving parts, and their order

They are separate steps on purpose, and the order is not arbitrary.

1. **Link** - `ops_users.supabase_user_id` is populated, so a Supabase identity resolves to an ops profile.
   Until this happens the guard finds no profile and grants no ops access.
   This runbook's script does this.
2. **Push role claims** - `app_metadata.ops_role` is written on each Supabase user (`POST /api/ops/admin/users/:id/role`, listed by `GET /api/ops/admin/role-drift`), so the role rides in the token and the Edge middleware has a ceiling to check.
   **Until this happens a Supabase-only session cannot pass the Edge gate at all**, no matter how correct the link is.
3. **Close the old door** - `/ops/login` is removed and the guard redirects to `/login`.

Doing 3 before 2, or 2 before 1, locks operators out.
Doing 1 and 2 with 3 still pending locks nobody out of anything - which is exactly why the old door stays open across a soak.

## Before you start

- [ ] `pnpm migrate:ops` has been run against the ops database, so `ops_users.supabase_user_id` exists.
- [ ] You have `SUPABASE_SERVICE_ROLE_KEY` for **the same Supabase project** the app runs against (`NEXT_PUBLIC_SUPABASE_URL`).
      Pointing the backfill at the wrong project is the single most damaging mistake available here; step 1 detects it, see below.
- [ ] You can reach the ops database directly with `psql`.
      Every rollback in this document assumes it, and the last one requires it.
- [ ] You know which `ops_users` row is **yours**, and that it is `role = 'admin'`, `status = 'active'`.

## Step 0 - record what "working" looks like today

Sign in through **both** doors and confirm both work:

- `/ops/login` with your ops password, landing on your role's dashboard.
- `/login` with your Supabase password, landing on `/project/upsrtc`.

If you do not have a Supabase account at all, create one **now**, before anything else, using the email that is on your `ops_users` row:

```sh
SUPABASE_URL=https://<project>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=... \
  pnpm create-project-user -- --email you@example.com
```

It prompts for the password with echo disabled.
Use a different password from your ops one if you like - after cutover the Supabase one is the only one that matters.

## Step 1 - dry-run the backfill and read every line

```sh
OPS_DATABASE_URL=postgres://... \
SUPABASE_URL=https://<project>.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=... \
  pnpm backfill-ops-links
```

This writes nothing.
It prints one line per `ops_users` row and a `RESULT:` summary.
Read all of it - the whole point of this step is that the surprises surface here rather than during a write.

| line                                | meaning                                                      | what to do                                                       |
| ----------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------- |
| `[LINK]`                            | will be linked to the named identity                         | nothing; this is the plan                                        |
| `[ok]`                              | already linked correctly                                     | nothing                                                          |
| `[skip] (..., disabled)`            | disabled account, matched but not linked                     | leave it, or re-run with `--include-disabled`                    |
| `[ATTENTION no-identity]`           | no Supabase user with that email                             | create one (step 2), or decide the account is dead               |
| `[ATTENTION no-email]`              | the ops row has no usable email address                      | fix the address in `ops_users`, or disable the row               |
| `[ATTENTION ambiguous-identity]`    | two Supabase users share that address                        | delete or rename the wrong one in the Supabase dashboard         |
| `[ATTENTION duplicate-ops-email]`   | two ops rows share that address                              | disable the stale one; only one may own the identity             |
| `[ATTENTION identity-taken]`        | that identity is already linked to a different ops row       | unlink the wrong one (see rollback) before re-running            |
| `[ATTENTION linked-elsewhere]`      | the row is already linked to some other identity             | investigate; the script will never re-point it                   |
| `[ATTENTION linked-email-differs]`  | linked fine, but the identity signs in under another address | harmless today; reconcile the addresses when convenient          |
| `[ATTENTION linked-unknown]`        | linked to an id this Supabase project does not have          | **stop** - almost always the wrong Supabase project              |

Also read the `claim:` field on each line.

- `absent` - expected at this stage, and fixed by step 4.
- `ok` - the role claim agrees with the database.
- `mismatch(<role>)` - the token would claim a different role than the database holds.
  After cutover the guard refuses that session outright, so step 4 must correct it.

If `[ATTENTION linked-unknown]` appears on rows you have never linked, or the identity count looks wrong for your organisation, **stop and check which Supabase project the credentials belong to.**
Resolving that as "everyone needs a new account" would create a duplicate account for every operator.

## Step 2 - resolve every ATTENTION row

Nothing here is optional, and none of it can be resolved by the script, because each one needs a decision only a human can make.

- **`no-identity`** - either create the Supabase account (`pnpm create-project-user`, as in step 0), or accept that the person is gone and disable the ops row through the admin screen.
- **`no-email`** - correct `ops_users.email` (an admin can do this in the database; there is no UI for it), or disable the row.
- **`ambiguous-identity` and `duplicate-ops-email`** - exactly one row on each side may own the identity.
  Remove or disable the other.
- **`linked-unknown`** - see the warning in step 1.

Re-run the dry run until only `[LINK]`, `[ok]` and deliberate `[skip]` lines remain.

## Step 3 - link YOUR OWN account first, and prove it

This is the step that keeps you from being locked out of your own product.
Do it alone, before anyone else's account is touched.

**3a.** Link only your account.

```sh
OPS_DATABASE_URL=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  pnpm backfill-ops-links -- \
    --email you@example.com \
    --apply \
    --actor-email you@example.com
```

`--actor-email` must be an active admin.
Each link is recorded in `ops_audit_log` as `admin.user.supabase_link`, attributed to that account.
(`--no-audit` exists for the case where you genuinely have no admin row to attribute to.
It is an explicit acknowledgement, not a default.)

Note that `RESULT:` on a `--email` run reports only the account you named, and says so on the line.
It is not a statement about the fleet.

**3b.** Push the role claim for your account.
`POST /api/ops/admin/users/<your ops user id>/role` with the role the database **already** holds (`{"role":"admin"}`) is the push - re-assigning an unchanged role is deliberately not a no-op, it re-writes `app_metadata.ops_role` as an ordinary audited assignment.

Do this **while signed in through the legacy ops session**, and this is the part that is easy to get wrong.
That endpoint sits behind `/api/ops/*`, which the Edge gate protects, and until your claim exists a Supabase-only session has no ceiling to pass it with.
The legacy `olympuss_ops_session` cookie does, which is precisely why `/ops/login?legacy=1` still exists and why step 3c tells you not to sign out of it.

**3c.** Prove both doors, in this order, and do not skip any of them.

1. In your **normal** browser, stay signed in at `/ops/login`.
   Do not sign out.
   This is your escape hatch for the rest of the procedure.
2. In a **private window**, sign in at `/login` with your Supabase password, and confirm you reach your ops dashboard with admin access.
3. Back in the normal browser, confirm the old session still works.

If (2) fails, **stop and roll back your own link** (Rollback A).
Nothing else has been touched yet and the old door is still open, so a failure here costs you nothing but time.

## Step 4 - link everyone else, then push every role claim

```sh
OPS_DATABASE_URL=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  pnpm backfill-ops-links -- --apply --actor-email you@example.com
```

Then push a role claim for every remaining account, again from the legacy admin session.
`GET /api/ops/admin/role-drift` lists exactly which accounts need it: `claim_missing` is every account this backfill has just linked, and `claim_stale` is one whose token would claim the wrong role.
Repair each by re-assigning the role the database already holds, as in 3b.
Re-read the drift report until it is empty.

Then run the backfill dry run one final time as an independent verification pass - it reads the same two systems from the other side.
**Every row must read `claim: ok`, and `needs-attention` must be `0`.**
A row reading `claim: absent` cannot pass the Edge gate once the old door closes, and a row reading `claim: mismatch(...)` is refused outright.

Tell your operators one thing before you go further: **after a role change they must sign out and sign in again.**
The role rides in their token, and a token minted before the change disagrees with the database, which the guard refuses on purpose.

## Step 5 - soak with both doors open

Leave `/ops/login` open and let people use `/login` for at least a full operating cycle - a shift changeover, ideally a week.
Both doors resolve to the same `ops_users` row and get the same checks, so there is nothing to keep in sync and no reason to hurry.

Watch for anyone who cannot sign in at `/login`, and for any row that has drifted back to `claim: absent` or `mismatch`.
`GET /api/ops/admin/role-drift` and a backfill dry run both answer this; each is read-only and safe to run any number of times.
Drift after cutover is not hypothetical - editing `app_metadata` in the Supabase dashboard or a role changed by hand with `psql` both produce it, and it presents to the operator as "I sign in and it immediately says my session is out of date", which is close to undiagnosable from their side.

## Step 6 - close the old door

Only when step 4's verification is clean and step 5 surfaced nothing: remove `/ops/login` and repoint the guard's redirect at `/login`.

That change is code, not configuration, so backing it out is a deploy.
Everything before it is reversible without one, which is why it is last.

Do **not** drop `ops_users.password_hash` at the same time.
Leave it until the new door has been the only door for a stated soak period.
It costs nothing to keep, and it is the difference between a configuration rollback and a password reset for every operator.

## Rollback

Take the lowest-numbered one that fixes your problem.

**Rollback A - one wrongly linked account.**
The link is the only thing to undo.

```sql
update ops_users set supabase_user_id = null where email = 'them@example.com';
```

That account immediately goes back to signing in at `/ops/login` with its existing password, and nothing else changes.
The audit row for the original link stays; that table is append-only by design and cannot be edited.

**Rollback B - the links are wrong across the board.**
Same statement, unfiltered.

```sql
update ops_users set supabase_user_id = null;
```

Everyone is back on the legacy path.
No password is reset, no account is deleted, no Supabase user is touched, and the column and its indexes stay in place ready for a corrected run.

**Rollback C - the new front door itself is the problem, after step 6.**
Redeploy the previous release.
`/ops/login` returns, and because `password_hash` was never cleared, every account's old password still works.
The `supabase_user_id` values are inert while the old door is in use, so they harm nothing and can stay.

**Rollback D - you are locked out entirely.**
With direct database access you always have a way back in.

```sql
-- confirm your row is what you think it is
select id, email, role, status, supabase_user_id from ops_users where email = 'you@example.com';

-- re-enable it if something disabled it
update ops_users set status = 'active', disabled_at = null, disabled_by = null
 where email = 'you@example.com';

-- and drop the link, so the legacy password path is authoritative again
update ops_users set supabase_user_id = null where email = 'you@example.com';
```

If your password itself is the problem, `pnpm seed-ops-admin` re-seeds the first admin (it refuses when an active admin already exists), and `pnpm seed-ops-user` re-points a non-admin account's password.
Both read the password from a hidden prompt, never from argv.

**What no rollback requires:** restoring a backup, resetting anyone's password, deleting a Supabase user, or reversing the migration.
The migration adds a nullable column and two indexes.
Leaving it applied costs nothing, and removing it would only make a retry harder.

## The backfill script itself

`scripts/backfill-ops-supabase-links.mjs`, wired up as `pnpm backfill-ops-links`.

- **Dry run by default.**
  `--apply` is required to write, and it writes exactly what the dry run printed.
- **Matches on email, case-insensitively, and on nothing else.**
  Anything it cannot resolve with certainty is reported for a human.
  Nothing is silently skipped.
- **Never creates, modifies or deletes a Supabase user.**
  Its only Supabase call is a read.
- **Never writes `app_metadata`.**
  It reports the claim state; `POST /api/ops/admin/users/:id/role` owns writing it.
- **Never re-points or clears an existing link**, and never touches `password_hash`, `role` or `status`.
- **Safe to re-run.**
  Already-linked rows are a no-op, and the write is guarded against a concurrent run.
- **Never prints a secret** - not the service-role key, not a password, not a hash.
  It prints the Supabase project host, which is public, and never the database URL, which carries a password.

`--help` documents every flag.
Read it before `--apply`.
