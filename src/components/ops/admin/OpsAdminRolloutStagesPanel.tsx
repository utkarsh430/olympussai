'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import type { RolloutStage, RolloutStageAuditEntry, RolloutStageRow } from '@/models/control';
import type { PilotSnapshot } from '@/lib/controlService/pilotData';
import {
  ROLLOUT_STAGE_LABEL,
  ROLLOUT_STAGE_MEANING,
  ROLLOUT_STAGE_ORDER,
  permitsCommands,
  rolloutStageLabel,
  stageChangeActionLabel,
  stageChangeDirection,
  withdrawsCommandAuthority,
} from '@/lib/ops/rolloutPosture';
import {
  OpsAlert,
  OpsButton,
  OpsEmptyState,
  OpsIdentifier,
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
 * Command permissions, per corridor.
 *
 * ─── WHAT THIS SCREEN IS ACTUALLY FOR ────────────────────────────────────
 *
 * This is a safety setting, not a display value. The control service refuses
 * to create ANY instruction for a corridor at `observation` or `shadow` — it
 * records the attempt and answers 403 (control-service/src/pilot/gate.ts). So
 * this is the screen that decides, per corridor, whether a dispatcher's
 * approval reaches a driver at all.
 *
 * The version this replaced rendered all of that as a dropdown and a "Set
 * stage" button per row, with an optional reason box, and treated moving UP
 * and moving DOWN as the same gesture. Four things follow from taking the
 * setting seriously instead:
 *
 *   1. DEMOTION IS CONFIRMED, AND THE ONE THAT STOPS INSTRUCTIONS REQUIRES A
 *      WRITTEN REASON. Crossing back below `advisory` stops instructions on a
 *      live corridor; the people who notice are the dispatchers whose
 *      approvals begin failing, and they will ask why. A reason reconstructed
 *      afterwards from an audit trail is not the same artifact as one written
 *      at the moment of the decision.
 *   2. THE BUTTON IS NAMED AFTER WHAT IT DOES. "Stop instructions on this
 *      corridor", not "Withdraw command authority" and certainly not "Demote".
 *      See `stageChangeActionLabel`.
 *   3. THE LIST IS FILTERED, NOT DUMPED. The network is 759 corridors. A page
 *      that renders 759 editors is one where nobody finds the eighteen that
 *      actually allow instructions, which are the only ones whose setting is
 *      load bearing today.
 *   4. EVERY PERMISSION SAYS WHAT IT ALLOWS. Not the pilot-programme name for
 *      it — what the control service will and will not do. The wire values are
 *      untouched; only the reading changed.
 *
 * Client-side only; every action goes through the guarded
 * /api/ops/admin/rollout-stages* routes, which are the enforcement point.
 * This component trusts nothing it did not get back from one of them.
 */

/** How many rows to render before asking. 759 corridors is a real number here. */
const PAGE_SIZE = 40;

type StageFilter = 'commanding' | 'held' | 'all';

const FILTER_LABEL: Record<StageFilter, string> = {
  commanding: 'Instructions allowed',
  held: 'Watch-only',
  all: 'Every corridor',
};

function AuditTrail({ routeDirectionId }: { routeDirectionId: string }) {
  const [entries, setEntries] = useState<RolloutStageAuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`/api/ops/admin/rollout-stages/${routeDirectionId}/audit`, {
          cache: 'no-store',
        });
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

  if (error) return <p className="text-xs text-destructive">{error}</p>;
  if (!entries) return <p className="text-xs text-subtle">Loading the change history…</p>;
  if (entries.length === 0) {
    return (
      <p className="text-xs text-subtle">This corridor&apos;s permission has never been changed.</p>
    );
  }

  return (
    <ul className="space-y-1 text-xs text-muted-foreground">
      {entries.map((entry) => (
        <li key={entry.id}>
          {/* The stored wire values are translated here too. An audit row that
              reads "observation → advisory" is only readable by somebody who
              knows the programme, and the person most likely to be reading it
              is somebody investigating why an instruction did or did not go
              out. The stored value is untouched; only the reading changes. */}
          <span className="font-medium text-foreground">
            {entry.previousStage ? rolloutStageLabel(entry.previousStage) : '(never set)'} &rarr;{' '}
            {rolloutStageLabel(entry.newStage)}
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
        { rolloutStage: RolloutStageRow } | { error?: { message?: string } } | null;
      if (!response.ok || !data || !('rolloutStage' in data)) {
        setError((data && 'error' in data && data.error?.message) || 'The stage was not changed.');
        return;
      }
      onSaved(data.rolloutStage);
      setReason('');
      setSaved(
        permitsCommands(data.rolloutStage.stage)
          ? 'Saved. Instructions are allowed on this corridor from now. No release is needed.'
          : 'Saved. Instructions for this corridor are refused from now. No release is needed.',
      );
    } catch {
      setError('Something went wrong. The permission was not changed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <OpsStack gap="tight" className="text-xs">
      <div className="grid gap-3 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
        <div>
          <label htmlFor={stageId} className="ops-label mb-1.5 block">
            Permission
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
          <p className="mt-1.5 leading-snug text-subtle">{ROLLOUT_STAGE_MEANING[stage]}</p>
        </div>

        <div>
          <label htmlFor={reasonId} className="ops-label mb-1.5 block">
            Why {reasonRequired && <span className="text-destructive">(required)</span>}
          </label>
          <OpsTextarea
            id={reasonId}
            value={reason}
            disabled={busy}
            onChange={(event) => setReason(event.target.value)}
            placeholder={
              reasonRequired
                ? 'Why instructions are being stopped on this corridor'
                : 'e.g. week 3 of the trial, nothing has been blocked by a safety rule'
            }
            className="min-h-[4.5rem] w-full px-2 py-1 text-xs"
          />
          <p className="mt-1 leading-snug text-subtle">
            Recorded against this change and shown in this corridor&apos;s history.
          </p>
        </div>
      </div>

      {withdrawing && (
        <OpsAlert tone="warning" title="This stops instructions reaching drivers on this corridor">
          Changing this corridor from &ldquo;{ROLLOUT_STAGE_LABEL[row.stage].toLowerCase()}&rdquo;
          to &ldquo;{ROLLOUT_STAGE_LABEL[stage].toLowerCase()}&rdquo; takes effect straight away. No
          release is needed. From that moment the control service refuses every instruction for this
          corridor and records each attempt as blocked by a safety rule — the dispatchers will see
          their approvals start failing, and they will ask why.
          {reasonMissing && ' Say why before applying it.'}
        </OpsAlert>
      )}

      {!withdrawing && direction === 'demotion' && (
        <p className="leading-snug text-muted-foreground">
          A narrower setting, but instructions stay allowed either way — nothing stops working.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <OpsButton
          variant={withdrawing ? 'danger' : direction === 'promotion' ? 'primary' : 'default'}
          className="px-3 py-1.5 text-xs normal-case tracking-normal"
          disabled={busy || reasonMissing}
          onClick={() => void submit()}
        >
          {busy ? 'Applying…' : stageChangeActionLabel(row.stage, stage)}
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
        <p role="status" className="text-success">
          {saved}
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}

      {row.updatedBy && (
        <p className="text-[11px] text-subtle">
          Last set by {row.updatedBy}
          {row.updatedAt ? ` at ${new Date(row.updatedAt).toLocaleString()}` : ''}
          {row.reason ? ` — ${row.reason}` : ''}.
        </p>
      )}

      {showAudit && (
        <div className="border-t border-border pt-3">
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
      <OpsAlert tone="error" title="Command permissions could not be read">
        {loadError} Nothing has changed — this screen cannot see it. Every corridor keeps whatever
        permission it already had.
      </OpsAlert>
    );
  }

  if (!snapshot) {
    return <p className="text-sm text-muted-foreground">Loading command permissions…</p>;
  }

  const visible = filtered.slice(0, limit);

  return (
    <OpsStack>
      {snapshot.source !== 'live' && (
        <OpsAlert tone="warning">
          Showing the last permissions this screen read
          {snapshot.error ? ` — the control service did not answer (${snapshot.error})` : ''}. They
          may no longer be current. Changing one from here still goes to the live service.
        </OpsAlert>
      )}

      <OpsPanel
        title="What each permission means"
        description="Set here, enforced by the control service, with no release in between."
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
          <ul className="space-y-1 text-xs leading-snug text-subtle">
            {ROLLOUT_STAGE_ORDER.map((stage) => (
              <li key={stage}>
                <span
                  className={
                    permitsCommands(stage)
                      ? 'font-medium text-primary'
                      : 'font-medium text-muted-foreground'
                  }
                >
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
        description="Corridors that allow instructions are shown first, because those are the ones whose setting matters today."
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
        <div className="border-b border-border p-3">
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
                ? 'The control service reports no corridors at all.'
                : query.trim()
                  ? 'No corridor in this view matches that search.'
                  : filter === 'commanding'
                    ? 'No corridor allows instructions right now. Every one is set to watch only or watch and suggest, so the control service refuses every instruction across the network.'
                    : 'Every corridor in the network currently allows instructions.'}
            </OpsEmptyState>
          </div>
        ) : (
          <OpsTableFrame className="rounded-none border-0">
            <table className={opsTableClass}>
              <thead>
                <tr className={opsTheadRowClass}>
                  <th className={opsThClass}>Corridor</th>
                  <th className={opsThClass}>Direction</th>
                  <th className={opsThClass}>Permission</th>
                  <th className={opsThClass}>Instructions</th>
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
                        <OpsIdentifier className="ml-2 text-[11px] text-subtle">
                          {row.routeId}
                        </OpsIdentifier>
                      </td>
                      <td className={opsTdMutedClass}>{row.directionCode}</td>
                      <td className={opsTdClass}>{ROLLOUT_STAGE_LABEL[row.stage]}</td>
                      <td className={opsTdClass}>
                        {permitsCommands(row.stage) ? (
                          <span className="font-medium text-primary">Allowed</span>
                        ) : (
                          <span className="text-muted-foreground">Refused</span>
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
                            {open ? 'Close' : 'Change'}
                          </OpsButton>
                        </div>
                      </td>
                    </tr>,
                    open ? (
                      <tr key={`${row.routeDirectionId}-editor`} className={opsTrClass}>
                        <td colSpan={5} className="bg-muted/50 px-3 py-4">
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
          <div className="flex items-center justify-between gap-3 border-t border-border p-3 text-xs text-muted-foreground">
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
