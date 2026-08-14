/**
 * The control-room console's status band, as data.
 *
 * This module is pure and knows nothing about fetching, so the rule it
 * enforces can be tested exhaustively without a control service: the console
 * shows real numbers or it says it cannot see, and it never confuses the two.
 * The wire type below is what `GET /api/ops/control-room/overview` returns and
 * what `src/lib/ops/controlRoomOverview.ts` composes; the builder underneath
 * is what the strip renders.
 *
 * WHY THE PROVENANCE FLAGS ARE SEPARATE PER SOURCE. The strip mixes four
 * upstreams with genuinely independent failure modes — the GPS fleet feed, the
 * control service's headway sweep, its daily KPI roll-up, and this app's own
 * kill-switch table. During a partial outage the honest console shows live
 * headway beside an unavailable recovery rate. One global "degraded" flag
 * would either blank readings that are fine or, far worse, present stale ones
 * as current. See src/lib/ops/consoleReadings.ts for the three-state reading
 * this is built on.
 */
import type { UpstreamSource } from '@/models/canonical';
import type { BunchingIncident, DailyKpiSnapshot, HeadwayAggregate, RouteDirectionMeta } from '@/models/control';
import type { KillSwitchRecord } from '@/lib/auth/rbac/repo';
import {
  formatPercent,
  formatRatio,
  formatSeconds,
  readingFrom,
  unavailable,
  observed,
  type ConsoleReading,
} from './consoleReadings';

/** The wire shape of GET /api/ops/control-room/overview. Serializable throughout. */
export interface ControlRoomOverview {
  fetchedAt: string;
  /** Corridors the control service reports as active, for the picker. */
  routeDirections: RouteDirectionMeta[];
  /** The corridor this snapshot describes, or null when the service listed none. */
  selectedRouteDirectionId: string | null;
  /** Fleet-feed half: statewide vehicle count and its provenance. */
  fleet: {
    reporting: number;
    source: UpstreamSource;
    stale: boolean;
    error: string | null;
  };
  /** Control-service observability half. `ok` false means headway and incidents below are not to be trusted as current. */
  observability: {
    ok: boolean;
    stale: boolean;
    error: string | null;
  };
  headway: HeadwayAggregate | null;
  /** Open bunching incidents on the selected corridor. Meaningless unless `observability.ok`. */
  incidents: BunchingIncident[];
  /** Today's KPI roll-up for the selected corridor. `ok` false means the roll-up could not be read at all. */
  dailyKpi: {
    ok: boolean;
    /** Null when the roll-up was read but holds no row for this corridor yet. */
    row: DailyKpiSnapshot | null;
  };
  /** Guardrail breaches recorded for the selected corridor. */
  guardrails: {
    ok: boolean;
    total: number;
    critical: number;
  };
  /** Engaged kill switches from this app's own table. `ok` false means the table could not be read. */
  killSwitches: {
    ok: boolean;
    active: KillSwitchRecord[];
  };
}

export interface ConsoleKpiTile {
  label: string;
  reading: ConsoleReading;
  /** Renders `reading.value` when it is observed. */
  format?: (value: number) => string;
  /** Emphasis for the value, decided from the value itself — never from a threshold this module invents. */
  tone?: 'default' | 'accent' | 'good' | 'warn' | 'critical';
  unit?: string;
}

export interface ConsoleKpiModel {
  tiles: ConsoleKpiTile[];
  /** Provenance chip for the fleet feed, matched to the shared badge vocabulary. */
  fleetBadge: { variant: 'live' | 'sim' | 'fixture' | 'critical' | 'neutral'; label: string };
  /** Non-null when at least one kill switch is engaged: the console must not offer to issue anything. */
  killSwitchNotice: { engaged: boolean; label: string; detail: string } | null;
  /** Every upstream that failed, for one honest line under the strip. */
  degraded: string[];
}

/**
 * How bunched is too bunched, for COLOUR ONLY.
 *
 * A coefficient of variation at or above this is what the transit literature
 * and this system's own `route_policies` treat as an irregular service, and
 * the tile turns amber. It changes no number, gates no action, and is
 * deliberately not a threshold the product claims to have measured — the real
 * operational thresholds live in `route_policies` and are applied by the
 * headway detector, which is what actually opens an incident.
 */
const CV_IRREGULAR = 0.5;

