'use client';

import { useCallback, useEffect, useState } from 'react';
import type { OpsRoleDriftReport, OpsRoleDriftKind } from '@/lib/auth/rbac/roleDrift';
import {
  OpsAlert,
  OpsButton,
  OpsPanel,
  OpsStack,
  OpsTableFrame,
  opsTableClass,
  opsTdClass,
  opsTdMutedClass,
  opsTheadRowClass,
  opsThClass,
  opsTrClass,
} from '@/components/ops/ui';

/**
 * The two-store role check, given a surface.
 *
 * `GET /api/ops/admin/role-drift` has existed since the auth collapse and had
 * no screen: the one failure mode of the two-store design that produces no
 * error anywhere until an operator cannot sign in was reachable only by typing
 * the URL of a JSON endpoint. It is now on the admin console's overview, which
 * is the one place the person who can repair it is already standing.
 *
 * ─── WHY IT IS NOT POLLED, AND WHY IT IS NOT AUTOMATIC ───────────────────
 *
 * The check reads Supabase Auth once per linked account, five at a time, so it
 * is a burst of admin-API calls against a rate-limited service — not something
 * to run on a timer behind a screen somebody left open. It runs on mount and
 * on demand.
 *
 * And it never repairs. The repair is a normal audited role assignment
 * (POST /api/ops/admin/users/:id/role with the role the database already
 * holds), performed from the people screen, deliberately by a person: a
 * checker that silently repaired would be deciding which of the two stores was
 * right, and the reason a mismatch is refused rather than resolved is that
 * neither is knowable from here.
 */

/** What each disagreement actually costs the operator, in the admin's language. */
const DRIFT_CONSEQUENCE: Record<OpsRoleDriftKind, string> = {
  claim_missing:
    'Their sign-in carries no role, so the operations console refuses them at the edge before any page is reached. Everything else about the account is fine.',
  claim_stale:
    'Their sign-in carries a different role than this system holds. Every request is refused — to them it looks like being signed out the moment they sign in.',
  claim_lingering:
    'The account is disabled but its sign-in still carries an ops role. Not an access path — access is refused on status first — but evidence a disable did not finish.',
  identity_missing:
    'The linked sign-in account no longer exists, so this person cannot sign in at all.',
  unreadable:
    'The sign-in provider could not be read for this account, so its state is unknown rather than clean.',
};

const DRIFT_LABEL: Record<OpsRoleDriftKind, string> = {
  claim_missing: 'No role on sign-in',
  claim_stale: 'Roles disagree',
  claim_lingering: 'Leftover role on a disabled account',
  identity_missing: 'Sign-in account missing',
  unreadable: 'Could not be checked',
};

export function OpsAdminRoleDriftPanel() {
  const [report, setReport] = useState<OpsRoleDriftReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/ops/admin/role-drift', { cache: 'no-store' });
      const data = (await response.json().catch(() => null)) as
        | OpsRoleDriftReport
        | { error?: { message?: string } }
        | null;
      if (!response.ok || !data || !('drift' in data)) {
        setError(
          (data && 'error' in data && data.error?.message) ||
            'The role check could not be run just now.',
        );
        // Deliberately keeps any previous report on screen rather than blanking
        // it: a failed re-check does not un-observe what the last one found.
        return;
      }
      setReport(data);
    } catch {
      setError('The role check could not be run just now.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <OpsPanel
      title="Sign-in roles against this system's roles"
      description="A role lives in two places. When they disagree the operator is not escalated — they are locked out, silently, and it presents as a session that expires the instant they sign in."
      actions={
        <OpsButton variant="quiet" onClick={() => void load()} disabled={busy}>
          {busy ? 'Checking…' : 'Re-check'}
        </OpsButton>
      }
    >
      <OpsStack gap="tight">
        {error && <OpsAlert tone="warning">{error}</OpsAlert>}

        {!report && !error && <p className="text-sm text-ops-muted">Checking every account…</p>}

        {report && (
          <>
            {report.drift.length === 0 ? (
              <OpsAlert tone="success">
                All {report.linkedUsers} linked{' '}
                {report.linkedUsers === 1 ? 'account agrees' : 'accounts agree'} with their sign-in.
                {report.unlinkedUsers > 0 && (
                  <>
                    {' '}
                    {report.unlinkedUsers} further{' '}
                    {report.unlinkedUsers === 1 ? 'account has' : 'accounts have'} no sign-in
                    identity to disagree with — they sign in through the legacy door, and are not
                    covered by this check.
                  </>
                )}
              </OpsAlert>
            ) : (
              <>
                <OpsAlert tone="warning" title={`${report.drift.length} of ${report.linkedUsers} accounts disagree`}>
                  Repair each one by re-assigning the role this system already holds, on the people
                  screen. That re-pushes the claim as an ordinary audited assignment — this check
                  never changes anything itself, because it cannot know which of the two stores is
                  the correct one.
                </OpsAlert>
                <OpsTableFrame>
                  <table className={opsTableClass}>
                    <thead>
                      <tr className={opsTheadRowClass}>
                        <th className={opsThClass}>Account</th>
                        <th className={opsThClass}>This system</th>
                        <th className={opsThClass}>Their sign-in</th>
                        <th className={opsThClass}>What it costs them</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.drift.map((entry) => (
                        <tr key={entry.opsUserId} className={opsTrClass}>
                          <td className={opsTdClass}>
                            <span className="block">{entry.email}</span>
                            <span className="text-[11px] uppercase tracking-[0.12em] text-ops-faint">
                              {DRIFT_LABEL[entry.kind]}
                            </span>
                          </td>
                          <td className={opsTdClass}>
                            {entry.databaseRole.replace('_', ' ')}
                            {entry.databaseStatus === 'disabled' && (
                              <span className="ml-1 text-ops-faint">(disabled)</span>
                            )}
                          </td>
                          <td className={opsTdMutedClass}>
                            {entry.claimRole ? entry.claimRole.replace('_', ' ') : '—'}
                          </td>
                          <td className={opsTdMutedClass}>
                            {DRIFT_CONSEQUENCE[entry.kind]}
                            {entry.detail ? ` (${entry.detail})` : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </OpsTableFrame>
              </>
            )}
            <p className="text-[11px] text-ops-faint">
              Checked {new Date(report.checkedAt).toLocaleString()} · {report.totalUsers} accounts,{' '}
              {report.linkedUsers} with a sign-in identity. This reads the stored role, so it
              describes the next token an operator will be issued — a token already in hand can lag
              a repair by up to its own lifetime, and that is not drift.
            </p>
          </>
        )}
      </OpsStack>
    </OpsPanel>
  );
}
