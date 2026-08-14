'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import type { RolloutStage, RolloutStageAuditEntry, RolloutStageRow } from '@/models/control';
import type { PilotSnapshot } from '@/lib/controlService/pilotData';
import {
  ROLLOUT_STAGE_LABEL,
  ROLLOUT_STAGE_MEANING,
  ROLLOUT_STAGE_ORDER,
  permitsCommands,
  stageChangeDirection,
  withdrawsCommandAuthority,
} from '@/lib/ops/rolloutPosture';
import {
  OpsAlert,
  OpsButton,
  OpsEmptyState,
  OpsInput,
  OpsPanel,
  OpsReadout,
  OpsSelect,
  OpsStack,
  OpsTableFrame,
  OpsTextarea,
  opsTableClass,
  opsTdClass,
  opsTdMutedClass,
  opsTheadRowClass,
  opsThClass,
  opsTrClass,
} from '@/components/ops/ui';

/**
 * Per-route-direction rollout stages.
 *
 * ─── WHAT THIS SCREEN IS ACTUALLY FOR ────────────────────────────────────
 *
 * A rollout stage is not a display value. The control service refuses to
 * create ANY command for a corridor at `observation` or `shadow` — it records
 * a guardrail breach and answers 403 (control-service/src/pilot/gate.ts). So
 * this is the screen that decides, per corridor, whether dispatchers'
 * approvals reach drivers at all.
 *
 * The version this replaced rendered all of that as a dropdown and a "Set
 * stage" button per row, with an optional reason box, and treated moving UP
 * and moving DOWN as the same gesture. Three things follow from taking the
 * posture seriously instead:
 *
 *   1. DEMOTION IS CONFIRMED, AND THE ONE THAT WITHDRAWS COMMAND AUTHORITY
 *      REQUIRES A WRITTEN REASON. Crossing back below `advisory` stops
 *      commands on a live corridor; the people who notice are dispatchers
 *      whose approvals begin failing, and they will ask why. A reason
 *      reconstructed afterwards from an audit trail is not the same artifact
 *      as one written at the moment of the decision.
 *   2. THE LIST IS FILTERED, NOT DUMPED. The network is 759 corridors. A page
 *      that renders 759 editors is one where nobody finds the eighteen that
 *      are actually promoted, which are the only ones whose posture is load
 *      bearing today.
 *   3. EVERY STAGE SAYS WHAT IT PERMITS. Not the pilot-plan name for it — what
 *      the control service will and will not do.
 *
 * Client-side only; every action goes through the guarded
 * /api/ops/admin/rollout-stages* routes, which are the enforcement point.
 * This component trusts nothing it did not get back from one of them.
 */

/** How many rows to render before asking. 759 corridors is a real number here. */
const PAGE_SIZE = 40;

type StageFilter = 'commanding' | 'held' | 'all';

const FILTER_LABEL: Record<StageFilter, string> = {
  commanding: 'Accepting commands',
  held: 'Held at detect-only',
  all: 'Every corridor',
};

