'use client';

import { useEffect, useId, useState } from 'react';
import type { RolloutStage, RolloutStageAuditEntry, RolloutStageRow } from '@/models/control';
import type { PilotSnapshot } from '@/lib/controlService/pilotData';

const STAGES: RolloutStage[] = ['observation', 'shadow', 'advisory', 'limited_auto', 'expanded'];

const STAGE_LABEL: Record<RolloutStage, string> = {
  observation: 'Observation (detect only)',
  shadow: 'Shadow (recommend only)',
  advisory: 'Advisory (human-approved commands)',
  limited_auto: 'Limited auto',
  expanded: 'Expanded',
};

// Literal hexes because these are applied through `style`, not a class:
// the stage is data-driven, and Tailwind cannot see a class name it never
// literally contains. Values are the ops palette's own (tailwind.config.ts
// `ops.muted` / `holo.glow` / `ops.warn` / `ops.good`) — keep them in step.
const STAGE_COLOR: Record<RolloutStage, string> = {
  observation: '#9fb6c9',
  shadow: '#3ff0ff',
  advisory: '#f5c977',
  limited_auto: '#8ee7b4',
  expanded: '#8ee7b4',
};

function AuditTrail({ routeDirectionId }: { routeDirectionId: string }) {
  const [entries, setEntries] = useState<RolloutStageAuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/ops/admin/rollout-stages/${routeDirectionId}/audit`, { cache: 'no-store' });
        const data = (await response.json().catch(() => null)) as { auditLog?: RolloutStageAuditEntry[] } | null;
        if (cancelled) return;
        if (!response.ok || !data) {
          setError('Could not load audit trail.');
          return;
        }
        setEntries(data.auditLog ?? []);
      } catch {
        if (!cancelled) setError('Could not load audit trail.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [routeDirectionId]);

  if (error) return <p className="text-xs text-alert-crimson">{error}</p>;
  if (!entries) return <p className="text-xs text-ops-faint">Loading audit trail…</p>;
  if (entries.length === 0) return <p className="text-xs text-ops-faint">No stage changes recorded yet.</p>;

  return (
    <ul className="space-y-1 text-xs text-ops-muted">
      {entries.map((entry) => (
        <li key={entry.id}>
          <span className="text-ops-ink">
            {entry.previousStage ?? '(unset)'} &rarr; {entry.newStage}
          </span>{' '}
          by {entry.changedBy} at {new Date(entry.createdAt).toLocaleString()}
          {entry.reason ? ` — ${entry.reason}` : ''}
        </li>
      ))}
    </ul>
  );
}

/**
 * Admin per-route rollout-stage editor (ticket AC1: "Admin sets a
 * route-direction's rollout stage; control/command services respect it
 * without a deploy"). Client-side only; every action goes through the
 * guarded /api/ops/admin/rollout-stages* routes, which are the actual
 * enforcement point — this component trusts nothing it doesn't get back
 * from those responses, same pattern as OpsAdminInvitesPanel.
 */
export function OpsAdminRolloutStagesPanel() {
  const [snapshot, setSnapshot] = useState<PilotSnapshot<RolloutStageRow[]> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingStage, setPendingStage] = useState<Record<string, RolloutStage>>({});
  const [pendingReason, setPendingReason] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [rowSaved, setRowSaved] = useState<Record<string, boolean>>({});
  const [expandedAuditId, setExpandedAuditId] = useState<string | null>(null);
  const reasonId = useId();

  async function load() {
    try {
      const response = await fetch('/api/ops/admin/rollout-stages', { cache: 'no-store' });
      const data = (await response.json().catch(() => null)) as PilotSnapshot<RolloutStageRow[]> | null;
      if (!response.ok || !data) {
        setLoadError('Could not load rollout stages.');
        return;
      }
      setSnapshot(data);
      setLoadError(null);
    } catch {
      setLoadError('Could not load rollout stages.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleSetStage(row: RolloutStageRow) {
    const stage = pendingStage[row.routeDirectionId] ?? row.stage;
    const reason = pendingReason[row.routeDirectionId] ?? '';
    setBusyId(row.routeDirectionId);
    setRowError((prev) => ({ ...prev, [row.routeDirectionId]: '' }));
    setRowSaved((prev) => ({ ...prev, [row.routeDirectionId]: false }));
    try {
      const response = await fetch(`/api/ops/admin/rollout-stages/${row.routeDirectionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage, reason: reason.trim() === '' ? null : reason }),
      });
      const data = (await response.json().catch(() => null)) as
        | { rolloutStage: RolloutStageRow }
        | { error?: { message?: string } }
        | null;
      if (!response.ok || !data || !('rolloutStage' in data)) {
        setRowError((prev) => ({
          ...prev,
          [row.routeDirectionId]: (data && 'error' in data && data.error?.message) || 'Could not set the rollout stage.',
        }));
        return;
      }
      setRowSaved((prev) => ({ ...prev, [row.routeDirectionId]: true }));
      setSnapshot((prev) =>
        prev
          ? {
              ...prev,
              data: prev.data.map((r) => (r.routeDirectionId === row.routeDirectionId ? data.rolloutStage : r)),
            }
          : prev,
      );
      if (expandedAuditId === row.routeDirectionId) {
        // force a re-mount of AuditTrail so it re-fetches the new entry
        setExpandedAuditId(null);
        setTimeout(() => setExpandedAuditId(row.routeDirectionId), 0);
      }
    } catch {
      setRowError((prev) => ({ ...prev, [row.routeDirectionId]: 'Something went wrong. Please try again.' }));
    } finally {
      setBusyId(null);
    }
  }

  if (loadError) {
    return <p role="alert" className="text-sm text-alert-crimson">{loadError}</p>;
  }
  if (!snapshot) {
    return <p className="text-sm text-ops-muted">Loading rollout stages…</p>;
  }

  return (
    <div className="space-y-6">
      {snapshot.source !== 'live' && (
        <p role="alert" className="rounded-md border border-alert-amber/40 bg-alert-amber/10 px-3 py-2 text-xs text-ops-warn">
          Showing the last known data — the control service did not respond{snapshot.error ? ` (${snapshot.error})` : ''}.
        </p>
      )}
      <ul className="space-y-4">
        {snapshot.data.map((row) => {
          const stage = pendingStage[row.routeDirectionId] ?? row.stage;
          return (
            <li key={row.routeDirectionId} className="rounded-md border border-ops-line p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <span className="text-sm text-ops-ink">
                    {row.publicName} <span className="text-ops-muted">({row.directionCode})</span>
                  </span>
                  <span
                    className="ml-3 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em]"
                    style={{ color: STAGE_COLOR[row.stage], border: `1px solid ${STAGE_COLOR[row.stage]}55` }}
                  >
                    {row.stage}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => setExpandedAuditId((cur) => (cur === row.routeDirectionId ? null : row.routeDirectionId))}
                  className="text-xs text-holo-glow hover:underline"
                >
                  {expandedAuditId === row.routeDirectionId ? 'Hide audit trail' : 'View audit trail'}
                </button>
              </div>

              <div className="grid gap-2 sm:grid-cols-[1fr,2fr,auto] sm:items-end">
                <label className="flex flex-col gap-1 text-xs text-ops-muted">
                  Stage
                  <select
                    value={stage}
                    onChange={(e) =>
                      setPendingStage((prev) => ({ ...prev, [row.routeDirectionId]: e.target.value as RolloutStage }))
                    }
                    className="ops-input w-auto px-2 py-1 text-xs"
                  >
                    {STAGES.map((s) => (
                      <option key={s} value={s}>
                        {STAGE_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </label>
                <label htmlFor={`${reasonId}-${row.routeDirectionId}`} className="flex flex-col gap-1 text-xs text-ops-muted">
                  Reason
                  <input
                    id={`${reasonId}-${row.routeDirectionId}`}
                    value={pendingReason[row.routeDirectionId] ?? ''}
                    onChange={(e) => setPendingReason((prev) => ({ ...prev, [row.routeDirectionId]: e.target.value }))}
                    placeholder="e.g. week 3 of pilot cadence, guardrails clean"
                    className="ops-input w-auto px-2 py-1 text-xs"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void handleSetStage(row)}
                  disabled={busyId === row.routeDirectionId}
                  className="rounded border border-ops-line-strong px-3 py-1.5 text-xs text-ops-muted hover:border-holo-glow/60 hover:text-holo-glow disabled:opacity-60"
                >
                  {busyId === row.routeDirectionId ? 'Saving…' : 'Set stage'}
                </button>
              </div>

              {rowSaved[row.routeDirectionId] && !rowError[row.routeDirectionId] && (
                <p role="status" className="mt-2 text-xs text-ops-good">
                  Saved — takes effect immediately, no deploy required.
                </p>
              )}
              {rowError[row.routeDirectionId] && (
                <p role="alert" className="mt-2 text-xs text-alert-crimson">
                  {rowError[row.routeDirectionId]}
                </p>
              )}
              {row.updatedBy && (
                <p className="mt-2 text-[11px] text-ops-faint">
                  Last set by {row.updatedBy}
                  {row.updatedAt ? ` at ${new Date(row.updatedAt).toLocaleString()}` : ''}
                  {row.reason ? ` — ${row.reason}` : ''}.
                </p>
              )}
              {expandedAuditId === row.routeDirectionId && (
                <div className="mt-3 border-t border-ops-line pt-3">
                  <AuditTrail routeDirectionId={row.routeDirectionId} />
                </div>
              )}
            </li>
          );
        })}
        {snapshot.data.length === 0 && <p className="text-sm text-ops-muted">No active route-directions found.</p>}
      </ul>
    </div>
  );
}