export function buildConsoleKpi(overview: ControlRoomOverview): ConsoleKpiModel {
  const degraded: string[] = [];
  if (overview.fleet.source === 'unavailable') degraded.push('the vehicle feed');
  if (!overview.observability.ok) degraded.push('the control service');
  if (!overview.dailyKpi.ok) degraded.push("today's KPI roll-up");
  if (!overview.guardrails.ok) degraded.push('guardrail breaches');
  if (!overview.killSwitches.ok) degraded.push('the kill-switch record');

  const headwayOk = overview.observability.ok;
  const aggregate = overview.headway;
  const sampleNote =
    aggregate === null
      ? 'no headway sample computed yet'
      : `${aggregate.sampleCount} pair ${aggregate.sampleCount === 1 ? 'sample' : 'samples'}`;

  const cv = readingFrom(headwayOk, aggregate?.cv, {
    observed: sampleNote,
    missing: sampleNote,
    unavailable: 'the control service did not answer',
  });

  const tiles: ConsoleKpiTile[] = [
    {
      label: 'Vehicles reporting',
      reading:
        overview.fleet.source === 'unavailable'
          ? unavailable('the vehicle feed did not answer')
          : observed(
              overview.fleet.reporting,
              overview.fleet.stale ? 'last known positions, feed is behind' : 'statewide, live feed',
            ),
      tone: 'accent',
    },
    {
      label: 'Mean headway',
      reading: readingFrom(headwayOk, aggregate?.meanHeadwaySeconds, {
        observed:
          aggregate === null
            ? sampleNote
            : `target ${formatSeconds(aggregate.targetHeadwaySeconds)} · ${sampleNote}`,
        missing: sampleNote,
        unavailable: 'the control service did not answer',
      }),
      format: formatSeconds,
    },
    {
      label: 'Headway CV',
      reading: cv,
      format: formatRatio,
      tone: cv.availability === 'observed' && (cv.value ?? 0) >= CV_IRREGULAR ? 'warn' : 'default',
    },
    {
      label: 'Excess wait',
      reading: readingFrom(headwayOk, aggregate?.ewtSeconds, {
        observed: 'passenger-impact KPI',
        missing: sampleNote,
        unavailable: 'the control service did not answer',
      }),
      format: formatSeconds,
    },
    {
      label: 'Open incidents',
      reading: headwayOk
        ? observed(
            overview.incidents.length,
            overview.incidents.length === 0 ? 'this corridor is clear' : 'bunching on this corridor',
          )
        : unavailable('the control service did not answer'),
      tone:
        headwayOk && overview.incidents.length > 0 ? 'critical' : 'default',
    },
    {
      label: 'Recovery rate',
      reading: readingFrom(overview.dailyKpi.ok, overview.dailyKpi.row?.recoveryRate, {
        observed: overview.dailyKpi.row
          ? `${overview.dailyKpi.row.recoveredIncidentCount}/${overview.dailyKpi.row.incidentCount} incidents today`
          : 'today',
        missing: overview.dailyKpi.row === null ? 'no roll-up for this corridor yet today' : 'not computed for today yet',
        unavailable: 'the KPI roll-up could not be read',
      }),
      format: formatPercent,
    },
    {
      label: 'Guardrail breaches',
      reading: overview.guardrails.ok
        ? observed(
            overview.guardrails.total,
            overview.guardrails.critical > 0
              ? `${overview.guardrails.critical} critical`
              : overview.guardrails.total === 0
                ? 'none recorded'
                : 'none critical',
          )
        : unavailable('breaches could not be read'),
      tone: overview.guardrails.ok && overview.guardrails.critical > 0 ? 'critical' : 'default',
    },
  ];

  return {
    tiles,
    fleetBadge: fleetBadgeFor(overview.fleet.source, overview.fleet.stale),
    killSwitchNotice: killSwitchNoticeFor(overview.killSwitches),
    degraded,
  };
}

/**
 * The provenance chip, mapped onto the shared badge vocabulary rather than a
 * second one. `fixture` genuinely means bundled demo vehicles, and it keeps
 * the command centre's own chip so a fabricated fleet can never look live on
 * one surface and modelled on another.
 */
function fleetBadgeFor(source: UpstreamSource, stale: boolean): ConsoleKpiModel['fleetBadge'] {
  if (source === 'unavailable') return { variant: 'critical', label: 'Feed down' };
  if (source === 'fixture') return { variant: 'fixture', label: 'Demo data' };
  if (stale) return { variant: 'sim', label: 'Last known' };
  return { variant: 'live', label: 'Live' };
}

function killSwitchNoticeFor(killSwitches: ControlRoomOverview['killSwitches']): ConsoleKpiModel['killSwitchNotice'] {
  if (!killSwitches.ok) {
    // Unreadable is NOT "clear". The console cannot promise commands will be
    // accepted, and saying "no kill switch engaged" here would be a claim it
    // has no evidence for.
    return {
      engaged: false,
      label: 'Kill switches unknown',
      detail: 'The kill-switch record could not be read, so whether commands are halted is unknown.',
    };
  }
  if (killSwitches.active.length === 0) return null;

  const network = killSwitches.active.find((entry) => entry.scope === 'network');
  if (network) {
    return {
      engaged: true,
      label: 'Network kill switch engaged',
      detail: `No new commands can be authorized anywhere. Reason: ${network.reason}`,
    };
  }
  const count = killSwitches.active.length;
  return {
    engaged: true,
    label: `${count} route kill ${count === 1 ? 'switch' : 'switches'} engaged`,
    detail: killSwitches.active
      .map((entry) => `${entry.routeDirectionId ?? 'unknown route'}: ${entry.reason}`)
      .join(' · '),
  };
}

/**
 * Whether a command may be issued for this corridor right now, from the same
 * evidence `POST /api/ops/control-room/commands` will consult a moment later.
 * A network switch blocks everything; a route switch blocks only its own
 * corridor. Unknown blocks nothing here on purpose — the command endpoint is
 * the authority and refuses on its own read, so guessing "blocked" would hide
 * a working control on a transient database blip.
 */
export function commandsHaltedFor(
  killSwitches: ControlRoomOverview['killSwitches'],
  routeDirectionId: string | null,
): KillSwitchRecord | null {
  if (!killSwitches.ok) return null;
  return (
    killSwitches.active.find(
      (entry) =>
        entry.scope === 'network' ||
        (routeDirectionId !== null && entry.routeDirectionId === routeDirectionId),
    ) ?? null
  );
}
