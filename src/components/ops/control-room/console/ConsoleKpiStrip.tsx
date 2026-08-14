'use client';

import { OpsBadge, OpsReadingStat, OpsStatGroup, OpsStatStrip } from '@/components/ops/ui';
import { isObserved } from '@/lib/ops/consoleReadings';
import type {
  ConsoleKpiModel,
  ConsoleKpiScope,
  ConsoleKpiTile,
} from '@/lib/ops/controlRoomOverviewModel';

/**
 * What each scope is called on screen.
 *
 * The two populations are genuinely different sizes and must never read as one
 * set of facts about one thing: the left group counts every bus in Uttar
 * Pradesh, the right group describes ONE corridor out of 759. "Whole state" is
 * the phrase that makes that difference land at a glance — plainer than
 * "network", and it names the actual population rather than a piece of
 * infrastructure.
 *
 * The corridor group says "this corridor" rather than naming it, because which
 * corridor it is already lives in the page subtitle and in the picker, and a
 * third copy is a third thing to keep in step.
 */
const SCOPE_LABEL: Record<ConsoleKpiScope, string> = {
  network: 'Whole state',
  corridor: 'This corridor',
};

/** Scope order on the strip. Whole state first: it is the context the corridor readings sit inside. */
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
 * unavailable count of buses closing up drawn in alert red would read as
 * "buses are closing up", which is the same lie by a different route.
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
          <span className="text-[11px] tabular-nums text-subtle">
            {fetchedAt === null
              ? 'waiting for the first reading'
              : paused
                ? `paused · ${ageSeconds === null ? 'age unknown' : `${ageSeconds}s old`}`
                : ageSeconds === null
                  ? 'updated'
                  : `updated ${ageSeconds}s ago`}
          </span>
        </div>
      </OpsStatStrip>

      {model.killSwitchNotice && (
        <p
          role={model.killSwitchNotice.engaged ? 'alert' : 'status'}
          className={
            model.killSwitchNotice.engaged
              ? 'border-t border-destructive/40 bg-destructive/10 px-6 py-2 text-xs text-destructive'
              : 'border-t border-warning/40 bg-warning/10 px-6 py-2 text-xs text-warning'
          }
        >
          <span className="font-semibold">{model.killSwitchNotice.label}</span> —{' '}
          {model.killSwitchNotice.detail}
        </p>
      )}

      {model.degraded.length > 0 && (
        <p role="status" className="border-t border-border px-6 py-2 text-xs text-warning">
          Some readings are unavailable: {model.degraded.join(', ')} did not answer. Tiles marked{' '}
          <span className="font-mono">n/a</span> are unknown, not zero.
        </p>
      )}

      {/* Muted, not amber, and never alongside the word "unavailable". This is
          a working system reporting a corridor it has nothing to say about;
          styling it as a fault is how the outage claim got here in the first
          place. */}
      {model.corridorNotice !== null && (
        <p role="status" className="border-t border-border px-6 py-2 text-xs text-muted-foreground">
          {model.corridorNotice} Tiles marked <span className="font-mono">—</span> have nothing to
          report, as opposed to <span className="font-mono">n/a</span>, which means unknown.
        </p>
      )}

      {/* Deliberately NOT a live region, and the faintest line on the strip.
          This is true of a perfectly healthy console and is present on every
          shift, so it is context to read once — not a status that should
          announce itself to a screen reader every time the band re-renders.
          The two notices above are events; this one is a standing condition. */}
      {model.coverageNotice !== null && (
        <p className="border-t border-border px-6 py-2 text-[11px] leading-relaxed text-subtle">
          {model.coverageNotice}
        </p>
      )}
    </div>
  );
}

/**
 * One tile, through the shared honest-value primitive.
 *
 * This used to call `readingDisplay` and paint the resulting string itself,
 * which got the two glyphs right and the two ANNOUNCEMENTS wrong: a screen
 * reader says nothing at all for `—` and "n a" for `n/a`, so the distinction
 * the whole strip is built on vanished for an operator using one.
 * `OpsReadingStat` emits the glyph for the eye and the phrase — "nothing to
 * report" or "unknown, could not be read" — for the accessibility tree, and
 * suppresses the unit when there is no value to attach it to.
 */
function ConsoleKpiTileView({ tile }: { tile: ConsoleKpiTile }) {
  return (
    <OpsReadingStat
      label={tile.label}
      reading={tile.reading}
      format={tile.format}
      unit={tile.unit}
      tone={tile.tone}
      className={isObserved(tile.reading) ? undefined : 'opacity-70'}
    />
  );
}
