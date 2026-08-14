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
    'Their sign-in carries no role at all, so this console turns them away before any page loads. Everything else about the account is fine.',
  claim_stale:
    'Their sign-in says one role and this system says another. Every request is refused — to them it looks like being signed out the moment they sign in.',
  claim_lingering:
    'The account is disabled, but its sign-in still carries a role here. It is not a way in — access is refused on the disabled status first — but it is evidence that a disable did not finish.',
  identity_missing: 'The sign-in account is gone, so this person cannot sign in at all.',
  unreadable:
    'The sign-in provider could not be read for this account, so its state is unknown rather than known to be fine.',
};

const DRIFT_LABEL: Record<OpsRoleDriftKind, string> = {
  claim_missing: 'No role on sign-in',
  claim_stale: 'The two disagree',
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
        OpsRoleDriftReport | { error?: { message?: string } } | null;
      if (!response.ok || !data || !('drift' in data)) {
        setError(
          (data && 'error' in data && data.error?.message) ||
            'This check could not be run just now.',
        );
        // Deliberately keeps any previous report on screen rather than blanking
        // it: a failed re-check does not un-observe what the last one found.
        return;
      }
      setReport(data);
    } catch {
      setError('This check could not be run just now.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <OpsPanel
      title="Where sign-in and this system disagree about someone's role"
      description="A role is kept in two places. When they disagree, nobody gets extra access — the person is locked out instead, silently, and to them it looks like being signed out the moment they sign in."
      actions={
        <OpsButton variant="quiet" onClick={() => void load()} disabled={busy}>
          {busy ? 'Checking…' : 'Check again'}
        </OpsButton>
      }
    >
      <OpsStack gap="tight">
        {error && <OpsAlert tone="warning">{error}</OpsAlert>}

        {!report && !error && (
          <p className="text-sm text-muted-foreground">Checking every account…</p>
        )}

        {report && (
          <>
            {report.drift.length === 0 ? (
              <OpsAlert tone="success">
                All {report.linkedUsers}{' '}
                {report.linkedUsers === 1 ? 'account agrees' : 'accounts agree'} with their sign-in.
                {report.unlinkedUsers > 0 && (
                  <>
                    {' '}
                    {report.unlinkedUsers} further{' '}
                    {report.unlinkedUsers === 1
                      ? 'account signs in through the older door and has'
                      : 'accounts sign in through the older door and have'}{' '}
                    no separate sign-in record to disagree with, so this check does not cover{' '}
                    {report.unlinkedUsers === 1 ? 'it' : 'them'}.
                  </>
                )}
              </OpsAlert>
            ) : (
              <>
                <OpsAlert
                  tone="warning"
                  title={`${report.drift.length} of ${report.linkedUsers} accounts disagree`}
                >
                  Fix each one on the people screen by setting the person to the role this system
                  already holds. That writes the role onto their sign-in again, recorded like any
                  other change. This check never changes anything itself, because it cannot know
                  which of the two is the correct one.
                </OpsAlert>
                <OpsTableFrame>
                  <table className={opsTableClass}>
                    <thead>
                      <tr className={opsTheadRowClass}>
                        <th className={opsThClass}>Account</th>
                        <th className={opsThClass}>This system says</th>
                        <th className={opsThClass}>Their sign-in says</th>
                        <th className={opsThClass}>What it costs them</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.drift.map((entry) => (
                        <tr key={entry.opsUserId} className={opsTrClass}>
                          <td className={opsTdClass}>
                            <span className="block">{entry.email}</span>
                            <span className="text-[11px] text-subtle">
                              {DRIFT_LABEL[entry.kind]}
                            </span>
                          </td>
                          <td className={opsTdClass}>
                            {entry.databaseRole.replace(/_/g, ' ')}
                            {entry.databaseStatus === 'disabled' && (
                              <span className="ml-1 text-subtle">(disabled)</span>
                            )}
                          </td>
                          <td className={opsTdMutedClass}>
                            {entry.claimRole ? (
                              entry.claimRole.replace(/_/g, ' ')
                            ) : (
                              <span title="their sign-in carries no role at all">
                                <span aria-hidden>—</span>
                                <span className="sr-only">no role at all</span>
                              </span>
                            )}
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
            <p className="text-[11px] text-subtle">
              Checked {new Date(report.checkedAt).toLocaleString()} · {report.totalUsers} accounts,{' '}
              {report.linkedUsers} of them with a separate sign-in record. This reads the stored
              role, so it describes the next pass somebody will be issued — a pass already in their
              hands can lag a fix by up to its own lifetime, and that is not a disagreement.
            </p>
          </>
        )}
      </OpsStack>
    </OpsPanel>
  );
}
