'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { KillSwitchRecord } from '@/lib/auth/rbac/repo';

/**
 * Route-level and network-wide kill switches (this ticket's AC4:
 * "immediately halt new automatic commands ... both logged"). Server-
 * seeded with the currently-active list so the page never renders an
 * empty flash before the first client fetch; every engage/disengage is
 * attributed and reasoned (POST /api/ops/control-room/kill-switches,
 * .../:id/disengage), enforced at command-creation time by
 * src/app/api/ops/control-room/commands/route.ts.
 *
 * `refreshToken` lets the control-room console re-read the active list on its
 * own clock. Without it this panel only ever updated after THIS operator's own
 * engage or disengage - so a switch thrown by a colleague, or by the shift
 * before, stayed invisible here until the page was reloaded by hand. On the
 * one control that halts commands network-wide, that is not an acceptable
 * blind spot.
 */
export function KillSwitchPanel({
  initialActive,
  refreshToken,
}: {
  initialActive: KillSwitchRecord[];
  refreshToken?: number;
}) {
  const [active, setActive] = useState<KillSwitchRecord[]>(initialActive);
  const [scope, setScope] = useState<'network' | 'route'>('network');
  const [routeDirectionId, setRouteDirectionId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [disengageReason, setDisengageReason] = useState<Record<string, string>>({});
  const [disengagingId, setDisengagingId] = useState<string | null>(null);

  const errorId = useId();

  const refresh = useCallback(async () => {
    const response = await fetch('/api/ops/control-room/kill-switches', { cache: 'no-store' });
    const data = (await response.json().catch(() => null)) as { active: KillSwitchRecord[] } | null;
    // A failed read leaves the current list alone rather than emptying it: an
    // empty kill-switch list reads as "nothing is halted", which is the one
    // conclusion a dropped request must never let an operator draw.
    if (response.ok && data && Array.isArray(data.active)) setActive(data.active);
  }, []);

  // Skips the first render: the server already seeded `initialActive`, so
  // re-reading it immediately would be a wasted request on page open.
  const hasMountedRef = useRef(false);
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    void refresh();
  }, [refreshToken, refresh]);

  async function engage(event: React.FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/ops/control-room/kill-switches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          scope === 'network' ? { scope: 'network', reason } : { scope: 'route', routeDirectionId, reason },
        ),
      });
      const data = (await response.json().catch(() => null)) as { ok: true } | { error: { message: string } } | null;
      if (!response.ok || !data || !('ok' in data)) {
        setError((data && 'error' in data && data.error.message) || 'Failed to engage the kill switch.');
        setSubmitting(false);
        return;
      }
      setReason('');
      setRouteDirectionId('');
      await refresh();
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function disengage(id: string) {
    const reasonValue = disengageReason[id]?.trim();
    if (!reasonValue) return;
    setDisengagingId(id);
    try {
      const response = await fetch(`/api/ops/control-room/kill-switches/${id}/disengage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reasonValue }),
      });
      if (response.ok) {
        await refresh();
        setDisengageReason((prev) => ({ ...prev, [id]: '' }));
      }
    } finally {
      setDisengagingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {active.length === 0 ? (
        <p className="ops-well px-4 py-3 text-sm text-ops-muted">
          No kill switches engaged — automatic commands are permitted.
        </p>
      ) : (
        <ul className="space-y-2">
          {active.map((ks) => (
            <li key={ks.id} className="rounded-md border border-alert-crimson/40 bg-alert-crimson/10 px-4 py-3 text-sm text-ops-danger">
              <p>
                <span className="font-mono text-[10px] uppercase tracking-[0.12em]">
                  {ks.scope === 'network' ? 'Network-wide' : `Route-direction ${ks.routeDirectionId}`}
                </span>{' '}
                — engaged {new Date(ks.engagedAt).toLocaleString()}
              </p>
              <p className="mt-1">Reason: {ks.reason}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  value={disengageReason[ks.id] ?? ''}
                  onChange={(e) => setDisengageReason((prev) => ({ ...prev, [ks.id]: e.target.value }))}
                  placeholder="Reason for disengaging"
                  className="ops-input min-w-[220px] flex-1 py-1.5 text-xs"
                />
                <button
                  type="button"
                  disabled={disengagingId === ks.id || !(disengageReason[ks.id]?.trim())}
                  onClick={() => disengage(ks.id)}
                  className="ops-button border-alert-green/60 bg-alert-green/10 text-ops-good hover:border-alert-green hover:bg-alert-green/20 hover:text-ops-good"
                >
                  {disengagingId === ks.id ? 'Disengaging…' : 'Disengage'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={engage} className="space-y-3 rounded-md border border-ops-line p-4">
        <h3 className="ops-label">Engage a kill switch</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="kill-switch-scope" className="mb-1 block text-xs text-ops-muted">
              Scope
            </label>
            <select
              id="kill-switch-scope"
              value={scope}
              onChange={(e) => setScope(e.target.value as 'network' | 'route')}
              className="ops-input"
            >
              <option value="network">Network-wide</option>
              <option value="route">Route-direction</option>
            </select>
          </div>
          {scope === 'route' && (
            <div>
              <label htmlFor="kill-switch-route" className="mb-1 block text-xs text-ops-muted">
                Route-direction id
              </label>
              <input
                id="kill-switch-route"
                required
                value={routeDirectionId}
                onChange={(e) => setRouteDirectionId(e.target.value)}
                className="ops-input"
              />
            </div>
          )}
        </div>
        <div>
          <label htmlFor="kill-switch-reason" className="mb-1 block text-xs text-ops-muted">
            Reason
          </label>
          <textarea
            id="kill-switch-reason"
            required
            minLength={1}
            maxLength={2000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            aria-describedby={error ? errorId : undefined}
            className="ops-input"
          />
        </div>
        {error && (
          <p id={errorId} role="alert" className="text-sm text-alert-crimson">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={submitting || reason.trim().length === 0 || (scope === 'route' && routeDirectionId.trim().length === 0)}
          className="ops-button-danger px-5 py-2 text-ops-danger"
        >
          {submitting ? 'Engaging…' : 'Engage kill switch'}
        </button>
      </form>
    </div>
  );
}
