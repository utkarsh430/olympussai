'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { KillSwitchRecord } from '@/lib/auth/rbac/repo';
import type { RouteDirectionMeta } from '@/models/control';
import {
  OpsAlert,
  OpsButton,
  OpsEmptyState,
  OpsField,
  OpsIdentifier,
  OpsInput,
  OpsSelect,
  OpsTextarea,
} from '@/components/ops/ui';
import { STOP_INSTRUCTIONS, corridorName } from '@/lib/ops/vocabulary';
import { CorridorPicker } from './CorridorPicker';

/**
 * The control that stops new instructions being sent — the one this codebase
 * calls a kill switch everywhere except on screen.
 *
 * ─── WHY IT IS NOT CALLED A KILL SWITCH ANY MORE ─────────────────────────
 *
 * Two reasons, and the second is the one that matters.
 *
 * It is jargon, and this console is read by UPSRTC operations staff for whom
 * English is often a second language. And it OVERSTATES what the control does:
 * engaging it halts NEW instructions. Instructions already sent still stand,
 * and a driver may still be acting on one. An operator who reads "kill switch"
 * during an incident may reasonably believe they have just stopped everything
 * in flight, and they have not. So the wording throughout is "stop new
 * instructions", and the sentence saying that already-sent instructions still
 * stand is on the panel rather than in a doc comment.
 *
 * The scope words move with it: "network-wide" becomes "whole state", and
 * "route-direction <uuid>" becomes a corridor an operator can name.
 *
 * ─── WHAT DID NOT CHANGE ─────────────────────────────────────────────────
 *
 * Every engage and disengage is still attributed and still requires a reason
 * (POST /api/ops/control-room/kill-switches, .../:id/disengage), and the
 * enforcement is still at instruction-creation time in
 * src/app/api/ops/control-room/commands/route.ts. The panel is still seeded
 * server-side so it never flashes an empty list, and `refreshToken` still lets
 * the console re-read on its own clock — a switch thrown by a colleague or by
 * the shift before must not stay invisible here.
 */
