import type { APIRequestContext } from '@playwright/test';
import { isQaIdentityEmail } from '../../../scripts/lib/qa-identity.mjs';

/**
 * Signing an ops account in through `/login` — the single front door — and
 * refusing to do it for anything but a QA account.
 *
 * ─── WHY THE SPECS MOVED OFF THE LEGACY DOOR ─────────────────────────────
 *
 * All three ops suites used to authenticate with POST /api/ops/auth/login,
 * the legacy HS256 password endpoint. That endpoint is the last thing keeping
 * the old auth system alive, and it cannot be deleted while the only
 * end-to-end coverage of the ops console depends on it. So the suites drive
 * `/login` instead: Supabase Auth, the `app_metadata.ops_role` claim, the
 * Edge ceiling that reads it, and `resolveLanding` picking the destination —
 * the whole path a real operator now takes, none of which the legacy door
 * exercised.
 *
 * ─── THE NAMESPACE CHECK, AND WHY IT IS HERE ─────────────────────────────
 *
 * CI runs this against the project's REAL Supabase directory. `assertQaRoster`
 * refuses to let a suite so much as attempt a sign-in as an address outside
 * `*.qa@example.test`, so a mistyped or misconfigured `E2E_*_EMAIL` fails at
 * setup with a clear reason instead of driving a suite — one that disables
 * accounts on purpose — against somebody's real login. The identity-writing
 * half of the same rule lives in scripts/lib/qa-identity.mjs; this is the
 * read-side twin, and both refuse in code rather than by convention.
 */

/** Refuse the whole run if any configured account is outside the namespace. */
export function assertQaRoster(accounts: Record<string, { email?: string }>): void {
  const strays = Object.entries(accounts)
    .filter(([, account]) => account.email && !isQaIdentityEmail(account.email))
    .map(([role, account]) => `${role}=${account.email}`);

  if (strays.length > 0) {
    throw new Error(
      `Refusing to run: ${strays.join(', ')} ${strays.length === 1 ? 'is' : 'are'} outside the ` +
        'QA identity namespace (*.qa@example.test). This suite signs in against the real ' +
        'Supabase directory and deliberately disables accounts, so it may only ever be pointed ' +
        'at throwaway QA identities. Fix the E2E_*_EMAIL values rather than relaxing this check.',
    );
  }
}

/** Cookie names Supabase Auth writes its session into (it chunks large ones). */
export function isSupabaseAuthCookie(name: string): boolean {
  return /^sb-.+-auth-token(\.\d+)?$/.test(name);
}

export interface FrontDoorSession {
  /** Where the SERVER said this account belongs. */
  redirectTo: string;
  /**
   * `name=value; name=value` for every cookie the sign-in set, ready to put on
   * a `Cookie` request header.
   *
   * Read from every `Set-Cookie` on the response rather than just the first:
   * Supabase splits a session that exceeds the per-cookie size limit across
   * `…-auth-token.0`, `…-auth-token.1`, and `headers()` collapses repeated
   * `Set-Cookie` values into one newline-joined string, so anything that reads
   * a single header silently keeps chunk zero and drops the rest.
   */
  cookieHeader: string;
}

/**
 * Sign in at the single front door, or throw saying exactly what went wrong.
 *
 * Fails loudly on a `?notice=` destination rather than returning it. That URL
 * means the sign-in SUCCEEDED and the account still has nowhere to go — no
 * linked `ops_users` profile, or a role claim that never reached Supabase
 * Auth — which is a broken fixture, not a test failure to be discovered three
 * assertions later as a mysterious redirect to a login page.
 */
export async function signInThroughFrontDoor(
  request: APIRequestContext,
  { email, password, origin }: { email: string; password: string; origin: string },
): Promise<FrontDoorSession> {
  if (!isQaIdentityEmail(email)) {
    throw new Error(
      `Refusing to sign in as "${email}": outside the QA identity namespace (*.qa@example.test).`,
    );
  }

  const response = await request.post('/api/auth/login', {
    headers: { 'Content-Type': 'application/json', Origin: origin },
    data: { email, password },
  });

  if (!response.ok()) {
    throw new Error(
      `sign-in failed for ${email} (${response.status()}): ${await response.text()}`,
    );
  }

  const { redirectTo } = (await response.json()) as { redirectTo?: string };
  if (!redirectTo) {
    throw new Error(`sign-in for ${email} returned no destination`);
  }
  if (redirectTo.startsWith('/login')) {
    throw new Error(
      `${email} signed in but has no usable ops access (server sent it to ${redirectTo}). ` +
        'The seeded account is missing its ops_users link or its app_metadata.ops_role claim — ' +
        'check the seeding step, not this assertion.',
    );
  }

  const cookieHeader = response
    .headersArray()
    .filter((header) => header.name.toLowerCase() === 'set-cookie')
    // Everything after the first `;` is attributes (Path/HttpOnly/SameSite),
    // which belong on a response header and never on a request one.
    .map((header) => header.value.split(';', 1)[0]!.trim())
    .filter((pair) => pair.length > 0 && !pair.endsWith('='))
    .join('; ');

  if (!cookieHeader.includes('sb-')) {
    throw new Error(`sign-in for ${email} set no Supabase session cookie`);
  }

  return { redirectTo, cookieHeader };
}
