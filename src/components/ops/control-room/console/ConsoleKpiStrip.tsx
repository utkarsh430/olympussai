'use client';

import { OpsBadge, OpsStat, OpsStatGroup, OpsStatStrip } from '@/components/ops/ui';
import { isObserved, readingDisplay } from '@/lib/ops/consoleReadings';
import type { ConsoleKpiModel, ConsoleKpiScope, ConsoleKpiTile } from '@/lib/ops/controlRoomOverviewModel';

/**
 * What each scope is called on screen.
 *
 * "Statewide" and "Selected corridor" rather than "network" and "corridor":
 * the point of the caption is to make the two populations obviously different
 * sizes at a glance, and "statewide" is the word that does that work. The
 * corridor caption says "selected" because which corridor it is lives in the
 * shell's subtitle and the picker, and repeating the id here would be a third
 * copy to keep in step.
 */
const SCOPE_LABEL: Record<ConsoleKpiScope, string> = {
  network: 'Statewide',
  corridor: 'Selected corridor',
};

/** Scope order on the strip. Statewide first: it is the context the corridor readings sit inside. */
const SCOPE_ORDER: ConsoleKpiScope[] = ['network', 'corridor'];

/**
 * The band of numbers pinned under the console chrome.
 *
 * It renders `buildConsoleKpi`'s model and decides nothing itself. That split
 * is deliberate: the interesting behaviour here is the refusal to invent a
 * number, and it belongs somewhere a test can enumerate every degraded
 * combination without a DOM. See src/lib/ops/controlRoomOverviewModel.ts.
 *
 * The one presentational rule it does own: a reading that is not observed
 * renders in the muted ink, never in the tone its value would have had. An
 * unavailable incident count drawn in alert red would read as "incidents",
 * which is the same lie by a different route.
 */
export function ConsoleKpiStrip({
  model,
  fetchedAt,
  ageSeconds,
  paused,
}: {
  model: ConsoleKpiModel;
  fetchedAt: string | null;
  /** Seconds since the displayed snapshot was taken. Null before the first one lands. */
  ageSeconds: number | null;
  paused: boolean;
}) {
  return (
    <div>
      <OpsStatStrip>
        {SCOPE_ORDER.map((scope) => {
          const tiles = model.tiles.filter((tile) => tile.scope === scope);
          if (tiles.length === 0) return null;
          return (
            <OpsStatGroup key={scope} label={SCOPE_LABEL[scope]}>
              {tiles.map((tile) => (
                <ConsoleKpiTileView key={tile.label} tile={tile} />
              ))}
            </OpsStatGroup>
          );
        })}

        <div className="ml-auto flex items-center gap-3 self-center">
          <OpsBadge variant={model.fleetBadge.variant}>{model.fleetBadge.label}</OpsBadge>
          <span className="font-mono text-[11px] text-ops-faint">
            {fetchedAt === null
              ? 'awaiting first reading'
              : paused
                ? `paused · ${ageSeconds === null ? 'unknown age' : `${ageSeconds}s old`}`
                : ageSeconds === null
                  ? 'updated'
                  : `updated ${ageSeconds}s ago`}
          </span>
        </div>
      </OpsStatStrip>

      {model.killSwitchNotice && (
        <p
          role={model.killSwitchNotice.engaged ? 'alert' : 'status'}
          className={`border-t px-6 py-2 text-xs ${
            model.killSwitchNotice.engaged
              ? 'border-alert-crimson/40 bg-alert-crimson/10 text-ops-danger'
              : 'border-alert-amber/40 bg-alert-amber/10 text-ops-warn'
          }`}
        >
          <span className="font-semibold">{model.killSwitchNotice.label}</span> — {model.killSwitchNotice.detail}
        </p>
      )}

      {model.degraded.length > 0 && (
        <p role="status" className="border-t border-ops-line px-6 py-2 text-xs text-ops-warn">
          Some readings are unavailable: {model.degraded.join(', ')} did not answer. Tiles marked{' '}
          <span className="font-mono">n/a</span> are unknown, not zero.
        </p>
      )}

      {/* Muted, not amber, and never alongside the word "unavailable". This is
          a working system reporting a corridor it has nothing to say about;
          styling it as a fault is how the outage claim got here in the first
          place. */}
      {model.corridorNotice !== null && (
        <p role="status" className="border-t border-ops-line px-6 py-2 text-xs text-ops-muted">
          {model.corridorNotice} Tiles marked <span className="font-mono">—</span> have nothing to report, as opposed
          to <span className="font-mono">n/a</span>, which means unknown.
        </p>
      )}

      {/* Deliberately NOT a live region, and the faintest line on the strip.
          This is true of a perfectly healthy console and is present on every
          shift, so it is context to read once — not a status that should
          announce itself to a screen reader every time the band re-renders.
          The two notices above are events; this one is a standing condition. */}
      {model.coverageNotice !== null && (
        <p className="border-t border-ops-line px-6 py-2 text-[11px] leading-relaxed text-ops-faint">
          {model.coverageNotice}
        </p>
      )}
    </div>
  );
}

/**
 * One tile. Unchanged in behaviour from when the strip mapped tiles inline —
 * extracted only so the scope groups above stay readable.
 */
function ConsoleKpiTileView({ tile }: { tile: ConsoleKpiTile }) {
  const observedValue = isObserved(tile.reading);
  return (
    <OpsStat
      label={tile.label}
      value={readingDisplay(tile.reading, tile.format)}
      unit={observedValue ? tile.unit : undefined}
      hint={tile.reading.detail}
      tone={observedValue ? (tile.tone ?? 'default') : 'default'}
      className={observedValue ? undefined : 'opacity-70'}
    />
  );
}
