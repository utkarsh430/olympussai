'use client';

import { useCallback, useState } from 'react';
import {
  OpsAlert,
  OpsButton,
  OpsField,
  OpsPanel,
  OpsStack,
  OpsTextarea,
} from '@/components/ops/ui';
import type { ControlSettings } from '@/lib/controlService/settings';

/**
 * The switch that decides what the controller is optimising.
 *
 * ─── WHY A SWITCH AND NOT A SLIDER ───────────────────────────────────────
 *
 * The obvious design is a weight — "how much do passengers aboard matter?" —
 * and it would be wrong. The in-vehicle term's exchange rate against waiting
 * passengers is the passenger arrival rate, which is currently a placeholder
 * (one passenger per planned headway). A slider over a term whose units are
 * wrong invites an operator to tune their way to a sensible-looking answer,
 * and every position on it would be equally unfounded. A switch says the
 * honest thing: this term is either in the objective or it is not, and there
 * is a prerequisite before it should be.
 *
 * ─── WHY TURNING IT ON IS THE DANGEROUS DIRECTION ────────────────────────
 *
 * It reads as the considerate option, which is exactly why the warning is
 * loud. With the arrival rate still a placeholder, the in-vehicle cost works
 * out at roughly half a planned headway of hold per person aboard — so on a
 * 30-minute corridor a single passenger cancels any hold the controller would
 * have asked for. The controller does not become gentler; it goes quiet. And
 * a controller proposing nothing looks exactly like a network with no
 * problems, which is the failure nobody notices.
 *
 * ─── AND WHY A REASON IS REQUIRED ────────────────────────────────────────
 *
 * Same reason the kill switch requires one. This changes how the engine
 * decides on every corridor at once; six months later the only evidence of
 * why will be this field.
 */
export function OccupancyToggle({
  initialSettings,
  initialError,
}: {
  initialSettings: ControlSettings | null;
  /** Set when the current setting could not be read at all — distinct from "it is off". */
  initialError?: string | null;
}) {
  const [settings, setSettings] = useState<ControlSettings | null>(initialSettings);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

  const target = settings ? !settings.weighOccupancy : null;

  const save = useCallback(async () => {
    if (target === null) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/ops/control-room/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weighOccupancy: target, updateReason: reason.trim() }),
      });
      const data = (await response.json().catch(() => null)) as
        | ControlSettings
        | { error: { code: string; message: string } }
        | null;

      if (!response.ok || !data || 'error' in data) {
        setError(
          data && 'error' in data ? data.error.message : 'The setting could not be changed.',
        );
        return;
      }
      setSettings(data);
      setReason('');
    } catch {
      setError('The setting could not be changed.');
    } finally {
      setSaving(false);
    }
  }, [target, reason]);

  return (
    <OpsPanel title="What the controller is weighing">
      <OpsStack gap="tight">
        {error ? (
          <OpsAlert tone="warning" title="Could not read or change the setting">
            {error}
          </OpsAlert>
        ) : null}

        {settings === null ? (
          // NOT rendered as "off". An unreadable setting and a setting that is
          // off mean different things, and only one of them is safe to act on.
          <OpsAlert tone="warning" title="The current setting is unknown">
            The control service could not be reached, so what the engine is weighing right now
            cannot be confirmed — this is not the same as it being switched off.
          </OpsAlert>
        ) : (
          <>
            <div className="ops-well px-4 py-3">
              <p className="ops-eyebrow">Currently</p>
              <p className="mt-1 text-sm font-medium">
                {settings.weighOccupancy
                  ? 'Even spacing, punctuality, and how full each bus is'
                  : 'Even spacing and punctuality only'}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {settings.weighOccupancy
                  ? 'Holds are weighed against the delay they impose on passengers already aboard.'
                  : 'The engine minimises bunching and the timetable delay bunching causes. How full a bus is does not affect the decision.'}
              </p>
              {settings.updatedBy ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  Last changed by {settings.updatedBy}
                  {settings.updateReason ? ` — ${settings.updateReason}` : ''}
                </p>
              ) : null}
            </div>

            {/*
              The warning is shown only when turning it ON, because that is the
              direction with a prerequisite. Turning it off returns the engine
              to the two priorities the operator named, which needs no caveat.
            */}
            {target === true ? (
              <OpsAlert tone="warning" title="Check this before switching it on">
                Passenger numbers are not being measured yet — the engine currently assumes one
                passenger arrives per planned headway. Until real boarding counts are loaded,
                weighing occupancy will make the engine stop proposing holds almost entirely,
                which looks the same as a network with no problems.
              </OpsAlert>
            ) : null}

            <OpsField
              label="Why are you changing this?"
              htmlFor="occupancy-reason"
              hint="Recorded against the change. This is the only record of why the engine's priorities changed."
              required
            >
              <OpsTextarea
                id="occupancy-reason"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={
                  target
                    ? 'e.g. boarding counts loaded for the Lucknow corridors, arrival rate calibrated'
                    : 'e.g. reverting until boarding data is available'
                }
              />
            </OpsField>

            <OpsButton
              variant={target ? 'danger' : 'primary'}
              onClick={() => void save()}
              disabled={saving || reason.trim().length === 0}
            >
              {saving
                ? 'Changing…'
                : target
                  ? 'Also weigh how full each bus is'
                  : 'Weigh spacing and punctuality only'}
            </OpsButton>
            {reason.trim().length === 0 ? (
              <p className="text-xs text-muted-foreground">A reason is required.</p>
            ) : null}
          </>
        )}
      </OpsStack>
    </OpsPanel>
  );
}