export function KillSwitchPanel({
  initialActive,
  refreshToken,
  corridors = [],
  defaultRouteDirectionId,
}: {
  initialActive: KillSwitchRecord[];
  refreshToken?: number;
  /** So a corridor can be chosen by name instead of typed as a reference. */
  corridors?: readonly RouteDirectionMeta[];
  defaultRouteDirectionId?: string | null;
}) {
  const [active, setActive] = useState<KillSwitchRecord[]>(initialActive);
  const [scope, setScope] = useState<'network' | 'route'>('network');
  const [routeDirectionId, setRouteDirectionId] = useState(defaultRouteDirectionId ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [releaseReason, setReleaseReason] = useState<Record<string, string>>({});
  const [releasingId, setReleasingId] = useState<string | null>(null);

  const errorId = useId();

  const refresh = useCallback(async () => {
    const response = await fetch('/api/ops/control-room/kill-switches', { cache: 'no-store' });
    const data = (await response.json().catch(() => null)) as { active: KillSwitchRecord[] } | null;
    // A failed read leaves the current list alone rather than emptying it: an
    // empty list reads as "nothing is stopped", which is the one conclusion a
    // dropped request must never let an operator draw.
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
          scope === 'network'
            ? { scope: 'network', reason }
            : { scope: 'route', routeDirectionId, reason },
        ),
      });
      const data = (await response.json().catch(() => null)) as
        { ok: true } | { error: { message: string } } | null;
      if (!response.ok || !data || !('ok' in data)) {
        setError(
          (data && 'error' in data && data.error.message) ||
            'Instructions were not stopped. Try again.',
        );
        setSubmitting(false);
        return;
      }
      setReason('');
      await refresh();
    } catch {
      setError('Instructions were not stopped — the console could not be reached. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function release(id: string) {
    const reasonValue = releaseReason[id]?.trim();
    if (!reasonValue) return;
    setReleasingId(id);
    try {
      const response = await fetch(`/api/ops/control-room/kill-switches/${id}/disengage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reasonValue }),
      });
      if (response.ok) {
        await refresh();
        setReleaseReason((prev) => ({ ...prev, [id]: '' }));
      }
    } finally {
      setReleasingId(null);
    }
  }

  return (
    <div className="space-y-4">
      {active.length === 0 ? (
        <OpsEmptyState>Nothing is stopped. Instructions can be sent as normal.</OpsEmptyState>
      ) : (
        <ul className="space-y-2">
          {active.map((ks) => (
            <li
              key={ks.id}
              className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            >
              <p className="font-semibold">
                {ks.scope === 'network'
                  ? 'New instructions stopped across the whole state'
                  : `New instructions stopped on ${corridorLabelFor(ks.routeDirectionId, corridors)}`}
              </p>
              <p className="mt-0.5 text-xs">
                Stopped at {new Date(ks.engagedAt).toLocaleString()}. Instructions sent before then
                still stand.
              </p>
              <p className="mt-1">Reason: {ks.reason}</p>

              <div className="mt-2 flex flex-wrap items-end gap-2">
                <div className="min-w-[220px] flex-1">
                  <label
                    htmlFor={`release-reason-${ks.id}`}
                    className="ops-eyebrow mb-1 block text-foreground"
                  >
                    Why you are allowing instructions again
                  </label>
                  <OpsInput
                    id={`release-reason-${ks.id}`}
                    value={releaseReason[ks.id] ?? ''}
                    onChange={(e) =>
                      setReleaseReason((prev) => ({ ...prev, [ks.id]: e.target.value }))
                    }
                    className="py-1.5 text-xs"
                  />
                </div>
                <OpsButton
                  disabled={releasingId === ks.id || !releaseReason[ks.id]?.trim()}
                  onClick={() => release(ks.id)}
                >
                  {releasingId === ks.id
                    ? STOP_INSTRUCTIONS.releasePending
                    : STOP_INSTRUCTIONS.releaseAction}
                </OpsButton>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={engage} className="space-y-3 rounded-md border border-border p-4">
        <h3 className="ops-label">{STOP_INSTRUCTIONS.title}</h3>
        <p className="text-[11px] leading-snug text-subtle">{STOP_INSTRUCTIONS.gloss}</p>

        <div className="grid gap-4 sm:grid-cols-2">
          <OpsField label="Where" htmlFor="kill-switch-scope" required>
            <OpsSelect
              id="kill-switch-scope"
              value={scope}
              onChange={(e) => setScope(e.target.value as 'network' | 'route')}
            >
              <option value="network">{STOP_INSTRUCTIONS.scopeNetwork}</option>
              <option value="route">{STOP_INSTRUCTIONS.scopeRoute}</option>
            </OpsSelect>
          </OpsField>

          {scope === 'route' &&
            (corridors.length > 0 ? (
              <CorridorPicker
                corridors={corridors}
                value={routeDirectionId === '' ? null : routeDirectionId}
                onChange={setRouteDirectionId}
                label="Which corridor"
              />
            ) : (
              <OpsField
                label="Which corridor"
                htmlFor="kill-switch-route"
                required
                hint="The corridor list could not be read, so this has to be the reference rather than a name."
              >
                <OpsInput
                  id="kill-switch-route"
                  required
                  value={routeDirectionId}
                  onChange={(e) => setRouteDirectionId(e.target.value)}
                />
              </OpsField>
            ))}
        </div>

        <OpsField
          label="Why you are stopping instructions"
          htmlFor="kill-switch-reason"
          required
          hint="Recorded against your name, permanently."
        >
          <OpsTextarea
            id="kill-switch-reason"
            required
            minLength={1}
            maxLength={2000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            aria-describedby={error ? errorId : 'kill-switch-reason-hint'}
          />
        </OpsField>

        {error && (
          <OpsAlert tone="error" id={errorId}>
            {error}
          </OpsAlert>
        )}

        <OpsButton
          type="submit"
          variant="danger"
          className="px-5 py-2"
          disabled={
            submitting ||
            reason.trim().length === 0 ||
            (scope === 'route' && routeDirectionId.trim().length === 0)
          }
        >
          {submitting ? STOP_INSTRUCTIONS.engagePending : STOP_INSTRUCTIONS.engageAction}
        </OpsButton>
      </form>
    </div>
  );
}

/**
 * A corridor an operator can name, or the raw reference when it cannot be
 * resolved.
 *
 * A stopped-instruction entry reading "Route-direction 5f2c9a1e-…" names
 * nothing anyone can act on, and this panel usually has the corridor list in
 * hand. When it does not — the control service is down, or the corridor has
 * since been deactivated — the reference is shown rather than a guess. An
 * unresolvable id is a real state and inventing a name for it would be worse
 * than showing it.
 */
function corridorLabelFor(
  routeDirectionId: string | null,
  corridors: readonly RouteDirectionMeta[],
): React.ReactNode {
  if (routeDirectionId === null) return 'a corridor that was not recorded';
  const meta = corridors.find((c) => c.routeDirectionId === routeDirectionId);
  if (meta) return `corridor ${corridorName(meta)}`;
  return <OpsIdentifier>{routeDirectionId}</OpsIdentifier>;
}