function AuditTrail({ routeDirectionId }: { routeDirectionId: string }) {
  const [entries, setEntries] = useState<RolloutStageAuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(
          `/api/ops/admin/rollout-stages/${routeDirectionId}/audit`,
          { cache: 'no-store' },
        );
        const data = (await response.json().catch(() => null)) as {
          auditLog?: RolloutStageAuditEntry[];
        } | null;
        if (cancelled) return;
        if (!response.ok || !data) {
          setError('Could not load the change history.');
          return;
        }
        setEntries(data.auditLog ?? []);
      } catch {
        if (!cancelled) setError('Could not load the change history.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [routeDirectionId]);

  if (error) return <p className="text-xs text-ops-danger">{error}</p>;
  if (!entries) return <p className="text-xs text-ops-faint">Loading the change history…</p>;
  if (entries.length === 0) {
    return <p className="text-xs text-ops-faint">This corridor has never been staged.</p>;
  }

  return (
    <ul className="space-y-1 text-xs text-ops-muted">
      {entries.map((entry) => (
        <li key={entry.id}>
          <span className="text-ops-ink">
            {entry.previousStage ?? '(never staged)'} &rarr; {entry.newStage}
          </span>{' '}
          by {entry.changedBy} at {new Date(entry.createdAt).toLocaleString()}
          {entry.reason ? ` — ${entry.reason}` : ''}
        </li>
      ))}
    </ul>
  );
}

/**
 * The editor for one corridor, opened deliberately rather than sitting on
 * every row.
 *
 * The submit control's shape is the point: it changes label and tone with the
 * direction of the change, and the withdraw-authority case cannot be submitted
 * without a reason. That is enforced here AND stated, so an admin does not
 * meet a disabled button with no explanation.
 */
function StageEditor({
  row,
  onSaved,
}: {
  row: RolloutStageRow;
  onSaved: (updated: RolloutStageRow) => void;
}) {
  const [stage, setStage] = useState<RolloutStage>(row.stage);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [showAudit, setShowAudit] = useState(false);
  const stageId = useId();
  const reasonId = useId();

  const direction = stageChangeDirection(row.stage, stage);
  const withdrawing = withdrawsCommandAuthority(row.stage, stage);
  const reasonRequired = withdrawing;
  const reasonMissing = reasonRequired && reason.trim() === '';

  async function submit() {
    if (busy || reasonMissing) return;
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const response = await fetch(`/api/ops/admin/rollout-stages/${row.routeDirectionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage, reason: reason.trim() === '' ? null : reason.trim() }),
      });
      const data = (await response.json().catch(() => null)) as
        | { rolloutStage: RolloutStageRow }
        | { error?: { message?: string } }
        | null;
      if (!response.ok || !data || !('rolloutStage' in data)) {
        setError(
          (data && 'error' in data && data.error?.message) || 'The stage was not changed.',
        );
        return;
      }
      onSaved(data.rolloutStage);
      setReason('');
      setSaved(
        permitsCommands(data.rolloutStage.stage)
          ? 'Saved. Commands are permitted on this corridor from now, with no deploy.'
          : 'Saved. Commands for this corridor are refused from now, with no deploy.',
      );
    } catch {
      setError('Something went wrong. The stage was not changed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <OpsStack gap="tight" className="text-xs">
      <div className="grid gap-3 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
        <div>
          <label htmlFor={stageId} className="ops-label mb-1.5 block">
            Stage
          </label>
          <OpsSelect
            id={stageId}
            value={stage}
            disabled={busy}
            onChange={(event) => {
              setStage(event.target.value as RolloutStage);
              setSaved(null);
              setError(null);
            }}
            className="w-full px-2 py-1 text-xs"
          >
            {ROLLOUT_STAGE_ORDER.map((option) => (
              <option key={option} value={option}>
                {ROLLOUT_STAGE_LABEL[option]}
              </option>
            ))}
          </OpsSelect>
          <p className="mt-1.5 leading-snug text-ops-faint">{ROLLOUT_STAGE_MEANING[stage]}</p>
        </div>

        <div>
          <label htmlFor={reasonId} className="ops-label mb-1.5 block">
            Reason {reasonRequired && <span className="text-alert-crimson">(required)</span>}
          </label>
          <OpsTextarea
            id={reasonId}
            value={reason}
            disabled={busy}
            onChange={(event) => setReason(event.target.value)}
            placeholder={
              reasonRequired
                ? 'Why commands are being withdrawn from this corridor'
                : 'e.g. week 3 of pilot cadence, guardrails clean'
            }
            className="min-h-[4.5rem] w-full px-2 py-1 text-xs"
          />
          <p className="mt-1 leading-snug text-ops-faint">
            Recorded against this change and shown in the corridor&apos;s history.
          </p>
        </div>
      </div>

      {withdrawing && (
        <OpsAlert tone="warning" title="This stops commands reaching drivers on this corridor">
          Moving from {ROLLOUT_STAGE_LABEL[row.stage].toLowerCase()} to{' '}
          {ROLLOUT_STAGE_LABEL[stage].toLowerCase()} takes effect immediately and with no deploy.
          From that moment the control service refuses every command for this corridor and logs
          each attempt as a guardrail breach — dispatchers will see their approvals start failing.
          {reasonMissing && ' Give a reason before applying it.'}
        </OpsAlert>
      )}

      {!withdrawing && direction === 'demotion' && (
        <p className="leading-snug text-ops-muted">
          A narrower posture, but commands stay permitted either way — nothing stops working.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <OpsButton
          variant={withdrawing ? 'danger' : direction === 'promotion' ? 'primary' : 'default'}
          className="px-3 py-1.5 text-xs normal-case tracking-normal"
          disabled={busy || reasonMissing}
          onClick={() => void submit()}
        >
          {busy
            ? 'Applying…'
            : withdrawing
              ? 'Withdraw command authority'
              : direction === 'promotion'
                ? `Promote to ${ROLLOUT_STAGE_LABEL[stage].toLowerCase()}`
                : direction === 'demotion'
                  ? `Narrow to ${ROLLOUT_STAGE_LABEL[stage].toLowerCase()}`
                  : 'Re-stamp this stage'}
        </OpsButton>
        <OpsButton
          variant="quiet"
          className="px-3 py-1.5 text-xs"
          onClick={() => setShowAudit((open) => !open)}
        >
          {showAudit ? 'Hide history' : 'History'}
        </OpsButton>
      </div>

      {saved && !error && (
        <p role="status" className="text-ops-good">
          {saved}
        </p>
      )}
      {error && (
        <p role="alert" className="text-ops-danger">
          {error}
        </p>
      )}

      {row.updatedBy && (
        <p className="text-[11px] text-ops-faint">
          Last set by {row.updatedBy}
          {row.updatedAt ? ` at ${new Date(row.updatedAt).toLocaleString()}` : ''}
          {row.reason ? ` — ${row.reason}` : ''}.
        </p>
      )}

      {showAudit && (
        <div className="border-t border-ops-line pt-3">
          <AuditTrail routeDirectionId={row.routeDirectionId} />
        </div>
      )}
    </OpsStack>
  );
}

export function OpsAdminRolloutStagesPanel() {
  const [snapshot, setSnapshot] = useState<PilotSnapshot<RolloutStageRow[]> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StageFilter>('commanding');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [openId, setOpenId] = useState<string | null>(null);
  const searchId = useId();

  async function load() {
    try {
      const response = await fetch('/api/ops/admin/rollout-stages', { cache: 'no-store' });
      const data = (await response.json().catch(() => null)) as PilotSnapshot<
        RolloutStageRow[]
      > | null;
      if (!response.ok || !data) {
        setLoadError('The rollout stages could not be read.');
        return;
      }
      setSnapshot(data);
      setLoadError(null);
    } catch {
      setLoadError('The rollout stages could not be read.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const rows = useMemo(() => snapshot?.data ?? [], [snapshot]);

  const tally = useMemo(() => {
    const byStage = Object.fromEntries(ROLLOUT_STAGE_ORDER.map((s) => [s, 0])) as Record<
      RolloutStage,
      number
    >;
    for (const row of rows) byStage[row.stage] += 1;
    return byStage;
  }, [rows]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter === 'commanding' && !permitsCommands(row.stage)) return false;
      if (filter === 'held' && permitsCommands(row.stage)) return false;
      if (!needle) return true;
      return (
        row.publicName.toLowerCase().includes(needle) ||
        row.routeId.toLowerCase().includes(needle) ||
        row.directionCode.toLowerCase().includes(needle)
      );
    });
  }, [rows, filter, query]);

  function handleSaved(updated: RolloutStageRow) {
    setSnapshot((prev) =>
      prev
        ? {
            ...prev,
            data: prev.data.map((row) =>
              row.routeDirectionId === updated.routeDirectionId ? updated : row,
            ),
          }
        : prev,
    );
  }

  if (loadError) {
    return (
      <OpsAlert tone="error" title="Rollout stages could not be read">
        {loadError} Nothing about the network&apos;s posture has changed — this console cannot see
        it. Every corridor keeps whatever stage it already had.
      </OpsAlert>
    );
  }

  if (!snapshot) {
    return <p className="text-sm text-ops-muted">Loading rollout stages…</p>;
  }

  const visible = filtered.slice(0, limit);

  return (
    <OpsStack>
      {snapshot.source !== 'live' && (
        <OpsAlert tone="warning">
          Showing the last posture this console read
          {snapshot.error ? ` — the control service did not respond (${snapshot.error})` : ''}. It
          may no longer be current; changing a stage from here still goes to the live service.
        </OpsAlert>
      )}

      <OpsPanel
        title="What the stages mean"
        description="Set here, enforced by the control service, with no deploy in between."
      >
        <OpsStack gap="tight">
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
            {ROLLOUT_STAGE_ORDER.map((stage) => (
              <OpsReadout
                key={stage}
                label={ROLLOUT_STAGE_LABEL[stage]}
                value={tally[stage]}
                tone={tally[stage] > 0 && permitsCommands(stage) ? 'accent' : 'default'}
              />
            ))}
          </div>
          <ul className="space-y-1 text-xs leading-snug text-ops-faint">
            {ROLLOUT_STAGE_ORDER.map((stage) => (
              <li key={stage}>
                <span className={permitsCommands(stage) ? 'text-holo-glow' : 'text-ops-muted'}>
                  {ROLLOUT_STAGE_LABEL[stage]}
                </span>{' '}
                — {ROLLOUT_STAGE_MEANING[stage]}
              </li>
            ))}
          </ul>
        </OpsStack>
      </OpsPanel>

      <OpsPanel
        title={FILTER_LABEL[filter]}
        description="Corridors accepting commands are shown first because those are the ones whose posture is load bearing today."
        actions={
          <div className="flex flex-wrap items-end gap-2">
            {(Object.keys(FILTER_LABEL) as StageFilter[]).map((option) => (
              <OpsButton
                key={option}
                variant={option === filter ? 'primary' : 'quiet'}
                className="px-3 py-1.5 text-xs"
                aria-pressed={option === filter}
                onClick={() => {
                  setFilter(option);
                  setLimit(PAGE_SIZE);
                }}
              >
                {FILTER_LABEL[option]}
              </OpsButton>
            ))}
          </div>
        }
        padded={false}
      >
        <div className="border-b border-ops-line p-3">
          <label htmlFor={searchId} className="sr-only">
            Search corridors
          </label>
          <OpsInput
            id={searchId}
            value={query}
            placeholder="Search by corridor, route or direction"
            onChange={(event) => {
              setQuery(event.target.value);
              setLimit(PAGE_SIZE);
            }}
            className="w-full max-w-sm px-2 py-1 text-xs"
          />
        </div>

        {visible.length === 0 ? (
          <div className="p-4">
            <OpsEmptyState>
              {rows.length === 0
                ? 'The control service reports no active route-directions at all.'
                : query.trim()
                  ? 'No corridor in this view matches that search.'
                  : filter === 'commanding'
                    ? 'No corridor currently accepts commands. Every one is held at observation or shadow, so the control service refuses every command on the network.'
                    : 'Every corridor in the network currently accepts commands.'}
            </OpsEmptyState>
          </div>
        ) : (
          <OpsTableFrame className="rounded-none border-0">
            <table className={opsTableClass}>
              <thead>
                <tr className={opsTheadRowClass}>
                  <th className={opsThClass}>Corridor</th>
                  <th className={opsThClass}>Direction</th>
                  <th className={opsThClass}>Stage</th>
                  <th className={opsThClass}>Commands</th>
                  <th className={opsThClass} />
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const open = openId === row.routeDirectionId;
                  return [
                    <tr key={row.routeDirectionId} className={opsTrClass}>
                      <td className={opsTdClass}>
                        {row.publicName}
                        <span className="ml-2 font-mono text-[11px] text-ops-faint">
                          {row.routeId}
                        </span>
                      </td>
                      <td className={opsTdMutedClass}>{row.directionCode}</td>
                      <td className={opsTdClass}>{ROLLOUT_STAGE_LABEL[row.stage]}</td>
                      <td className={opsTdClass}>
                        {permitsCommands(row.stage) ? (
                          <span className="text-holo-glow">permitted</span>
                        ) : (
                          <span className="text-ops-muted">refused</span>
                        )}
                      </td>
                      <td className={opsTdClass}>
                        <div className="flex justify-end">
                          <OpsButton
                            variant="quiet"
                            className="px-2 py-1 text-xs"
                            aria-expanded={open}
                            onClick={() => setOpenId(open ? null : row.routeDirectionId)}
                          >
                            {open ? 'Close' : 'Change stage'}
                          </OpsButton>
                        </div>
                      </td>
                    </tr>,
                    open ? (
                      <tr key={`${row.routeDirectionId}-editor`} className={opsTrClass}>
                        <td colSpan={5} className="bg-ops-raised/40 px-3 py-4">
                          <StageEditor row={row} onSaved={handleSaved} />
                        </td>
                      </tr>
                    ) : null,
                  ];
                })}
              </tbody>
            </table>
          </OpsTableFrame>
        )}

        {filtered.length > visible.length && (
          <div className="flex items-center justify-between gap-3 border-t border-ops-line p-3 text-xs text-ops-muted">
            <span>
              Showing {visible.length} of {filtered.length}
            </span>
            <OpsButton
              variant="quiet"
              className="px-3 py-1.5 text-xs"
              onClick={() => setLimit((current) => current + PAGE_SIZE)}
            >
              Show more
            </OpsButton>
          </div>
        )}
      </OpsPanel>
    </OpsStack>
  );
}
